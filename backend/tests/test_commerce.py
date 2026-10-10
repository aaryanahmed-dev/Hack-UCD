"""Token store, Stripe coin purchases (mocked Stripe) and Persona verification gating."""

from types import SimpleNamespace

import pytest

from app import config
from app.models.shop_seed import seed_shop
from app.services import payments


@pytest.fixture
def store(db_session):
    with db_session() as db:
        seed_shop(db)
        db.commit()


def test_buy_and_equip_avatar(client, new_user, store):
    h, _ = new_user("alice")  # 100 signup tokens
    items = {i["id"]: i for i in client.get("/api/shop/items", headers=h).json()["items"]}
    assert items["avatar-sprout"]["priceTokens"] == 40 and items["avatar-sprout"]["owned"] == 0

    # can't equip what you don't own
    assert client.patch("/api/me", json={"equipped": {"avatar": "avatar-sprout"}}, headers=h).status_code == 403
    bought = client.post("/api/shop/items/avatar-sprout/purchase", headers=h).json()
    assert bought["owned"] == 1
    assert client.post("/api/shop/items/avatar-sprout/purchase", headers=h).status_code == 409  # once only
    me = client.patch("/api/me", json={"equipped": {"avatar": "avatar-sprout"}}, headers=h).json()
    assert me["equipped"]["avatar"] == "avatar-sprout"
    assert client.get("/api/wallet", headers=h).json()["tokens"] == 60

    # too expensive
    r = client.post("/api/shop/items/avatar-diamond/purchase", headers=h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "insufficient_balance"


def test_streak_freezes_stack(client, new_user, store):
    h, _ = new_user("alice")
    client.post("/api/shop/items/streak-freeze/purchase", headers=h)
    item = client.post("/api/shop/items/streak-freeze/purchase", headers=h).json()
    assert item["owned"] == 2


def test_stripe_checkout_and_fulfilment(client, new_user, monkeypatch):
    monkeypatch.setattr(config, "STRIPE_SECRET_KEY", "sk_test_x")
    h, me = new_user("alice")
    teen, _ = new_user("teen", date_of_birth="2015-01-01")

    created = {}

    class FakeSessions:
        def create(self, params):
            created.update(params)
            return SimpleNamespace(id="cs_test_123", url="https://checkout.stripe.com/c/pay/cs_test_123")

        def retrieve(self, session_id):
            return SimpleNamespace(id=session_id, payment_status="paid", payment_intent="pi_123")

    class FakePrices:
        def list(self, params):
            return SimpleNamespace(data=[SimpleNamespace(id="price_1000")])

    fake = SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=FakeSessions()), prices=FakePrices()))
    monkeypatch.setattr(payments, "_client", lambda: fake)

    assert client.post("/api/wallet/checkout", json={"coins": 1000, "returnTo": "http://localhost:8081/wallet"}, headers=teen).status_code == 403
    assert client.post("/api/wallet/checkout", json={"coins": 123, "returnTo": "http://localhost:8081/wallet"}, headers=h).status_code == 422
    r = client.post("/api/wallet/checkout", json={"coins": 1000, "returnTo": "http://localhost:8081/wallet"}, headers=h)
    assert r.json() == {"checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_123"}
    assert created["line_items"] == [{"price": "price_1000", "quantity": 1}]
    assert created["metadata"] == {"user_id": me["id"], "coins": "1000"}
    assert "session_id={CHECKOUT_SESSION_ID}" in created["success_url"]

    # Confirm on return credits coins once, even if called twice
    for _ in range(2):
        p = client.post("/api/wallet/checkout/confirm", json={"sessionId": "cs_test_123"}, headers=h).json()
        assert p["status"] == "paid"
    wallet = client.get("/api/wallet", headers=h).json()
    assert wallet["coins"] == 1000
    tx = client.get("/api/wallet/transactions?currency=coins", headers=h).json()["items"]
    assert [(t["type"], t["amount"]) for t in tx] == [("purchase", 1000)]
    assert client.get("/api/notifications", headers=h).json()["items"][0]["type"] == "coins_purchased"


def test_verification_gates_money(client, new_user, monkeypatch):
    monkeypatch.setattr(config, "PERSONA_API_KEY", "persona_sandbox_x")
    monkeypatch.setattr(config, "PERSONA_TEMPLATE_ID", "itmpl_x")
    monkeypatch.setattr(config, "STRIPE_SECRET_KEY", "sk_test_x")
    h, me = new_user("alice")
    assert client.get("/api/me", headers=h).json()["verificationRequired"] is True
    r = client.post("/api/wallet/checkout", json={"coins": 500, "returnTo": "http://localhost:8081/wallet"}, headers=h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "verification_required"

    url = client.post("/api/me/verification/start", json={"redirectUri": "http://localhost:8081/wallet"}, headers=h).json()["url"]
    assert url.startswith("https://inquiry.withpersona.com/verify?") and f"reference-id={me['id']}" in url

    import httpx

    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, json={"data": [{"id": "inq_1", "attributes": {"status": "approved"}}]}))
    v = client.post("/api/me/verification/refresh", headers=h).json()
    assert v["verified"] is True and v["status"] == "verified"
    assert client.get("/api/me", headers=h).json()["idVerified"] is True
