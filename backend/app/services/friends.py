"""Friends (API_SPEC §6.3) and live status."""

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models.group import GroupMember
from app.models.session import ENDED_STATUSES, Participant, SessionStatus, StudySession
from app.models.social import Friendship
from app.models.user import User
from app.schemas.social import FriendOut, FriendRequestOut, FriendRequestResult
from app.schemas.user import UserSummary
from app.services import notifications
from app.services.realtime import manager
from app.timeutil import utc_now

_IN_PROGRESS = [s for s in SessionStatus if s not in ENDED_STATUSES and s != SessionStatus.LOBBY]


def _pair(db: Session, a: str, b: str) -> Friendship | None:
    return db.scalar(
        select(Friendship).where(
            or_(
                (Friendship.requester_id == a) & (Friendship.addressee_id == b),
                (Friendship.requester_id == b) & (Friendship.addressee_id == a),
            )
        )
    )


def are_friends(db: Session, a: str, b: str) -> bool:
    f = _pair(db, a, b)
    return f is not None and f.status == "accepted"


def friend_ids(db: Session, user_id: str) -> list[str]:
    rows = db.execute(
        select(Friendship.requester_id, Friendship.addressee_id).where(
            Friendship.status == "accepted",
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
        )
    ).all()
    return [b if a == user_id else a for a, b in rows]


def studying_sessions(db: Session, user_ids: list[str]) -> dict[str, StudySession]:
    """user id → the in-progress session they're in (if any)."""
    if not user_ids:
        return {}
    rows = db.execute(
        select(Participant.user_id, StudySession)
        .join(StudySession, StudySession.id == Participant.session_id)
        .where(Participant.user_id.in_(user_ids), StudySession.status.in_(_IN_PROGRESS))
    ).all()
    return {uid: s for uid, s in rows}


def status_of(user_id: str, studying: dict[str, StudySession]) -> str:
    return manager.status(user_id, studying=user_id in studying)


def _friend_out(db: Session, f: Friendship, me: User, studying: dict[str, StudySession], my_groups: set[str]) -> FriendOut:
    other = f.other(me.id)
    session = studying.get(other.id)
    return FriendOut(
        user=UserSummary.from_user(other),
        status=status_of(other.id, studying),
        # Only reveal which session if you share its group (you could open it)
        current_session_id=session.id if session and session.group_id in my_groups else None,
        since=f.accepted_at or f.created_at,
    )


def _request_out(f: Friendship, me: User) -> FriendRequestOut:
    return FriendRequestOut(
        id=f.id,
        user=UserSummary.from_user(f.other(me.id)),
        direction="outgoing" if f.requester_id == me.id else "incoming",
        created_at=f.created_at,
    )


def list_friends(db: Session, me: User) -> list[FriendOut]:
    friendships = db.scalars(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(Friendship.requester_id == me.id, Friendship.addressee_id == me.id),
        )
    ).all()
    others = [f.other(me.id).id for f in friendships]
    studying = studying_sessions(db, others)
    my_groups = set(db.scalars(select(GroupMember.group_id).where(GroupMember.user_id == me.id)))
    order = {"studying": 0, "online": 1, "offline": 2}
    out = [_friend_out(db, f, me, studying, my_groups) for f in friendships]
    return sorted(out, key=lambda f: (order[f.status], f.user.display_name.lower()))


def list_requests(db: Session, me: User) -> list[FriendRequestOut]:
    pending = db.scalars(
        select(Friendship)
        .where(
            Friendship.status == "pending",
            or_(Friendship.requester_id == me.id, Friendship.addressee_id == me.id),
        )
        .order_by(Friendship.created_at.desc())
    ).all()
    return [_request_out(f, me) for f in pending]


def _accept(db: Session, f: Friendship, me: User) -> FriendOut:
    f.status = "accepted"
    f.accepted_at = utc_now()
    requester = f.requester
    notifications.notify(
        db, requester.id, "friend_accepted", f"{me.display_name} accepted your friend request",
        "You can now see each other's status and invite each other to study.", {"userId": me.id},
    )
    db.commit()
    notifications.push_pending(db)
    _push_status_to(requester.id, me.id, db)
    return _friend_out(db, f, me, studying_sessions(db, [requester.id]), set())


def send_request(db: Session, me: User, username: str) -> FriendRequestResult:
    target = db.scalar(select(User).where(User.username == username.strip().lower().lstrip("@")))
    if target is None:
        raise ApiError(404, "not_found", "No one has that username.")
    if target.id == me.id:
        raise ApiError(409, "conflict", "You can't add yourself.")
    existing = _pair(db, me.id, target.id)
    if existing is not None:
        if existing.status == "accepted":
            raise ApiError(409, "conflict", f"You're already friends with {target.display_name}.")
        if existing.requester_id == me.id:
            raise ApiError(409, "conflict", "Request already sent.")
        return FriendRequestResult(request=None, friend=_accept(db, existing, me))  # they'd asked you

    f = Friendship(requester_id=me.id, addressee_id=target.id, status="pending", created_at=utc_now())
    db.add(f)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", "Request already sent.")
    notifications.notify(
        db, target.id, "friend_request", f"{me.display_name} wants to be friends",
        f"@{me.username} sent you a friend request.", {"requestId": f.id, "userId": me.id},
    )
    db.commit()
    notifications.push_pending(db)
    return FriendRequestResult(request=_request_out(f, me), friend=None)


def _get_request(db: Session, me: User, request_id: str) -> Friendship:
    f = db.get(Friendship, request_id)
    if f is None or f.status != "pending" or me.id not in (f.requester_id, f.addressee_id):
        raise not_found("Friend request")
    return f


def accept_request(db: Session, me: User, request_id: str) -> FriendOut:
    f = _get_request(db, me, request_id)
    if f.addressee_id != me.id:
        raise ApiError(403, "forbidden", "Only the person who received the request can accept it.")
    return _accept(db, f, me)


def delete_request(db: Session, me: User, request_id: str) -> None:
    db.delete(_get_request(db, me, request_id))
    db.commit()


def unfriend(db: Session, me: User, user_id: str) -> None:
    f = _pair(db, me.id, user_id)
    if f is None or f.status != "accepted":
        raise not_found("Friend")
    db.delete(f)
    db.commit()


def _push_status_to(viewer_id: str, user_id: str, db: Session) -> None:
    studying = studying_sessions(db, [user_id])
    manager.push_to_user(
        viewer_id, "friend.status",
        {"userId": user_id, "status": status_of(user_id, studying), "currentSessionId": None},
    )


def broadcast_status(db: Session, user_id: str) -> None:
    """Tell a user's online friends their current status (on connect/disconnect)."""
    for friend_id in friend_ids(db, user_id):
        _push_status_to(friend_id, user_id, db)
