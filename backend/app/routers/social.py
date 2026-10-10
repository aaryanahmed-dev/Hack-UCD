from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models.user import User
from app.schemas.common import ListResponse, Page
from app.schemas.social import (
    ActivityOut,
    FriendOut,
    FriendRequestOut,
    FriendRequestResult,
    GroupInviteBody,
    LeaderboardOut,
    MarkRead,
    NotificationOut,
    SendFriendRequest,
    SessionInviteBody,
)
from app.services import friends, invites, leaderboard, notifications

router = APIRouter(tags=["social"])


# ───────── Friends ─────────


@router.get("/api/friends", response_model=ListResponse[FriendOut])
def list_friends(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ListResponse(items=friends.list_friends(db, user))


@router.get("/api/friends/requests", response_model=ListResponse[FriendRequestOut])
def list_requests(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ListResponse(items=friends.list_requests(db, user))


@router.post("/api/friends/requests", response_model=FriendRequestResult, status_code=201)
def send_request(data: SendFriendRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return friends.send_request(db, user, data.username)


@router.post("/api/friends/requests/{request_id}/accept", response_model=FriendOut)
def accept_request(request_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return friends.accept_request(db, user, request_id)


@router.delete("/api/friends/requests/{request_id}", status_code=204)
def delete_request(request_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friends.delete_request(db, user, request_id)
    return Response(status_code=204)


@router.delete("/api/friends/{user_id}", status_code=204)
def unfriend(user_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    friends.unfriend(db, user, user_id)
    return Response(status_code=204)


# ───────── Invites ─────────


@router.post("/api/groups/{group_id}/invites", status_code=204)
def invite_to_group(group_id: str, data: GroupInviteBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invites.invite_to_group(db, user, group_id, data.user_id)
    return Response(status_code=204)


@router.post("/api/sessions/{session_id}/invites")
def invite_to_session(session_id: str, data: SessionInviteBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"invited": invites.invite_to_session(db, user, session_id, data.user_ids)}


# ───────── Notifications ─────────


@router.get("/api/notifications", response_model=Page[NotificationOut])
def list_notifications(
    unread_only: bool = Query(False, alias="unreadOnly"),
    limit: int = Query(30, ge=1, le=100),
    cursor: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return notifications.list_for(db, user.id, unread_only, limit, cursor)


@router.get("/api/notifications/unread-count")
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"count": notifications.unread_count(db, user.id)}


@router.post("/api/notifications/read", status_code=204)
def mark_read(data: MarkRead, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notifications.mark_read(db, user.id, data.ids, data.all)
    return Response(status_code=204)


# ───────── Leaderboards & activity ─────────


@router.get("/api/leaderboard", response_model=LeaderboardOut)
def get_leaderboard(
    scope: Literal["friends", "global", "group"] = "friends",
    metric: Literal["weekly_study", "avg_score", "tokens"] = "weekly_study",
    group_id: str | None = Query(None, alias="groupId"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return leaderboard.leaderboard(db, user, scope, metric, group_id)


@router.get("/api/me/activity", response_model=ActivityOut)
def my_activity(days: int = Query(14, ge=1, le=90), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ActivityOut(days=leaderboard.activity(db, user, days))
