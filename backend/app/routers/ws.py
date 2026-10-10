import asyncio
import json

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app import config, db as db_module
from app.auth import verify_token
from app.errors import ApiError
from app.models.user import User
from app.services.realtime import manager

router = APIRouter(tags=["realtime"])

# Close codes (API_SPEC §8)
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_HEARTBEAT_TIMEOUT = 4408


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


async def _receive_loop(websocket: WebSocket) -> None:
    """Answer pings until the client disconnects or stops sending heartbeats."""
    while True:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=config.WS_HEARTBEAT_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            await websocket.close(code=CLOSE_HEARTBEAT_TIMEOUT)
            return
        try:
            message = json.loads(raw)
            msg_type = message.get("type") if isinstance(message, dict) else None
        except json.JSONDecodeError:
            msg_type = None
        if msg_type == "ping":
            await websocket.send_json({"type": "pong", "data": {}})
        else:
            await websocket.send_json(
                {"type": "error", "data": {"code": "bad_request", "message": "Unknown message type."}}
            )


@router.websocket("/ws/me")
async def user_socket(websocket: WebSocket, token: str = Query("")):
    user_id = await _authenticate(websocket, token)
    if user_id is None:
        return
    manager.connect(user_id, websocket)
    # friend.status broadcasts arrive with friendships (build phase 6).
    try:
        await _receive_loop(websocket)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)
