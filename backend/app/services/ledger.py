"""The only place that moves tokens/coins. Callers commit the surrounding transaction."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ledger import Currency, LedgerEntry, LedgerEntryType
from app.models.user import User


def lock_user(db: Session, user_id: str) -> None:
    """Lock the user's row (SELECT … FOR UPDATE) before spending, so concurrent spends can't overdraw."""
    db.execute(select(User.id).where(User.id == user_id).with_for_update())


def balance(db: Session, user_id: str, currency: Currency) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.user_id == user_id, LedgerEntry.currency == currency
        )
    )
    return int(total)


def lifetime_earned(db: Session, user_id: str, currency: Currency) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0)).where(
            LedgerEntry.user_id == user_id, LedgerEntry.currency == currency, LedgerEntry.amount > 0
        )
    )
    return int(total)


def add_entry(
    db: Session,
    *,
    user_id: str,
    currency: Currency,
    amount: int,
    type: LedgerEntryType,
    description: str,
    session_id: str | None = None,
    counterparty_user_id: str | None = None,
    charity_id: str | None = None,
    stripe_ref: str | None = None,
) -> LedgerEntry:
    entry = LedgerEntry(
        user_id=user_id,
        currency=currency,
        amount=amount,
        type=type,
        description=description,
        session_id=session_id,
        counterparty_user_id=counterparty_user_id,
        charity_id=charity_id,
        stripe_ref=stripe_ref,
    )
    db.add(entry)
    return entry
