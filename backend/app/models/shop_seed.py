"""The token store catalogue. Seeded by migration; the app mirrors the render data (icon/colour) by id."""

from sqlalchemy.orm import Session

from app.models.commerce import ShopItem

STREAK_FREEZE_ID = "streak-freeze"
MAX_STREAK_FREEZES = 5

ITEMS = [
    # Avatars: an icon on a colour, replacing your initials
    {"id": "avatar-sprout", "kind": "avatar", "name": "Sprout", "description": "Fresh start, steady growth.", "price_tokens": 40, "data": {"icon": "leaf", "color": "#2F7A4B"}, "sort": 1},
    {"id": "avatar-bookworm", "kind": "avatar", "name": "Bookworm", "description": "Always one more chapter.", "price_tokens": 60, "data": {"icon": "book", "color": "#3B5B8C"}, "sort": 2},
    {"id": "avatar-scholar", "kind": "avatar", "name": "Scholar", "description": "Cap, gown, the works.", "price_tokens": 80, "data": {"icon": "school", "color": "#1E4D33"}, "sort": 3},
    {"id": "avatar-flash", "kind": "avatar", "name": "Quick Study", "description": "Answers in under 20 seconds.", "price_tokens": 90, "data": {"icon": "flash", "color": "#8A5512"}, "sort": 4},
    {"id": "avatar-flame", "kind": "avatar", "name": "On Fire", "description": "For streak keepers.", "price_tokens": 120, "data": {"icon": "flame", "color": "#B3402F"}, "sort": 5},
    {"id": "avatar-rocket", "kind": "avatar", "name": "Rocket", "description": "Grades going up.", "price_tokens": 150, "data": {"icon": "rocket", "color": "#7A3B5C"}, "sort": 6},
    {"id": "avatar-planet", "kind": "avatar", "name": "Big Brain", "description": "Thinking on another level.", "price_tokens": 180, "data": {"icon": "planet", "color": "#2F6F6A"}, "sort": 7},
    {"id": "avatar-diamond", "kind": "avatar", "name": "Diamond", "description": "Pressure makes them.", "price_tokens": 250, "data": {"icon": "diamond", "color": "#17231C"}, "sort": 8},
    # Frames: a coloured ring around your avatar
    {"id": "frame-emerald", "kind": "frame", "name": "Emerald ring", "description": "A calm green frame.", "price_tokens": 60, "data": {"color": "#3DBE6C"}, "sort": 10},
    {"id": "frame-ocean", "kind": "frame", "name": "Ocean ring", "description": "Cool and focused.", "price_tokens": 60, "data": {"color": "#3B82C4"}, "sort": 11},
    {"id": "frame-rose", "kind": "frame", "name": "Rose ring", "description": "Bold and warm.", "price_tokens": 90, "data": {"color": "#D9467A"}, "sort": 12},
    {"id": "frame-gold", "kind": "frame", "name": "Gold ring", "description": "For top of the leaderboard.", "price_tokens": 200, "data": {"color": "#E39B2F"}, "sort": 13},
    # Power-ups
    {"id": STREAK_FREEZE_ID, "kind": "streak_freeze", "name": "Streak freeze", "description": "Miss a day without losing your streak. Used automatically.", "price_tokens": 30, "data": {"icon": "snow", "color": "#3B82C4"}, "sort": 20},
]


def seed_shop(db: Session) -> None:
    existing = {i.id for i in db.query(ShopItem)}
    for item in ITEMS:
        if item["id"] not in existing:
            db.add(ShopItem(**item))
