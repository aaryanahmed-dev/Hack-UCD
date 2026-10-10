"""Study sessions — the core engine (API_SPEC §7)."""

import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UTCDateTimeCol, UUIDStr, new_id
from app.models.user import User
from app.timeutil import utc_now

LongText = Text().with_variant(mysql.LONGTEXT(), "mysql")


class SessionStatus(enum.StrEnum):
    LOBBY = "lobby"
    STUDYING = "studying"
    EXTENSION_VOTE = "extension_vote"
    GENERATING_QUIZ = "generating_quiz"
    QUIZ = "quiz"
    GRADING = "grading"
    REVIEW = "review"
    SETTLED = "settled"
    CANCELLED = "cancelled"


ENDED_STATUSES = (SessionStatus.SETTLED, SessionStatus.CANCELLED)


class Charity(Base):
    __tablename__ = "charities"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500))
    logo_url: Mapped[str | None] = mapped_column(String(500))
    website_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class StudySession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    host_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(20), index=True, default=SessionStatus.LOBBY)

    # SessionConfig
    title: Mapped[str] = mapped_column(String(60))
    mode: Mapped[str] = mapped_column(String(10))  # tokens | money
    stake_amount: Mapped[int] = mapped_column(Integer)
    payout_target: Mapped[str] = mapped_column(String(10))  # winners | charity
    charity_id: Mapped[str | None] = mapped_column(ForeignKey("charities.id"))
    study_minutes: Mapped[int] = mapped_column(Integer)
    extension_minutes: Mapped[int] = mapped_column(Integer)
    max_extensions: Mapped[int] = mapped_column(Integer)
    quiz_question_count: Mapped[int] = mapped_column(Integer)
    min_focus_percent: Mapped[int] = mapped_column(Integer)
    max_participants: Mapped[int] = mapped_column(Integer)
    scheduled_for: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)

    # Assessment rule decided by vote at start
    threshold_type: Mapped[str | None] = mapped_column(String(20))
    threshold_value: Mapped[int | None] = mapped_column(Integer)
    assessment_decided_by: Mapped[str | None] = mapped_column(String(12))  # vote | coin_flip

    # Extensions
    extensions_used: Mapped[int] = mapped_column(Integer, default=0)
    extension_vote_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    last_extension_extended: Mapped[bool | None] = mapped_column(Boolean)
    last_extension_decided_by: Mapped[str | None] = mapped_column(String(12))

    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    study_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    quiz_starts_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    quiz_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    review_ends_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    settled_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    cancel_reason: Mapped[str | None] = mapped_column(String(255))
    quiz_attempts: Mapped[int] = mapped_column(Integer, default=0)  # AI generation attempts
    reminder_sent_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)  # 15-min 'starting soon' sent

    host: Mapped[User] = relationship(lazy="joined", foreign_keys=[host_id])
    charity: Mapped[Charity | None] = relationship(lazy="joined")
    participants: Mapped[list["Participant"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="selectin", order_by="Participant.joined_at"
    )
    materials: Mapped[list["Material"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="selectin", order_by="Material.uploaded_at"
    )
    assessment_votes: Mapped[list["AssessmentVote"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )

    def participant(self, user_id: str) -> "Participant | None":
        return next((p for p in self.participants if p.user_id == user_id), None)


class Participant(Base):
    __tablename__ = "session_participants"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)
    is_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    # Focus accounting: time in the current state since focus_since is added on the next change.
    focus_state: Mapped[str] = mapped_column(String(10), default="offline")  # focused|idle|away|offline
    focus_since: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    focused_seconds: Mapped[int] = mapped_column(Integer, default=0)
    unfocused_seconds: Mapped[int] = mapped_column(Integer, default=0)

    # Results (provisional during review, final once settled)
    quiz_score: Mapped[int | None] = mapped_column(Integer)
    focus_percent: Mapped[int | None] = mapped_column(Integer)
    flagged_count: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    rank: Mapped[int | None] = mapped_column(Integer)
    payout: Mapped[int | None] = mapped_column(Integer)
    net_amount: Mapped[int | None] = mapped_column(Integer)
    bonus_tokens: Mapped[int | None] = mapped_column(Integer)
    review_done: Mapped[bool] = mapped_column(Boolean, default=False)
    # Opted in to ending the current study block early (it ends once everyone has)
    wants_to_finish: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped[StudySession] = relationship(back_populates="participants")
    user: Mapped[User] = relationship(lazy="joined")


class AssessmentVote(Base):
    __tablename__ = "assessment_votes"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    threshold_type: Mapped[str] = mapped_column(String(20))
    threshold_value: Mapped[int] = mapped_column(Integer)


class ExtensionVote(Base):
    __tablename__ = "extension_votes"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True)
    round: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    extend: Mapped[bool] = mapped_column(Boolean)


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(8))  # file | text
    title: Mapped[str] = mapped_column(String(200))
    mime_type: Mapped[str | None] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str | None] = mapped_column(String(500))
    extracted_text: Mapped[str | None] = mapped_column(LongText)
    text_status: Mapped[str] = mapped_column(String(12))  # processing | ready | failed
    uploaded_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    session: Mapped[StudySession] = relationship(back_populates="materials")
    uploader: Mapped[User] = relationship(lazy="joined")
    approvals: Mapped[list["MaterialApproval"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class MaterialApproval(Base):
    """A row means the user approved the material."""

    __tablename__ = "material_approvals"

    material_id: Mapped[str] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)


class SessionTodo(Base):
    __tablename__ = "session_todos"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    creator: Mapped[User] = relationship(lazy="joined", foreign_keys=[created_by])
    completer: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[completed_by])


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(20))  # multiple_choice | short_answer
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSON)  # [{"id": "a", "text": "..."}]
    correct_option_id: Mapped[str | None] = mapped_column(String(8))
    model_answer: Mapped[str | None] = mapped_column(Text)
    nullified: Mapped[bool] = mapped_column(Boolean, default=False)


class QuizAnswer(Base):
    """Created when a question is first served to a user (starts its timer)."""

    __tablename__ = "quiz_answers"
    __table_args__ = (UniqueConstraint("user_id", "question_id", name="uq_quiz_answer_user_question"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    question_id: Mapped[str] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"))
    served_at: Mapped[datetime] = mapped_column(UTCDateTimeCol)
    deadline: Mapped[datetime] = mapped_column(UTCDateTimeCol)
    answered_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)
    option_id: Mapped[str | None] = mapped_column(String(8))
    text: Mapped[str | None] = mapped_column(Text)
    expired: Mapped[bool] = mapped_column(Boolean, default=False)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)  # left the app while it was open
    score: Mapped[float | None] = mapped_column(Float)  # 0–1, set when graded
    feedback: Mapped[str | None] = mapped_column(Text)


class Dispute(Base):
    __tablename__ = "disputes"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"), unique=True)
    opened_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(300))
    outcome: Mapped[str] = mapped_column(String(10), default="open")  # open | nullified | kept
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)

    opener: Mapped[User] = relationship(lazy="joined")
    votes: Mapped[list["DisputeVote"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class DisputeVote(Base):
    __tablename__ = "dispute_votes"

    dispute_id: Mapped[str] = mapped_column(ForeignKey("disputes.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    vote: Mapped[str] = mapped_column(String(4))  # drop | keep
