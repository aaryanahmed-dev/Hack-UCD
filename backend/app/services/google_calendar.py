"""Google Calendar sync (API_SPEC §6.12): OAuth connect, read events, add scheduled sessions with a reminder.

Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY. Without them the feature reports
`configured: false` and everything else in the calendar keeps working.
"""

import logging
import re
import threading
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
import jwt
from cryptography.fernet import Fernet, InvalidToken

from app import config
from app import db as db_module
from app.errors import ApiError
from app.models.group import Group
from app.models.productivity import GoogleAccount, GoogleSessionEvent
from app.models.session import SessionStatus, StudySession
from app.timeutil import utc_now

logger = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
SCOPES = "openid email https://www.googleapis.com/auth/calendar.events"
TIMEOUT = 15


class GoogleError(Exception):
    pass


def configured() -> bool:
    return bool(config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET and config.TOKEN_ENCRYPTION_KEY)


def redirect_uri() -> str:
    return f"{config.PUBLIC_BASE_URL}/api/calendar/google/callback"


def _fernet() -> Fernet:
    return Fernet(config.TOKEN_ENCRYPTION_KEY.encode())


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


def _require_configured() -> None:
    if not configured():
        raise ApiError(409, "google_not_configured", "Google Calendar isn't set up on this server yet.")


# ───────── Connect (OAuth) ─────────


def allowed_return(url: str) -> bool:
    """Only send the browser back to our own app (web origin, local dev, or the app's deep link)."""
    if url.startswith(("studystakes://", "exp://")):
        return True
    if url.startswith(config.PUBLIC_BASE_URL + "/") or url == config.PUBLIC_BASE_URL:
        return True
    match = re.match(r"^(https?://[^/]+)", url)
    origin = match.group(1) if match else ""
    return bool(
        origin
        and (origin in config.CORS_ORIGINS or (config.CORS_ORIGIN_REGEX and re.fullmatch(config.CORS_ORIGIN_REGEX, origin)))
    )


def auth_url(user_id: str, return_to: str) -> str:
    _require_configured()
    if not allowed_return(return_to):
        raise ApiError(422, "validation_error", "Invalid return address.", [{"field": "returnTo", "message": "not allowed"}])
    state = jwt.encode(
        {"sub": user_id, "ret": return_to, "exp": int(time.time()) + 600}, config.TOKEN_ENCRYPTION_KEY, "HS256"
    )
    return AUTH_URL + "?" + urlencode({
        "client_id": config.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    })


def read_state(state: str) -> tuple[str, str]:
    """(user id, return_to) from a signed OAuth state."""
    claims = jwt.decode(state, config.TOKEN_ENCRYPTION_KEY, algorithms=["HS256"])
    return claims["sub"], claims["ret"]


def with_query(url: str, **params: str) -> str:
    return url + ("&" if "?" in url else "?") + urlencode(params)


def complete_connect(user_id: str, code: str) -> None:
    """Exchange the OAuth code and store the (encrypted) tokens."""
    response = httpx.post(TOKEN_URL, data={
        "code": code,
        "client_id": config.GOOGLE_CLIENT_ID,
        "client_secret": config.GOOGLE_CLIENT_SECRET,
        "redirect_uri": redirect_uri(),
        "grant_type": "authorization_code",
    }, timeout=TIMEOUT)
    if response.status_code != 200:
        raise GoogleError(f"Token exchange failed: {response.text[:200]}")
    tokens = response.json()
    if not tokens.get("refresh_token"):
        raise GoogleError("Google didn't return a refresh token")
    email = None
    try:
        info = httpx.get(USERINFO_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"}, timeout=TIMEOUT)
        email = info.json().get("email") if info.status_code == 200 else None
    except httpx.HTTPError:
        pass
    with db_module.SessionLocal() as db:
        account = db.get(GoogleAccount, user_id) or GoogleAccount(user_id=user_id)
        account.refresh_token = _encrypt(tokens["refresh_token"])
        account.access_token = _encrypt(tokens["access_token"])
        account.access_expires_at = utc_now() + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)
        account.google_email = email
        account.connected_at = utc_now()
        db.merge(account)
        db.commit()
    sync_user_sessions_async(user_id)


# ───────── API calls ─────────


def _access_token(db, account: GoogleAccount) -> str:
    if account.access_token and account.access_expires_at and account.access_expires_at > utc_now():
        try:
            return _decrypt(account.access_token)
        except InvalidToken:
            pass
    try:
        refresh = _decrypt(account.refresh_token)
    except InvalidToken as exc:
        raise GoogleError("Stored Google token can't be decrypted (key changed?) — reconnect Google") from exc
    response = httpx.post(TOKEN_URL, data={
        "client_id": config.GOOGLE_CLIENT_ID,
        "client_secret": config.GOOGLE_CLIENT_SECRET,
        "refresh_token": refresh,
        "grant_type": "refresh_token",
    }, timeout=TIMEOUT)
    if response.status_code != 200:
        raise GoogleError("Google access was revoked — reconnect Google Calendar")
    tokens = response.json()
    account.access_token = _encrypt(tokens["access_token"])
    account.access_expires_at = utc_now() + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)
    db.commit()
    return tokens["access_token"]


def _rfc3339(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_google_time(value: dict) -> tuple[datetime, bool]:
    if "dateTime" in value:
        dt = datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(UTC).replace(tzinfo=None)
        return dt, False
    return datetime.fromisoformat(value["date"]), True


def guess_kind(title: str) -> str:
    t = title.lower()
    if re.search(r"\b(exam|midterm|final|test|quiz)\b", t):
        return "exam"
    if re.search(r"\b(assignment|due|deadline|submit|submission|homework|essay|lab report|project)\b", t):
        return "assignment"
    if re.search(r"\b(study|revision|revise)\b", t):
        return "study_session"
    return "other"


def list_events(db, account: GoogleAccount, start: datetime, end: datetime) -> list[dict]:
    token = _access_token(db, account)
    response = httpx.get(EVENTS_URL, params={
        "timeMin": _rfc3339(start),
        "timeMax": _rfc3339(end),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": "250",
    }, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
    if response.status_code != 200:
        raise GoogleError(f"Couldn't load Google Calendar ({response.status_code})")
    events = []
    for item in response.json().get("items", []):
        if item.get("status") == "cancelled" or "start" not in item:
            continue
        # Don't show our own session events twice
        if (item.get("extendedProperties") or {}).get("private", {}).get("studyStakesSession"):
            continue
        starts_at, all_day = _parse_google_time(item["start"])
        ends_at = _parse_google_time(item["end"])[0] if "end" in item else None
        title = item.get("summary") or "(No title)"
        events.append({
            "id": item["id"], "title": title, "kind": guess_kind(title), "starts_at": starts_at,
            "ends_at": ends_at, "all_day": all_day, "notes": item.get("description"),
            "html_link": item.get("htmlLink"),
        })
    return events


# ───────── Pushing scheduled sessions ─────────


def _session_body(s: StudySession, group_name: str) -> dict:
    start = s.scheduled_for
    end = start + timedelta(minutes=s.study_minutes)
    return {
        "summary": f"Study session: {s.title}",
        "description": f"Study Stakes session in {group_name}. {s.study_minutes} min of study, then a quiz.",
        "start": {"dateTime": _rfc3339(start), "timeZone": "UTC"},
        "end": {"dateTime": _rfc3339(end), "timeZone": "UTC"},
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": config.SESSION_REMINDER_MINUTES}]},
        "extendedProperties": {"private": {"studyStakesSession": s.id}},
    }


def sync_session(session_id: str) -> None:
    """Make every participant's Google Calendar match the session (create / update / remove)."""
    if not configured():
        return
    with db_module.SessionLocal() as db:
        s = db.get(StudySession, session_id)
        if s is None:
            return
        wanted = {p.user_id for p in s.participants} if (
            s.scheduled_for and s.status == SessionStatus.LOBBY and s.scheduled_for > utc_now()
        ) else set()
        existing = {e.user_id: e for e in db.query(GoogleSessionEvent).filter_by(session_id=session_id)}
        accounts = {a.user_id: a for a in db.query(GoogleAccount).filter(GoogleAccount.user_id.in_(wanted | set(existing)))}
        group = db.get(Group, s.group_id)
        body = _session_body(s, group.name if group else 'your group') if wanted else None
        for user_id in wanted | set(existing):
            account = accounts.get(user_id)
            if account is None:
                continue
            try:
                token = _access_token(db, account)
                headers = {"Authorization": f"Bearer {token}"}
                mapping = existing.get(user_id)
                if user_id in wanted:
                    if mapping:
                        httpx.patch(f"{EVENTS_URL}/{mapping.google_event_id}", json=body, headers=headers, timeout=TIMEOUT)
                    else:
                        r = httpx.post(EVENTS_URL, json=body, headers=headers, timeout=TIMEOUT)
                        if r.status_code in (200, 201):
                            db.add(GoogleSessionEvent(session_id=session_id, user_id=user_id, google_event_id=r.json()["id"]))
                elif mapping:
                    httpx.delete(f"{EVENTS_URL}/{mapping.google_event_id}", headers=headers, timeout=TIMEOUT)
                    db.delete(mapping)
                db.commit()
            except (GoogleError, httpx.HTTPError) as exc:
                db.rollback()
                logger.warning("Google sync for session %s / user %s failed: %s", session_id, user_id, exc)


def sync_session_async(session_id: str) -> None:
    """Best-effort background sync so requests never wait on Google."""
    if configured():
        threading.Thread(target=sync_session, args=(session_id,), daemon=True).start()


def sync_user_sessions_async(user_id: str) -> None:
    """After connecting, add the user's upcoming scheduled sessions."""
    if not configured():
        return

    def run():
        from app.models.session import Participant

        with db_module.SessionLocal() as db:
            ids = [
                s.id for s in db.query(StudySession).join(Participant, Participant.session_id == StudySession.id)
                .filter(Participant.user_id == user_id, StudySession.status == SessionStatus.LOBBY,
                        StudySession.scheduled_for.is_not(None))
            ]
        for sid in ids:
            sync_session(sid)

    threading.Thread(target=run, daemon=True).start()
