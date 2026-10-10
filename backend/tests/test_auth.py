from cryptography.hazmat.primitives.asymmetric import ec

import jwt

from app import auth, config
from tests.conftest import auth_headers, make_token


def test_missing_token(client):
    r = client.get("/api/me")
    assert r.status_code == 401
    assert r.json() == {"error": {"code": "unauthenticated", "message": "Missing access token.", "details": None}}


def test_garbage_token(client):
    r = client.get("/api/me", headers=auth_headers("not-a-jwt"))
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


def test_expired_token(client):
    r = client.get("/api/me", headers=auth_headers(make_token(expires_in=-10)))
    assert r.status_code == 401
    assert r.json()["error"]["message"] == "Your session has expired."


def test_wrong_audience(client):
    r = client.get("/api/me", headers=auth_headers(make_token(aud="anon")))
    assert r.status_code == 401


def test_wrong_secret(client):
    token = jwt.encode({"sub": "x", "aud": "authenticated", "exp": 9999999999}, "another-secret-32-bytes-long!!!!!", "HS256")
    r = client.get("/api/me", headers=auth_headers(token))
    assert r.status_code == 401


def test_valid_token_without_profile(client):
    r = client.get("/api/me", headers=auth_headers(make_token()))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "profile_not_found"


def test_jwks_es256_token(client, monkeypatch):
    """Production path: asymmetric token verified with a key from Supabase's JWKS, issuer checked."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(config, "SUPABASE_URL", "https://proj.supabase.co")

    class FakeJwks:
        def get_signing_key_from_jwt(self, token):
            return type("Key", (), {"key": private_key.public_key()})()

    monkeypatch.setattr(auth, "_jwks_client", lambda: FakeJwks())

    def es_token(iss):
        return jwt.encode(
            {"sub": "abc", "email": "a@b.c", "aud": "authenticated", "exp": 9999999999, "iss": iss},
            private_key,
            algorithm="ES256",
        )

    ok = client.get("/api/me", headers=auth_headers(es_token("https://proj.supabase.co/auth/v1")))
    assert ok.json()["error"]["code"] == "profile_not_found"  # token accepted

    bad_issuer = client.get("/api/me", headers=auth_headers(es_token("https://evil.supabase.co/auth/v1")))
    assert bad_issuer.status_code == 401
