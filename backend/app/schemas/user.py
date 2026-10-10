import re
from datetime import date

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, UTCDateTime
from app.timeutil import age_on, is_adult, utc_now

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,20}$")


class EquippedItems(CamelModel):
    avatar: str | None = None  # token store item id, e.g. "avatar-rocket"
    frame: str | None = None  # e.g. "frame-gold"
    banner: str | None = None  # reserved


class UserSummary(CamelModel):
    id: str
    username: str
    display_name: str
    avatar_url: str | None
    equipped: EquippedItems

    @classmethod
    def from_user(cls, user) -> "UserSummary":
        return cls(**_summary_fields(user))


class Me(UserSummary):
    email: str
    date_of_birth: date
    is_adult: bool
    google_calendar_connected: bool
    id_verified: bool  # passed Persona ID verification
    verification_required: bool  # money features need id_verified (server has Persona configured)
    created_at: UTCDateTime

    @classmethod
    def from_user(cls, user) -> "Me":
        return cls(
            **_summary_fields(user),
            email=user.email,
            date_of_birth=user.date_of_birth,
            is_adult=is_adult(user.date_of_birth),
            google_calendar_connected=False,
            id_verified=user.id_verified_at is not None,
            verification_required=_verification_required(),
            created_at=user.created_at,
        )


def _verification_required() -> bool:
    from app.services import verification

    return verification.required()


def _summary_fields(user) -> dict:
    return dict(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        equipped=EquippedItems(avatar=user.equipped_avatar_id, frame=user.equipped_frame_id, banner=user.equipped_banner_id),
    )


def _clean_display_name(v: str) -> str:
    v = v.strip()
    if not 1 <= len(v) <= 40:
        raise ValueError("must be 1-40 characters")
    return v


class CreateProfile(CamelModel):
    username: str
    display_name: str
    date_of_birth: date

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("must be 3-20 characters: letters, numbers or _")
        return v

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str) -> str:
        return _clean_display_name(v)

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v: date) -> date:
        today = utc_now().date()
        if v >= today:
            raise ValueError("must be in the past")
        if age_on(v, today) > 120:
            raise ValueError("is not a valid date of birth")
        return v


class UpdateProfile(CamelModel):
    display_name: str | None = None
    avatar_url: str | None = Field(default=None, max_length=500)
    equipped: EquippedItems | None = None

    @field_validator("display_name")
    @classmethod
    def _display_name(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("cannot be null")
        return _clean_display_name(v)

    @field_validator("avatar_url")
    @classmethod
    def _avatar_url(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("https://", "http://")):
            raise ValueError("must be an http(s) URL")
        return v


class UserStats(CamelModel):
    total_study_minutes: int
    weekly_study_minutes: int
    current_streak_days: int
    longest_streak_days: int
    sessions_completed: int
    wins: int
    losses: int
    win_rate: int | None
    average_quiz_score: int | None
    average_focus_percent: int | None
    lifetime_tokens_earned: int
    tokens: int
    coins_won: int
    coins_donated: int
