"""Quiz, review and settlement (API_SPEC §7.6–7.8).

AI calls (generation, grading) are slow, so they run outside DB transactions in background jobs
started by the engine: read what's needed → call OpenRouter → lock the session and write results.
"""

import logging
import math
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app import db as db_module
from app.errors import ApiError
from app.models.ledger import Currency, LedgerEntryType
from app.models.session import (
    Dispute,
    DisputeVote,
    QuizAnswer,
    QuizQuestion,
    SessionStatus,
    StudySession,
)
from app.models.user import User
from app.schemas.session import (
    CurrentQuestion,
    DisputeOut,
    MyAnswer,
    QuestionReview,
    QuizOption,
    QuizQuestionOut,
    ReviewOut,
)
from app.schemas.user import UserSummary
from app.services import ai, ledger, settlement
from app.services.realtime import manager
from app.services.session_view import participant_outs
from app.services.sessions import _require_participant, _require_status, lock_session, refund_stakes
from app.timeutil import utc_now

logger = logging.getLogger(__name__)


def _questions(db: Session, session_id: str) -> list[QuizQuestion]:
    return list(db.scalars(select(QuizQuestion).where(QuizQuestion.session_id == session_id).order_by(QuizQuestion.index)))


def _answers(db: Session, session_id: str, user_id: str | None = None) -> list[QuizAnswer]:
    query = select(QuizAnswer).where(QuizAnswer.session_id == session_id)
    if user_id:
        query = query.where(QuizAnswer.user_id == user_id)
    return list(db.scalars(query))


def question_out(q: QuizQuestion) -> QuizQuestionOut:
    return QuizQuestionOut(
        id=q.id,
        index=q.index,
        type=q.type,
        prompt=q.prompt,
        options=[QuizOption(**o) for o in q.options] if q.options else None,
        time_limit_seconds=config.QUIZ_SECONDS_PER_QUESTION,
    )


# ───────── Generation (background job) ─────────


def material_text(s: StudySession) -> str:
    parts = [f"## {m.title}\n{m.extracted_text}" for m in s.materials if m.extracted_text]
    return "\n\n".join(parts)[: config.MAX_MATERIAL_CHARS_FOR_QUIZ]


def generate_quiz_job(session_id: str) -> None:
    with db_module.SessionLocal() as db:
        s = db.get(StudySession, session_id)
        if s is None or s.status != SessionStatus.GENERATING_QUIZ:
            return
        text, count = material_text(s), s.quiz_question_count

    questions, last_error = None, None
    for attempt in range(1, config.QUIZ_GENERATION_ATTEMPTS + 1):
        try:
            questions = ai.generate_quiz(text, count)
            break
        except ai.AiError as exc:
            last_error = exc
            logger.warning("Quiz generation attempt %s for %s failed: %s", attempt, session_id, exc)

    with db_module.SessionLocal() as db:
        s = lock_session(db, session_id)
        if s is None or s.status != SessionStatus.GENERATING_QUIZ:
            return
        if questions is None:
            logger.error("Giving up on quiz for %s: %s", session_id, last_error)
            refund_stakes(db, s, "We couldn't generate the quiz, so everyone's stake was refunded.")
        else:
            for i, q in enumerate(questions):
                db.add(QuizQuestion(
                    session_id=s.id, index=i, type=q.type, prompt=q.prompt, options=q.options,
                    correct_option_id=q.correct_option_id, model_answer=q.model_answer,
                ))
            now = utc_now()
            s.status = SessionStatus.QUIZ
            s.quiz_starts_at = now
            s.quiz_ends_at = now + timedelta(
                seconds=len(questions) * config.QUIZ_SECONDS_PER_QUESTION + config.QUIZ_EXTRA_SECONDS
            )
        db.commit()
    manager.notify_session(session_id)


# ───────── Taking the quiz ─────────


def _grace() -> timedelta:
    return timedelta(seconds=config.QUIZ_ANSWER_GRACE_SECONDS)


def _expire(answer: QuizAnswer) -> None:
    answer.expired = True
    answer.answered_at = answer.deadline
    answer.score = 0.0


def _advance(db: Session, s: StudySession, user_id: str, now: datetime) -> tuple[QuizQuestion | None, QuizAnswer | None, int, int]:
    """Find the user's current question, expiring overdue ones and serving the next (starts its timer)."""
    questions = _questions(db, s.id)
    answers = {a.question_id: a for a in _answers(db, s.id, user_id)}
    for number, q in enumerate(questions, start=1):
        a = answers.get(q.id)
        if a is None:
            a = QuizAnswer(
                session_id=s.id, user_id=user_id, question_id=q.id, served_at=now,
                deadline=now + timedelta(seconds=config.QUIZ_SECONDS_PER_QUESTION),
            )
            db.add(a)
            db.flush()
            return q, a, number, len(questions)
        if a.answered_at is None:
            if now > a.deadline + _grace():
                _expire(a)
                continue
            return q, a, number, len(questions)
    return None, None, len(questions), len(questions)


def _current_out(q, a, number, total, now) -> CurrentQuestion:
    return CurrentQuestion(
        question=question_out(q) if q else None,
        number=number,
        total=total,
        deadline=a.deadline if a else None,
        server_time=now,
    )


def current_question(db: Session, s: StudySession, user: User) -> CurrentQuestion:
    _require_status(s, SessionStatus.QUIZ, action="take the quiz")
    _require_participant(s, user)
    now = utc_now()
    q, a, number, total = _advance(db, s, user.id, now)
    finished = q is None
    if finished:
        _maybe_finish(db, s)
    db.commit()
    if finished or a is not None:
        manager.notify_session(s.id)  # progress changed
    return _current_out(q, a, number, total, now)


def submit_answer(db: Session, s: StudySession, user: User, question_id: str, option_id: str | None, text: str | None) -> CurrentQuestion:
    _require_status(s, SessionStatus.QUIZ, action="answer")
    _require_participant(s, user)
    now = utc_now()
    q, a, _, _ = _advance(db, s, user.id, now)
    if q is None or q.id != question_id:
        db.commit()  # keep any expiries
        raise ApiError(409, "question_expired", "Time's up for that question.")
    if now > a.deadline + _grace():
        _expire(a)
        db.commit()
        raise ApiError(409, "question_expired", "Time's up for that question.")

    a.answered_at = now
    if q.type == "multiple_choice":
        valid = {o["id"] for o in q.options or []}
        a.option_id = option_id if option_id in valid else None
        a.score = 0.0 if a.flagged else (1.0 if a.option_id == q.correct_option_id else 0.0)
    else:
        a.text = (text or "").strip()[:1000] or None
        if a.flagged or not a.text:
            a.score = 0.0  # otherwise graded by the AI after the quiz

    q, a, number, total = _advance(db, s, user.id, now)
    if q is None:
        _maybe_finish(db, s)
    db.commit()
    manager.notify_session(s.id)
    return _current_out(q, a, number, total, now)


def flag_open_question(db: Session, s: StudySession, user_id: str, now: datetime) -> None:
    """Anti-cheat: leaving the app while a question is open scores that question 0."""
    open_answer = db.scalar(
        select(QuizAnswer).where(
            QuizAnswer.session_id == s.id, QuizAnswer.user_id == user_id, QuizAnswer.answered_at.is_(None)
        )
    )
    if open_answer is not None and now <= open_answer.deadline + _grace() and not open_answer.flagged:
        open_answer.flagged = True
        open_answer.score = 0.0


def _maybe_finish(db: Session, s: StudySession) -> None:
    """Close the quiz once every participant has answered (or run out of time on) every question."""
    total = len(_questions(db, s.id))
    done: dict[str, int] = {}
    for a in _answers(db, s.id):
        if a.answered_at is not None:
            done[a.user_id] = done.get(a.user_id, 0) + 1
    if all(done.get(p.user_id, 0) >= total for p in s.participants):
        s.status = SessionStatus.GRADING


def close_quiz(db: Session, s: StudySession, now: datetime) -> None:
    """Hard cut-off at quiz_ends_at: anything unanswered scores 0."""
    for a in _answers(db, s.id):
        if a.answered_at is None:
            _expire(a)
    s.status = SessionStatus.GRADING


# ───────── Grading (background job) ─────────


def grade_job(session_id: str) -> None:
    with db_module.SessionLocal() as db:
        s = db.get(StudySession, session_id)
        if s is None or s.status != SessionStatus.GRADING:
            return
        questions = {q.id: q for q in _questions(db, session_id)}
        pending = [
            {"id": a.id, "question": questions[a.question_id].prompt,
             "reference": questions[a.question_id].model_answer or "", "answer": a.text or ""}
            for a in _answers(db, session_id)
            if a.score is None and questions[a.question_id].type == "short_answer"
        ]

    grades: dict[str, ai.Grade] = {}
    if pending:
        try:
            grades = ai.grade_short_answers(pending)
        except ai.AiError as exc:
            logger.warning("AI grading failed for %s, using fallback: %s", session_id, exc)
        for item in pending:
            if item["id"] not in grades:
                grades[item["id"]] = ai.fallback_grade(item["reference"], item["answer"])

    with db_module.SessionLocal() as db:
        s = lock_session(db, session_id)
        if s is None or s.status != SessionStatus.GRADING:
            return
        for a in _answers(db, session_id):
            if a.id in grades and a.score is None:
                a.score = grades[a.id].score
                a.feedback = grades[a.id].feedback or None
            elif a.score is None:
                a.score = 0.0
        compute_results(db, s, final=False)
        s.status = SessionStatus.REVIEW
        s.review_ends_at = utc_now() + timedelta(seconds=config.REVIEW_SECONDS)
        db.commit()
    manager.notify_session(session_id)


# ───────── Results & settlement ─────────


def compute_results(db: Session, s: StudySession, final: bool) -> settlement.Settlement:
    """Score everyone over non-nullified questions and work out payouts (§7.3, §7.8).
    With final=True the payouts are written to the ledger."""
    questions = [q for q in _questions(db, s.id) if not q.nullified]
    answers = _answers(db, s.id)
    by_user: dict[str, dict[str, QuizAnswer]] = {}
    flagged: dict[str, int] = {}
    for a in answers:
        by_user.setdefault(a.user_id, {})[a.question_id] = a
        if a.flagged:
            flagged[a.user_id] = flagged.get(a.user_id, 0) + 1

    entrants = []
    for p in s.participants:
        mine = by_user.get(p.user_id, {})
        total = sum((mine[q.id].score or 0.0) if q.id in mine else 0.0 for q in questions)
        score = round(100 * total / len(questions)) if questions else 0
        entrants.append(settlement.Entrant(p.user_id, score, p.focus_percent or 0, p.focused_seconds))
        p.quiz_score = score
        p.flagged_count = flagged.get(p.user_id, 0)

    result = settlement.settle(
        entrants,
        stake=s.stake_amount,
        mode=s.mode,
        payout_target=s.payout_target,
        threshold_type=s.threshold_type or "fixed",
        threshold_value=s.threshold_value if s.threshold_value is not None else 0,
        min_focus_percent=s.min_focus_percent,
        bonus_multiplier=config.WINNER_BONUS_MULTIPLIER,
    )
    for p in s.participants:
        o = result.outcomes[p.user_id]
        p.passed, p.rank, p.payout, p.net_amount, p.bonus_tokens = o.passed, o.rank, o.payout, o.net_amount, o.bonus_tokens

    if final:
        _write_ledger(db, s, result)
    return result


def _write_ledger(db: Session, s: StudySession, result: settlement.Settlement) -> None:
    currency = Currency.COINS if s.mode == "money" else Currency.TOKENS
    names = {p.user_id: p.user.display_name for p in s.participants}
    for p in s.participants:
        o = result.outcomes[p.user_id]
        if (o.passed or p.user_id in result.refunded) and s.stake_amount > 0:
            ledger.add_entry(db, user_id=p.user_id, currency=currency, amount=s.stake_amount,
                             type=LedgerEntryType.STAKE_REFUND, session_id=s.id, description=f"Stake back: {s.title}")
        if o.bonus_tokens > 0:
            ledger.add_entry(db, user_id=p.user_id, currency=Currency.TOKENS, amount=o.bonus_tokens,
                             type=LedgerEntryType.WINNER_BONUS, session_id=s.id, description=f"Winner's bonus: {s.title}")
    for t in result.transfers:
        ledger.add_entry(db, user_id=t.to_user, currency=currency, amount=t.amount, type=LedgerEntryType.WINNINGS,
                         session_id=s.id, counterparty_user_id=t.from_user,
                         description=f"Won from {names.get(t.from_user, 'a friend')}: {s.title}")


def settle(db: Session, s: StudySession, now: datetime) -> None:
    for dispute in db.scalars(select(Dispute).where(Dispute.session_id == s.id, Dispute.outcome == "open")):
        dispute.outcome = "kept"
    result = compute_results(db, s, final=True)
    s.status = SessionStatus.SETTLED
    s.settled_at = now
    from app.services import notifications

    unit = "coins" if s.mode == "money" else "tokens"
    for p in s.participants:
        o = result.outcomes[p.user_id]
        net = f"{'+' if o.net_amount > 0 else ''}{o.net_amount} {unit}" if s.stake_amount else "no stake"
        notifications.notify(
            db, p.user_id, "session_settled", f"Results: {s.title}",
            f"{'You passed' if o.passed else 'You didn’t pass'} with {p.quiz_score}% ({net}).",
            {"sessionId": s.id, "groupId": s.group_id},
        )


# ───────── Review & disputes ─────────


def _votes_needed(s: StudySession) -> int:
    return math.ceil(2 * len(s.participants) / 3)


def _dispute_out(d: Dispute, s: StudySession, viewer_id: str) -> DisputeOut:
    drop = sum(1 for v in d.votes if v.vote == "drop")
    return DisputeOut(
        id=d.id,
        question_id=d.question_id,
        opened_by=UserSummary.from_user(d.opener),
        reason=d.reason,
        drop_votes=drop,
        keep_votes=len(d.votes) - drop,
        votes_needed=_votes_needed(s),
        my_vote=next((v.vote for v in d.votes if v.user_id == viewer_id), None),
        outcome=d.outcome,
    )


def get_review(db: Session, s: StudySession, user: User) -> ReviewOut:
    _require_status(s, SessionStatus.REVIEW, SessionStatus.SETTLED, action="see the review")
    disputes = {d.question_id: d for d in db.scalars(select(Dispute).where(Dispute.session_id == s.id))}
    mine = {a.question_id: a for a in _answers(db, s.id, user.id)}
    reviews = []
    for q in _questions(db, s.id):
        a = mine.get(q.id)
        d = disputes.get(q.id)
        reviews.append(QuestionReview(
            question=question_out(q),
            correct_option_id=q.correct_option_id,
            model_answer=q.model_answer,
            my_answer=MyAnswer(option_id=a.option_id, text=a.text) if a and (a.option_id or a.text) else None,
            my_score=(a.score or 0.0) if a else 0.0,
            flagged=bool(a and a.flagged),
            expired=bool(a and a.expired),
            feedback=a.feedback if a else None,
            nullified=q.nullified,
            dispute=_dispute_out(d, s, user.id) if d else None,
        ))
    return ReviewOut(participants=participant_outs(db, s), questions=reviews)


def _apply_dispute_votes(db: Session, s: StudySession, d: Dispute) -> None:
    drops = sum(1 for v in d.votes if v.vote == "drop")
    if d.outcome == "open" and drops >= _votes_needed(s):
        d.outcome = "nullified"
        question = db.get(QuizQuestion, d.question_id)
        question.nullified = True
        compute_results(db, s, final=False)  # provisional results change live


def open_dispute(db: Session, s: StudySession, user: User, question_id: str, reason: str) -> DisputeOut:
    _require_status(s, SessionStatus.REVIEW, action="dispute a question")
    _require_participant(s, user)
    question = db.get(QuizQuestion, question_id)
    if question is None or question.session_id != s.id:
        raise ApiError(404, "not_found", "Question not found.")
    if db.scalar(select(Dispute).where(Dispute.question_id == question_id)) is not None:
        raise ApiError(409, "conflict", "That question is already disputed — vote on it instead.")
    d = Dispute(session_id=s.id, question_id=question_id, opened_by=user.id, reason=reason.strip())
    d.votes.append(DisputeVote(user_id=user.id, vote="drop"))  # opener's vote counts as drop
    db.add(d)
    db.flush()
    _apply_dispute_votes(db, s, d)
    db.commit()
    manager.notify_session(s.id)
    return _dispute_out(d, s, user.id)


def vote_dispute(db: Session, s: StudySession, user: User, dispute_id: str, vote: str) -> DisputeOut:
    _require_status(s, SessionStatus.REVIEW, action="vote on a dispute")
    _require_participant(s, user)
    d = db.get(Dispute, dispute_id)
    if d is None or d.session_id != s.id:
        raise ApiError(404, "not_found", "Dispute not found.")
    if any(v.user_id == user.id for v in d.votes):
        raise ApiError(409, "already_voted", "You've already voted on this.")
    d.votes.append(DisputeVote(user_id=user.id, vote=vote))
    db.flush()
    _apply_dispute_votes(db, s, d)
    db.commit()
    manager.notify_session(s.id)
    return _dispute_out(d, s, user.id)


def review_done(db: Session, s: StudySession, user: User) -> None:
    _require_status(s, SessionStatus.REVIEW, action="finish reviewing")
    p = _require_participant(s, user)
    p.review_done = True
    if all(x.review_done for x in s.participants):
        settle(db, s, utc_now())
    db.commit()
    from app.services import notifications

    notifications.push_pending(db)
    manager.notify_session(s.id)
