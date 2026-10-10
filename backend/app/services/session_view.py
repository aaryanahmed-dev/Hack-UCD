"""Serialize sessions for a specific viewer (the payload has a viewer-specific `me`)."""

from collections import defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.models.session import (
    ExtensionVote,
    Participant,
    QuizAnswer,
    QuizQuestion,
    SessionStatus,
    SessionTodo,
    StudySession,
)
from app.schemas.session import (
    AssessmentOut,
    AssessmentRule,
    CharityOut,
    ExtensionOut,
    ExtensionOutcome,
    ExtensionRoundOut,
    FocusSummary,
    GroupRef,
    MaterialOut,
    MyResultRef,
    ParticipantOut,
    ParticipantResult,
    QuizProgress,
    SessionConfigOut,
    SessionMe,
    SessionSummaryOut,
    SessionTodoOut,
    StudySessionOut,
    VoteTally,
)
from app.schemas.user import UserSummary
from app.services.realtime import manager
from app.timeutil import utc_now

RESULT_STATUSES = (SessionStatus.REVIEW, SessionStatus.SETTLED)
QUIZ_STATUSES = (SessionStatus.QUIZ, SessionStatus.GRADING, SessionStatus.REVIEW, SessionStatus.SETTLED)


def live_focus_seconds(s: StudySession, p: Participant, now: datetime) -> tuple[int, int]:
    """(focused, unfocused) including the still-running segment while studying."""
    focused, unfocused = p.focused_seconds, p.unfocused_seconds
    if s.status == SessionStatus.STUDYING and p.focus_since and s.study_ends_at:
        segment = int(max(0, (min(now, s.study_ends_at) - p.focus_since).total_seconds()))
        if p.focus_state == "focused":
            focused += segment
        else:
            unfocused += segment
    return focused, unfocused


def focus_percent(focused: int, unfocused: int) -> int:
    total = focused + unfocused
    return round(100 * focused / total) if total else 0


def _focus(s: StudySession, p: Participant, now: datetime) -> FocusSummary | None:
    if s.started_at is None:
        return None
    focused, unfocused = live_focus_seconds(s, p, now)
    return FocusSummary(
        state=p.focus_state,
        focused_seconds=focused,
        unfocused_seconds=unfocused,
        focus_percent=focus_percent(focused, unfocused),
    )


def _quiz_progress(db: Session, s: StudySession) -> dict[str, QuizProgress]:
    if s.status not in QUIZ_STATUSES:
        return {}
    total = len(db.scalars(select(QuizQuestion.id).where(QuizQuestion.session_id == s.id)).all())
    answered: dict[str, int] = defaultdict(int)
    flagged: dict[str, int] = defaultdict(int)
    for a in db.scalars(select(QuizAnswer).where(QuizAnswer.session_id == s.id)):
        if a.answered_at is not None or a.expired:
            answered[a.user_id] += 1
        if a.flagged:
            flagged[a.user_id] += 1
    return {
        p.user_id: QuizProgress(answered=answered[p.user_id], total=total, flagged=flagged[p.user_id])
        for p in s.participants
    }


def _result(s: StudySession, p: Participant) -> ParticipantResult | None:
    if s.status not in RESULT_STATUSES or p.quiz_score is None:
        return None
    return ParticipantResult(
        quiz_score=p.quiz_score,
        focus_percent=p.focus_percent or 0,
        flagged_questions=p.flagged_count,
        passed=bool(p.passed),
        rank=p.rank or 0,
        stake_amount=s.stake_amount,
        payout=p.payout or 0,
        net_amount=p.net_amount or 0,
        bonus_tokens=p.bonus_tokens or 0,
        final=s.status == SessionStatus.SETTLED,
    )


def participant_outs(db: Session, s: StudySession, now: datetime | None = None) -> list[ParticipantOut]:
    now = now or utc_now()
    progress = _quiz_progress(db, s)
    voters = {v.user_id for v in s.assessment_votes}
    return [
        ParticipantOut(
            user=UserSummary.from_user(p.user),
            is_host=p.user_id == s.host_id,
            is_ready=p.is_ready,
            joined_at=p.joined_at,
            presence="online" if manager.in_session(s.id, p.user_id) else "offline",
            has_voted=p.user_id in voters,
            wants_to_finish=p.wants_to_finish,
            focus=_focus(s, p, now),
            quiz_progress=progress.get(p.user_id),
            result=_result(s, p),
        )
        for p in s.participants
    ]


def _assessment(s: StudySession, viewer_id: str) -> AssessmentOut:
    tally: dict[tuple[str, int], int] = defaultdict(int)
    my_vote = None
    for v in s.assessment_votes:
        tally[(v.threshold_type, v.threshold_value)] += 1
        if v.user_id == viewer_id:
            my_vote = AssessmentRule(threshold_type=v.threshold_type, threshold_value=v.threshold_value)
    decided = (
        AssessmentRule(threshold_type=s.threshold_type, threshold_value=s.threshold_value)
        if s.threshold_type is not None and s.threshold_value is not None
        else None
    )
    return AssessmentOut(
        votes=[
            VoteTally(rule=AssessmentRule(threshold_type=t, threshold_value=v), count=c)
            for (t, v), c in sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        my_vote=my_vote,
        decided=decided,
        decided_by=s.assessment_decided_by,
    )


def _extension(db: Session, s: StudySession, viewer_id: str) -> ExtensionOut:
    vote = None
    if s.status == SessionStatus.EXTENSION_VOTE and s.extension_vote_ends_at:
        votes = db.scalars(
            select(ExtensionVote).where(
                ExtensionVote.session_id == s.id, ExtensionVote.round == s.extensions_used + 1
            )
        ).all()
        yes = sum(1 for v in votes if v.extend)
        mine = next((v.extend for v in votes if v.user_id == viewer_id), None)
        vote = ExtensionRoundOut(
            ends_at=s.extension_vote_ends_at,
            yes=yes,
            no=len(votes) - yes,
            voted=len(votes),
            my_vote=mine,
        )
    last = (
        ExtensionOutcome(extended=s.last_extension_extended, decided_by=s.last_extension_decided_by)
        if s.last_extension_extended is not None and s.last_extension_decided_by
        else None
    )
    return ExtensionOut(used=s.extensions_used, vote=vote, last_outcome=last)


def materials_out(s: StudySession) -> list[MaterialOut]:
    participant_ids = {p.user_id for p in s.participants}
    out = []
    for m in s.materials:
        approved = [a.user_id for a in m.approvals]
        out.append(
            MaterialOut(
                id=m.id,
                kind=m.kind,
                title=m.title,
                mime_type=m.mime_type,
                size_bytes=m.size_bytes,
                uploaded_by=UserSummary.from_user(m.uploader),
                uploaded_at=m.uploaded_at,
                approved_by=approved,
                approved_by_all=participant_ids.issubset(approved),
                text_status=m.text_status,
            )
        )
    return out


def config_out(s: StudySession) -> SessionConfigOut:
    return SessionConfigOut(
        title=s.title,
        mode=s.mode,
        stake_amount=s.stake_amount,
        payout_target=s.payout_target,
        charity_id=s.charity_id,
        study_minutes=s.study_minutes,
        extension_minutes=s.extension_minutes,
        max_extensions=s.max_extensions,
        quiz_question_count=s.quiz_question_count,
        min_focus_percent=s.min_focus_percent,
        max_participants=s.max_participants,
        scheduled_for=s.scheduled_for,
    )


def charity_out(c) -> CharityOut | None:
    if c is None:
        return None
    return CharityOut(id=c.id, name=c.name, description=c.description, logo_url=c.logo_url, website_url=c.website_url)


def to_session_out(db: Session, s: StudySession, viewer_id: str) -> StudySessionOut:
    now = utc_now()
    participants = participant_outs(db, s, now)
    mine = next((p for p in participants if p.user.id == viewer_id), None)
    me_participant = s.participant(viewer_id)
    return StudySessionOut(
        id=s.id,
        group=GroupRef(id=s.group_id, name=_group_name(db, s.group_id)),
        status=s.status,
        host=UserSummary.from_user(s.host),
        config=config_out(s),
        charity=charity_out(s.charity),
        participants=participants,
        materials=materials_out(s),
        assessment=_assessment(s, viewer_id),
        extension=_extension(db, s, viewer_id),
        created_at=s.created_at,
        started_at=s.started_at,
        study_ends_at=s.study_ends_at,
        quiz_starts_at=s.quiz_starts_at,
        quiz_ends_at=s.quiz_ends_at,
        review_ends_at=s.review_ends_at,
        settled_at=s.settled_at,
        cancel_reason=s.cancel_reason,
        server_time=now,
        me=SessionMe(
            is_host=s.host_id == viewer_id,
            is_participant=me_participant is not None,
            is_ready=bool(me_participant and me_participant.is_ready),
            quiz_progress=mine.quiz_progress if mine else None,
            review_done=bool(me_participant and me_participant.review_done),
            wants_to_finish=bool(me_participant and me_participant.wants_to_finish),
        ),
    )


def _group_name(db: Session, group_id: str) -> str:
    from app.models.group import Group

    group = db.get(Group, group_id)
    return group.name if group else ""


def to_summary(db: Session, s: StudySession, viewer_id: str) -> SessionSummaryOut:
    p = s.participant(viewer_id)
    my_result = (
        MyResultRef(passed=bool(p.passed), net_amount=p.net_amount or 0)
        if p is not None and s.status == SessionStatus.SETTLED and p.passed is not None
        else None
    )
    return SessionSummaryOut(
        id=s.id,
        group=GroupRef(id=s.group_id, name=_group_name(db, s.group_id)),
        title=s.title,
        status=s.status,
        mode=s.mode,
        stake_amount=s.stake_amount,
        participant_count=len(s.participants),
        scheduled_for=s.scheduled_for,
        started_at=s.started_at,
        settled_at=s.settled_at,
        my_result=my_result,
    )


def todo_out(t: SessionTodo) -> SessionTodoOut:
    return SessionTodoOut(
        id=t.id,
        title=t.title,
        created_by=UserSummary.from_user(t.creator),
        is_done=t.is_done,
        completed_by=UserSummary.from_user(t.completer) if t.completer else None,
        completed_at=t.completed_at,
        created_at=t.created_at,
    )


def todos_out(db: Session, session_id: str) -> list[SessionTodoOut]:
    todos = db.scalars(
        select(SessionTodo).where(SessionTodo.session_id == session_id).order_by(SessionTodo.created_at)
    ).all()
    return [todo_out(t) for t in todos]


def quiz_seconds() -> int:
    return config.QUIZ_SECONDS_PER_QUESTION
