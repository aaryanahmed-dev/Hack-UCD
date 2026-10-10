import pytest

from app.models.ledger import Currency, LedgerEntryType
from app.services import ledger


@pytest.fixture
def people(client, new_user):
    alice, a = new_user("alice")
    bob, b = new_user("bob")
    carol, c = new_user("carol")
    return {"alice": alice, "bob": bob, "carol": carol, "ids": {"alice": a["id"], "bob": b["id"], "carol": c["id"]}}


def befriend(client, people, x, y):
    r = client.post("/api/friends/requests", json={"username": y}, headers=people[x])
    assert r.status_code == 201, r.text
    req = next(q for q in client.get("/api/friends/requests", headers=people[y]).json()["items"] if q["direction"] == "incoming")
    assert client.post(f"/api/friends/requests/{req['id']}/accept", headers=people[y]).status_code == 200


def test_friend_request_flow(client, people):
    r = client.post("/api/friends/requests", json={"username": "@BOB"}, headers=people["alice"]).json()
    assert r["request"]["direction"] == "outgoing" and r["friend"] is None
    assert client.post("/api/friends/requests", json={"username": "bob"}, headers=people["alice"]).status_code == 409

    incoming = client.get("/api/friends/requests", headers=people["bob"]).json()["items"]
    assert [(q["direction"], q["user"]["username"]) for q in incoming] == [("incoming", "alice")]
    notes = client.get("/api/notifications", headers=people["bob"]).json()["items"]
    assert notes[0]["type"] == "friend_request" and notes[0]["data"]["requestId"] == incoming[0]["id"]
    assert client.get("/api/notifications/unread-count", headers=people["bob"]).json() == {"count": 1}

    # only the receiver can accept
    assert client.post(f"/api/friends/requests/{incoming[0]['id']}/accept", headers=people["alice"]).status_code == 403
    friend = client.post(f"/api/friends/requests/{incoming[0]['id']}/accept", headers=people["bob"]).json()
    assert friend["user"]["username"] == "alice" and friend["status"] == "offline"
    assert [f["user"]["username"] for f in client.get("/api/friends", headers=people["alice"]).json()["items"]] == ["bob"]
    assert client.get("/api/notifications", headers=people["alice"]).json()["items"][0]["type"] == "friend_accepted"

    # stats become visible to friends only
    assert client.get(f"/api/users/{people['ids']['bob']}/stats", headers=people["alice"]).status_code == 200
    assert client.get(f"/api/users/{people['ids']['bob']}/stats", headers=people["carol"]).status_code == 403

    assert client.delete(f"/api/friends/{people['ids']['bob']}", headers=people["alice"]).status_code == 204
    assert client.get("/api/friends", headers=people["bob"]).json()["items"] == []


def test_mutual_request_auto_accepts(client, people):
    client.post("/api/friends/requests", json={"username": "bob"}, headers=people["alice"])
    r = client.post("/api/friends/requests", json={"username": "alice"}, headers=people["bob"]).json()
    assert r["friend"]["user"]["username"] == "alice" and r["request"] is None


def test_request_errors(client, people):
    assert client.post("/api/friends/requests", json={"username": "nobody"}, headers=people["alice"]).status_code == 404
    assert client.post("/api/friends/requests", json={"username": "alice"}, headers=people["alice"]).status_code == 409
    client.post("/api/friends/requests", json={"username": "bob"}, headers=people["alice"])
    req = client.get("/api/friends/requests", headers=people["alice"]).json()["items"][0]
    assert client.delete(f"/api/friends/requests/{req['id']}", headers=people["alice"]).status_code == 204  # cancel
    assert client.get("/api/friends/requests", headers=people["bob"]).json()["items"] == []


def test_mark_notifications_read(client, people):
    client.post("/api/friends/requests", json={"username": "bob"}, headers=people["alice"])
    client.post("/api/friends/requests", json={"username": "bob"}, headers=people["carol"])
    items = client.get("/api/notifications?unreadOnly=true", headers=people["bob"]).json()["items"]
    assert len(items) == 2
    client.post("/api/notifications/read", json={"ids": [items[0]["id"]]}, headers=people["bob"])
    assert client.get("/api/notifications/unread-count", headers=people["bob"]).json()["count"] == 1
    client.post("/api/notifications/read", json={"all": True}, headers=people["bob"])
    assert client.get("/api/notifications/unread-count", headers=people["bob"]).json()["count"] == 0


def test_group_and_session_invites(client, people):
    g = client.post("/api/groups", json={"name": "Bio"}, headers=people["alice"]).json()
    # carol isn't alice's friend
    r = client.post(f"/api/groups/{g['id']}/invites", json={"userId": people["ids"]["carol"]}, headers=people["alice"])
    assert r.status_code == 403
    befriend(client, people, "alice", "bob")
    assert client.post(f"/api/groups/{g['id']}/invites", json={"userId": people["ids"]["bob"]}, headers=people["alice"]).status_code == 204
    invite = client.get("/api/notifications", headers=people["bob"]).json()["items"][0]
    assert invite["type"] == "group_invite" and invite["data"]["inviteCode"] == g["inviteCode"]
    client.post("/api/groups/join", json={"inviteCode": invite["data"]["inviteCode"]}, headers=people["bob"])
    assert client.post(f"/api/groups/{g['id']}/invites", json={"userId": people["ids"]["bob"]}, headers=people["alice"]).status_code == 409

    s = client.post(f"/api/groups/{g['id']}/sessions", json={"title": "S", "mode": "tokens", "payoutTarget": "winners", "stakeAmount": 0, "studyMinutes": 15}, headers=people["alice"]).json()
    r = client.post(f"/api/sessions/{s['id']}/invites", json={"userIds": [people["ids"]["bob"]]}, headers=people["alice"])
    assert r.json() == {"invited": 1}
    note = client.get("/api/notifications", headers=people["bob"]).json()["items"][0]
    assert note["type"] == "session_invite" and note["data"]["sessionId"] == s["id"]
    bad = client.post(f"/api/sessions/{s['id']}/invites", json={"userIds": [people["ids"]["carol"]]}, headers=people["alice"])
    assert bad.status_code == 422


def test_leaderboard_friends_and_global(client, people, db_session):
    befriend(client, people, "alice", "bob")
    ids = people["ids"]
    with db_session() as db:
        ledger.add_entry(db, user_id=ids["bob"], currency=Currency.TOKENS, amount=40, type=LedgerEntryType.WINNINGS,
                         counterparty_user_id=ids["alice"], description="won")
        ledger.add_entry(db, user_id=ids["alice"], currency=Currency.TOKENS, amount=15, type=LedgerEntryType.WINNINGS,
                         counterparty_user_id=ids["bob"], description="won")
        db.commit()

    lb = client.get("/api/leaderboard?scope=friends&metric=tokens", headers=people["alice"]).json()
    assert [(r["user"]["username"], r["value"], r["rank"]) for r in lb["items"]] == [("bob", 140, 1), ("alice", 115, 2)]
    bob_row = lb["items"][0]
    assert bob_row["wonFromMe"] == {"tokens": 40, "coins": 0} and bob_row["lostToMe"] == {"tokens": 15, "coins": 0}
    assert lb["me"]["user"]["username"] == "alice" and lb["me"]["wonFromMe"] is None

    glob = client.get("/api/leaderboard?scope=global&metric=weekly_study", headers=people["carol"]).json()
    assert len(glob["items"]) == 3 and all(r["value"] == 0 for r in glob["items"])
    assert all(r["wonFromMe"] is None for r in glob["items"])

    avg = client.get("/api/leaderboard?scope=friends&metric=avg_score", headers=people["alice"]).json()
    assert all(r["rank"] is None and r["value"] is None for r in avg["items"])  # needs 3+ quizzes

    g = client.post("/api/groups", json={"name": "G"}, headers=people["alice"]).json()
    grp = client.get(f"/api/leaderboard?scope=group&groupId={g['id']}", headers=people["alice"]).json()
    assert [r["user"]["username"] for r in grp["items"]] == ["alice"]
    assert client.get(f"/api/leaderboard?scope=group&groupId={g['id']}", headers=people["carol"]).status_code == 404


def test_activity(client, people):
    days = client.get("/api/me/activity?days=7", headers=people["alice"]).json()["days"]
    assert len(days) == 7 and all(d["studyMinutes"] == 0 for d in days)
    t = client.post("/api/todos", json={"title": "Read"}, headers=people["alice"]).json()
    client.patch(f"/api/todos/{t['id']}", json={"isDone": True}, headers=people["alice"])
    days = client.get("/api/me/activity?days=7", headers=people["alice"]).json()["days"]
    assert days[-1]["todosCompleted"] == 1
