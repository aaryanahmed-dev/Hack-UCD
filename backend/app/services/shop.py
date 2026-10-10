"""Token store (API_SPEC §6.13): avatars, avatar frames and streak freezes, paid with tokens."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models.commerce import ShopItem, UserItem
from app.models.ledger import Currency, LedgerEntryType
from app.models.shop_seed import MAX_STREAK_FREEZES, STREAK_FREEZE_ID
from app.models.user import User
from app.schemas.commerce import ShopItemOut
from app.services import ledger


def owned_quantities(db: Session, user_id: str) -> dict[str, int]:
    return {ui.item_id: ui.quantity for ui in db.scalars(select(UserItem).where(UserItem.user_id == user_id))}


def _out(item: ShopItem, owned: int, user: User) -> ShopItemOut:
    equipped = item.id in (user.equipped_avatar_id, user.equipped_frame_id)
    return ShopItemOut(
        id=item.id, kind=item.kind, name=item.name, description=item.description, price_tokens=item.price_tokens,
        data={k: str(v) for k, v in (item.data or {}).items()}, owned=owned, equipped=equipped,
    )


def list_items(db: Session, user: User) -> list[ShopItemOut]:
    owned = owned_quantities(db, user.id)
    items = db.scalars(select(ShopItem).order_by(ShopItem.sort)).all()
    return [_out(i, owned.get(i.id, 0), user) for i in items]


def purchase(db: Session, user: User, item_id: str) -> ShopItemOut:
    item = db.get(ShopItem, item_id)
    if item is None:
        raise not_found("Item")
    ledger.lock_user(db, user.id)
    owned = db.get(UserItem, (user.id, item.id))
    if item.kind == "streak_freeze":
        if owned and owned.quantity >= MAX_STREAK_FREEZES:
            raise ApiError(409, "conflict", f"You can hold at most {MAX_STREAK_FREEZES} streak freezes.")
    elif owned:
        raise ApiError(409, "conflict", "You already own this.")
    if ledger.balance(db, user.id, Currency.TOKENS) < item.price_tokens:
        raise ApiError(409, "insufficient_balance", f"You need {item.price_tokens} tokens for {item.name}.")
    ledger.add_entry(db, user_id=user.id, currency=Currency.TOKENS, amount=-item.price_tokens,
                     type=LedgerEntryType.SHOP_PURCHASE, description=f"Store: {item.name}")
    if owned:
        owned.quantity += 1
    else:
        owned = UserItem(user_id=user.id, item_id=item.id, quantity=1)
        db.add(owned)
    db.commit()
    return _out(item, owned.quantity, user)


def check_equip(db: Session, user: User, item_id: str, kind: str) -> None:
    item = db.get(ShopItem, item_id)
    if item is None or item.kind != kind:
        raise not_found("Item")
    if db.get(UserItem, (user.id, item_id)) is None:
        raise ApiError(403, "forbidden", "Buy this in the token store first.")


def freezes_owned(db: Session, user_id: str) -> int:
    owned = db.get(UserItem, (user_id, STREAK_FREEZE_ID))
    return owned.quantity if owned else 0


def use_freeze(db: Session, user_id: str) -> None:
    owned = db.get(UserItem, (user_id, STREAK_FREEZE_ID))
    if owned and owned.quantity > 0:
        owned.quantity -= 1
