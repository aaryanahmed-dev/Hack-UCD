from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.group import (
    CreateGroup,
    GroupDetail,
    GroupMemberOut,
    GroupSummary,
    JoinGroup,
    UpdateGroup,
    UpdateMemberRole,
)
from app.services import groups

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("", response_model=ListResponse[GroupSummary])
def list_groups(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return groups.list_my_groups(db, user)


@router.post("", response_model=GroupDetail, status_code=201)
def create_group(data: CreateGroup, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = groups.create_group(db, user, data)
    return groups.to_detail(group, "owner")


@router.post("/join", response_model=GroupDetail)
def join_group(data: JoinGroup, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = groups.join_group(db, user, data.invite_code)
    return groups.to_detail(group, "member")


@router.get("/{group_id}", response_model=GroupDetail)
def get_group(group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    membership = groups.get_membership(db, group_id, user)
    return groups.to_detail(membership.group, membership.role)


@router.patch("/{group_id}", response_model=GroupDetail)
def update_group(
    group_id: str, data: UpdateGroup, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    membership = groups.get_membership(db, group_id, user)
    group = groups.update_group(db, membership, data)
    return groups.to_detail(group, membership.role)


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    groups.delete_group(db, groups.get_membership(db, group_id, user))
    return Response(status_code=204)


@router.post("/{group_id}/invite-code", response_model=GroupDetail)
def regenerate_invite_code(group_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    membership = groups.get_membership(db, group_id, user)
    group = groups.regenerate_invite_code(db, membership)
    return groups.to_detail(group, membership.role)


@router.patch("/{group_id}/members/{user_id}", response_model=GroupMemberOut)
def update_member_role(
    group_id: str,
    user_id: str,
    data: UpdateMemberRole,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    membership = groups.get_membership(db, group_id, user)
    return groups.to_member_out(groups.set_member_role(db, membership, user_id, data.role))


@router.delete("/{group_id}/members/{user_id}", status_code=204)
def remove_member(
    group_id: str, user_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    groups.remove_member(db, groups.get_membership(db, group_id, user), user_id)
    return Response(status_code=204)
