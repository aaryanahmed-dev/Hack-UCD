from datetime import date
from typing import Literal

from pydantic import Field

from app.schemas.common import CamelModel, UTCDateTime
from app.schemas.user import UserSummary

UserStatus = Literal["offline", "online", "studying"]


class FriendOut(CamelModel):
    user: UserSummary
    status: UserStatus
    current_session_id: str | None  # set while studying in a session you can see (shared group)
    since: UTCDateTime


class FriendRequestOut(CamelModel):
    id: str
    user: UserSummary  # the other person
    direction: Literal["incoming", "outgoing"]
    created_at: UTCDateTime


class SendFriendRequest(CamelModel):
    username: str = Field(min_length=1, max_length=20)


class FriendRequestResult(CamelModel):
    """POST /friends/requests: either a new pending request, or an instant friendship if they'd asked you."""

    request: FriendRequestOut | None
    friend: FriendOut | None


class NotificationOut(CamelModel):
    id: str
    type: str
    title: str
    body: str
    data: dict[str, str]
    read_at: UTCDateTime | None
    created_at: UTCDateTime


class MarkRead(CamelModel):
    ids: list[str] = Field(default_factory=list)
    all: bool = False


class GroupInviteBody(CamelModel):
    user_id: str


class SessionInviteBody(CamelModel):
    user_ids: list[str] = Field(min_length=1, max_length=50)


class Amounts(CamelModel):
    tokens: int
    coins: int


class LeaderboardRow(CamelModel):
    rank: int | None  # null when the metric has no value yet (e.g. fewer than 3 quizzes)
    user: UserSummary
    value: int | None
    weekly_study_minutes: int
    average_quiz_score: int | None
    tokens: int
    sessions_completed: int
    won_from_me: Amounts | None  # friends scope: what this person has won from you
    lost_to_me: Amounts | None  # friends scope: what you've won from them


class LeaderboardOut(CamelModel):
    items: list[LeaderboardRow]
    me: LeaderboardRow


class ActivityDay(CamelModel):
    date: date
    study_minutes: int
    sessions: int
    todos_completed: int


class ActivityOut(CamelModel):
    days: list[ActivityDay]
