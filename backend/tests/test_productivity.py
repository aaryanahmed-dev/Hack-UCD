from datetime import timedelta

import httpx
import pytest
from cryptography.fernet import Fernet

from app import config
from app.models.productivity import GoogleAccount
from app.services import google_calendar
from app.timeutil import utc_now


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ───────── To-dos ─────────


def test_todo_crud_and_subtasks(client, new_user):
    h, _ = new_user("alice")
    due = utc_now() + timedelta(days=2)
    t = client.post("/api/todos", json={
        "title": "  Essay draft ", "priority": "high", "tags": ["#English", "english", "uni"], "dueAt": iso(due),
        "subtasks": [{"title": "Outline"}, {"title": "Intro"}],
    }, headers=h)
    assert t.status_code == 201, t.text
    t = t.json()
    assert t["title"] == "Essay draft" and t["tags"] == ["english", "uni"]
    assert [s["title"] for s in t["subtasks"]] == ["Outline", "Intro"]

    t = client.patch(f"/api/todos/{t['id']}/subtasks/{t['subtasks'][0]['id']}", json={"isDone": True}, headers=h).json()
    assert t["subtasks"][0]["isDone"]
    t = client.post(f"/api/todos/{t['id']}/subtasks", json={"title": "Conclusion"}, headers=h).json()
    assert len(t["subtasks"]) == 3
    t = client.delete(f"/api/todos/{t['id']}/subtasks/{t['subtasks'][1]['id']}", headers=h).json()
    assert [s["title"] for s in t["subtasks"]] == ["Outline", "Conclusion"]

    done = client.patch(f"/api/todos/{t['id']}", json={"isDone": True}, headers=h).json()
    assert done["isDone"] and done["completedAt"]
    assert client.patch(f"/api/todos/{t['id']}", json={"isDone": False}, headers=h).json()["completedAt"] is None
    assert client.delete(f"/api/todos/{t['id']}", headers=h).status_code == 204
    assert client.get("/api/todos", headers=h).json()["items"] == []


def test_todo_sorting_and_filters(client, new_user):
    h, _ = new_user("alice")
    soon = utc_now() + timedelta(hours=3)
    later = utc_now() + timedelta(days=5)
    client.post("/api/todos", json={"title": "No date low", "priority": "low"}, headers=h)
    client.post("/api/todos", json={"title": "Later", "dueAt": iso(later), "tags": ["exam"]}, headers=h)
    client.post("/api/todos", json={"title": "Soon", "dueAt": iso(soon), "priority": "high"}, headers=h)
    titles = [t["title"] for t in client.get("/api/todos", headers=h).json()["items"]]
    assert titles == ["Soon", "Later", "No date low"]
    assert [t["title"] for t in client.get("/api/todos?tag=exam", headers=h).json()["items"]] == ["Later"]
    assert [t["title"] for t in client.get("/api/todos?priority=high", headers=h).json()["items"]] == ["Soon"]


def test_todo_validation_and_privacy(client, new_user):
    alice, _ = new_user("alice")
    bob, bob_me = new_user("bob")
    assert client.post("/api/todos", json={"title": "  "}, headers=alice).status_code == 422
    assert client.post("/api/todos", json={"title": "x", "tags": ["a", "b", "c", "d", "e", "f"]}, headers=alice).status_code == 422
    t = client.post("/api/todos", json={"title": "Mine"}, headers=bob).json()
    assert client.patch(f"/api/todos/{t['id']}", json={"isDone": True}, headers=alice).status_code == 404
    assert client.get(f"/api/users/{bob_me['id']}/todos", headers=alice).status_code == 403

    # friends see only friends-visible to-dos
    client.post("/api/friends/requests", json={"username": "bob"}, headers=alice)
    client.post("/api/friends/requests", json={"username": "alice"}, headers=bob)
    client.post("/api/todos", json={"title": "Shared", "visibility": "friends"}, headers=bob)
    assert [x["title"] for x in client.get(f"/api/users/{bob_me['id']}/todos", headers=alice).json()["items"]] == ["Shared"]


# ───────── Calendar ─────────


def test_calendar_events_and_sessions(client, new_user):
    h, _ = new_user("alice")
    start = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
    exam = client.post("/api/calendar/events", json={
        "title": "Chem exam", "kind": "exam", "startsAt": iso(start + timedelta(days=3, hours=9)),
        "endsAt": iso(start + timedelta(days=3, hours=11)),
    }, headers=h)
    assert exam.status_code == 201
    bad = client.post("/api/calendar/events", json={
        "title": "x", "startsAt": iso(start + timedelta(days=1)), "endsAt": iso(start)}, headers=h)
    assert bad.status_code == 422

    g = client.post("/api/groups", json={"name": "G"}, headers=h).json()
    scheduled = start + timedelta(days=2, hours=18)
    s = client.post(f"/api/groups/{g['id']}/sessions", json={
        "title": "Evening sprint", "mode": "tokens", "payoutTarget": "winners", "stakeAmount": 0,
        "studyMinutes": 45, "scheduledFor": iso(scheduled)}, headers=h).json()

    r = client.get(f"/api/calendar/events?from={iso(start)}&to={iso(start + timedelta(days=7))}", headers=h).json()
    assert r["googleError"] is None
    kinds = [(e["title"], e["kind"], e["source"]) for e in r["items"]]
    assert kinds == [("Evening sprint", "study_session", "session"), ("Chem exam", "exam", "manual")]
    session_event = r["items"][0]
    assert session_event["sessionId"] == s["id"] and session_event["groupName"] == "G"

    e = client.patch(f"/api/calendar/events/{exam.json()['id']}", json={"title": "Chem final"}, headers=h).json()
    assert e["title"] == "Chem final"
    assert client.delete(f"/api/calendar/events/{e['id']}", headers=h).status_code == 204
    too_long = client.get(f"/api/calendar/events?from={iso(start)}&to={iso(start + timedelta(days=200))}", headers=h)
    assert too_long.status_code == 422


def test_google_not_configured(client, new_user, monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "")
    h, _ = new_user("alice")
    assert client.get("/api/calendar/google", headers=h).json() == {"configured": False, "connected": False, "googleEmail": None}
    r = client.post("/api/calendar/google/connect", json={"returnTo": "http://localhost:8081/calendar"}, headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "google_not_configured"


@pytest.fixture
def google_on(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setattr(config, "TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(config, "PUBLIC_BASE_URL", "https://api.example.test")


def test_google_connect_flow(client, new_user, google_on, monkeypatch, db_session):
    h, me = new_user("alice")
    bad = client.post("/api/calendar/google/connect", json={"returnTo": "https://evil.example/x"}, headers=h)
    assert bad.status_code == 422
    url = client.post("/api/calendar/google/connect", json={"returnTo": "http://localhost:8081/calendar"}, headers=h).json()["authUrl"]
    assert url.startswith("https://accounts.google.com/") and "redirect_uri=https%3A%2F%2Fapi.example.test" in url
    state = httpx.URL(url).params["state"]

    def fake_post(u, data=None, json=None, headers=None, timeout=None):
        assert u == google_calendar.TOKEN_URL and data["code"] == "the-code"
        return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt", "expires_in": 3600})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, json={"email": "alice@gmail.com"}))
    monkeypatch.setattr(google_calendar, "sync_user_sessions_async", lambda uid: None)
    r = client.get(f"/api/calendar/google/callback?state={state}&code=the-code", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "http://localhost:8081/calendar?google=connected"

    with db_session() as db:
        account = db.get(GoogleAccount, me["id"])
        assert account.refresh_token != "rt"  # encrypted at rest
    assert client.get("/api/calendar/google", headers=h).json() == {"configured": True, "connected": True, "googleEmail": "alice@gmail.com"}

    # events come back merged, with a guessed kind
    start = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
    google_items = {"items": [
        {"id": "g1", "summary": "COMP3010 assignment due", "start": {"dateTime": iso(start + timedelta(days=1, hours=17))},
         "end": {"dateTime": iso(start + timedelta(days=1, hours=18))}, "htmlLink": "https://calendar.google.com/x"},
        {"id": "g2", "summary": "Reading week", "start": {"date": (start + timedelta(days=2)).strftime("%Y-%m-%d")},
         "end": {"date": (start + timedelta(days=3)).strftime("%Y-%m-%d")}},
    ]}
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, json=google_items))
    r = client.get(f"/api/calendar/events?from={iso(start)}&to={iso(start + timedelta(days=7))}", headers=h).json()
    assert [(e["id"], e["kind"], e["allDay"], e["source"]) for e in r["items"]] == [
        ("g1", "assignment", False, "google"), ("g2", "other", True, "google")]

    # Google down → calendar still works, with a warning
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(500))
    r = client.get(f"/api/calendar/events?from={iso(start)}&to={iso(start + timedelta(days=7))}", headers=h).json()
    assert r["items"] == [] and r["googleError"]

    assert client.delete("/api/calendar/google", headers=h).status_code == 204
    assert client.get("/api/calendar/google", headers=h).json()["connected"] is False


def test_google_callback_error_and_bad_state(client, new_user, google_on):
    h, _ = new_user("alice")
    url = client.post("/api/calendar/google/connect", json={"returnTo": "studystakes://calendar"}, headers=h).json()["authUrl"]
    state = httpx.URL(url).params["state"]
    r = client.get(f"/api/calendar/google/callback?state={state}&error=access_denied", follow_redirects=False)
    assert r.headers["location"] == "studystakes://calendar?google=error"
    assert client.get("/api/calendar/google/callback?state=junk&code=x", follow_redirects=False).status_code == 400


def test_guess_kind():
    assert google_calendar.guess_kind("MATH20 Midterm") == "exam"
    assert google_calendar.guess_kind("Essay submission") == "assignment"
    assert google_calendar.guess_kind("Lunch") == "other"
