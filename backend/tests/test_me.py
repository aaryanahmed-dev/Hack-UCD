import re

from app.timeutil import utc_now
from tests.conftest import auth_headers, make_token

ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def test_onboarding_creates_profile(client):
    headers = auth_headers(make_token(sub="11111111-1111-1111-1111-111111111111", email="alex@example.com"))
    r = client.post(
        "/api/me",
        json={"username": "  Alex_99 ", "displayName": " Alex ", "dateOfBirth": "2000-05-01"},
        headers=headers,
    )
    assert r.status_code == 201
    body = r.json()
    assert body == {
        "id": "11111111-1111-1111-1111-111111111111",
        "username": "alex_99",
        "displayName": "Alex",
        "avatarUrl": None,
        "equipped": {"avatar": None, "frame": None, "banner": None},
        "email": "alex@example.com",
        "dateOfBirth": "2000-05-01",
        "isAdult": True,
        "googleCalendarConnected": False,
        "idVerified": False,
        "verificationRequired": False,
        "createdAt": body["createdAt"],
    }
    assert ISO_Z.match(body["createdAt"])

    assert client.get("/api/me", headers=headers).json() == body


def test_under_18_is_not_adult(client, new_user):
    year = utc_now().year - 15
    _, me = new_user("teen", date_of_birth=f"{year}-01-01")
    assert me["isAdult"] is False


def test_signup_bonus_in_stats(client, new_user):
    headers, _ = new_user("sam")
    stats = client.get("/api/me/stats", headers=headers).json()
    assert stats["tokens"] == 100
    assert stats["lifetimeTokensEarned"] == 100
    assert stats["winRate"] is None


def test_profile_already_exists(client, new_user):
    headers, _ = new_user("sam")
    r = client.post("/api/me", json={"username": "other", "displayName": "X", "dateOfBirth": "2000-01-01"}, headers=headers)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"


def test_username_taken_case_insensitive(client, new_user):
    new_user("sam")
    r = client.post(
        "/api/me",
        json={"username": "SAM", "displayName": "Other", "dateOfBirth": "2000-01-01"},
        headers=auth_headers(make_token()),
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "username_taken"


def test_onboarding_validation(client):
    r = client.post(
        "/api/me",
        json={"username": "a!", "displayName": "", "dateOfBirth": "2999-01-01"},
        headers=auth_headers(make_token()),
    )
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert {d["field"] for d in err["details"]} == {"username", "displayName", "dateOfBirth"}


def test_update_profile(client, new_user):
    headers, _ = new_user("sam")
    r = client.patch("/api/me", json={"displayName": "Sammy", "avatarUrl": "https://img.example/a.png"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["displayName"] == "Sammy"
    assert r.json()["avatarUrl"] == "https://img.example/a.png"

    # partial: avatar unchanged
    r = client.patch("/api/me", json={"displayName": "S"}, headers=headers)
    assert r.json()["avatarUrl"] == "https://img.example/a.png"

    # explicit null clears avatar; displayName can't be null
    assert client.patch("/api/me", json={"avatarUrl": None}, headers=headers).json()["avatarUrl"] is None
    assert client.patch("/api/me", json={"displayName": None}, headers=headers).status_code == 422


def test_equip_unknown_item(client, new_user):
    headers, _ = new_user("sam")
    r = client.patch("/api/me", json={"equipped": {"banner": "00000000-0000-0000-0000-000000000000"}}, headers=headers)
    assert r.status_code == 404
    assert client.patch("/api/me", json={"equipped": {"banner": None}}, headers=headers).status_code == 200


def test_routes_need_profile(client):
    headers = auth_headers(make_token())
    assert client.get("/api/me/stats", headers=headers).json()["error"]["code"] == "profile_not_found"
    assert client.get("/api/users?search=a", headers=headers).json()["error"]["code"] == "profile_not_found"
