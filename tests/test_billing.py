from __future__ import annotations

import hashlib
import hmac
import json
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.billing import service, stripe_api
from app.billing.router import create_billing_router
from app.membership import plans, ranks
from tests.test_commerce import ADMIN, MEMBER, NOW
from tests.test_membership import AUTH, Case, membership_db

ADMIN_AUTH = {"Authorization": "Bearer admin"}


class FakeStripe:
    """Records calls and answers the Stripe endpoints FayFort uses."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict | None, dict | None]] = []
        self.prices: dict[str, dict] = {}
        self.webhooks: dict[str, dict] = {}
        self.subscriptions: dict[str, dict] = {}
        self.count = 0

    def __call__(self, method, path, data=None, *, params=None, idempotency_key=None, client=None):
        self.calls.append((method, path, data, params))
        self.count += 1
        if path == "/prices" and method == "GET":
            key = (params or {}).get("lookup_keys", [None])[0]
            found = [p for p in self.prices.values() if p["lookup_key"] == key]
            return {"data": found}
        if path == "/products" and method == "POST":
            return {"id": f"prod_{self.count}", "active": True}
        if path.startswith("/products/"):
            return {"id": path.split("/")[-1], "active": True}
        if path == "/prices" and method == "POST":
            price = {"id": f"price_{self.count}", "lookup_key": data["lookup_key"], "product": data["product"]}
            self.prices[price["id"]] = price
            return price
        if path.startswith("/prices/"):
            return self.prices[path.split("/")[-1]]
        if path == "/billing_portal/configurations":
            return {"id": f"bpc_{self.count}"}
        if path == "/webhook_endpoints" and method == "GET":
            return {"data": list(self.webhooks.values())}
        if path == "/webhook_endpoints" and method == "POST":
            endpoint = {"id": f"we_{self.count}", "url": data["url"], "status": "enabled",
                        "enabled_events": data["enabled_events"], "secret": "whsec_test"}
            self.webhooks[endpoint["id"]] = endpoint
            return endpoint
        if path.startswith("/webhook_endpoints/") and method == "GET":
            return self.webhooks[path.split("/")[-1]]
        if path == "/customers":
            return {"id": "cus_123"}
        if path == "/checkout/sessions":
            return {"id": "cs_1", "url": "https://checkout.stripe.com/c/pay/cs_1"}
        if path == "/billing_portal/sessions":
            return {"url": "https://billing.stripe.com/p/session/1"}
        if path.startswith("/subscriptions/"):
            sub = self.subscriptions[path.split("/")[-1]]
            if method == "POST" and data is not None and "pause_collection" in data:
                sub["pause_collection"] = data["pause_collection"] or None
            return sub
        raise AssertionError(f"Unexpected Stripe call {method} {path}")


def subscription(sub_id="sub_1", price="price_pro", status="active", start=None, **extra):
    return {"id": sub_id, "customer": "cus_123", "status": status, "metadata": {"fayfort_member_id": MEMBER},
            "items": {"data": [{"price": {"id": price}}]}, "start_date": int((start or NOW).timestamp()),
            "current_period_end": int((NOW + timedelta(days=30)).timestamp()), "cancel_at_period_end": False, **extra}


class BillingCase(Case):
    def setUp(self):
        for target, value in (("STRIPE_SECRET_KEY", "sk_test_123"), ("STRIPE_WEBHOOK_SECRET", ""),
                              ("STRIPE_PRICE_STANDARD", ""), ("STRIPE_PRICE_PRO", ""),
                              ("PUBLIC_API_URL", "https://api.fayfort.test"), ("APP_PUBLIC_URL", "https://app.fayfort.test")):
            patcher = patch.object(service.settings, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.stripe = FakeStripe()
        patcher = patch.object(stripe_api, "request", self.stripe)
        patcher.start()
        self.addCleanup(patcher.stop)

    def with_prices(self, db):
        db.rows["billing_settings"] = [{"key": "price_standard", "value": "price_std"},
                                       {"key": "price_pro", "value": "price_pro"},
                                       {"key": "webhook_secret", "value": "whsec_test"}]
        return db


class StripeClientTests(unittest.TestCase):
    def test_form_encoding(self):
        self.assertEqual(stripe_api.encode({"line_items": [{"price": "p", "quantity": 1}], "a": {"b": True}}),
                         [("line_items[0][price]", "p"), ("line_items[0][quantity]", "1"), ("a[b]", "true")])

    def test_signature(self):
        payload, now = b'{"id":"evt_1"}', int(time.time())
        good = hmac.new(b"whsec_x", f"{now}.".encode() + payload, hashlib.sha256).hexdigest()
        self.assertTrue(stripe_api.verify_signature(payload, f"t={now},v1={good}", "whsec_x"))
        self.assertFalse(stripe_api.verify_signature(payload, f"t={now},v1=bad", "whsec_x"))
        self.assertFalse(stripe_api.verify_signature(payload, f"t={now - 1000},v1={good}", "whsec_x"))


class SetupTests(BillingCase):
    def test_setup_creates_everything_once(self):
        self.use(membership_db())
        result = service.ensure_setup()
        self.assertTrue(result["ready"], result)
        self.assertEqual(result["mode"], "test")
        created = [(m, p) for m, p, _, _ in self.stripe.calls if m == "POST"]
        self.assertEqual(sum(1 for c in created if c[1] == "/prices"), 2)
        self.assertIn(("POST", "/webhook_endpoints"), created)
        webhook = next(d for m, p, d, _ in self.stripe.calls if (m, p) == ("POST", "/webhook_endpoints"))
        self.assertEqual(webhook["url"], "https://api.fayfort.test/billing/stripe/webhook")
        self.assertEqual(service.webhook_secret(), "whsec_test")
        price = next(d for m, p, d, _ in self.stripe.calls if (m, p) == ("POST", "/prices"))
        self.assertEqual((price["unit_amount"], price["recurring"]), (1900, {"interval": "month"}))
        self.stripe.calls.clear()
        service.ensure_setup()  # second run: finds everything, creates nothing
        self.assertEqual([c for c in self.stripe.calls if c[0] == "POST"], [])

    def test_not_configured_does_nothing(self):
        self.use(membership_db())
        with patch.object(service.settings, "STRIPE_SECRET_KEY", ""):
            self.assertFalse(service.ensure_setup()["configured"])
        self.assertEqual(self.stripe.calls, [])


class SubscriptionTests(BillingCase):
    def test_checkout_and_portal(self):
        client = self.client(self.with_prices(membership_db()))
        app = FastAPI()
        app.include_router(create_billing_router())
        client = TestClient(app)
        started = client.post("/members/subscription/checkout", json={"plan": "pro"}, headers=AUTH)
        self.assertEqual(started.status_code, 200, started.text)
        self.assertTrue(started.json()["url"].startswith("https://checkout.stripe.com/"))
        session = next(d for m, p, d, _ in self.stripe.calls if p == "/checkout/sessions")
        self.assertEqual(session["line_items"], [{"price": "price_pro", "quantity": 1}])
        self.assertEqual(session["subscription_data"]["metadata"]["fayfort_member_id"], MEMBER)
        self.assertEqual(session["success_url"], "https://app.fayfort.test/member/chat?billing=success")
        portal = client.post("/members/subscription/portal", headers=AUTH)
        self.assertEqual(portal.json()["url"], "https://billing.stripe.com/p/session/1")

    def test_subscription_sets_plan_and_cancel_returns_to_free(self):
        self.use(self.with_prices(membership_db()))
        service.sync_subscription(subscription())
        profile = self.db.rows["member_profiles"][0]
        row = self.db.rows["member_subscriptions"][0]
        self.assertEqual((profile["member_tier"], row["plan"], row["status"]), ("pro", "pro", "active"))
        self.assertIsNotNone(row["continuous_since"])
        service.sync_subscription(subscription(status="canceled"))
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "free")
        self.assertIsNotNone(self.db.rows["member_subscriptions"][0]["ended_at"])

    def test_coming_back_within_grace_keeps_continuous_months(self):
        self.use(self.with_prices(membership_db()))
        first = NOW - timedelta(days=90)
        service.sync_subscription(subscription(start=first))
        since = self.db.rows["member_subscriptions"][0]["continuous_since"]
        service.sync_subscription(subscription(status="canceled"))
        self.db.rows["member_subscriptions"][0]["ended_at"] = (NOW - timedelta(days=5)).isoformat()
        service.sync_subscription(subscription("sub_2", start=NOW))
        self.assertEqual(self.db.rows["member_subscriptions"][0]["continuous_since"], since)
        service.sync_subscription(subscription("sub_2", status="canceled"))
        self.db.rows["member_subscriptions"][0]["ended_at"] = (NOW - timedelta(days=20)).isoformat()
        service.sync_subscription(subscription("sub_3", start=NOW))
        self.assertNotEqual(self.db.rows["member_subscriptions"][0]["continuous_since"], since)

    def test_old_subscription_events_dont_downgrade_a_new_one(self):
        self.use(self.with_prices(membership_db()))
        service.sync_subscription(subscription("sub_new"))
        service.sync_subscription(subscription("sub_old", status="canceled"))
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")

    def test_pause_turns_perks_off_and_keeps_history(self):
        self.use(self.with_prices(membership_db()))
        self.stripe.subscriptions["sub_1"] = subscription()
        service.sync_subscription(self.stripe.subscriptions["sub_1"])
        since = self.db.rows["member_subscriptions"][0]["continuous_since"]
        view = service.pause(MEMBER, 2)
        self.assertTrue(view["paused"])
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "free")
        self.assertEqual(self.db.rows["member_subscriptions"][0]["continuous_since"], since)
        service.resume(MEMBER)
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")

    def test_paid_months_count_toward_rank_and_month_one_pro_pays_standard_deposit(self):
        self.use(self.with_prices(membership_db()))
        service.sync_subscription(subscription(start=NOW - timedelta(days=3)))
        self.assertEqual(plans.deposit_terms(MEMBER)["reason"], "pro_first_month")
        service.record_invoice_paid({"id": "in_1", "subscription": "sub_1", "customer": "cus_123", "amount_paid": 4900,
                                     "currency": "usd", "lines": {"data": [{"price": {"id": "price_pro"}}]},
                                     "status_transitions": {"paid_at": int(NOW.timestamp())}})
        self.assertEqual(ranks.recompute(MEMBER)["score"], 100)
        self.db.rows["member_subscriptions"][0]["continuous_since"] = (NOW - timedelta(days=45)).isoformat()
        self.assertEqual(plans.deposit_terms(MEMBER)["reason"], "pro_good_standing")


class WebhookTests(BillingCase):
    def post(self, client, event, secret="whsec_test"):
        body = json.dumps(event).encode()
        now = int(time.time())
        sig = hmac.new(secret.encode(), f"{now}.".encode() + body, hashlib.sha256).hexdigest()
        return client.post("/billing/stripe/webhook", content=body,
                           headers={"Stripe-Signature": f"t={now},v1={sig}", "Content-Type": "application/json"})

    def test_signed_events_update_the_member_once(self):
        self.use(self.with_prices(membership_db()))
        self.stripe.subscriptions["sub_1"] = subscription()
        app = FastAPI()
        app.include_router(create_billing_router())
        client = TestClient(app)
        event = {"id": "evt_1", "type": "customer.subscription.created", "data": {"object": {"id": "sub_1"}}}
        self.assertEqual(self.post(client, event, secret="whsec_wrong").status_code, 400)
        first = self.post(client, event)
        self.assertEqual(first.json()["result"], "processed")
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")
        self.assertEqual(self.post(client, event).json()["result"], "duplicate")

    def test_admin_status_and_setup(self):
        self.use(membership_db())
        app = FastAPI()
        app.include_router(create_billing_router())
        client = TestClient(app)
        with patch("app.billing.router.trusted_platform_admin",
                   side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None):
            self.assertEqual(client.get("/platform/billing/status", headers=AUTH).status_code, 403)
            ready = client.post("/platform/billing/setup", headers=ADMIN_AUTH).json()
        self.assertTrue(ready["ready"])
        self.assertEqual(ready["prices"]["pro"]["monthly"], 49.0)


if __name__ == "__main__":
    unittest.main()
