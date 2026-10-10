from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth import AuthUser
from app.errors import ApiError, not_found
from app.models.ledger import Currency, LedgerEntry, LedgerEntryType
from app.models.session import Participant, SessionStatus, StudySession
from app.models.user import User
from app.schemas.user import CreateProfile, UpdateProfile, UserStats
from app.services import ledger
from app.timeutil import utc_now


def create_profile(db: Session, auth: AuthUser, data: CreateProfile) -> User:
    if db.get(User, auth.id) is not None:
        raise ApiError(409, "conflict", "Your profile already exists.")
    if db.scalar(select(User.id).where(User.username == data.username)) is not None:
        raise ApiError(409, "username_taken", "That username is taken.")

    user = User(
        id=auth.id,
        email=auth.email,
        username=data.username,
        display_name=data.display_name,
        date_of_birth=data.date_of_birth,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        # Lost a race with another request for the same profile or username
        db.rollback()
        if db.get(User, auth.id) is not None:
            raise ApiError(409, "conflict", "Your profile already exists.")
        raise ApiError(409, "username_taken", "That username is taken.")

    ledger.add_entry(
        db,
        user_id=user.id,
        currency=Currency.TOKENS,
        amount=config.SIGNUP_BONUS_TOKENS,
        type=LedgerEntryType.SIGNUP_BONUS,
        description="Welcome bonus",
    )
    db.commit()
    return user


def update_profile(db: Session, user: User, data: UpdateProfile) -> User:
    changes = data.model_dump(exclude_unset=True)
    if "display_name" in changes:
        user.display_name = changes["display_name"]
    if "avatar_url" in changes:
        user.avatar_url = changes["avatar_url"]
    if data.equipped is not None:
        from app.services import shop

        equipped = data.equipped.model_dump(exclude_unset=True)
        for slot, column in (("avatar", "equipped_avatar_id"), ("frame", "equipped_frame_id")):
            if slot in equipped:
                if equipped[slot] is not None:
                    shop.check_equip(db, user, equipped[slot], slot)  # must own it
                setattr(user, column, equipped[slot])
        if equipped.get("banner") is not None:
            raise not_found("Shop item")
    db.commit()
    return user


def search_users(db: Session, query: str, limit: int = 20) -> list[User]:
    prefix = query.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    if not prefix:
        return []
    return list(
        db.scalars(
            select(User).where(User.username.like(f"{prefix}%", escape="\\")).order_by(User.username).limit(limit)
        )
    )


def get_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    return user


def _streaks(days: set[date], today: date) -> tuple[int, int]:
    """(current, longest) runs of consecutive days. The current streak survives until a full day is missed."""
    longest = run = 0
    previous = None
    for d in sorted(days):
        run = run + 1 if previous is not None and d - previous == timedelta(days=1) else 1
        longest = max(longest, run)
        previous = d
    current = 0
    cursor = today if today in days else today - timedelta(days=1)
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)
    return current, longest


def _apply_streak_freezes(db: Session, user: User, days: set[date], today: date) -> set[date]:
    """Streak freezes cover missed days automatically: walk back from yesterday over the gap before the
    most recent streak and spend one freeze per missed day (if there are enough to bridge it)."""
    from app.models.commerce import StreakFreezeUse
    from app.services import shop

    covered = {u.day for u in db.scalars(select(StreakFreezeUse).where(StreakFreezeUse.user_id == user.id))}
    all_days = days | covered
    if not all_days or today in all_days:
        return covered
    gap, cursor = [], today - timedelta(days=1)
    while cursor not in all_days and len(gap) <= 5:
        gap.append(cursor)
        cursor -= timedelta(days=1)
    if cursor not in all_days:
        return covered  # no streak to protect
    # Leave today itself open (you can still study today); only past missed days are frozen
    if gap and gap[0] == today - timedelta(days=1) and len(gap) <= shop.freezes_owned(db, user.id):
        for day in gap:
            db.add(StreakFreezeUse(user_id=user.id, day=day))
            shop.use_freeze(db, user.id)
            covered.add(day)
        db.commit()
    return covered


def get_stats(db: Session, user: User) -> UserStats:
    rows = db.execute(
        select(Participant, StudySession)
        .join(StudySession, StudySession.id == Participant.session_id)
        .where(Participant.user_id == user.id, StudySession.status == SessionStatus.SETTLED)
    ).all()
    now = utc_now()
    week_start = datetime.combine(now.date() - timedelta(days=now.weekday()), datetime.min.time())

    total_seconds = weekly_seconds = wins = coins_donated = 0
    scores, focus = [], []
    days: set[date] = set()
    for p, s in rows:
        total_seconds += p.focused_seconds
        if s.settled_at and s.settled_at >= week_start:
            weekly_seconds += p.focused_seconds
        if p.passed:
            wins += 1
        elif s.mode == "money":
            nobody_passed = not any(x.passed for x in s.participants)
            if s.payout_target == "charity" or nobody_passed:
                coins_donated += s.stake_amount
        if p.quiz_score is not None:
            scores.append(p.quiz_score)
        if p.focus_percent is not None:
            focus.append(p.focus_percent)
        if s.settled_at:
            days.add(s.settled_at.date())
    days |= _apply_streak_freezes(db, user, days, now.date())
    current_streak, longest_streak = _streaks(days, now.date())
    completed = len(rows)
    coins_won = db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.user_id == user.id,
            LedgerEntry.currency == Currency.COINS,
            LedgerEntry.type == LedgerEntryType.WINNINGS,
        )
    )
    return UserStats(
        total_study_minutes=total_seconds // 60,
        weekly_study_minutes=weekly_seconds // 60,
        current_streak_days=current_streak,
        longest_streak_days=longest_streak,
        sessions_completed=completed,
        wins=wins,
        losses=completed - wins,
        win_rate=round(100 * wins / completed) if completed else None,
        average_quiz_score=round(sum(scores) / len(scores)) if scores else None,
        average_focus_percent=round(sum(focus) / len(focus)) if focus else None,
        lifetime_tokens_earned=ledger.lifetime_earned(db, user.id, Currency.TOKENS),
        tokens=ledger.balance(db, user.id, Currency.TOKENS),
        coins_won=int(coins_won),
        coins_donated=coins_donated,
    )
