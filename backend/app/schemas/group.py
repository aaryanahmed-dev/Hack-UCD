from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, UTCDateTime
from app.schemas.user import UserSummary

GroupRoleValue = Literal["owner", "admin", "member"]
UserStatus = Literal["offline", "online", "studying"]


class ActiveSessionRef(CamelModel):
    id: str
    status: str


class GroupSummary(CamelModel):
    id: str
    name: str
    description: str | None
    member_count: int
    my_role: GroupRoleValue
    active_session: ActiveSessionRef | None
    created_at: UTCDateTime


class GroupMemberOut(CamelModel):
    user: UserSummary
    role: GroupRoleValue
    status: UserStatus
    joined_at: UTCDateTime


class GroupStats(CamelModel):
    total_focused_minutes: int
    sessions_completed: int
    average_quiz_score: int | None


class Milestone(CamelModel):
    id: str
    title: str
    metric: Literal["focus_hours", "sessions_completed"]
    target: int
    progress: int
    achieved_at: UTCDateTime | None


class GroupDetail(GroupSummary):
    invite_code: str
    members: list[GroupMemberOut]
    stats: GroupStats
    milestones: list[Milestone]


def _clean_name(v: str) -> str:
    v = v.strip()
    if not 1 <= len(v) <= 60:
        raise ValueError("must be 1-60 characters")
    return v


def _clean_description(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class CreateGroup(CamelModel):
    name: str
    description: str | None = Field(default=None, max_length=500)

    _name = field_validator("name")(_clean_name)
    _description = field_validator("description")(_clean_description)


class UpdateGroup(CamelModel):
    name: str | None = None
    description: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str:
        if v is None:
            raise ValueError("cannot be null")
        return _clean_name(v)

    _description = field_validator("description")(_clean_description)


class JoinGroup(CamelModel):
    invite_code: str = Field(min_length=1, max_length=20)


class UpdateMemberRole(CamelModel):
    role: Literal["admin", "member"]
