"""Study invites (API_SPEC §6.4, §6.5): invite friends to a group, or group members to a session."""

from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models.group import Group, GroupMember
from app.models.session import SessionStatus
from app.models.user import User
from app.services import friends, groups, notifications, sessions


def invite_to_group(db: Session, me: User, group_id: str, user_id: str) -> None:
    groups.get_membership(db, group_id, me)
    group = db.get(Group, group_id)
    target = db.get(User, user_id)
    if target is None:
        raise not_found("User")
    if not friends.are_friends(db, me.id, user_id):
        raise ApiError(403, "forbidden", "You can only invite your friends.")
    if db.get(GroupMember, (group_id, user_id)) is not None:
        raise ApiError(409, "already_member", f"{target.display_name} is already in {group.name}.")
    notifications.notify(
        db, user_id, "group_invite", f"{me.display_name} invited you to {group.name}",
        "Join the group to study together.",
        {"groupId": group.id, "groupName": group.name, "inviteCode": group.invite_code, "fromUserId": me.id},
    )
    db.commit()
    notifications.push_pending(db)


def invite_to_session(db: Session, me: User, session_id: str, user_ids: list[str]) -> int:
    """Notify group members about a session lobby. Returns how many were invited."""
    s = sessions.get_session(db, session_id, me)
    if s.participant(me.id) is None:
        raise ApiError(403, "forbidden", "Join the session before inviting others.")
    if s.status != SessionStatus.LOBBY:
        raise ApiError(409, "invalid_session_state", "You can only invite people while the session is in the lobby.")
    group = db.get(Group, s.group_id)
    invited = 0
    for uid in dict.fromkeys(user_ids):
        if uid == me.id or s.participant(uid) is not None:
            continue
        if db.get(GroupMember, (s.group_id, uid)) is None:
            raise ApiError(422, "validation_error", "You can only invite members of this group.",
                           [{"field": "userIds", "message": "not a group member"}])
        notifications.notify(
            db, uid, "session_invite", f"{me.display_name} invited you to study",
            f"“{s.title}” in {group.name} — join the lobby.", {"sessionId": s.id, "groupId": s.group_id},
        )
        invited += 1
    db.commit()
    notifications.push_pending(db)
    return invited
