"""Calendar (API_SPEC §6.12): your own events + group study sessions + Google Calendar, merged."""

import logging
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.errors import ApiError, not_found
from app.models.group import Group, GroupMember
from app.models.productivity import CalendarEvent, GoogleAccount
from app.models.session import Participant, SessionStatus, StudySession
from app.models.user import User
from app.schemas.productivity import CalendarEventOut, CalendarEventsOut, CreateEvent, GoogleStatus, UpdateEvent
from app.services import google_calendar

logger = logging.getLogger(__name__)

MAX_RANGE_DAYS = 93


def _manual_out(e: CalendarEvent) -> CalendarEventOut:
    return CalendarEventOut(
        id=e.id, title=e.title, kind=e.kind, starts_at=e.starts_at, ends_at=e.ends_at, all_day=e.all_day,
        notes=e.notes, source="manual", session_id=None, group_name=None, html_link=None,
    )


def _session_events(db: Session, me: User, start: datetime, end: datetime) -> list[CalendarEventOut]:
    """Sessions I took part in, plus scheduled sessions in my groups (so I can join)."""
    my_groups = select(GroupMember.group_id).where(GroupMember.user_id == me.id)
    mine = select(Participant.session_id).where(Participant.user_id == me.id)
    sessions = db.scalars(
        select(StudySession).where(
            StudySession.group_id.in_(my_groups),
            StudySession.status != SessionStatus.CANCELLED,
            or_(
                (StudySession.scheduled_for >= start) & (StudySession.scheduled_for < end) & (StudySession.status == SessionStatus.LOBBY),
                (StudySession.started_at >= start) & (StudySession.started_at < end) & StudySession.id.in_(mine),
            ),
        )
    ).all()
    names = {g.id: g.name for g in db.scalars(select(Group).where(Group.id.in_({s.group_id for s in sessions})))}
    out = []
    for s in sessions:
        starts_at = s.started_at or s.scheduled_for
        out.append(CalendarEventOut(
            id=s.id, title=s.title, kind="study_session", starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=s.study_minutes), all_day=False, notes=None,
            source="session", session_id=s.id, group_name=names.get(s.group_id), html_link=None,
        ))
    return out


def list_events(db: Session, me: User, start: datetime, end: datetime) -> CalendarEventsOut:
    if end <= start:
        raise ApiError(422, "validation_error", "`to` must be after `from`.", [{"field": "to", "message": "before from"}])
    if end - start > timedelta(days=MAX_RANGE_DAYS):
        raise ApiError(422, "validation_error", f"Ask for at most {MAX_RANGE_DAYS} days at a time.", [{"field": "to", "message": "range too long"}])
    manual = db.scalars(
        select(CalendarEvent).where(
            CalendarEvent.user_id == me.id, CalendarEvent.starts_at >= start, CalendarEvent.starts_at < end
        )
    ).all()
    items = [_manual_out(e) for e in manual] + _session_events(db, me, start, end)

    google_error = None
    account = db.get(GoogleAccount, me.id)
    if account is not None and google_calendar.configured():
        try:
            for g in google_calendar.list_events(db, account, start, end):
                items.append(CalendarEventOut(**g, source="google", session_id=None, group_name=None))
        except Exception as exc:  # network/auth problems shouldn't break the calendar
            logger.warning("Google Calendar fetch failed for %s: %s", me.id, exc)
            google_error = str(exc) if isinstance(exc, google_calendar.GoogleError) else "Couldn't reach Google Calendar."
    items.sort(key=lambda e: (e.starts_at, not e.all_day))
    return CalendarEventsOut(items=items, google_error=google_error)


def _get(db: Session, me: User, event_id: str) -> CalendarEvent:
    e = db.get(CalendarEvent, event_id)
    if e is None or e.user_id != me.id:
        raise not_found("Event")
    return e


def _check_times(starts_at: datetime, ends_at: datetime | None) -> None:
    if ends_at is not None and ends_at < starts_at:
        raise ApiError(422, "validation_error", "The end can't be before the start.", [{"field": "endsAt", "message": "before start"}])


def create(db: Session, me: User, data: CreateEvent) -> CalendarEventOut:
    _check_times(data.starts_at, data.ends_at)
    e = CalendarEvent(user_id=me.id, title=data.title, kind=data.kind, starts_at=data.starts_at,
                      ends_at=data.ends_at, all_day=data.all_day, notes=(data.notes or "").strip() or None)
    db.add(e)
    db.commit()
    return _manual_out(e)


def update(db: Session, me: User, event_id: str, data: UpdateEvent) -> CalendarEventOut:
    e = _get(db, me, event_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "title" and value:
            e.title = value.strip()
        elif field == "notes":
            e.notes = (value or "").strip() or None
        elif value is not None or field == "ends_at":
            setattr(e, field, value)
    _check_times(e.starts_at, e.ends_at)
    db.commit()
    return _manual_out(e)


def delete(db: Session, me: User, event_id: str) -> None:
    db.delete(_get(db, me, event_id))
    db.commit()


def google_status(db: Session, me: User) -> GoogleStatus:
    account = db.get(GoogleAccount, me.id)
    return GoogleStatus(
        configured=google_calendar.configured(),
        connected=account is not None,
        google_email=account.google_email if account else None,
    )


def disconnect_google(db: Session, me: User) -> None:
    account = db.get(GoogleAccount, me.id)
    if account is not None:
        db.delete(account)
        db.commit()
