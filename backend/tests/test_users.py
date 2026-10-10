def test_search_by_prefix(client, new_user):
    headers, _ = new_user("alice")
    new_user("alfred")
    new_user("bob")
    new_user("al_x")

    r = client.get("/api/users?search=AL", headers=headers)
    assert r.status_code == 200
    assert [u["username"] for u in r.json()["items"]] == ["al_x", "alfred", "alice"]

    # "_" and "%" are literal, not wildcards
    assert [u["username"] for u in client.get("/api/users?search=al_", headers=headers).json()["items"]] == ["al_x"]
    assert client.get("/api/users?search=%25", headers=headers).json()["items"] == []


def test_search_requires_query(client, new_user):
    headers, _ = new_user("alice")
    r = client.get("/api/users", headers=headers)
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "search"


def test_get_user(client, new_user):
    headers, _ = new_user("alice")
    _, bob = new_user("bob")
    r = client.get(f"/api/users/{bob['id']}", headers=headers)
    assert r.json() == {
        "id": bob["id"],
        "username": "bob",
        "displayName": "Bob",
        "avatarUrl": None,
        "equipped": {"avatar": None, "frame": None, "banner": None},
    }
    missing = client.get("/api/users/00000000-0000-0000-0000-000000000000", headers=headers)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_user_stats_only_self_for_now(client, new_user):
    headers, me = new_user("alice")
    _, bob = new_user("bob")
    assert client.get(f"/api/users/{me['id']}/stats", headers=headers).status_code == 200
    assert client.get(f"/api/users/{bob['id']}/stats", headers=headers).status_code == 403


def test_unknown_route_uses_error_shape(client):
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
