import re

import pytest

from app.services import groups as groups_service


@pytest.fixture
def group(client, new_user):
    """alice owns a group; bob and carol joined it."""
    alice, alice_me = new_user("alice")
    bob, bob_me = new_user("bob")
    carol, carol_me = new_user("carol")
    g = client.post("/api/groups", json={"name": " Organic Chem Squad ", "description": "  "}, headers=alice).json()
    for h in (bob, carol):
        assert client.post("/api/groups/join", json={"inviteCode": g["inviteCode"].lower()}, headers=h).status_code == 200
    return {
        "id": g["id"],
        "code": g["inviteCode"],
        "alice": (alice, alice_me["id"]),
        "bob": (bob, bob_me["id"]),
        "carol": (carol, carol_me["id"]),
    }


def roles(client, group_id, headers):
    detail = client.get(f"/api/groups/{group_id}", headers=headers).json()
    return {m["user"]["username"]: m["role"] for m in detail["members"]}


def test_create_group(client, new_user):
    headers, me = new_user("alice")
    r = client.post("/api/groups", json={"name": "  Physics  ", "description": " Weekly grind "}, headers=headers)
    assert r.status_code == 201
    g = r.json()
    assert g["name"] == "Physics"
    assert g["description"] == "Weekly grind"
    assert g["myRole"] == "owner"
    assert g["memberCount"] == 1
    assert g["activeSession"] is None
    assert re.fullmatch(r"[A-Z0-9]{6}", g["inviteCode"])
    assert g["members"] == [
        {
            "user": {"id": me["id"], "username": "alice", "displayName": "Alice", "avatarUrl": None,
                     "equipped": {"avatar": None, "frame": None, "banner": None}},
            "role": "owner",
            "status": "offline",
            "joinedAt": g["members"][0]["joinedAt"],
        }
    ]
    assert g["stats"] == {"totalFocusedMinutes": 0, "sessionsCompleted": 0, "averageQuizScore": None}
    assert len(g["milestones"]) == 9
    assert g["milestones"][0] == {
        "id": "focus_hours_10", "title": "10 hours studied together", "metric": "focus_hours",
        "target": 10, "progress": 0, "achievedAt": None,
    }


def test_create_group_validation(client, new_user):
    headers, _ = new_user("alice")
    r = client.post("/api/groups", json={"name": "   "}, headers=headers)
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "name"


def test_join_and_list(client, group):
    bob, _ = group["bob"]
    g = client.get(f"/api/groups/{group['id']}", headers=bob).json()
    assert g["description"] is None  # blank description stored as null
    assert g["myRole"] == "member"
    assert [m["user"]["username"] for m in g["members"]] == ["alice", "bob", "carol"]

    listed = client.get("/api/groups", headers=bob).json()["items"]
    assert [(x["id"], x["memberCount"], x["myRole"]) for x in listed] == [(group["id"], 3, "member")]
    assert "members" not in listed[0]


def test_join_errors(client, group, new_user):
    bob, _ = group["bob"]
    again = client.post("/api/groups/join", json={"inviteCode": group["code"]}, headers=bob)
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_member"

    dave, _ = new_user("dave")
    bad = client.post("/api/groups/join", json={"inviteCode": "ZZZZZZ"}, headers=dave)
    assert bad.status_code == 404


def test_group_full(client, group, new_user, monkeypatch):
    monkeypatch.setattr(groups_service, "MAX_MEMBERS", 3)
    dave, _ = new_user("dave")
    r = client.post("/api/groups/join", json={"inviteCode": group["code"]}, headers=dave)
    assert r.status_code == 409 and r.json()["error"]["code"] == "group_full"


def test_non_member_gets_404(client, group, new_user):
    dave, _ = new_user("dave")
    assert client.get(f"/api/groups/{group['id']}", headers=dave).status_code == 404
    assert client.patch(f"/api/groups/{group['id']}", json={"name": "x"}, headers=dave).status_code == 404


def test_update_group_permissions(client, group):
    alice, _ = group["alice"]
    bob, bob_id = group["bob"]
    assert client.patch(f"/api/groups/{group['id']}", json={"name": "Nope"}, headers=bob).status_code == 403

    client.patch(f"/api/groups/{group['id']}/members/{bob_id}", json={"role": "admin"}, headers=alice)
    r = client.patch(f"/api/groups/{group['id']}", json={"description": "Exams in May"}, headers=bob)
    assert r.status_code == 200
    assert r.json()["description"] == "Exams in May"
    assert r.json()["name"] == "Organic Chem Squad"


def test_regenerate_invite_code(client, group, new_user):
    alice, _ = group["alice"]
    bob, _ = group["bob"]
    assert client.post(f"/api/groups/{group['id']}/invite-code", headers=bob).status_code == 403

    new_code = client.post(f"/api/groups/{group['id']}/invite-code", headers=alice).json()["inviteCode"]
    assert new_code != group["code"]
    dave, _ = new_user("dave")
    assert client.post("/api/groups/join", json={"inviteCode": group["code"]}, headers=dave).status_code == 404
    assert client.post("/api/groups/join", json={"inviteCode": new_code}, headers=dave).status_code == 200


def test_set_roles(client, group):
    alice, alice_id = group["alice"]
    bob, bob_id = group["bob"]
    _, carol_id = group["carol"]
    base = f"/api/groups/{group['id']}/members"

    r = client.patch(f"{base}/{bob_id}", json={"role": "admin"}, headers=alice)
    assert r.status_code == 200 and r.json()["role"] == "admin"
    # only the owner sets roles, and the owner role can't be assigned or changed
    assert client.patch(f"{base}/{carol_id}", json={"role": "admin"}, headers=bob).status_code == 403
    assert client.patch(f"{base}/{carol_id}", json={"role": "owner"}, headers=alice).status_code == 422
    assert client.patch(f"{base}/{alice_id}", json={"role": "member"}, headers=alice).status_code == 409


def test_remove_member_permissions(client, group):
    alice, _ = group["alice"]
    bob, bob_id = group["bob"]
    carol, carol_id = group["carol"]
    base = f"/api/groups/{group['id']}/members"

    assert client.delete(f"{base}/{carol_id}", headers=bob).status_code == 403  # member can't remove
    client.patch(f"{base}/{bob_id}", json={"role": "admin"}, headers=alice)
    client.patch(f"{base}/{carol_id}", json={"role": "admin"}, headers=alice)
    assert client.delete(f"{base}/{carol_id}", headers=bob).status_code == 403  # admin can't remove admin
    assert client.delete(f"{base}/{carol_id}", headers=alice).status_code == 204  # owner can
    assert client.get(f"/api/groups/{group['id']}", headers=carol).status_code == 404


def test_owner_leaves_admin_takes_over(client, group):
    alice, alice_id = group["alice"]
    _, carol_id = group["carol"]
    bob, _ = group["bob"]
    client.patch(f"/api/groups/{group['id']}/members/{carol_id}", json={"role": "admin"}, headers=alice)

    assert client.delete(f"/api/groups/{group['id']}/members/{alice_id}", headers=alice).status_code == 204
    assert roles(client, group["id"], bob) == {"carol": "owner", "bob": "member"}


def test_owner_leaves_oldest_member_takes_over(client, group):
    alice, alice_id = group["alice"]
    bob, _ = group["bob"]
    client.delete(f"/api/groups/{group['id']}/members/{alice_id}", headers=alice)
    assert roles(client, group["id"], bob) == {"bob": "owner", "carol": "member"}


def test_last_member_leaving_deletes_group(client, new_user):
    headers, me = new_user("solo")
    g = client.post("/api/groups", json={"name": "Solo"}, headers=headers).json()
    assert client.delete(f"/api/groups/{g['id']}/members/{me['id']}", headers=headers).status_code == 204
    assert client.get("/api/groups", headers=headers).json()["items"] == []


def test_delete_group(client, group):
    alice, _ = group["alice"]
    bob, _ = group["bob"]
    assert client.delete(f"/api/groups/{group['id']}", headers=bob).status_code == 403
    assert client.delete(f"/api/groups/{group['id']}", headers=alice).status_code == 204
    assert client.get("/api/groups", headers=bob).json()["items"] == []


def test_unknown_member(client, group):
    alice, _ = group["alice"]
    r = client.delete(f"/api/groups/{group['id']}/members/00000000-0000-0000-0000-000000000000", headers=alice)
    assert r.status_code == 404
