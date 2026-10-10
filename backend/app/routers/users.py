from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.errors import ApiError
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.user import UserStats, UserSummary
from app.services import friends, users

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=ListResponse[UserSummary])
def search_users(
    search: str = Query(min_length=1, max_length=20),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return ListResponse(items=[UserSummary.from_user(u) for u in users.search_users(db, search)])


@router.get("/{user_id}", response_model=UserSummary)
def get_user(user_id: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return UserSummary.from_user(users.get_user(db, user_id))


@router.get("/{user_id}/stats", response_model=UserStats)
def get_user_stats(user_id: str, me: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target = users.get_user(db, user_id)
    if target.id != me.id and not friends.are_friends(db, me.id, target.id):
        raise ApiError(403, "forbidden", "You can only view your friends' stats.")
    return users.get_stats(db, target)
