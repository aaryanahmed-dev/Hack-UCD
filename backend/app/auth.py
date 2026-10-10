import logging
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import config
from app.db import get_db
from app.errors import ApiError
from app.models.user import User

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    """Identity from a verified Supabase token — exists even before onboarding."""

    id: str
    email: str


def _unauthenticated(message: str = "Please sign in again.") -> ApiError:
    return ApiError(401, "unauthenticated", message)


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{config.SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)


def _signing_key(token: str, alg: str):
    if alg == "HS256":
        if not config.SUPABASE_JWT_SECRET:
            raise _unauthenticated("Unsupported token.")
        return config.SUPABASE_JWT_SECRET
    if not config.SUPABASE_URL:
        logger.error("SUPABASE_URL is not set; cannot verify tokens")
        raise ApiError(500, "internal_error", "Authentication is not configured.")
    try:
        return _jwks_client().get_signing_key_from_jwt(token).key
    except jwt.PyJWKClientConnectionError as exc:
        logger.error("Could not fetch Supabase JWKS: %s", exc)
        raise ApiError(502, "upstream_error", "Could not reach the authentication service.")
    except jwt.PyJWKClientError:
        raise _unauthenticated()


def verify_token(token: str) -> AuthUser:
    """Verify a Supabase access token and return who it belongs to. Also used by WebSockets."""
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError:
        raise _unauthenticated()
    if alg not in ("ES256", "RS256", "HS256"):
        raise _unauthenticated("Unsupported token.")

    key = _signing_key(token, alg)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience=config.SUPABASE_JWT_AUDIENCE,
            issuer=f"{config.SUPABASE_URL}/auth/v1" if config.SUPABASE_URL else None,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise _unauthenticated("Your session has expired.")
    except jwt.PyJWTError:
        raise _unauthenticated()
    return AuthUser(id=claims["sub"], email=claims.get("email") or "")


def get_auth_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> AuthUser:
    if credentials is None:
        raise _unauthenticated("Missing access token.")
    return verify_token(credentials.credentials)


def get_current_user(auth: AuthUser = Depends(get_auth_user), db: Session = Depends(get_db)) -> User:
    """The signed-in user's profile. 404 profile_not_found until onboarding (POST /api/me) is done."""
    user = db.get(User, auth.id)
    if user is None:
        raise ApiError(404, "profile_not_found", "Finish setting up your profile.")
    if auth.email and user.email != auth.email:
        user.email = auth.email  # keep in sync if it was changed in Supabase
        db.commit()
    return user
