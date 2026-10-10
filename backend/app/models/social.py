from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTimeCol, UUIDStr, new_id
from app.models.user import User
from app.timeutil import utc_now


class Friendship(Base):
    """One row per pair. `requester` sent the request; status pending → accepted (declines delete the row)."""

    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    requester_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    addressee_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | accepted
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)
    accepted_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)

    requester: Mapped[User] = relationship(lazy="joined", foreign_keys=[requester_id])
    addressee: Mapped[User] = relationship(lazy="joined", foreign_keys=[addressee_id])

    def other(self, user_id: str) -> User:
        return self.addressee if self.requester_id == user_id else self.requester


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)
