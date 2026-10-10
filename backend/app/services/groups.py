import secrets
import string

from sqlalchemy import func, select
from sqlalchemy.orm import Session, object_session

from app.errors import ApiError, not_found
from app.models.group import Group, GroupMember, GroupRole
from app.models.session import ENDED_STATUSES, Participant, SessionStatus, StudySession
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.group import (
    ActiveSessionRef,
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


# A member counts as "studying" while in a session that has started and not finished.
_IN_PROGRESS = [s for s in SessionStatus if s not in ENDED_STATUSES and s != SessionStatus.LOBBY]


def _active_session(db: Session, group_id: str) -> StudySession | None:
    return db.scalar(
        select(StudySession)
        .where(StudySession.group_id == group_id, StudySession.status.not_in(ENDED_STATUSES))
        .order_by(StudySession.created_at.desc())
    )


def to_summary(group: Group, my_role: str) -> GroupSummary:
    active = _active_session(object_session(group), group.id)
    return GroupSummary(
        id=group.id,
        name=group.name,
        description=group.description,
        member_count=len(group.members),
        my_role=my_role,
        active_session=ActiveSessionRef(id=active.id, status=active.status) if active else None,
        created_at=group.created_at,
    )


def to_member_out(member: GroupMember, studying: set[str] = frozenset()) -> GroupMemberOut:
    return GroupMemberOut(
        user=UserSummary.from_user(member.user),
        role=member.role,
        status=manager.status(member.user_id, studying=member.user_id in studying),
        joined_at=member.joined_at,
    )


def _studying_user_ids(db: Session, group_id: str) -> set[str]:
    return set(
        db.scalars(
            select(Participant.user_id)
            .join(StudySession, StudySession.id == Participant.session_id)
            .where(StudySession.group_id == group_id, StudySession.status.in_(_IN_PROGRESS))
        )
    )


def _group_stats(db: Session, group_id: str) -> GroupStats:
    settled = (
        select(Participant)
        .join(StudySession, StudySession.id == Participant.session_id)
        .where(StudySession.group_id == group_id, StudySession.status == SessionStatus.SETTLED)
        .subquery()
    )
    focused, avg_score = db.execute(
        select(func.coalesce(func.sum(settled.c.focused_seconds), 0), func.avg(settled.c.quiz_score))
    ).one()
    completed = db.scalar(
        select(func.count()).where(StudySession.group_id == group_id, StudySession.status == SessionStatus.SETTLED)
    )
    return GroupStats(
        total_focused_minutes=int(focused) // 60,
        sessions_completed=int(completed or 0),
        average_quiz_score=round(float(avg_score)) if avg_score is not None else None,
    )


def to_detail(group: Group, my_role: str) -> GroupDetail:
    db = object_session(group)
    stats = _group_stats(db, group.id)
    studying = _studying_user_ids(db, group.id)
    progress = {
        "focus_hours": stats.total_focused_minutes // 60,
        "sessions_completed": stats.sessions_completed,
    }
    members = sorted(group.members, key=lambda m: (_ROLE_ORDER[GroupRole(m.role)], m.joined_at))
    return GroupDetail(
        **to_summary(group, my_role).model_dump(),
        invite_code=group.invite_code,
        members=[to_member_out(m, studying) for m in members],
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
    if _active_session(db, membership.group_id) is not None:
        raise ApiError(409, "conflict", "Finish or cancel the group's session first.")
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
        if _in_active_session(db, group.id, target.user_id):
            raise ApiError(409, "conflict", "They're in a session right now — try again after it ends.")
        group.members.remove(target)
        db.commit()
        return

    # Leaving
    if _in_active_session(db, group.id, target.user_id):
        raise ApiError(409, "conflict", "Leave or finish your session in this group first.")
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


def _in_active_session(db: Session, group_id: str, user_id: str) -> bool:
    return (
        db.scalar(
            select(Participant.user_id)
            .join(StudySession, StudySession.id == Participant.session_id)
            .where(
                StudySession.group_id == group_id,
                StudySession.status.not_in(ENDED_STATUSES),
                Participant.user_id == user_id,
            )
        )
        is not None
    )
