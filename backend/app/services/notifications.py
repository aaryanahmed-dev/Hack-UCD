"""In-app notifications: stored in MySQL and pushed live over /ws/me (API_SPEC §6.14, §8.1)."""

import base64

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models.social import Notification
from app.schemas.common import Page
from app.schemas.social import NotificationOut
from app.services.realtime import manager
from app.timeutil import utc_now


def to_out(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        data={k: str(v) for k, v in (n.data or {}).items()},
        read_at=n.read_at,
        created_at=n.created_at,
    )


def notify(db: Session, user_id: str, type: str, title: str, body: str, data: dict | None = None) -> Notification:
    """Store a notification. It is pushed to the user's devices once the caller commits (see `push_pending`)."""
    n = Notification(user_id=user_id, type=type, title=title, body=body, data=data or {}, created_at=utc_now())
    db.add(n)
    db.info.setdefault("pending_notifications", []).append(n)
    return n


def push_pending(db: Session) -> None:
    """Call after commit: deliver notifications created in this DB session over /ws/me."""
    for n in db.info.pop("pending_notifications", []):
        manager.push_to_user(n.user_id, "notification.created", to_out(n).model_dump(by_alias=True, mode="json"))


def list_for(db: Session, user_id: str, unread_only: bool, limit: int, cursor: str | None) -> Page[NotificationOut]:
    try:
        offset = int(base64.urlsafe_b64decode(cursor.encode()).decode()) if cursor else 0
    except ValueError:
        raise ApiError(400, "bad_request", "Invalid cursor.")
    query = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = db.scalars(query.order_by(Notification.created_at.desc()).offset(offset).limit(limit + 1)).all()
    next_cursor = base64.urlsafe_b64encode(str(offset + limit).encode()).decode() if len(rows) > limit else None
    return Page(items=[to_out(n) for n in rows[:limit]], next_cursor=next_cursor)


def unread_count(db: Session, user_id: str) -> int:
    return db.scalar(
        select(func.count()).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    ) or 0


def mark_read(db: Session, user_id: str, ids: list[str], all_: bool) -> None:
    query = update(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    if not all_:
        if not ids:
            return
        query = query.where(Notification.id.in_(ids))
    db.execute(query.values(read_at=utc_now()))
    db.commit()
