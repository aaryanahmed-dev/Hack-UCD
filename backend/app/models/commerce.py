from datetime import date, datetime

from sqlalchemy import JSON, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTimeCol, UUIDStr, new_id
from app.timeutil import utc_now


class Payment(Base):
    """A Stripe Checkout Session for buying coins. Fulfilled exactly once (webhook or confirm)."""

    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    stripe_session_id: Mapped[str] = mapped_column(String(255), unique=True)
    stripe_payment_intent: Mapped[str | None] = mapped_column(String(255))
    coins: Mapped[int] = mapped_column(Integer)
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="eur")
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | paid | expired
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)
    paid_at: Mapped[datetime | None] = mapped_column(UTCDateTimeCol)


class ShopItem(Base):
    """Token store catalogue. `id` is a readable slug (e.g. "avatar-rocket") the app also uses to render it."""

    __tablename__ = "shop_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # avatar | frame | streak_freeze
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(200))
    price_tokens: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON, default=dict)  # render info: {"icon", "color"}
    sort: Mapped[int] = mapped_column(Integer, default=0)


class UserItem(Base):
    __tablename__ = "user_items"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("shop_items.id"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)  # streak freezes stack; cosmetics are 1
    acquired_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)


class StreakFreezeUse(Base):
    """A day a streak freeze covered (so the streak didn't break)."""

    __tablename__ = "streak_freeze_uses"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
