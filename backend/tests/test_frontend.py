import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import config
from app.errors import register_error_handlers
from app.frontend import mount_frontend


@pytest.fixture
def web_client(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "_expo/static/js").mkdir(parents=True)
    (tmp_path / "_expo/static/js/entry.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("nope")
    monkeypatch.setattr(config, "FRONTEND_DIST", str(tmp_path))

    app = FastAPI()
    register_error_handlers(app)

    @app.get("/api/real")
    def real():
        return {"ok": True}

    mount_frontend(app)
    return TestClient(app)


def test_serves_index_and_spa_routes(web_client):
    for path in ("/", "/sign-in", "/onboarding", "/groups/abc"):
        r = web_client.get(path)
        assert r.status_code == 200 and r.text == "<html>app</html>", path
        assert r.headers["cache-control"] == "no-cache"


def test_serves_static_files_with_long_cache(web_client):
    r = web_client.get("/_expo/static/js/entry.js")
    assert r.text == "console.log(1)"
    assert "immutable" in r.headers["cache-control"]


def test_api_paths_are_not_swallowed(web_client):
    assert web_client.get("/api/real").json() == {"ok": True}
    r = web_client.get("/api/missing")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert web_client.get("/ws/me").status_code == 404


def test_no_path_traversal(web_client):
    r = web_client.get("/..%2Fsecret.txt")
    assert "nope" not in r.text


def test_without_build(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "FRONTEND_DIST", str(tmp_path / "missing"))
    app = FastAPI()
    register_error_handlers(app)
    mount_frontend(app)
    client = TestClient(app)
    assert "not built" in client.get("/").json()["message"]
    assert client.get("/sign-in").status_code == 404
