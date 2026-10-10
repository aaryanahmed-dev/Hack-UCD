import secrets
import string

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models.group import Group, GroupMember, GroupRole
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.group import (
    CreateGroup,
    GroupDetail,
    GroupMemberOut,
    GroupStats,
    GroupSummary,
    Milestone,
    UpdateGroup,
)
from app.schemas.user import UserSummary
from app.services.realtime import manager

MAX_MEMBERS = 50
INVITE_CODE_ALPHABET = string.ascii_uppercase + string.digits
INVITE_CODE_LENGTH = 6
_ROLE_ORDER = {GroupRole.OWNER: 0, GroupRole.ADMIN: 1, GroupRole.MEMBER: 2}

# (id, title, metric, target) — progress comes from group stats.
MILESTONES = [
    *[(f"focus_hours_{h}", f"{h} hours studied together", "focus_hours", h) for h in (10, 25, 50, 100, 250)],
    *[(f"sessions_{n}", f"{n} sessions completed", "sessions_completed", n) for n in (5, 10, 25, 50)],
]


# ───────── Lookups & permissions ─────────


def get_membership(db: Session, group_id: str, user: User) -> GroupMember:
    """The caller's membership. Non-members get 404 so groups aren't discoverable by id."""
    membership = db.get(GroupMember, (group_id, user.id))
    if membership is None:
        raise not_found("Group")
    return membership


def require_role(membership: GroupMember, *roles: GroupRole) -> None:
    if membership.role not in roles:
        raise ApiError(403, "forbidden", "You don't have permission to do that in this group.")


def _find_member(group: Group, user_id: str) -> GroupMember:
    for member in group.members:
        if member.user_id == user_id:
            return member
    raise not_found("Group member")


# ───────── Serialization ─────────


def to_summary(group: Group, my_role: str) -> GroupSummary:
    return GroupSummary(
        id=group.id,
        name=group.name,
        description=group.description,
        member_count=len(group.members),
        my_role=my_role,
        active_session=None,  # study sessions arrive in build phase 3
        created_at=group.created_at,
    )


def to_member_out(member: GroupMember) -> GroupMemberOut:
    return GroupMemberOut(
        user=UserSummary.from_user(member.user),
        role=member.role,
        status=manager.status(member.user_id),
        joined_at=member.joined_at,
    )


def to_detail(group: Group, my_role: str) -> GroupDetail:
    # Stats come from settled sessions (build phase 5); zero until then.
    stats = GroupStats(total_focused_minutes=0, sessions_completed=0, average_quiz_score=None)
    progress = {
        "focus_hours": stats.total_focused_minutes // 60,
        "sessions_completed": stats.sessions_completed,
    }
    members = sorted(group.members, key=lambda m: (_ROLE_ORDER[GroupRole(m.role)], m.joined_at))
    return GroupDetail(
        **to_summary(group, my_role).model_dump(),
        invite_code=group.invite_code,
        members=[to_member_out(m) for m in members],
        stats=stats,
        milestones=[
            Milestone(
                id=mid,
                title=title,
                metric=metric,
                target=target,
                progress=min(progress[metric], target),
                achieved_at=None,
            )
            for mid, title, metric, target in MILESTONES
        ],
    )


# ───────── Operations ─────────


def _new_invite_code(db: Session) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(INVITE_CODE_LENGTH))
        if db.scalar(select(Group.id).where(Group.invite_code == code)) is None:
            return code
    raise ApiError(500, "internal_error", "Could not generate an invite code.")


def list_my_groups(db: Session, user: User) -> ListResponse[GroupSummary]:
    rows = db.execute(
        select(Group, GroupMember.role)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id)
        .order_by(GroupMember.joined_at.desc())
    ).all()
    return ListResponse(items=[to_summary(group, role) for group, role in rows])


def create_group(db: Session, user: User, data: CreateGroup) -> Group:
    group = Group(name=data.name, description=data.description, invite_code=_new_invite_code(db))
    group.members.append(GroupMember(user_id=user.id, role=GroupRole.OWNER))
    db.add(group)
    db.commit()
    return group


def update_group(db: Session, membership: GroupMember, data: UpdateGroup) -> Group:
    require_role(membership, GroupRole.OWNER, GroupRole.ADMIN)
    group = membership.group
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        group.name = changes["name"]
    if "description" in changes:
        group.description = changes["description"]
    db.commit()
    return group


def delete_group(db: Session, membership: GroupMember) -> None:
    require_role(membership, GroupRole.OWNER)
    # Once sessions exist: refuse while the group has an active session.
    db.delete(membership.group)
    db.commit()


def join_group(db: Session, user: User, invite_code: str) -> Group:
    code = invite_code.strip().upper()
    group = db.scalar(select(Group).where(Group.invite_code == code).with_for_update())
    if group is None:
        raise ApiError(404, "not_found", "No group has that invite code.")
    if any(m.user_id == user.id for m in group.members):
        raise ApiError(409, "already_member", "You're already in this group.")
    if len(group.members) >= MAX_MEMBERS:
        raise ApiError(409, "group_full", f"This group is full ({MAX_MEMBERS} members).")
    group.members.append(GroupMember(user_id=user.id, role=GroupRole.MEMBER))
    db.commit()
    return group


def regenerate_invite_code(db: Session, membership: GroupMember) -> Group:
    require_role(membership, GroupRole.OWNER, GroupRole.ADMIN)
    group = membership.group
    group.invite_code = _new_invite_code(db)
    db.commit()
    return group


def set_member_role(db: Session, membership: GroupMember, target_user_id: str, role: str) -> GroupMember:
    require_role(membership, GroupRole.OWNER)
    target = _find_member(membership.group, target_user_id)
    if target.role == GroupRole.OWNER:
        raise ApiError(409, "conflict", "The owner's role can't be changed.")
    target.role = role
    db.commit()
    return target


def remove_member(db: Session, membership: GroupMember, target_user_id: str) -> None:
    """Leave the group (target is yourself) or remove someone else (owner, or admin removing a member)."""
    group = membership.group
    target = _find_member(group, target_user_id)

    if target.user_id != membership.user_id:
        allowed = membership.role == GroupRole.OWNER or (
            membership.role == GroupRole.ADMIN and target.role == GroupRole.MEMBER
        )
        if not allowed:
            raise ApiError(403, "forbidden", "You don't have permission to remove this member.")
        # Once sessions exist: refuse while the target is in an active session.
        group.members.remove(target)
        db.commit()
        return

    # Leaving
    remaining = [m for m in group.members if m.user_id != target.user_id]
    if not remaining:
        db.delete(group)  # last member out: the group goes too
        db.commit()
        return
    if target.role == GroupRole.OWNER:
        successor = min(remaining, key=lambda m: (_ROLE_ORDER[GroupRole(m.role)], m.joined_at))
        successor.role = GroupRole.OWNER
    group.members.remove(target)
    db.commit()
