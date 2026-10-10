"""Study session lifecycle (API_SPEC §7): lobby, studying, extension vote, focus and shared to-dos.

Rules:
- Every mutation locks the session row first (`lock_session`) so concurrent requests and the
  background engine can't interleave.
- Status changes happen only in this module and in services/quiz.py, and are followed by
  `manager.notify_session()` after commit so watchers get a fresh snapshot.
"""

import secrets
from collections import Counter
from datetime import datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import config
from app.errors import ApiError, not_found
from app.models.group import GroupMember
from app.models.ledger import Currency, LedgerEntryType
from app.models.session import (
    ENDED_STATUSES,
    AssessmentVote,
    Charity,
    ExtensionVote,
    MaterialApproval,
    Participant,
    SessionStatus,
    SessionTodo,
    StudySession,
)
from app.models.user import User
from app.schemas.session import AssessmentRule, CreateTodo, SessionConfig, UpdateSessionConfig, UpdateTodo
from app.services import ledger
from app.services.realtime import manager
from app.services.session_view import focus_percent, to_session_out, todos_out
from app.timeutil import is_adult, utc_now

ACTIVE_STATUSES = tuple(s for s in SessionStatus if s not in ENDED_STATUSES)


# ───────── Loading & permissions ─────────


def _require_group_member(db: Session, group_id: str, user: User) -> None:
    if db.get(GroupMember, (group_id, user.id)) is None:
        raise not_found("Session")


def get_session(db: Session, session_id: str, user: User) -> StudySession:
    """Any member of the session's group can view it."""
    s = db.get(StudySession, session_id)
    if s is None:
        raise not_found("Session")
    _require_group_member(db, s.group_id, user)
    return s


def lock_session(db: Session, session_id: str) -> StudySession | None:
    return db.scalar(
        select(StudySession)
        .where(StudySession.id == session_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def get_session_for_update(db: Session, session_id: str, user: User) -> StudySession:
    s = lock_session(db, session_id)
    if s is None:
        raise not_found("Session")
    _require_group_member(db, s.group_id, user)
    return s


def _require_participant(s: StudySession, user: User) -> Participant:
    p = s.participant(user.id)
    if p is None:
        raise ApiError(403, "forbidden", "You're not taking part in this session.")
    return p


def _require_host(s: StudySession, user: User) -> None:
    if s.host_id != user.id:
        raise ApiError(403, "forbidden", "Only the session host can do that.")


def _require_status(s: StudySession, *statuses: str, action: str = "do that") -> None:
    if s.status not in statuses:
        raise ApiError(409, "invalid_session_state", f"You can't {action} right now (session is {s.status}).")


def active_session_for_group(db: Session, group_id: str) -> StudySession | None:
    return db.scalar(
        select(StudySession)
        .where(StudySession.group_id == group_id, StudySession.status.in_(ACTIVE_STATUSES))
        .order_by(StudySession.created_at.desc())
    )


def user_in_active_session(db: Session, group_id: str, user_id: str) -> bool:
    return (
        db.scalar(
            select(Participant.user_id)
            .join(StudySession, StudySession.id == Participant.session_id)
            .where(
                StudySession.group_id == group_id,
                StudySession.status.in_(ACTIVE_STATUSES),
                Participant.user_id == user_id,
            )
        )
        is not None
    )


def _currency(s: StudySession) -> Currency:
    return Currency.COINS if s.mode == "money" else Currency.TOKENS


def _unready_all(s: StudySession) -> None:
    for p in s.participants:
        p.is_ready = False


def _commit_and_notify(db: Session, s: StudySession, kind: str = "session.updated") -> StudySession:
    db.commit()
    manager.notify_session(s.id, kind)
    return s


# ───────── Config ─────────


def _check_config(db: Session, cfg: SessionConfig, participants: list[User]) -> None:
    if cfg.charity_id is not None:
        charity = db.get(Charity, cfg.charity_id)
        if charity is None or not charity.is_active:
            raise ApiError(
                422, "validation_error", "Pick a charity from the list.",
                [{"field": "charityId", "message": "unknown charity"}],
            )
    if cfg.mode == "money" and not all(is_adult(u.date_of_birth) for u in participants):
        raise ApiError(403, "age_restricted", "Money sessions are only for participants aged 18+.")
    if cfg.mode == "money" and _verification_missing(participants):
        raise ApiError(403, "verification_required", "Everyone needs to verify their ID for a money session.")
    if cfg.max_participants < len(participants):
        raise ApiError(
            422, "validation_error", "There are already more participants than that.",
            [{"field": "maxParticipants", "message": "below current participant count"}],
        )


def _verification_missing(users: list[User]) -> bool:
    from app.services import verification

    return verification.required() and any(u.id_verified_at is None for u in users)


def _apply_config(s: StudySession, cfg: SessionConfig) -> None:
    for field, value in cfg.model_dump().items():
        setattr(s, field, value)


def _validation_error(exc: ValidationError) -> ApiError:
    details = [{"field": ".".join(str(p) for p in e["loc"]) or "body", "message": e["msg"]} for e in exc.errors()]
    message = details[0]["message"].removeprefix("Value error, ") if details else "Some fields are invalid."
    return ApiError(422, "validation_error", message, details)


def create_session(db: Session, user: User, group_id: str, cfg: SessionConfig) -> StudySession:
    if db.get(GroupMember, (group_id, user.id)) is None:
        raise not_found("Group")
    if active_session_for_group(db, group_id) is not None:
        raise ApiError(409, "conflict", "This group already has a session in progress.")
    _check_config(db, cfg, [user])
    s = StudySession(group_id=group_id, host_id=user.id, status=SessionStatus.LOBBY)
    _apply_config(s, cfg)
    s.participants.append(Participant(user_id=user.id))
    db.add(s)
    db.commit()
    _sync_calendar(s)
    return s


def _sync_calendar(s: StudySession) -> None:
    if s.scheduled_for is not None:
        from app.services import google_calendar

        google_calendar.sync_session_async(s.id)


def update_config(db: Session, s: StudySession, user: User, changes: UpdateSessionConfig) -> StudySession:
    _require_host(s, user)
    _require_status(s, SessionStatus.LOBBY, action="change the settings")
    current = {
        k: getattr(s, k) for k in SessionConfig.model_fields
    }
    merged = {**current, **changes.model_dump(exclude_unset=True)}
    try:
        cfg = SessionConfig(**merged)
    except ValidationError as exc:
        raise _validation_error(exc)
    _check_config(db, cfg, [p.user for p in s.participants])
    previously_scheduled = s.scheduled_for
    _apply_config(s, cfg)
    if s.scheduled_for != previously_scheduled:
        s.reminder_sent_at = None
    _unready_all(s)  # nobody stays committed to terms they haven't seen
    _commit_and_notify(db, s)
    if previously_scheduled is not None or s.scheduled_for is not None:
        from app.services import google_calendar

        google_calendar.sync_session_async(s.id)
    return s


# ───────── Lobby ─────────


def join(db: Session, s: StudySession, user: User) -> StudySession:
    _require_status(s, SessionStatus.LOBBY, action="join")
    if s.participant(user.id) is not None:
        raise ApiError(409, "already_member", "You're already in this session.")
    if len(s.participants) >= s.max_participants:
        raise ApiError(409, "session_full", "This session is full.")
    if s.mode == "money" and not is_adult(user.date_of_birth):
        raise ApiError(403, "age_restricted", "Money sessions are only for participants aged 18+.")
    if s.mode == "money" and _verification_missing([user]):
        raise ApiError(403, "verification_required", "Verify your ID in your wallet to join a money session.")
    s.participants.append(Participant(user_id=user.id))
    _commit_and_notify(db, s)
    _sync_calendar(s)
    return s


def leave(db: Session, s: StudySession, user: User) -> None:
    _require_status(s, SessionStatus.LOBBY, action="leave")
    p = _require_participant(s, user)
    s.participants.remove(p)
    for vote in [v for v in s.assessment_votes if v.user_id == user.id]:
        s.assessment_votes.remove(vote)
    if not s.participants:
        s.status = SessionStatus.CANCELLED
        s.cancel_reason = "Everyone left the lobby."
    elif s.host_id == user.id:
        s.host_id = s.participants[0].user_id  # earliest joined
    _commit_and_notify(db, s)
    _sync_calendar(s)


def cancel(db: Session, s: StudySession, user: User) -> None:
    _require_host(s, user)
    _require_status(s, SessionStatus.LOBBY, action="cancel the session")
    s.status = SessionStatus.CANCELLED
    s.cancel_reason = "The host cancelled the session."
    _commit_and_notify(db, s)
    _sync_calendar(s)


def vote_assessment(db: Session, s: StudySession, user: User, rule: AssessmentRule) -> StudySession:
    _require_status(s, SessionStatus.LOBBY, action="vote")
    _require_participant(s, user)
    vote = next((v for v in s.assessment_votes if v.user_id == user.id), None)
    if vote is None:
        s.assessment_votes.append(
            AssessmentVote(user_id=user.id, threshold_type=rule.threshold_type, threshold_value=rule.threshold_value)
        )
    else:
        vote.threshold_type = rule.threshold_type
        vote.threshold_value = rule.threshold_value
    return _commit_and_notify(db, s)


def _ready_blockers(db: Session, s: StudySession, user: User) -> str | None:
    if not any(v.user_id == user.id for v in s.assessment_votes):
        return "Vote on how the quiz is passed first."
    for m in s.materials:
        if m.text_status != "ready":
            return f"“{m.title}” couldn't be read. Remove it or paste the text instead."
        if not any(a.user_id == user.id for a in m.approvals):
            return "Approve all the study material first."
    if s.mode == "money" and not is_adult(user.date_of_birth):
        return "Money sessions are only for participants aged 18+."
    if s.stake_amount > ledger.balance(db, user.id, _currency(s)):
        unit = "coins" if s.mode == "money" else "tokens"
        return f"You need {s.stake_amount} {unit} to stake in this session."
    return None


def set_ready(db: Session, s: StudySession, user: User, is_ready: bool) -> StudySession:
    _require_status(s, SessionStatus.LOBBY, action="ready up")
    p = _require_participant(s, user)
    if is_ready:
        blocker = _ready_blockers(db, s, user)
        if blocker:
            code = "insufficient_balance" if "need" in blocker and "stake" in blocker else "invalid_session_state"
            raise ApiError(409, code, blocker)
    p.is_ready = is_ready
    return _commit_and_notify(db, s)


def resolve_assessment(votes: list[AssessmentVote]) -> tuple[str, int, str]:
    """Most-voted threshold type wins (coin flip on a tie); its value is the median of its votes."""
    type_counts = Counter(v.threshold_type for v in votes)
    top = max(type_counts.values())
    tied = sorted(t for t, c in type_counts.items() if c == top)
    decided_by = "vote"
    winner = tied[0]
    if len(tied) > 1:
        winner = tied[secrets.randbelow(len(tied))]
        decided_by = "coin_flip"
    values = sorted(v.threshold_value for v in votes if v.threshold_type == winner)
    return winner, values[(len(values) - 1) // 2], decided_by


def start(db: Session, s: StudySession, user: User) -> StudySession:
    _require_host(s, user)
    _require_status(s, SessionStatus.LOBBY, action="start")
    if len(s.participants) < 2:
        raise ApiError(409, "invalid_session_state", "You need at least 2 people to start.")
    not_ready = [p.user.display_name for p in s.participants if not p.is_ready]
    if not_ready:
        raise ApiError(409, "invalid_session_state", f"Waiting for {', '.join(not_ready)} to get ready.")
    if not s.materials:
        raise ApiError(409, "invalid_session_state", "Add some study material first.")
    participant_ids = {p.user_id for p in s.participants}
    for m in s.materials:
        if m.text_status != "ready" or not participant_ids.issubset(a.user_id for a in m.approvals):
            raise ApiError(409, "invalid_session_state", "Everyone has to approve all the study material.")

    currency = _currency(s)
    for p in sorted(s.participants, key=lambda p: p.user_id):  # stable lock order
        ledger.lock_user(db, p.user_id)
        if s.stake_amount > ledger.balance(db, p.user_id, currency):
            raise ApiError(409, "insufficient_balance", f"{p.user.display_name} no longer has enough to stake.")

    s.threshold_type, s.threshold_value, s.assessment_decided_by = resolve_assessment(s.assessment_votes)
    now = utc_now()
    if s.stake_amount > 0:
        for p in s.participants:
            ledger.add_entry(
                db, user_id=p.user_id, currency=currency, amount=-s.stake_amount,
                type=LedgerEntryType.STAKE, session_id=s.id, description=f"Stake: {s.title}",
            )
    s.status = SessionStatus.STUDYING
    s.started_at = now
    s.study_ends_at = now + timedelta(minutes=s.study_minutes)
    for p in s.participants:
        # Study time isn't focus-tracked (use any resources you like); it all counts as studied.
        p.focus_state = "focused"
        p.focus_since = now
    return _commit_and_notify(db, s)


def refund_stakes(db: Session, s: StudySession, reason: str) -> None:
    """Cancel a started session and give everyone their stake back."""
    if s.stake_amount > 0 and s.started_at is not None:
        for p in s.participants:
            ledger.add_entry(
                db, user_id=p.user_id, currency=_currency(s), amount=s.stake_amount,
                type=LedgerEntryType.STAKE_REFUND, session_id=s.id, description=f"Refund: {s.title}",
            )
    s.status = SessionStatus.CANCELLED
    s.cancel_reason = reason


# ───────── Focus (API_SPEC §7.4) ─────────


def _flush_focus(s: StudySession, until: datetime) -> None:
    """Add each participant's running segment to their totals and stop the clock."""
    for p in s.participants:
        if p.focus_since is not None:
            end = min(until, s.study_ends_at) if s.study_ends_at else until
            segment = int(max(0, (end - p.focus_since).total_seconds()))
            if p.focus_state == "focused":
                p.focused_seconds += segment
            else:
                p.unfocused_seconds += segment
            p.focus_since = None
        p.focus_percent = focus_percent(p.focused_seconds, p.unfocused_seconds)


def update_focus(db: Session, session_id: str, user_id: str, state: str) -> None:
    """Record a focus change from the session socket (or the REST fallback). Only the quiz is tracked."""
    s = lock_session(db, session_id)
    if s is None:
        return
    p = s.participant(user_id)
    if p is None:
        db.rollback()
        return
    if s.status == SessionStatus.STUDYING:
        # Focus is only tracked during the quiz (anti-cheat); the study block counts in full.
        db.rollback()
        return
    now = utc_now()
    changed = p.focus_state != state
    p.focus_state = state
    if s.status == SessionStatus.QUIZ and state != "focused":
        from app.services import quiz

        quiz.flag_open_question(db, s, user_id, now)
    db.commit()
    if changed or s.status == SessionStatus.QUIZ:
        manager.notify_session(s.id)


# ───────── Timers (driven by the engine) ─────────


def end_study(db: Session, s: StudySession, now: datetime) -> None:
    _flush_focus(s, now)
    if s.extensions_used < s.max_extensions:
        s.status = SessionStatus.EXTENSION_VOTE
        s.extension_vote_ends_at = now + timedelta(seconds=config.EXTENSION_VOTE_SECONDS)
    else:
        s.status = SessionStatus.GENERATING_QUIZ


def set_finish_early(db: Session, s: StudySession, user: User, wants_to_finish: bool) -> StudySession:
    """Opt in/out of ending the study block early. When everyone has opted in, it ends now and the
    quiz starts straight away (no extension vote — everyone just said they're done)."""
    _require_status(s, SessionStatus.STUDYING, action="finish early")
    p = _require_participant(s, user)
    p.wants_to_finish = wants_to_finish
    if all(x.wants_to_finish for x in s.participants):
        now = utc_now()
        s.study_ends_at = now
        _flush_focus(s, now)
        s.status = SessionStatus.GENERATING_QUIZ
    return _commit_and_notify(db, s)


def _extension_votes(db: Session, s: StudySession) -> list[ExtensionVote]:
    return list(
        db.scalars(
            select(ExtensionVote).where(
                ExtensionVote.session_id == s.id, ExtensionVote.round == s.extensions_used + 1
            )
        )
    )


def resolve_extension(db: Session, s: StudySession, now: datetime) -> None:
    """2 people: both must say yes. 3+: majority; a tie is a coin flip. Non-voters count as no."""
    votes = _extension_votes(db, s)
    n = len(s.participants)
    yes = sum(1 for v in votes if v.extend)
    no = n - yes
    decided_by = "vote"
    if n == 2:
        extend = yes == 2
    elif yes == no:
        extend = secrets.randbelow(2) == 1
        decided_by = "coin_flip"
    else:
        extend = yes > no
    s.last_extension_extended = extend
    s.last_extension_decided_by = decided_by
    s.extension_vote_ends_at = None
    if extend:
        s.extensions_used += 1
        s.status = SessionStatus.STUDYING
        s.study_ends_at = now + timedelta(minutes=s.extension_minutes)
        for p in s.participants:
            p.focus_since = now
            p.wants_to_finish = False  # a new block needs a fresh agreement to end early
    else:
        s.status = SessionStatus.GENERATING_QUIZ


def vote_extension(db: Session, s: StudySession, user: User, extend: bool) -> StudySession:
    _require_status(s, SessionStatus.EXTENSION_VOTE, action="vote on an extension")
    _require_participant(s, user)
    votes = _extension_votes(db, s)
    if any(v.user_id == user.id for v in votes):
        raise ApiError(409, "already_voted", "You've already voted.")
    db.add(ExtensionVote(session_id=s.id, round=s.extensions_used + 1, user_id=user.id, extend=extend))
    db.flush()
    if len(votes) + 1 >= len(s.participants):  # everyone voted: decide now
        resolve_extension(db, s, utc_now())
    return _commit_and_notify(db, s)


# ───────── Shared to-dos ─────────


def _require_todo_access(s: StudySession, user: User) -> None:
    _require_participant(s, user)
    if s.status in ENDED_STATUSES:
        raise ApiError(409, "invalid_session_state", "This session has ended.")


def list_todos(db: Session, s: StudySession):
    return todos_out(db, s.id)


def create_todo(db: Session, s: StudySession, user: User, data: CreateTodo) -> SessionTodo:
    _require_todo_access(s, user)
    todo = SessionTodo(session_id=s.id, title=data.title, created_by=user.id)
    db.add(todo)
    db.commit()
    manager.notify_session(s.id, "session.todos")
    return todo


def _get_todo(db: Session, s: StudySession, todo_id: str) -> SessionTodo:
    todo = db.get(SessionTodo, todo_id)
    if todo is None or todo.session_id != s.id:
        raise not_found("To-do")
    return todo


def update_todo(db: Session, s: StudySession, user: User, todo_id: str, data: UpdateTodo) -> SessionTodo:
    _require_todo_access(s, user)
    todo = _get_todo(db, s, todo_id)
    changes = data.model_dump(exclude_unset=True)
    if changes.get("title"):
        todo.title = changes["title"].strip()
    if "is_done" in changes and changes["is_done"] is not None and changes["is_done"] != todo.is_done:
        todo.is_done = changes["is_done"]
        todo.completed_by = user.id if todo.is_done else None
        todo.completed_at = utc_now() if todo.is_done else None
    db.commit()
    db.refresh(todo)
    manager.notify_session(s.id, "session.todos")
    return todo


def delete_todo(db: Session, s: StudySession, user: User, todo_id: str) -> None:
    _require_todo_access(s, user)
    db.delete(_get_todo(db, s, todo_id))
    db.commit()
    manager.notify_session(s.id, "session.todos")


# ───────── Material approvals helpers (used by services/materials.py) ─────────


def clear_approvals_for(db: Session, s: StudySession, user_id: str) -> None:
    material_ids = [m.id for m in s.materials]
    if material_ids:
        db.execute(
            delete(MaterialApproval).where(
                MaterialApproval.material_id.in_(material_ids), MaterialApproval.user_id == user_id
            )
        )


# ───────── Broadcast snapshots ─────────


def build_snapshots(kind: str, session_id: str, user_ids: list[str]) -> dict[str, dict]:
    from app import db as db_module

    with db_module.SessionLocal() as db:
        s = db.get(StudySession, session_id)
        if s is None:
            return {}
        if kind == "session.todos":
            data = {"items": [t.model_dump(by_alias=True, mode="json") for t in todos_out(db, s.id)]}
            return {u: {"type": kind, "data": data} for u in user_ids}
        return {
            u: {"type": "session.updated", "data": to_session_out(db, s, u).model_dump(by_alias=True, mode="json")}
            for u in user_ids
        }


manager.snapshot_builder = build_snapshots
