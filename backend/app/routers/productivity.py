import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth import get_current_user
from app.db import get_db
from app.errors import ApiError
from app.models.user import User
from app.schemas.common import ListResponse
from app.schemas.productivity import (
    CalendarEventOut,
    CalendarEventsOut,
    CreateEvent,
    CreateTodo,
    GoogleConnectBody,
    GoogleStatus,
    NewSubtask,
    TodoOut,
    UpdateEvent,
    UpdateSubtask,
    UpdateTodo,
)
from app.services import calendar, google_calendar, todos

logger = logging.getLogger(__name__)

router = APIRouter(tags=["productivity"])


# ───────── To-dos ─────────


@router.get("/api/todos", response_model=ListResponse[TodoOut])
def list_todos(
    is_done: bool | None = Query(None, alias="isDone"),
    tag: str | None = None,
    priority: str | None = Query(None, pattern="^(low|medium|high)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return ListResponse(items=todos.list_todos(db, user.id, is_done, tag, priority))


@router.post("/api/todos", response_model=TodoOut, status_code=201)
def create_todo(data: CreateTodo, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return todos.to_out(todos.create(db, user, data))


@router.patch("/api/todos/{todo_id}", response_model=TodoOut)
def update_todo(todo_id: str, data: UpdateTodo, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return todos.to_out(todos.update(db, user, todo_id, data))


@router.delete("/api/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    todos.delete(db, user, todo_id)
    return Response(status_code=204)


@router.post("/api/todos/{todo_id}/subtasks", response_model=TodoOut, status_code=201)
def add_subtask(todo_id: str, data: NewSubtask, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    todos.add_subtask(db, user, todo_id, data.title)
    return todos.to_out(todos._get(db, user, todo_id))


@router.patch("/api/todos/{todo_id}/subtasks/{subtask_id}", response_model=TodoOut)
def update_subtask(todo_id: str, subtask_id: str, data: UpdateSubtask, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return todos.to_out(todos.update_subtask(db, user, todo_id, subtask_id, data))


@router.delete("/api/todos/{todo_id}/subtasks/{subtask_id}", response_model=TodoOut)
def delete_subtask(todo_id: str, subtask_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return todos.to_out(todos.delete_subtask(db, user, todo_id, subtask_id))


@router.get("/api/users/{user_id}/todos", response_model=ListResponse[TodoOut])
def friend_todos(user_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ListResponse(items=todos.list_friend_todos(db, user, user_id))


# ───────── Calendar ─────────


def _utc_naive(d: datetime) -> datetime:
    """Query params may carry an offset; everything is stored as naive UTC."""
    return d.astimezone(UTC).replace(tzinfo=None) if d.tzinfo is not None else d


@router.get("/api/calendar/events", response_model=CalendarEventsOut)
def list_events(
    start: datetime = Query(alias="from"),
    end: datetime = Query(alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return calendar.list_events(db, user, _utc_naive(start), _utc_naive(end))


@router.post("/api/calendar/events", response_model=CalendarEventOut, status_code=201)
def create_event(data: CreateEvent, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return calendar.create(db, user, data)


@router.patch("/api/calendar/events/{event_id}", response_model=CalendarEventOut)
def update_event(event_id: str, data: UpdateEvent, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return calendar.update(db, user, event_id, data)


@router.delete("/api/calendar/events/{event_id}", status_code=204)
def delete_event(event_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    calendar.delete(db, user, event_id)
    return Response(status_code=204)


@router.get("/api/calendar/google", response_model=GoogleStatus)
def google_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return calendar.google_status(db, user)


@router.post("/api/calendar/google/connect")
def google_connect(data: GoogleConnectBody, user: User = Depends(get_current_user)):
    return {"authUrl": google_calendar.auth_url(user.id, data.return_to)}


@router.get("/api/calendar/google/callback", include_in_schema=False)
async def google_callback(state: str = "", code: str = "", error: str = ""):
    try:
        user_id, return_to = google_calendar.read_state(state)
    except Exception:
        raise ApiError(400, "bad_request", "This Google sign-in link has expired. Try connecting again.")
    if error or not code:
        return RedirectResponse(google_calendar.with_query(return_to, google="error"))
    try:
        await run_in_threadpool(google_calendar.complete_connect, user_id, code)
    except Exception as exc:
        logger.warning("Google connect failed for %s: %s", user_id, exc)
        return RedirectResponse(google_calendar.with_query(return_to, google="error"))
    return RedirectResponse(google_calendar.with_query(return_to, google="connected"))


@router.delete("/api/calendar/google", status_code=204)
def google_disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    calendar.disconnect_google(db, user)
    return Response(status_code=204)
