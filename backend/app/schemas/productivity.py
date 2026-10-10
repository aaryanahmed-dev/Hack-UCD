from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import CamelModel, UTCDateTime

Priority = Literal["low", "medium", "high"]
Visibility = Literal["private", "friends"]
EventKind = Literal["assignment", "exam", "study_session", "other"]


def _clean_title(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("cannot be blank")
    return v


def _clean_tags(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    tags: list[str] = []
    for t in v:
        t = t.strip().lower().lstrip("#")
        if t and t not in tags:
            if len(t) > 20:
                raise ValueError("tags can be at most 20 characters")
            tags.append(t)
    if len(tags) > 5:
        raise ValueError("at most 5 tags")
    return tags


# ───────── To-dos ─────────


class SubtaskOut(CamelModel):
    id: str
    title: str
    is_done: bool


class TodoOut(CamelModel):
    id: str
    title: str
    notes: str | None
    priority: Priority
    tags: list[str]
    due_at: UTCDateTime | None
    is_done: bool
    completed_at: UTCDateTime | None
    visibility: Visibility
    subtasks: list[SubtaskOut]
    created_at: UTCDateTime


class NewSubtask(CamelModel):
    title: str = Field(min_length=1, max_length=200)

    _title = field_validator("title")(_clean_title)


class CreateTodo(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)
    priority: Priority = "medium"
    tags: list[str] = Field(default_factory=list)
    due_at: UTCDateTime | None = None
    visibility: Visibility = "private"
    subtasks: list[NewSubtask] = Field(default_factory=list, max_length=30)

    _title = field_validator("title")(_clean_title)
    _tags = field_validator("tags")(_clean_tags)


class UpdateTodo(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)
    priority: Priority | None = None
    tags: list[str] | None = None
    due_at: UTCDateTime | None = None
    is_done: bool | None = None
    visibility: Visibility | None = None

    _tags = field_validator("tags")(_clean_tags)


class UpdateSubtask(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_done: bool | None = None


# ───────── Calendar ─────────


class CalendarEventOut(CamelModel):
    id: str
    title: str
    kind: EventKind
    starts_at: UTCDateTime
    ends_at: UTCDateTime | None
    all_day: bool
    notes: str | None
    source: Literal["manual", "google", "session"]
    session_id: str | None
    group_name: str | None  # source = session
    html_link: str | None  # source = google


class CalendarEventsOut(CamelModel):
    items: list[CalendarEventOut]
    google_error: str | None  # set when Google is connected but couldn't be reached


class CreateEvent(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    kind: EventKind = "other"
    starts_at: UTCDateTime
    ends_at: UTCDateTime | None = None
    all_day: bool = False
    notes: str | None = Field(default=None, max_length=5000)

    _title = field_validator("title")(_clean_title)


class UpdateEvent(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    kind: EventKind | None = None
    starts_at: UTCDateTime | None = None
    ends_at: UTCDateTime | None = None
    all_day: bool | None = None
    notes: str | None = Field(default=None, max_length=5000)


class GoogleConnectBody(CamelModel):
    return_to: str = Field(min_length=1, max_length=500)  # where to send the browser back to afterwards


class GoogleStatus(CamelModel):
    configured: bool  # server has Google credentials
    connected: bool
    google_email: str | None
