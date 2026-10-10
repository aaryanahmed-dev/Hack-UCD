"""In-memory registry of open WebSockets (single backend process, see API_SPEC §2)."""

import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._user_sockets: dict[str, set[WebSocket]] = defaultdict(set)

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
        return user_id in self._user_sockets

    def status(self, user_id: str) -> str:
        # "studying" is added when study sessions exist (build phase 4).
        return "online" if self.is_online(user_id) else "offline"

    async def send_to_user(self, user_id: str, type: str, data: dict) -> None:
        for websocket in list(self._user_sockets.get(user_id, ())):
            try:
                await websocket.send_json({"type": type, "data": data})
            except Exception:
                logger.info("Dropping dead socket for user %s", user_id)
                self.disconnect(user_id, websocket)


manager = ConnectionManager()
