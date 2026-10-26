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
        self.charges: dict[str, dict] = {}
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
        if path.startswith("/prices/") and method == "POST":
            self.prices.setdefault(path.split("/")[-1], {"id": path.split("/")[-1]}).update(data or {})
            return self.prices[path.split("/")[-1]]
        if path.startswith("/prices/"):
            return self.prices.get(path.split("/")[-1], {"id": path.split("/")[-1], "metadata": {}})
        if path.startswith("/charges/"):
            charge_id = path.split("/")[-1]
            return self.charges.get(charge_id, {"id": charge_id, "invoice": None,
                                                "balance_transaction": {"fee": 47}})
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
            if method == "POST" and data is not None and "items" in data:
                sub["items"] = {"data": [{"id": "si_1", "price": {"id": data["items"][0]["price"]}}]}
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
        self.assertEqual((price["unit_amount"], price["recurring"]), (599, {"interval": "month"}))
        portal = next(d for m, p, d, _ in self.stripe.calls if (m, p) == ("POST", "/billing_portal/configurations"))
        update = portal["features"]["subscription_update"]
        self.assertEqual(update["proration_behavior"], "always_invoice")  # upgrades charged at once
        self.assertIn({"type": "decreasing_item_amount"}, update["schedule_at_period_end"]["conditions"])  # downgrades wait
        webhook_events = next(d for m, p, d, _ in self.stripe.calls if (m, p) == ("POST", "/webhook_endpoints"))["enabled_events"]
        self.assertIn("charge.dispute.created", webhook_events)
        self.stripe.calls.clear()
        service.ensure_setup()  # second run: finds everything, creates nothing
        self.assertEqual([c for c in self.stripe.calls if c[0] == "POST"], [])

    def test_a_price_change_archives_the_old_price(self):
        self.use(membership_db())
        service.ensure_setup()
        old = service.price_ids()["standard"]
        with patch.object(service.settings, "MEMBER_STANDARD_MONTHLY_PRICE", 6.99):
            service.ensure_setup()
        new = service.price_ids()["standard"]
        self.assertNotEqual(old, new)
        self.assertIs(self.stripe.prices[old]["active"], False)
        self.assertIn(old, service.get_setting("archived_prices"))

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

    def test_pause_starts_at_the_end_of_the_paid_month_and_keeps_history(self):
        self.use(self.with_prices(membership_db()))
        self.stripe.subscriptions["sub_1"] = subscription()
        service.sync_subscription(self.stripe.subscriptions["sub_1"])
        since = self.db.rows["member_subscriptions"][0]["continuous_since"]
        view = service.pause(MEMBER, 2)
        self.assertTrue(view["paused"])
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")  # paid month not over yet
        resumes = next(d for m, p, d, _ in self.stripe.calls if p == "/subscriptions/sub_1" and m == "POST")["pause_collection"]["resumes_at"]
        self.assertGreater(resumes, int((NOW + timedelta(days=89)).timestamp()))  # 2 months after the paid month ends
        self.db.rows["member_subscriptions"][0]["paused_from"] = (NOW - timedelta(minutes=1)).isoformat()
        service.sweep()
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "free")
        self.assertEqual(self.db.rows["member_subscriptions"][0]["continuous_since"], since)
        service.resume(MEMBER)
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")

    def test_a_failed_payment_keeps_the_plan_for_seven_days_and_tells_the_member(self):
        self.use(self.with_prices(membership_db()))
        self.stripe.subscriptions["sub_1"] = subscription(status="past_due")
        service.handle_event({"id": "evt_f1", "type": "invoice.payment_failed",
                              "data": {"object": {"id": "in_f1", "subscription": "sub_1"}}})
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")
        emails = [r for r in self.db.rows.get("email_outbox", []) if r["template"] == "commerce_billing"]
        self.assertEqual(emails[-1]["payload"]["title"], "Your card was declined")
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance"], 0)  # no allowance while overdue
        self.db.rows["member_subscriptions"][0]["past_due_since"] = (NOW - timedelta(days=8)).isoformat()
        service.sweep()
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "free")
        titles = [r["payload"]["title"] for r in self.db.rows["email_outbox"] if r["template"] == "commerce_billing"]
        self.assertIn("Your FayFort plan has ended", titles)
        service.sweep()  # told once
        self.assertEqual(titles.count("Your FayFort plan has ended"),
                         [r["payload"]["title"] for r in self.db.rows["email_outbox"]].count("Your FayFort plan has ended"))
        self.stripe.subscriptions["sub_1"]["status"] = "active"
        service.sync_subscription(self.stripe.subscriptions["sub_1"])
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")
        self.assertIsNone(self.db.rows["member_subscriptions"][0]["past_due_since"])

    def paid(self, invoice_id, cents=1499, when=None, charge="ch_1"):
        service.record_invoice_paid({"id": invoice_id, "subscription": "sub_1", "customer": "cus_123", "amount_paid": cents,
                                     "currency": "usd", "charge": charge, "lines": {"data": [{"price": {"id": "price_pro"}}]},
                                     "status_transitions": {"paid_at": int((when or NOW).timestamp())}})

    def test_paid_months_count_toward_rank_and_month_one_runs_on_the_plan_below(self):
        self.use(self.with_prices(membership_db(commerce_orders=[{"id": "o1", "member_id": MEMBER, "financial_status": "paid",
                                                                  "placed_at": (NOW - timedelta(days=5)).isoformat()}])))
        service.sync_subscription(subscription(start=NOW - timedelta(days=35)))
        self.assertEqual(plans.deposit_terms(MEMBER)["reason"], "pro_first_month")
        self.paid("in_1", when=NOW - timedelta(days=35))
        self.assertEqual(plans.deposit_terms(MEMBER)["reason"], "pro_first_month")  # one paid month: still month one
        self.assertEqual(ranks.recompute(MEMBER)["score"], 40)  # 40 for the Pro month (the order has no total: 0)
        self.paid("in_2", when=NOW - timedelta(days=5), charge="ch_2")
        self.assertEqual(plans.deposit_terms(MEMBER)["reason"], "pro_good_standing")
        payment = next(p for p in self.db.rows["member_subscription_payments"] if p["stripe_invoice_id"] == "in_2")
        self.assertEqual(payment["fee"], 0.47)  # Stripe's fee from the balance transaction

    def test_a_refunded_month_earns_no_points(self):
        self.use(self.with_prices(membership_db()))
        service.sync_subscription(subscription())
        self.paid("in_1")
        self.assertEqual(ranks.recompute(MEMBER)["score"], 40)
        service.record_refund({"invoice": "in_1", "amount_refunded": 1499})
        self.assertEqual(ranks.recompute(MEMBER)["score"], 0)

    def test_a_dispute_ends_the_plan_and_opens_a_disputes_task(self):
        self.use(self.with_prices(membership_db()))
        service.sync_subscription(subscription())
        self.paid("in_1")
        self.stripe.charges["ch_1"] = {"id": "ch_1", "invoice": "in_1", "customer": "cus_123"}
        dispute = {"id": "dp_1", "charge": "ch_1", "amount": 1499, "currency": "usd", "reason": "fraudulent",
                   "status": "needs_response", "evidence_details": {"due_by": int((NOW + timedelta(days=7)).timestamp())}}
        service.handle_event({"id": "evt_d1", "type": "charge.dispute.created", "data": {"object": dispute}})
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "free")
        work = self.db.rows["operations_work_items"][-1]
        self.assertEqual((work["department"], work["work_type"], work["priority"]), ("disputes", "membership_dispute", "urgent"))
        self.assertIn("dashboard.stripe.com/test/disputes/dp_1", work["next_action"])
        self.assertEqual(ranks.recompute(MEMBER)["score"], 0)  # a disputed month earns nothing
        self.assertEqual(service.status()["open_disputes"], 1)
        service.handle_event({"id": "evt_d2", "type": "charge.dispute.closed", "data": {"object": {**dispute, "status": "won"}}})
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")
        self.assertEqual(ranks.recompute(MEMBER)["score"], 40)

    def test_a_lost_dispute_counts_as_a_refund(self):
        self.use(self.with_prices(membership_db()))
        service.sync_subscription(subscription())
        self.paid("in_1")
        self.stripe.charges["ch_1"] = {"id": "ch_1", "invoice": "in_1", "customer": "cus_123"}
        service.record_dispute({"id": "dp_2", "charge": "ch_1", "amount": 1499, "currency": "usd", "status": "lost"})
        self.assertEqual(self.db.rows["member_subscription_payments"][0]["dispute_lost_amount"], 14.99)
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "free")

    def test_moving_subscribers_to_current_prices(self):
        self.use(self.with_prices(membership_db()))
        self.stripe.subscriptions["sub_1"] = subscription(price="price_old")
        self.stripe.prices["price_old"] = {"id": "price_old", "metadata": {"fayfort_plan": "pro"}}
        service.sync_subscription(self.stripe.subscriptions["sub_1"])
        self.assertEqual(self.db.rows["member_profiles"][0]["member_tier"], "pro")  # an old price still maps to its plan
        self.stripe.subscriptions["sub_1"]["items"] = {"data": [{"id": "si_1", "price": {"id": "price_old"}}]}
        self.assertEqual(service.move_to_current_prices()["on_old_prices"], 1)
        moved = service.move_to_current_prices(dry_run=False)
        self.assertEqual(moved["moved"], 1)
        update = [d for m, p, d, _ in self.stripe.calls if p == "/subscriptions/sub_1" and m == "POST"][-1]
        self.assertEqual((update["items"][0]["price"], update["proration_behavior"]), ("price_pro", "none"))


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
        self.assertEqual((ready["prices"]["standard"]["monthly"], ready["prices"]["pro"]["monthly"]), (5.99, 14.99))
        self.assertEqual(ready["past_due_grace_days"], 7)


if __name__ == "__main__":
    unittest.main()
