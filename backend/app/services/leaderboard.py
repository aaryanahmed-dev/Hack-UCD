"""Leaderboards (API_SPEC §6.9) and the profile activity chart."""

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models.group import GroupMember
from app.models.ledger import Currency, LedgerEntry, LedgerEntryType
from app.models.productivity import Todo
from app.models.session import Participant, SessionStatus, StudySession
from app.models.user import User
from app.schemas.social import ActivityDay, Amounts, LeaderboardOut, LeaderboardRow
from app.schemas.user import UserSummary
from app.services import friends
from app.timeutil import utc_now

GLOBAL_LIMIT = 100
MIN_SESSIONS_FOR_AVG = 3


def week_start(now: datetime) -> datetime:
    """Monday 00:00 UTC of the current week."""
    return datetime.combine(now.date() - timedelta(days=now.weekday()), datetime.min.time())


def _population(db: Session, me: User, scope: str, group_id: str | None) -> list[str]:
    if scope == "friends":
        return [me.id, *friends.friend_ids(db, me.id)]
    if scope == "group":
        if not group_id or db.get(GroupMember, (group_id, me.id)) is None:
            raise ApiError(404, "not_found", "Group not found.")
        return list(db.scalars(select(GroupMember.user_id).where(GroupMember.group_id == group_id)))
    return list(db.scalars(select(User.id)))


def _session_stats(db: Session, user_ids: list[str], since: datetime) -> dict[str, tuple[int, float | None, int]]:
    """user → (focused seconds since `since`, average quiz score, settled sessions)."""
    rows = db.execute(
        select(
            Participant.user_id,
            func.coalesce(func.sum(case((StudySession.settled_at >= since, Participant.focused_seconds), else_=0)), 0),
            func.avg(Participant.quiz_score),
            func.count(),
        )
        .join(StudySession, StudySession.id == Participant.session_id)
        .where(StudySession.status == SessionStatus.SETTLED, Participant.user_id.in_(user_ids))
        .group_by(Participant.user_id)
    ).all()
    return {uid: (int(sec), float(avg) if avg is not None else None, int(n)) for uid, sec, avg, n in rows}


def _token_balances(db: Session, user_ids: list[str]) -> dict[str, int]:
    rows = db.execute(
        select(LedgerEntry.user_id, func.sum(LedgerEntry.amount))
        .where(LedgerEntry.user_id.in_(user_ids), LedgerEntry.currency == Currency.TOKENS)
        .group_by(LedgerEntry.user_id)
    ).all()
    return {uid: int(total) for uid, total in rows}


def _winnings(db: Session, winners: list[str], losers: list[str]) -> dict[tuple[str, str], Amounts]:
    """(winner, loser) → total won, from WINNINGS ledger entries."""
    rows = db.execute(
        select(LedgerEntry.user_id, LedgerEntry.counterparty_user_id, LedgerEntry.currency, func.sum(LedgerEntry.amount))
        .where(
            LedgerEntry.type == LedgerEntryType.WINNINGS,
            LedgerEntry.user_id.in_(winners),
            LedgerEntry.counterparty_user_id.in_(losers),
        )
        .group_by(LedgerEntry.user_id, LedgerEntry.counterparty_user_id, LedgerEntry.currency)
    ).all()
    out: dict[tuple[str, str], Amounts] = defaultdict(lambda: Amounts(tokens=0, coins=0))
    for winner, loser, currency, total in rows:
        amounts = out[(winner, loser)]
        if currency == Currency.COINS:
            amounts.coins += int(total)
        else:
            amounts.tokens += int(total)
    return out


def leaderboard(db: Session, me: User, scope: str, metric: str, group_id: str | None) -> LeaderboardOut:
    ids = _population(db, me, scope, group_id)
    if me.id not in ids:
        ids.append(me.id)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))}
    stats = _session_stats(db, ids, week_start(utc_now()))
    tokens = _token_balances(db, ids)
    won = lost = None
    if scope == "friends":
        others = [u for u in ids if u != me.id]
        won = _winnings(db, others, [me.id])
        lost = _winnings(db, [me.id], others)

    def value(uid: str) -> int | None:
        weekly_seconds, avg, sessions = stats.get(uid, (0, None, 0))
        if metric == "weekly_study":
            return weekly_seconds // 60
        if metric == "avg_score":
            return round(avg) if avg is not None and sessions >= MIN_SESSIONS_FOR_AVG else None
        return tokens.get(uid, 0)

    rows = []
    for uid in ids:
        user = users.get(uid)
        if user is None:
            continue
        weekly_seconds, avg, sessions = stats.get(uid, (0, None, 0))
        friendly = scope == "friends" and uid != me.id
        rows.append(
            LeaderboardRow(
                rank=None,
                user=UserSummary.from_user(user),
                value=value(uid),
                weekly_study_minutes=weekly_seconds // 60,
                average_quiz_score=round(avg) if avg is not None else None,
                tokens=tokens.get(uid, 0),
                sessions_completed=sessions,
                won_from_me=won.get((uid, me.id), Amounts(tokens=0, coins=0)) if friendly else None,
                lost_to_me=lost.get((me.id, uid), Amounts(tokens=0, coins=0)) if friendly else None,
            )
        )

    rows.sort(key=lambda r: (r.value is None, -(r.value or 0), r.user.display_name.lower()))
    previous = None
    for i, r in enumerate(rows):
        if r.value is None:
            continue
        r.rank = previous.rank if previous is not None and previous.value == r.value else i + 1
        previous = r

    me_row = next(r for r in rows if r.user.id == me.id)
    items = rows[:GLOBAL_LIMIT] if scope == "global" else rows
    return LeaderboardOut(items=items, me=me_row)


def activity(db: Session, me: User, days: int) -> list[ActivityDay]:
    today = utc_now().date()
    start = today - timedelta(days=days - 1)
    since = datetime.combine(start, datetime.min.time())
    minutes: dict[date, int] = defaultdict(int)
    sessions: dict[date, int] = defaultdict(int)
    for settled_at, seconds in db.execute(
        select(StudySession.settled_at, Participant.focused_seconds)
        .join(StudySession, StudySession.id == Participant.session_id)
        .where(
            Participant.user_id == me.id,
            StudySession.status == SessionStatus.SETTLED,
            StudySession.settled_at >= since,
        )
    ):
        minutes[settled_at.date()] += seconds // 60
        sessions[settled_at.date()] += 1
    todos: dict[date, int] = defaultdict(int)
    for (completed_at,) in db.execute(
        select(Todo.completed_at).where(Todo.user_id == me.id, Todo.is_done.is_(True), Todo.completed_at >= since)
    ):
        todos[completed_at.date()] += 1
    return [
        ActivityDay(date=d, study_minutes=minutes[d], sessions=sessions[d], todos_completed=todos[d])
        for d in (start + timedelta(days=i) for i in range(days))
    ]
