from datetime import datetime

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTimeCol, UUIDStr, new_id
from app.timeutil import utc_now


class Todo(Base):
    __tablename__ = "todos"
    __table_args__ = (Index("ix_todos_user_done", "user_id", "is_done"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(8), default="medium")  # low | medium | high
    tags: Mapped[list] = mapped_column(JSON, default=list)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    visibility: Mapped[str] = mapped_column(String(10), default="private")  # private | friends
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    subtasks: Mapped[list["Subtask"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="Subtask.position"
    )


class Subtask(Base):
    __tablename__ = "subtasks"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    todo_id: Mapped[str] = mapped_column(ForeignKey("todos.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (Index("ix_calendar_user_start", "user_id", "starts_at"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))  # assignment | exam | study_session | other
    starts_at: Mapped[datetime] = mapped_column(UTCDateTimeCol)
    ends_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)


class GoogleAccount(Base):
    """A user's Google Calendar connection. Tokens are encrypted at rest."""

    __tablename__ = "google_accounts"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    google_email: Mapped[str | None] = mapped_column(String(255))
    refresh_token: Mapped[str] = mapped_column(Text)  # encrypted
    access_token: Mapped[str | None] = mapped_column(Text)  # encrypted
    access_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    connected_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)


class GoogleSessionEvent(Base):
    """The Google Calendar event we created for a scheduled session, per user."""

    __tablename__ = "google_session_events"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    google_event_id: Mapped[str] = mapped_column(String(255))
