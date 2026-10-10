import enum
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTimeCol, UUIDStr, new_id
from app.timeutil import utc_now


class Currency(enum.StrEnum):
    TOKENS = "tokens"
    COINS = "coins"


class LedgerEntryType(enum.StrEnum):
    SIGNUP_BONUS = "signup_bonus"
    STAKE = "stake"
    STAKE_REFUND = "stake_refund"
    WINNINGS = "winnings"
    CHARITY_DONATION = "charity_donation"
    WINNER_BONUS = "winner_bonus"
    PURCHASE = "purchase"
    WITHDRAWAL = "withdrawal"
    SHOP_PURCHASE = "shop_purchase"
    ADJUSTMENT = "adjustment"


class LedgerEntry(Base):
    """Every tokens/coins movement. Balances are SUM(amount); there is no balance column."""

    __tablename__ = "ledger_entries"
    __table_args__ = (Index("ix_ledger_user_currency", "user_id", "currency"),)

    id: Mapped[str] = mapped_column(UUIDStr, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    currency: Mapped[str] = mapped_column(String(16))
    amount: Mapped[int] = mapped_column(BigInteger)  # signed: + received, − spent
    type: Mapped[str] = mapped_column(String(32))
    session_id: Mapped[str | None] = mapped_column(UUIDStr, index=True)  # FK once sessions exist
    counterparty_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    charity_id: Mapped[str | None] = mapped_column(UUIDStr)  # FK once charities exist
    stripe_ref: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTimeCol, default=utc_now)
