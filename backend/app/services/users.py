from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth import AuthUser
from app.errors import ApiError, not_found
from app.models.ledger import Currency, LedgerEntryType
from app.models.user import User
from app.schemas.user import CreateProfile, UpdateProfile, UserStats
from app.services import ledger


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
        equipped = data.equipped.model_dump(exclude_unset=True)
        # The shop isn't built yet, so nothing can be owned: only unequipping is valid.
        if any(item_id is not None for item_id in equipped.values()):
            raise not_found("Shop item")
        if "avatar" in equipped:
            user.equipped_avatar_id = None
        if "banner" in equipped:
            user.equipped_banner_id = None
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


def get_stats(db: Session, user: User) -> UserStats:
    # Session-based stats stay at zero until study sessions exist (build phases 4-5).
    return UserStats(
        total_study_minutes=0,
        weekly_study_minutes=0,
        current_streak_days=0,
        longest_streak_days=0,
        sessions_completed=0,
        wins=0,
        losses=0,
        win_rate=None,
        average_quiz_score=None,
        average_focus_percent=None,
        lifetime_tokens_earned=ledger.lifetime_earned(db, user.id, Currency.TOKENS),
        tokens=ledger.balance(db, user.id, Currency.TOKENS),
        coins_won=0,
        coins_donated=0,
    )
