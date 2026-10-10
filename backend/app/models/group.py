import enum
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTimeCol, UUIDStr, new_id
from app.models.user import User
from app.timeutil import utc_now


class GroupRole(enum.StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(String(500))
    invite_code: Mapped[str] = mapped_column(String(6), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    # The owner is the member with role "owner"; there is no separate owner column.
    members: Mapped[list["GroupMember"]] = relationship(
        back_populates="group", cascade="all, delete-orphan", lazy="selectin"
    )


class GroupMember(Base):
    __tablename__ = "group_members"

    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16))
    joined_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    group: Mapped[Group] = relationship(back_populates="members")
    user: Mapped[User] = relationship(lazy="joined")
