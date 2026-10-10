from fastapi.testclient import TestClient

from app.main import app


def _crash():
    raise RuntimeError("boom")


app.add_api_route("/__test__/crash", _crash)
# Move it in front of the web-app catch-all route, which would otherwise match first.
app.router.routes.insert(0, app.router.routes.pop())


def test_crash_returns_json_500_with_cors(db_session):
    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/__test__/crash", headers={"Origin": "http://localhost:8081"})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal_error", "message": "Something went wrong.", "details": None}}
    # Without this header the browser hides the error as a network failure
    assert r.headers["access-control-allow-origin"] == "http://localhost:8081"
