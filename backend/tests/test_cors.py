import pytest

PREFLIGHT = {"Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,ngrok-skip-browser-warning"}


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:19006", "http://192.168.1.23:8081"],
)
def test_local_dev_origins_allowed(client, origin):
    r = client.options("/api/me", headers={"Origin": origin, **PREFLIGHT})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost.evil.example", "http://8.8.8.8:8081"])
def test_other_origins_rejected(client, origin):
    r = client.options("/api/me", headers={"Origin": origin, **PREFLIGHT})
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers
