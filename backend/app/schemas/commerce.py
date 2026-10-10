from typing import Literal

from pydantic import Field

from app.schemas.common import CamelModel, UTCDateTime
from app.schemas.user import UserSummary


class CoinPack(CamelModel):
    coins: int
    amount_cents: int
    currency: str
    label: str


class WalletOut(CamelModel):
    tokens: int
    coins: int  # 1 coin = €0.01
    locked_tokens: int  # staked in sessions in progress
    locked_coins: int
    payments_configured: bool
    packs: list[CoinPack]


class LedgerEntryOut(CamelModel):
    id: str
    currency: Literal["tokens", "coins"]
    amount: int
    type: str
    session_id: str | None
    counterparty: UserSummary | None
    description: str
    created_at: UTCDateTime


class CheckoutBody(CamelModel):
    coins: int
    return_to: str = Field(min_length=1, max_length=500)


class CheckoutOut(CamelModel):
    checkout_url: str


class ConfirmBody(CamelModel):
    session_id: str = Field(min_length=1, max_length=255)


class PaymentOut(CamelModel):
    id: str
    coins: int
    amount_cents: int
    currency: str
    status: Literal["pending", "paid", "expired"]
    created_at: UTCDateTime
    paid_at: UTCDateTime | None


class VerificationOut(CamelModel):
    required: bool  # false when ID verification isn't configured on the server
    verified: bool
    status: Literal["not_required", "unverified", "pending", "declined", "verified"]
    verified_at: UTCDateTime | None


class VerificationStartBody(CamelModel):
    redirect_uri: str = Field(min_length=1, max_length=500)


class ShopItemOut(CamelModel):
    id: str
    kind: Literal["avatar", "frame", "streak_freeze"]
    name: str
    description: str
    price_tokens: int
    data: dict[str, str]  # {"icon", "color"}
    owned: int
    equipped: bool
