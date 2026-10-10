import pytest
from starlette.websockets import WebSocketDisconnect

from app import config
from tests.conftest import make_token


def token_of(headers: dict) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


def close_code(client, url: str) -> int:
    with client.websocket_connect(url) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    return exc.value.code


def test_rejects_bad_token(client):
    assert close_code(client, "/ws/me?token=garbage") == 4401
    assert close_code(client, "/ws/me") == 4401


def test_rejects_user_without_profile(client):
    assert close_code(client, f"/ws/me?token={make_token()}") == 4404


def test_ping_pong_and_errors(client, new_user):
    headers, _ = new_user("alice")
    with client.websocket_connect(f"/ws/me?token={token_of(headers)}") as ws:
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong", "data": {}}
        ws.send_text("not json")
        assert ws.receive_json()["data"]["code"] == "bad_request"


def test_presence_shows_in_group(client, new_user):
    alice, _ = new_user("alice")
    bob, _ = new_user("bob")
    g = client.post("/api/groups", json={"name": "G"}, headers=alice).json()
    client.post("/api/groups/join", json={"inviteCode": g["inviteCode"]}, headers=bob)

    def statuses():
        members = client.get(f"/api/groups/{g['id']}", headers=alice).json()["members"]
        return {m["user"]["username"]: m["status"] for m in members}

    assert statuses() == {"alice": "offline", "bob": "offline"}
    with client.websocket_connect(f"/ws/me?token={token_of(bob)}") as ws:
        ws.send_json({"type": "ping"})
        ws.receive_json()
        assert statuses() == {"alice": "offline", "bob": "online"}
    assert statuses() == {"alice": "offline", "bob": "offline"}


def test_heartbeat_timeout(client, new_user, monkeypatch):
    monkeypatch.setattr(config, "WS_HEARTBEAT_TIMEOUT_SECONDS", 0.2)
    headers, _ = new_user("alice")
    assert close_code(client, f"/ws/me?token={token_of(headers)}") == 4408
