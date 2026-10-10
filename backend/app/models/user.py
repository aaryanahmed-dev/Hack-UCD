from datetime import date, datetime

from sqlalchemy import Date, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTimeCol, UUIDStr
from app.timeutil import utc_now


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True)  # Supabase user id (JWT "sub")
    email: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(20), unique=True)
    display_name: Mapped[str] = mapped_column(String(40))
    date_of_birth: Mapped[date] = mapped_column(Date)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    equipped_avatar_id: Mapped[str | None] = mapped_column(UUIDStr)  # FK to shop_items once the shop exists
    equipped_banner_id: Mapped[str | None] = mapped_column(UUIDStr)
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now, onupdate=utc_now)
