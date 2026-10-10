from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import AuthUser, get_auth_user, get_current_user
from app.db import get_db
from app.models.user import User
from app.schemas.user import CreateProfile, Me, UpdateProfile, UserStats
from app.services import users

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=Me)
def get_me(user: User = Depends(get_current_user)):
    return Me.from_user(user)


@router.post("", response_model=Me, status_code=201)
def create_me(data: CreateProfile, auth: AuthUser = Depends(get_auth_user), db: Session = Depends(get_db)):
    return Me.from_user(users.create_profile(db, auth, data))


@router.patch("", response_model=Me)
def update_me(data: UpdateProfile, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return Me.from_user(users.update_profile(db, user, data))


@router.get("/stats", response_model=UserStats)
def get_my_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return users.get_stats(db, user)
