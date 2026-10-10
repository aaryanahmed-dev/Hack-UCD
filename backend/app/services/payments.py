"""Buying coins with Stripe Checkout (sandbox), and the wallet.

Pricing model: coins are the in-app currency for real-money stakes; 1 coin = €0.01, sold in packs
(500 / 1,000 / 2,000 / 5,000 coins = €5 / €10 / €20 / €50). Each pack is a Stripe Product with a Price
(looked up by `lookup_key`, created on first use). A purchase is a one-off Checkout Session; when Stripe
confirms payment — via the `checkout.session.completed` webhook or the app confirming on return — the
coins are credited to the ledger exactly once.
"""

import base64
import logging

import stripe
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import config
from app.errors import ApiError
from app.models.commerce import Payment
from app.models.ledger import Currency, LedgerEntry, LedgerEntryType
from app.models.session import Participant, SessionStatus, StudySession
from app.models.user import User
from app.schemas.commerce import CoinPack, LedgerEntryOut, PaymentOut, WalletOut
from app.schemas.common import Page
from app.schemas.user import UserSummary
from app.services import ledger, notifications, verification
from app.timeutil import is_adult, utc_now

logger = logging.getLogger(__name__)


def configured() -> bool:
    return bool(config.STRIPE_SECRET_KEY)


def _client() -> stripe.StripeClient:
    if not configured():
        raise ApiError(409, "payments_not_configured", "Payments aren't set up on this server yet.")
    return stripe.StripeClient(config.STRIPE_SECRET_KEY)


def packs() -> list[CoinPack]:
    return [CoinPack(coins=c, amount_cents=c, currency="eur", label=f"€{c / 100:.0f}") for c in config.COIN_PACKS]


def _price_id(client: stripe.StripeClient, coins: int) -> str:
    """The Stripe Price for a coin pack — found by lookup key, or created (with its Product) on first use."""
    key = f"study_stakes_coins_{coins}"
    found = client.v1.prices.list(params={"lookup_keys": [key], "limit": 1})
    if found.data:
        return found.data[0].id
    price = client.v1.prices.create(params={
        "currency": "eur",
        "unit_amount": coins,  # 1 coin = 1 cent
        "lookup_key": key,
        "product_data": {"name": f"{coins:,} Study Stakes coins"},
        "metadata": {"coins": str(coins)},
    })
    return price.id


def _require_can_buy(db: Session, user: User) -> None:
    if not is_adult(user.date_of_birth):
        raise ApiError(403, "age_restricted", "Buying coins is only for users aged 18+.")
    if verification.required() and user.id_verified_at is None:
        raise ApiError(403, "verification_required", "Verify your ID before using real money.")


def create_checkout(db: Session, user: User, coins: int, return_to: str) -> str:
    if coins not in config.COIN_PACKS:
        raise ApiError(422, "validation_error", "Pick one of the coin packs.", [{"field": "coins", "message": "unknown pack"}])
    _require_can_buy(db, user)
    client = _client()
    sep = "&" if "?" in return_to else "?"
    try:
        session = client.v1.checkout.sessions.create(params={
            "mode": "payment",
            "line_items": [{"price": _price_id(client, coins), "quantity": 1}],
            "success_url": f"{return_to}{sep}checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{return_to}{sep}checkout=cancelled",
            "client_reference_id": user.id,
            "customer_email": user.email or None,
            "metadata": {"user_id": user.id, "coins": str(coins)},
        })
    except stripe.StripeError as exc:
        logger.warning("Stripe checkout failed: %s", exc)
        raise ApiError(502, "upstream_error", "Couldn't start the payment. Try again.")
    db.add(Payment(user_id=user.id, stripe_session_id=session.id, coins=coins, amount_cents=coins, currency="eur"))
    db.commit()
    return session.url


def fulfil(db: Session, session_id: str, payment_status: str, payment_intent: str | None) -> Payment | None:
    """Credit coins for a paid Checkout Session — idempotent, safe to call from webhook and confirm."""
    payment = db.scalar(select(Payment).where(Payment.stripe_session_id == session_id).with_for_update())
    if payment is None:
        logger.warning("Unknown checkout session %s", session_id)
        return None
    if payment.status == "paid" or payment_status != "paid":
        return payment
    payment.status = "paid"
    payment.paid_at = utc_now()
    payment.stripe_payment_intent = payment_intent
    ledger.add_entry(
        db, user_id=payment.user_id, currency=Currency.COINS, amount=payment.coins, type=LedgerEntryType.PURCHASE,
        stripe_ref=payment_intent or session_id, description=f"Bought {payment.coins:,} coins (€{payment.amount_cents / 100:.2f})",
    )
    notifications.notify(
        db, payment.user_id, "coins_purchased", "Coins added 🎉",
        f"{payment.coins:,} coins (€{payment.amount_cents / 100:.2f}) are in your wallet.", {"paymentId": payment.id},
    )
    db.commit()
    notifications.push_pending(db)
    return payment


def confirm(db: Session, user: User, session_id: str) -> PaymentOut:
    """Called by the app when Stripe redirects back: checks with Stripe and fulfils (no webhook needed)."""
    payment = db.scalar(select(Payment).where(Payment.stripe_session_id == session_id, Payment.user_id == user.id))
    if payment is None:
        raise ApiError(404, "not_found", "Payment not found.")
    if payment.status != "paid":
        try:
            session = _client().v1.checkout.sessions.retrieve(session_id)
        except stripe.StripeError:
            raise ApiError(502, "upstream_error", "Couldn't reach Stripe. Your coins will still arrive.")
        payment = fulfil(db, session_id, session.payment_status, session.payment_intent) or payment
    return to_payment_out(payment)


def handle_webhook(db: Session, payload: bytes, signature: str | None) -> None:
    if not config.STRIPE_WEBHOOK_SECRET:
        raise ApiError(409, "payments_not_configured", "Webhook secret not set.")
    try:
        event = stripe.Webhook.construct_event(payload, signature, config.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        raise ApiError(400, "bad_request", "Invalid Stripe signature.")
    if event.type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        obj = event.data.object
        fulfil(db, obj.id, obj.payment_status, obj.payment_intent)
    elif event.type == "checkout.session.expired":
        payment = db.scalar(select(Payment).where(Payment.stripe_session_id == event.data.object.id))
        if payment is not None and payment.status == "pending":
            payment.status = "expired"
            db.commit()


def to_payment_out(p: Payment) -> PaymentOut:
    return PaymentOut(id=p.id, coins=p.coins, amount_cents=p.amount_cents, currency=p.currency, status=p.status,
                      created_at=p.created_at, paid_at=p.paid_at)


# ───────── Wallet ─────────


def _locked(db: Session, user_id: str, mode: str) -> int:
    """Stakes currently held in sessions that started but haven't settled."""
    in_play = [SessionStatus.STUDYING, SessionStatus.EXTENSION_VOTE, SessionStatus.GENERATING_QUIZ,
               SessionStatus.QUIZ, SessionStatus.GRADING, SessionStatus.REVIEW]
    total = db.scalar(
        select(func.coalesce(func.sum(StudySession.stake_amount), 0))
        .join(Participant, Participant.session_id == StudySession.id)
        .where(Participant.user_id == user_id, StudySession.mode == mode, StudySession.status.in_(in_play))
    )
    return int(total)


def wallet(db: Session, user: User) -> WalletOut:
    return WalletOut(
        tokens=ledger.balance(db, user.id, Currency.TOKENS),
        coins=ledger.balance(db, user.id, Currency.COINS),
        locked_tokens=_locked(db, user.id, "tokens"),
        locked_coins=_locked(db, user.id, "money"),
        payments_configured=configured(),
        packs=packs(),
    )


def transactions(db: Session, user: User, currency: str | None, limit: int, cursor: str | None) -> Page[LedgerEntryOut]:
    try:
        offset = int(base64.urlsafe_b64decode(cursor.encode()).decode()) if cursor else 0
    except ValueError:
        raise ApiError(400, "bad_request", "Invalid cursor.")
    query = select(LedgerEntry).where(LedgerEntry.user_id == user.id)
    if currency:
        query = query.where(LedgerEntry.currency == currency)
    rows = db.scalars(query.order_by(LedgerEntry.created_at.desc()).offset(offset).limit(limit + 1)).all()
    others = {r.counterparty_user_id for r in rows if r.counterparty_user_id}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(others)))} if others else {}
    items = [
        LedgerEntryOut(
            id=r.id, currency=r.currency, amount=r.amount, type=r.type, session_id=r.session_id,
            counterparty=UserSummary.from_user(users[r.counterparty_user_id]) if r.counterparty_user_id in users else None,
            description=r.description, created_at=r.created_at,
        )
        for r in rows[:limit]
    ]
    next_cursor = base64.urlsafe_b64encode(str(offset + limit).encode()).decode() if len(rows) > limit else None
    return Page(items=items, next_cursor=next_cursor)
