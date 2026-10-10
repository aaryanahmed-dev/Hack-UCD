import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app import config, db as db_module
from app.auth import verify_token
from app.errors import ApiError
from app.models.group import GroupMember
from app.models.session import StudySession
from app.models.user import User
from app.services import sessions
from app.services.realtime import manager

router = APIRouter(tags=["realtime"])

# Close codes (API_SPEC §8)
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_HEARTBEAT_TIMEOUT = 4408

FOCUS_STATES = {"focused", "idle", "away"}

MessageHandler = Callable[[str, dict], Awaitable[bool]]


def _profile_exists(user_id: str) -> bool:
    with db_module.SessionLocal() as db:
        return db.get(User, user_id) is not None


async def _authenticate(websocket: WebSocket, token: str) -> str | None:
    """Accept the socket and return the user id, or close it with the right code and return None."""
    await websocket.accept()
    try:
        auth = await run_in_threadpool(verify_token, token)
    except ApiError as exc:
        await websocket.close(code=CLOSE_UNAUTHENTICATED if exc.status == 401 else 1011)
        return None
    if not await run_in_threadpool(_profile_exists, auth.id):
        await websocket.close(code=CLOSE_NOT_FOUND)
        return None
    return auth.id


async def _send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "data": {"code": "bad_request", "message": message}})


async def _receive_loop(websocket: WebSocket, handler: MessageHandler | None = None) -> None:
    """Answer pings (and pass other messages to `handler`) until the client disconnects or goes quiet."""
    while True:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=config.WS_HEARTBEAT_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            await websocket.close(code=CLOSE_HEARTBEAT_TIMEOUT)
            return
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            message = None
        if not isinstance(message, dict):
            await _send_error(websocket, "Messages must be JSON objects.")
            continue
        msg_type = message.get("type")
        data = message.get("data") if isinstance(message.get("data"), dict) else {}
        if msg_type == "ping":
            await websocket.send_json({"type": "pong", "data": {}})
        elif handler is None or not await handler(msg_type, data):
            await _send_error(websocket, "Unknown message type.")


@router.websocket("/ws/me")
async def user_socket(websocket: WebSocket, token: str = Query("")):
    user_id = await _authenticate(websocket, token)
    if user_id is None:
        return
    manager.connect(user_id, websocket)
    await run_in_threadpool(_broadcast_status, user_id)  # friends see you come online
    try:
        await _receive_loop(websocket)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)
        await run_in_threadpool(_broadcast_status, user_id)


def _broadcast_status(user_id: str) -> None:
    from app.services import friends

    with db_module.SessionLocal() as db:
        friends.broadcast_status(db, user_id)


def _session_access(session_id: str, user_id: str) -> bool | None:
    """None if the session doesn't exist, else whether the user is in its group."""
    with db_module.SessionLocal() as db:
        s = db.get(StudySession, session_id)
        if s is None:
            return None
        return db.get(GroupMember, (s.group_id, user_id)) is not None


def _set_focus(session_id: str, user_id: str, state: str) -> None:
    with db_module.SessionLocal() as db:
        sessions.update_focus(db, session_id, user_id, state)


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str, token: str = Query("")):
    user_id = await _authenticate(websocket, token)
    if user_id is None:
        return
    access = await run_in_threadpool(_session_access, session_id, user_id)
    if access is None:
        await websocket.close(code=CLOSE_NOT_FOUND)
        return
    if not access:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return

    async def handle(msg_type: str, data: dict) -> bool:
        if msg_type == "focus.update" and data.get("state") in FOCUS_STATES:
            await run_in_threadpool(_set_focus, session_id, user_id, data["state"])
            return True
        return False

    manager.join_session(session_id, user_id, websocket)
    try:
        initial = await run_in_threadpool(sessions.build_snapshots, "session.updated", session_id, [user_id])
        todos = await run_in_threadpool(sessions.build_snapshots, "session.todos", session_id, [user_id])
        await websocket.send_json(initial[user_id])
        await websocket.send_json(todos[user_id])
        manager.notify_session(session_id)  # others see this participant come online
        await _receive_loop(websocket, handle)
    except WebSocketDisconnect:
        pass
    finally:
        manager.leave_session(session_id, websocket)
        if not manager.in_session(session_id, user_id):
            await run_in_threadpool(_set_focus, session_id, user_id, "offline")
        manager.notify_session(session_id)
