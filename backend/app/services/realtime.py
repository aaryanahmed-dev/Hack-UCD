"""In-memory registry of open WebSockets (single backend process, see API_SPEC §2).

Request handlers run in worker threads; they call `notify_session()` which is thread-safe and
queues a broadcast. A background task on the event loop builds a per-viewer snapshot (the
session payload has a viewer-specific `me`) and pushes it to every open session socket.
"""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Callable

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# (kind, session_id, user_ids) -> {user_id: message}; set by the sessions service at import time.
SnapshotBuilder = Callable[[str, str, list[str]], dict[str, dict]]


class ConnectionManager:
    def __init__(self) -> None:
        self._user_sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self._session_sockets: dict[str, dict[WebSocket, str]] = defaultdict(dict)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue | None = None
        self.snapshot_builder: SnapshotBuilder | None = None

    # ───────── user sockets (/ws/me) ─────────

    def connect(self, user_id: str, websocket: WebSocket) -> None:
        self._user_sockets[user_id].add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        sockets = self._user_sockets.get(user_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            del self._user_sockets[user_id]

    def is_online(self, user_id: str) -> bool:
        return user_id in self._user_sockets or any(user_id in s.values() for s in self._session_sockets.values())

    def status(self, user_id: str, studying: bool = False) -> str:
        if studying:
            return "studying"
        return "online" if self.is_online(user_id) else "offline"

    async def send_to_user(self, user_id: str, type: str, data: dict) -> None:
        for websocket in list(self._user_sockets.get(user_id, ())):
            try:
                await websocket.send_json({"type": type, "data": data})
            except Exception:
                logger.info("Dropping dead socket for user %s", user_id)
                self.disconnect(user_id, websocket)

    # ───────── session sockets (/ws/sessions/{id}) ─────────

    def join_session(self, session_id: str, user_id: str, websocket: WebSocket) -> None:
        self._session_sockets[session_id][websocket] = user_id

    def leave_session(self, session_id: str, websocket: WebSocket) -> None:
        sockets = self._session_sockets.get(session_id)
        if sockets is None:
            return
        sockets.pop(websocket, None)
        if not sockets:
            del self._session_sockets[session_id]

    def in_session(self, session_id: str, user_id: str) -> bool:
        return user_id in self._session_sockets.get(session_id, {}).values()

    # ───────── broadcasting ─────────

    def start(self, loop: asyncio.AbstractEventLoop) -> asyncio.Task:
        self._loop = loop
        self._queue = asyncio.Queue()
        return loop.create_task(self._broadcast_forever())

    def notify_session(self, session_id: str, kind: str = "session.updated") -> None:
        """Thread-safe: push the latest state of a session to everyone watching it."""
        if self._loop is None or self._queue is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (kind, session_id))

    def push_to_user(self, user_id: str, type: str, data: dict) -> None:
        """Thread-safe: send one message to every /ws/me socket of a user (if they're connected)."""
        if self._loop is None or self._loop.is_closed() or user_id not in self._user_sockets:
            return
        loop = self._loop
        loop.call_soon_threadsafe(lambda: loop.create_task(self.send_to_user(user_id, type, data)))

    def online_user_ids(self) -> set[str]:
        return set(self._user_sockets) | {u for s in self._session_sockets.values() for u in s.values()}

    async def _broadcast_forever(self) -> None:
        assert self._queue is not None
        while True:
            first = await self._queue.get()
            pending = {first}
            while not self._queue.empty():  # coalesce bursts of changes
                pending.add(self._queue.get_nowait())
            for kind, session_id in pending:
                try:
                    await self.broadcast(kind, session_id)
                except Exception:
                    logger.exception("Broadcast failed for session %s", session_id)

    async def broadcast(self, kind: str, session_id: str) -> None:
        sockets = dict(self._session_sockets.get(session_id, {}))
        if not sockets or self.snapshot_builder is None:
            return
        messages = await asyncio.to_thread(self.snapshot_builder, kind, session_id, sorted(set(sockets.values())))
        for websocket, user_id in sockets.items():
            message = messages.get(user_id)
            if message is None:
                continue
            try:
                await websocket.send_json(message)
            except Exception:
                self.leave_session(session_id, websocket)


manager = ConnectionManager()
