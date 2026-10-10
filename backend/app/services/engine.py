"""Background engine: advances session timers and runs AI jobs (API_SPEC §7.1).

Everything is driven by state in the database, so a restart simply picks up where it left off:
overdue timers fire on the next tick and sessions stuck in generating_quiz / grading get their job
started again.
"""

import asyncio
import logging

from sqlalchemy import select

from app import config
from app import db as db_module
from app.models.session import SessionStatus, StudySession
from app.services import notifications, quiz, sessions
from app.services.realtime import manager
from app.timeutil import utc_now

logger = logging.getLogger(__name__)

JOBS = {
    SessionStatus.GENERATING_QUIZ: quiz.generate_quiz_job,
    SessionStatus.GRADING: quiz.grade_job,
}
_running: set[tuple[str, str]] = set()


def tick() -> list[tuple[str, str]]:
    """Fire every overdue timer. Returns (session_id, status) pairs that need a background job."""
    now = utc_now()
    changed: list[str] = []
    with db_module.SessionLocal() as db:
        due = db.scalars(
            select(StudySession.id).where(
                (
                    (StudySession.status == SessionStatus.STUDYING) & (StudySession.study_ends_at <= now)
                )
                | (
                    (StudySession.status == SessionStatus.EXTENSION_VOTE)
                    & (StudySession.extension_vote_ends_at <= now)
                )
                | ((StudySession.status == SessionStatus.QUIZ) & (StudySession.quiz_ends_at <= now))
                | ((StudySession.status == SessionStatus.REVIEW) & (StudySession.review_ends_at <= now))
            )
        ).all()
        for session_id in due:
            s = sessions.lock_session(db, session_id)
            if s is None:
                continue
            if s.status == SessionStatus.STUDYING and s.study_ends_at <= now:
                sessions.end_study(db, s, now)
            elif s.status == SessionStatus.EXTENSION_VOTE and s.extension_vote_ends_at <= now:
                sessions.resolve_extension(db, s, now)
            elif s.status == SessionStatus.QUIZ and s.quiz_ends_at <= now:
                quiz.close_quiz(db, s, now)
            elif s.status == SessionStatus.REVIEW and s.review_ends_at <= now:
                quiz.settle(db, s, now)
            else:
                db.rollback()
                continue
            db.commit()
            notifications.push_pending(db)
            changed.append(session_id)

        _send_reminders(db, now)

        needs_job = db.execute(
            select(StudySession.id, StudySession.status).where(StudySession.status.in_(list(JOBS)))
        ).all()

    for session_id in changed:
        manager.notify_session(session_id)
    return [(sid, status) for sid, status in needs_job]


def _send_reminders(db, now) -> None:
    """Tell everyone in the group when a scheduled session starts within 15 minutes."""
    from datetime import timedelta

    from app.models.group import Group, GroupMember

    soon = db.scalars(
        select(StudySession).where(
            StudySession.status == SessionStatus.LOBBY,
            StudySession.scheduled_for.is_not(None),
            StudySession.reminder_sent_at.is_(None),
            StudySession.scheduled_for <= now + timedelta(minutes=config.SESSION_REMINDER_MINUTES),
            StudySession.scheduled_for > now - timedelta(minutes=5),
        )
    ).all()
    for s in soon:
        group = db.get(Group, s.group_id)
        joined = {p.user_id for p in s.participants}
        for member in db.scalars(select(GroupMember).where(GroupMember.group_id == s.group_id)):
            notifications.notify(
                db, member.user_id, "session_starting", f"Starting soon: {s.title}",
                f"{group.name if group else 'Your group'} studies at "
                f"{s.scheduled_for.strftime('%H:%M')} UTC — {'you’re in' if member.user_id in joined else 'join the lobby'}.",
                {"sessionId": s.id, "groupId": s.group_id},
            )
        s.reminder_sent_at = now
        db.commit()
        notifications.push_pending(db)


async def _run_job(session_id: str, status: str) -> None:
    key = (session_id, status)
    try:
        await asyncio.to_thread(JOBS[status], session_id)
    except Exception:
        logger.exception("Job %s failed for session %s", status, session_id)
    finally:
        _running.discard(key)


async def run_forever() -> None:
    while True:
        try:
            for session_id, status in await asyncio.to_thread(tick):
                key = (session_id, status)
                if key not in _running:
                    _running.add(key)
                    asyncio.create_task(_run_job(session_id, status))
        except Exception:
            logger.exception("Engine tick failed")
        await asyncio.sleep(config.ENGINE_TICK_SECONDS)
