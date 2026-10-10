import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers tables)
from app import config
from app.db import Base, get_db
from app.main import app

TEST_SECRET = "test-secret-at-least-32-bytes-long!!"


@pytest.fixture(autouse=True)
def auth_config(monkeypatch):
    # Tests sign tokens with HS256; production uses Supabase's JWKS.
    monkeypatch.setattr(config, "SUPABASE_URL", "")
    monkeypatch.setattr(config, "SUPABASE_JWT_SECRET", TEST_SECRET)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestingSession
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def client(db_session):
    return TestClient(app)


def make_token(sub: str | None = None, email: str = "user@example.com", expires_in: int = 3600, **extra) -> str:
    claims = {
        "sub": sub or str(uuid.uuid4()),
        "email": email,
        "aud": "authenticated",
        "exp": int(time.time()) + expires_in,
        **extra,
    }
    return jwt.encode(claims, TEST_SECRET, algorithm="HS256")


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def new_user(client):
    """Factory: create an onboarded user, return (headers, me_json)."""

    def _create(username: str, date_of_birth: str = "2000-01-15"):
        headers = auth_headers(make_token(email=f"{username}@example.com"))
        r = client.post(
            "/api/me",
            json={"username": username, "displayName": username.title(), "dateOfBirth": date_of_birth},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        return headers, r.json()

    return _create
