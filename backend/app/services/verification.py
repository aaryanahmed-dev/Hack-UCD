"""ID verification with Persona (sandbox) before any real-money feature.

Flow: the app opens Persona's hosted flow (inquiry template + our user id as reference-id). When the
user returns, the app asks us to check; we look up their inquiries via the Persona API and mark the
account verified once one is approved/completed. If Persona isn't configured, verification isn't
required (adults can use money features directly) so local development still works.
"""

import logging
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from app import config
from app.errors import ApiError
from app.models.user import User
from app.schemas.commerce import VerificationOut
from app.timeutil import is_adult, utc_now

logger = logging.getLogger(__name__)

HOSTED_FLOW_URL = "https://inquiry.withpersona.com/verify"
API_URL = "https://api.withpersona.com/api/v1/inquiries"
PASSED = {"approved", "completed"}


def configured() -> bool:
    return bool(config.PERSONA_API_KEY and config.PERSONA_TEMPLATE_ID)


def required() -> bool:
    return configured()


def _out(user: User, status: str) -> VerificationOut:
    return VerificationOut(
        required=required(),
        verified=user.id_verified_at is not None,
        status=status,
        verified_at=user.id_verified_at,
    )


def status(user: User) -> VerificationOut:
    if not required():
        return _out(user, "not_required")
    return _out(user, "verified" if user.id_verified_at else "unverified")


def start(user: User, redirect_uri: str) -> str:
    if not is_adult(user.date_of_birth):
        raise ApiError(403, "age_restricted", "ID verification is only needed for users aged 18+.")
    if not configured():
        raise ApiError(409, "verification_not_configured", "ID verification isn't set up on this server.")
    params = {
        "inquiry-template-id": config.PERSONA_TEMPLATE_ID,
        "reference-id": user.id,
        "redirect-uri": redirect_uri,
    }
    if config.PERSONA_ENVIRONMENT_ID:
        params["environment-id"] = config.PERSONA_ENVIRONMENT_ID
    return f"{HOSTED_FLOW_URL}?{urlencode(params)}"


def refresh(db: Session, user: User) -> VerificationOut:
    """Ask Persona whether this user has a passed inquiry; mark them verified if so."""
    if not required():
        return _out(user, "not_required")
    if user.id_verified_at is not None:
        return _out(user, "verified")
    try:
        response = httpx.get(
            API_URL,
            params={"filter[reference-id]": user.id, "page[size]": "10"},
            headers={"Authorization": f"Bearer {config.PERSONA_API_KEY}", "Accept": "application/json"},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        logger.warning("Persona unreachable: %s", exc)
        raise ApiError(502, "upstream_error", "Couldn't reach the verification service.")
    if response.status_code != 200:
        logger.warning("Persona returned %s: %s", response.status_code, response.text[:200])
        raise ApiError(502, "upstream_error", "Couldn't check your verification.")
    inquiries = response.json().get("data", [])
    statuses = [(i.get("attributes") or {}).get("status") for i in inquiries]
    passed = next((i for i in inquiries if (i.get("attributes") or {}).get("status") in PASSED), None)
    if passed is not None:
        user.id_verified_at = utc_now()
        user.persona_inquiry_id = passed.get("id")
        db.commit()
        return _out(user, "verified")
    latest = statuses[0] if statuses else None
    # pending/needs_review → still checking; declined/failed → try again
    return _out(user, {"declined": "declined", "failed": "declined", "needs_review": "pending", "pending": "pending",
                       "created": "unverified", "expired": "unverified"}.get(latest or "", "unverified"))
