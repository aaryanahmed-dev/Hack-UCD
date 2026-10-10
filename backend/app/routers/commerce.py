from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.errors import ApiError
from app.models.user import User
from app.schemas.common import ListResponse, Page
from app.schemas.commerce import (
    CheckoutBody,
    CheckoutOut,
    ConfirmBody,
    LedgerEntryOut,
    PaymentOut,
    ShopItemOut,
    VerificationOut,
    VerificationStartBody,
    WalletOut,
)
from app.services import payments, shop, verification
from app.services.google_calendar import allowed_return

router = APIRouter(tags=["wallet"])


def _check_return(url: str) -> str:
    if not allowed_return(url):
        raise ApiError(422, "validation_error", "Invalid return address.", [{"field": "returnTo", "message": "not allowed"}])
    return url


# ───────── Wallet & Stripe ─────────


@router.get("/api/wallet", response_model=WalletOut)
def get_wallet(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return payments.wallet(db, user)


@router.get("/api/wallet/transactions", response_model=Page[LedgerEntryOut])
def get_transactions(
    currency: str | None = Query(None, pattern="^(tokens|coins)$"),
    limit: int = Query(30, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return payments.transactions(db, user, currency, limit, cursor)


@router.post("/api/wallet/checkout", response_model=CheckoutOut)
def create_checkout(data: CheckoutBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return CheckoutOut(checkout_url=payments.create_checkout(db, user, data.coins, _check_return(data.return_to)))


@router.post("/api/wallet/checkout/confirm", response_model=PaymentOut)
def confirm_checkout(data: ConfirmBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return payments.confirm(db, user, data.session_id)


@router.post("/api/webhooks/stripe", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payments.handle_webhook(db, await request.body(), request.headers.get("stripe-signature"))
    return Response(status_code=200)


# ───────── ID verification (Persona) ─────────


@router.get("/api/me/verification", response_model=VerificationOut)
def get_verification(user: User = Depends(get_current_user)):
    return verification.status(user)


@router.post("/api/me/verification/start")
def start_verification(data: VerificationStartBody, user: User = Depends(get_current_user)):
    return {"url": verification.start(user, _check_return(data.redirect_uri))}


@router.post("/api/me/verification/refresh", response_model=VerificationOut)
def refresh_verification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return verification.refresh(db, user)


# ───────── Token store ─────────


@router.get("/api/shop/items", response_model=ListResponse[ShopItemOut])
def list_shop(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ListResponse(items=shop.list_items(db, user))


@router.post("/api/shop/items/{item_id}/purchase", response_model=ShopItemOut)
def buy_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return shop.purchase(db, user, item_id)
