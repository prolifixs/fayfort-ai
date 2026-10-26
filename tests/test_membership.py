from __future__ import annotations

import re
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db, service as commerce_service
from app.commerce.admin_router import create_admin_commerce_router
from app.membership import plans, ranks, service
from app.membership.router import create_membership_router
from tests.test_commerce import ADMIN, MEMBER, NOW, Db, Query, ago

AUTH = {"Authorization": "Bearer member"}
ADMIN_AUTH = {"Authorization": "Bearer admin"}
INVOICE = ("gid://shopify/DraftOrder/9", "https://fayfort.myshopify.com/i/9")


class MQuery(Query):
    """The commerce fake plus the filters the membership code uses."""

    def neq(self, c, v): self.filters.append((c, "neq", v)); return self

    def or_(self, clause):
        options = []
        for part in clause.split(","):
            field, op, value = part.split(".", 2)
            options.append((field, op, value))
        self.filters.append(("*", "or", options))
        return self

    def _match(self, row):
        rest = [f for f in self.filters if f[1] not in ("neq", "or")]
        saved, self.filters = self.filters, rest
        try:
            if not super()._match(row):
                return False
        finally:
            self.filters = saved
        for c, op, v in self.filters:
            if op == "neq" and str(row.get(c)) == str(v):
                return False
            if op == "or":
                def hit(field, kind, value):
                    if kind == "ilike":
                        return value.strip("%").casefold() in str(row.get(field) or "").casefold()
                    if kind == "in":
                        return str(row.get(field)) in re.sub(r"[()]", "", value).split(",")
                    return False
                if not any(hit(*option) for option in v):
                    return False
        return True


class MDb(Db):
    def __init__(self, rows=None):
        super().__init__(rows)
        self.defaults["member_consultations"] = {"status": "awaiting_payment", "conversation_id": None}

    def table(self, name):
        return MQuery(self, name)

    def rpc(self, name, params):
        if name == "unlock_member_contact":
            self.rpcs.append((name, params))
            unlocks = self.rows.setdefault("member_contact_unlocks", [])
            key = (params["p_member_id"], params["p_record_type"], params["p_record_id"])
            existing = next((u for u in unlocks if (u["member_id"], u["record_type"], u["record_id"]) == key), None)
            if existing:
                return SimpleNamespace(execute=lambda: SimpleNamespace(data={"status": "already_unlocked", "method": existing["method"]}))
            since = params.get("p_period_start")
            used = sum(1 for u in unlocks if u["member_id"] == params["p_member_id"] and u["method"] == "pro_allowance"
                       and (since is None or str(u["created_at"]) >= str(since)))
            balance = sum(c["delta"] for c in self.rows.get("member_contact_credits", []) if c["member_id"] == params["p_member_id"])
            if (params.get("p_allowance") or 0) > 0 and since is not None and used < params["p_allowance"]:
                method = "pro_allowance"
            elif balance >= 1:
                method = "credit"
                self.rows.setdefault("member_contact_credits", []).append(
                    {"member_id": params["p_member_id"], "delta": -1, "reason": "unlock"})
            else:
                def fail():
                    raise RuntimeError("no_contact_credits")
                return SimpleNamespace(execute=fail)
            unlocks.append({"id": str(uuid.uuid4()), "member_id": key[0], "record_type": key[1], "record_id": key[2],
                            "method": method, "created_at": NOW.isoformat()})
            return SimpleNamespace(execute=lambda: SimpleNamespace(data={"status": "unlocked", "method": method}))
        if name == "redeem_member_points":
            self.rpcs.append((name, params))
            events = self.rows.setdefault("member_activity_events", [])
            balance = sum(e["points"] for e in events if e["member_id"] == params["p_member_id"])
            if balance < params["p_cost"]:
                def fail():
                    raise RuntimeError("not_enough_points")
                return SimpleNamespace(execute=fail)
            events.append({"id": str(uuid.uuid4()), "member_id": params["p_member_id"], "kind": "redeem",
                           "source_key": str(uuid.uuid4()), "points": -params["p_cost"], "occurred_at": NOW.isoformat()})
            self.rows.setdefault("member_contact_credits", []).append(
                {"member_id": params["p_member_id"], "delta": params["p_credits"], "reason": "points"})
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=balance - params["p_cost"]))
        if name == "request_member_conversation_support":
            self.rpcs.append((name, params))
            item = {"id": "work-1", "member_conversation_id": params["p_conversation_id"], "status": "open",
                    "work_type": "member_conversation"}
            self.rows.setdefault("operations_work_items", []).append(item)
            return SimpleNamespace(execute=lambda: SimpleNamespace(data={"id": "work-1", "status": "open"}))
        return super().rpc(name, params)


MARKET = str(uuid.UUID(int=101))
PROVIDER = str(uuid.UUID(int=102))
HOTEL = str(uuid.UUID(int=103))


def membership_db(tier: str = "free", **extra) -> MDb:
    rows = {
        "member_profiles": [{"user_id": MEMBER, "member_tier": tier, "rank_level": 1, "subrank": 1}],
        "directory_markets": [{"id": MARKET, "place_name": "Guangzhou Hair Market", "city": "Guangzhou",
                               "district": "Liwan", "address_en": "12 Wig Road", "address_cn": "假发路12号",
                               "buyer_notes": "Go before 10am", "verification_status": "verified"}],
        "directory_contacts": [{"market_id": MARKET, "contact_name": "Ms Li", "phone_wechat": "wx-li",
                                "floor_or_stall": "3F-12", "best_time": "Morning", "verification_status": "verified"}],
        "directory_market_categories": [{"market_id": MARKET, "category_ref": "hair-wigs"}],
        "directory_categories": [{"source_ref": "hair-wigs", "category": "Wigs", "group_name": "Hair", "product_type": "Lace wig"}],
        "directory_service_providers": [{"id": PROVIDER, "service": "Freight forwarding", "city": "Guangzhou",
                                         "ships_to": "Nigeria", "company": "FastShip", "phone_wechat": "wx-fast",
                                         "verification_status": "verified"}],
        "directory_hotels": [{"id": HOTEL, "area": "Liwan", "hotel_name": "Garden Hotel", "phone": "+86 20 1",
                              "rough_price_per_night": "$60", "verification_status": "verified"}],
    }
    rows.update(extra)
    return MDb(rows)


class Case(unittest.TestCase):
    def use(self, db: MDb) -> MDb:
        self.db = db
        patcher = patch.object(commerce_db, "client", db)
        patcher.start()
        self.addCleanup(patcher.stop)
        return db

    def client(self, db: MDb) -> TestClient:
        self.use(db)
        app = FastAPI()
        app.include_router(create_membership_router())
        app.include_router(create_admin_commerce_router())
        for target, mapping in (("app.commerce.member_router.trusted_user_id",
                                 lambda auth: {"Bearer member": MEMBER, "Bearer admin": ADMIN}.get(auth)),
                                ("app.commerce.admin_router.trusted_platform_admin",
                                 lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None)):
            patcher = patch(target, side_effect=mapping)
            patcher.start()
            self.addCleanup(patcher.stop)
        for target in ("app.membership.router.shopify.admin_configured", "app.commerce.admin_router.shopify.admin_configured"):
            patcher = patch(target, return_value=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        return TestClient(app)


class PlanRuleTests(Case):
    def test_deposit_rates_by_plan(self):
        bought = [{"id": "o1", "member_id": MEMBER, "financial_status": "paid", "placed_at": ago(days=5)}]
        for tier, rate in (("free", 0.5), ("standard", 0.25), ("pro", 0.0)):
            self.use(membership_db(tier, commerce_orders=list(bought)))
            quote = plans.deposit_quote(MEMBER, 200.0)
            self.assertEqual((quote["rate"], quote["amount"]), (rate, 200.0 * rate), tier)

    def test_pro_without_a_recent_purchase_pays_the_standard_deposit(self):
        self.use(membership_db("pro"))
        terms = plans.deposit_terms(MEMBER)
        self.assertEqual((terms["rate"], terms["reason"]), (0.25, "pro_not_yet_proven"))
        self.db.rows["commerce_orders"] = [{"id": "o1", "member_id": MEMBER, "financial_status": "paid", "placed_at": ago(days=120)}]
        self.assertEqual(plans.deposit_terms(MEMBER)["rate"], 0.25)  # older than 90 days doesn't count

    def test_pro_loses_free_sourcing_when_requests_dont_turn_into_purchases(self):
        requests = [{"id": f"r{i}", "member_id": MEMBER, "created_at": ago(days=i + 1)} for i in range(3)]
        requests += [{"id": f"r{i}", "member_id": MEMBER, "created_at": ago(days=i + 1)} for i in range(3, 6)]
        orders = [{"id": "o1", "member_id": MEMBER, "financial_status": "paid", "placed_at": ago(days=2)}]
        self.use(membership_db("pro", member_purchase_requests=requests, commerce_orders=orders))
        terms = plans.deposit_terms(MEMBER)  # 6 requests, 1 purchase: below one purchase per three requests
        self.assertEqual((terms["rate"], terms["reason"]), (0.25, "pro_below_good_standing"))
        self.db.rows["commerce_orders"].append({"id": "o2", "member_id": MEMBER, "financial_status": "paid",
                                                "placed_at": ago(days=3)})
        self.assertEqual(plans.deposit_terms(MEMBER)["rate"], 0.0)

    def test_consultation_prices(self):
        self.use(membership_db("free"))
        self.assertEqual(plans.consultation_quote(MEMBER)["price"], 100.0)
        self.use(membership_db("standard"))
        self.assertEqual(plans.consultation_quote(MEMBER)["price"], 85.0)
        self.use(membership_db("pro"))
        self.assertEqual((plans.consultation_quote(MEMBER)["price"], plans.consultation_quote(MEMBER)["included"]), (50.0, False))


class ConsultationTests(Case):
    def test_free_member_pays_then_consultation_opens_a_staff_chat(self):
        client = self.client(membership_db("free"))
        with patch("app.commerce.service.shopify.create_invoice", return_value=INVOICE) as create:
            booked = client.post("/members/consultations", json={"topic": "Help me pick a wig supplier"}, headers=AUTH)
            again = client.post("/members/consultations", json={"topic": "Another"}, headers=AUTH)
        self.assertEqual(booked.status_code, 201, booked.text)
        self.assertEqual(booked.json()["consultation"]["invoice_url"], INVOICE[1])
        self.assertTrue(again.json()["consultation"]["existing"])  # one unpaid booking at a time
        self.assertEqual(create.call_count, 1)
        self.assertEqual((create.call_args.kwargs["unit_price"], create.call_args.kwargs["kind"],
                          create.call_args.kwargs["requires_shipping"]), (100.0, "consultation", False))
        invoice = self.db.rows["commerce_invoices"][0]
        service.invoice_paid(invoice)
        service.invoice_paid(invoice)  # a retried webhook doesn't open a second chat
        consultation = self.db.rows["member_consultations"][0]
        self.assertEqual(consultation["status"], "requested")
        self.assertEqual(len(self.db.rows["member_conversations"]), 1)
        self.assertTrue(self.db.rows["member_conversations"][0]["title"].startswith("Consultation:"))
        work = self.db.rows["operations_work_items"][0]
        self.assertEqual((work["work_type"], work["priority"]), ("consultation", "high"))
        self.assertEqual(self.db.rows["email_outbox"][0]["template"], "commerce_consultation_booked")

    def test_pro_pays_the_pro_price_no_consultation_is_included(self):
        client = self.client(membership_db("pro"))
        with patch("app.commerce.service.shopify.create_invoice", return_value=INVOICE) as create:
            booked = client.post("/members/consultations", json={"topic": "Plan my Canton Fair trip"}, headers=AUTH)
        self.assertEqual(booked.status_code, 201, booked.text)
        self.assertEqual(create.call_args.kwargs["unit_price"], 50.0)
        self.assertFalse(self.db.rows["member_consultations"][0].get("included"))


class DirectoryTests(Case):
    def test_private_details_stay_hidden_until_unlocked(self):
        client = self.client(membership_db("free"))
        found = client.get("/members/directory", params={"type": "market", "q": "wigs"}, headers=AUTH).json()
        record = found["results"][0]
        self.assertEqual(record["public"]["categories"], ["Wigs"])  # matched through its category
        self.assertFalse(record["unlocked"])
        self.assertNotIn("private", record)
        self.assertNotIn("12 Wig Road", str(found))
        blocked = client.post("/members/directory/unlock", json={"record_type": "market", "record_id": MARKET}, headers=AUTH)
        self.assertEqual(blocked.status_code, 402)

    def test_credits_unlock_and_stay_unlocked(self):
        client = self.client(membership_db("free"))
        with patch("app.commerce.service.shopify.create_invoice", return_value=INVOICE) as create:
            bought = client.post("/members/contact-credits", json={"pack": "pack5"}, headers=AUTH)
        self.assertEqual(bought.status_code, 201, bought.text)
        self.assertEqual((create.call_args.kwargs["unit_price"], create.call_args.kwargs["kind"]), (50.0, "contact_credits"))
        invoice = self.db.rows["commerce_invoices"][0]
        service.invoice_paid(invoice)
        self.assertEqual(plans.contact_status(MEMBER)["credits"], 5)
        unlocked = client.post("/members/directory/unlock", json={"record_type": "market", "record_id": MARKET}, headers=AUTH)
        self.assertEqual(unlocked.status_code, 200, unlocked.text)
        record = unlocked.json()["record"]
        self.assertEqual(record["private"]["address_en"], "12 Wig Road")
        self.assertEqual(record["private"]["contacts"][0]["phone_wechat"], "wx-li")
        self.assertEqual(record["contacts"]["credits"], 4)
        client.post("/members/directory/unlock", json={"record_type": "market", "record_id": MARKET}, headers=AUTH)
        self.assertEqual(plans.contact_status(MEMBER)["credits"], 4)  # unlocking again is free
        mine = client.get("/members/directory/unlocked", headers=AUTH).json()["results"]
        self.assertEqual([r["id"] for r in mine], [MARKET])

    def test_allowance_follows_the_paid_month_and_grows_with_loyalty(self):
        period_start = ago(days=10)
        subscription = {"member_id": MEMBER, "status": "active", "continuous_since": ago(days=40),
                        "current_period_start": period_start}
        db = membership_db("pro", member_subscriptions=[subscription],
                           member_subscription_payments=[{"stripe_invoice_id": "in_1", "member_id": MEMBER, "plan": "pro",
                                                          "amount": 14.99, "paid_at": ago(days=40)}])
        self.use(db)
        # First paid month only: Standard's allowance (1) and Standard prices.
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance"], 1)
        self.assertEqual(plans.consultation_quote(MEMBER)["price"], 85.0)
        self.assertEqual(plans.deposit_terms(MEMBER)["reason"], "pro_first_month")
        db.rows["member_subscription_payments"].append({"stripe_invoice_id": "in_2", "member_id": MEMBER, "plan": "pro",
                                                         "amount": 14.99, "paid_at": period_start})
        status = plans.contact_status(MEMBER)
        self.assertEqual((status["pro_allowance"], status["pro_allowance_left"]), (3, 3))
        self.assertEqual(plans.consultation_quote(MEMBER)["price"], 50.0)
        # Unlocks from before this paid month don't count against it.
        db.rows["member_contact_unlocks"] = [{"member_id": MEMBER, "method": "pro_allowance", "record_type": "market",
                                              "record_id": f"x{i}", "created_at": ago(days=12)} for i in range(3)]
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance_left"], 3)
        db.rows["member_contact_unlocks"].append({"member_id": MEMBER, "method": "pro_allowance", "record_type": "market",
                                                  "record_id": "y", "created_at": ago(days=1)})
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance_left"], 2)
        # A refunded month doesn't count as paid, and an overdue payment stops the allowance.
        db.rows["member_subscription_payments"][1]["refunded_amount"] = 14.99
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance"], 1)
        db.rows["member_subscription_payments"][1]["refunded_amount"] = 0
        subscription["status"] = "past_due"
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance"], 0)

    def test_standard_includes_one_contact_then_uses_credits(self):
        client = self.client(membership_db("standard", member_contact_credits=[{"member_id": MEMBER, "delta": 2, "reason": "pack"}]))
        first = client.post("/members/directory/unlock", json={"record_type": "market", "record_id": MARKET}, headers=AUTH).json()["record"]
        second = client.post("/members/directory/unlock", json={"record_type": "service_provider", "record_id": PROVIDER},
                             headers=AUTH).json()["record"]
        self.assertEqual((first["method"], second["method"]), ("pro_allowance", "credit"))
        self.assertEqual(plans.contact_status(MEMBER)["credits"], 1)

    def test_pro_allowance_and_free_hotels(self):
        client = self.client(membership_db("pro"))
        unlocked = client.post("/members/directory/unlock", json={"record_type": "service_provider", "record_id": PROVIDER},
                               headers=AUTH).json()["record"]
        self.assertEqual((unlocked["method"], unlocked["private"]["company"]), ("pro_allowance", "FastShip"))
        self.assertEqual(unlocked["contacts"]["pro_allowance_left"], plans.PRO_CONTACTS_PER_MONTH - 1)
        hotels = client.get("/members/directory", params={"type": "hotel", "q": "liwan"}, headers=AUTH).json()["results"]
        self.assertEqual(hotels[0]["private"]["phone"], "+86 20 1")


class DepositTests(Case):
    def request_db(self, tier: str, **extra) -> MDb:
        rid = str(uuid.UUID(int=4))
        self.rid = rid
        return membership_db(tier, member_purchase_requests=[{"id": rid, "member_id": MEMBER, "request_title": "Wig",
                                                              "expected_total": 300, "expected_currency": "USD",
                                                              "created_at": ago(hours=2)}],
                             member_request_events=[{"request_id": rid, "stage": "sourcing", "sequence_no": 2}], **extra)

    def test_deposit_then_final_invoice_deducts_it(self):
        client = self.client(self.request_db("free"))
        listing = client.get("/platform/commerce/invoices", headers=ADMIN_AUTH).json()
        self.assertEqual(listing["deposits_due"][0]["suggested_deposit"], 150.0)
        with patch("app.commerce.service.shopify.create_invoice", return_value=INVOICE) as create:
            sent = client.post("/platform/commerce/invoices/deposit",
                               json={"request_id": self.rid, "expected_total": 300}, headers=ADMIN_AUTH)
            self.assertEqual(sent.status_code, 201, sent.text)
            self.assertEqual((create.call_args.kwargs["unit_price"], create.call_args.kwargs["kind"]), (150.0, "deposit"))
            self.assertEqual(client.get("/platform/commerce/invoices", headers=ADMIN_AUTH).json()["deposits_due"], [])
            deposit = self.db.rows["commerce_invoices"][0]
            deposit["status"] = "paid"
            self.db.rows["operations_sourcing_member_options"] = [{"id": "o1", "request_id": self.rid, "product_name": "Wig",
                                                                   "price_amount": 320, "currency": "USD",
                                                                   "status": "selected", "selected_at": ago(hours=1)}]
            ready = client.get("/platform/commerce/invoices", headers=ADMIN_AUTH).json()["ready_to_invoice"]
            self.assertEqual(ready[0]["deposit"]["status"], "paid")
            final = client.post("/platform/commerce/invoices", json={"request_id": self.rid}, headers=ADMIN_AUTH)
        self.assertEqual(final.status_code, 201, final.text)
        self.assertEqual((create.call_args.kwargs["unit_price"], create.call_args.kwargs["credit"]), (320.0, 150.0))
        self.assertEqual(self.db.rows["commerce_invoices"][1]["deposit_credit"], 150.0)

    def test_pro_in_good_standing_needs_no_deposit(self):
        client = self.client(self.request_db("pro", commerce_orders=[{"id": "o1", "member_id": MEMBER,
                                                                     "financial_status": "paid", "placed_at": ago(days=4)}]))
        refused = client.post("/platform/commerce/invoices/deposit",
                              json={"request_id": self.rid, "expected_total": 300}, headers=ADMIN_AUTH)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("good standing", refused.json()["detail"])


class RankTests(Case):
    def activity_db(self, tier: str = "free") -> MDb:
        return membership_db(tier,
            commerce_orders=[{"id": "o1", "shopify_order_id": "gid://shopify/Order/1", "member_id": MEMBER,
                              "financial_status": "paid", "total": 120, "placed_at": ago(days=3)}],
            commerce_invoices=[
                {"id": "i-order", "member_id": MEMBER, "kind": "order", "status": "paid", "request_id": "r1",
                 "paid_at": ago(days=3)},
                {"id": "i-dep", "member_id": MEMBER, "kind": "deposit", "status": "paid", "request_id": "r1",
                 "paid_at": ago(days=10)}],
            commerce_giveaway_entries=[{"giveaway_id": "g1", "member_id": MEMBER, "entered_at": ago(days=1)}])

    def test_steps(self):
        self.assertEqual(ranks.step(0), (1, 1))
        self.assertEqual(ranks.step(250), (2, 1))
        self.assertEqual(ranks.step(749), (2, 5))
        self.assertEqual(ranks.step(10_000), (5, 5))
        self.assertEqual(ranks.threshold(2, 2), 350)

    def test_activity_sets_score_rank_and_points(self):
        self.use(self.activity_db())
        result = ranks.recompute(MEMBER)
        # order 50 + 120, sourcing purchase 100, deposit 20, giveaway 5
        self.assertEqual((result["score"], result["balance"]), (295, 295))
        profile = self.db.rows["member_profiles"][0]
        self.assertEqual((profile["rank_level"], profile["subrank"], profile["points_balance"]), (2, 1, 295))
        ranks.recompute(MEMBER)  # idempotent: no double counting
        self.assertEqual(self.db.rows["member_profiles"][0]["status_score"], 295)
        self.assertEqual(len(self.db.rows["member_activity_events"]), 4)

    def test_refund_starts_grace_then_drops_one_subrank(self):
        from datetime import timedelta
        self.use(self.activity_db())
        ranks.recompute(MEMBER)
        self.db.rows["commerce_orders"][0]["financial_status"] = "refunded"
        held = ranks.recompute(MEMBER)
        self.assertEqual((held["score"], held["rank"], held["subrank"]), (125, 2, 1))  # kept during the grace period
        self.assertIsNotNone(held["below_since"])
        later = ranks.recompute(MEMBER, NOW + timedelta(days=31))
        self.assertEqual((later["rank"], later["subrank"]), (1, 5))  # one subrank down, not to the bottom

    def test_shares_that_bring_buyers_count(self):
        self.use(membership_db("free",
            commerce_trend_shares=[{"trend_item_id": "t1", "member_id": MEMBER, "shared_at": ago(days=5)}],
            commerce_invoices=[{"id": "i-b", "member_id": "buyer-1", "trend_item_id": "t1", "kind": "order",
                                "status": "paid", "paid_at": ago(days=2)}]))
        self.assertEqual(ranks.recompute(MEMBER)["score"], 30)

    def test_small_orders_earn_no_bonus_points(self):
        self.use(membership_db("free", commerce_orders=[
            {"id": f"s{i}", "shopify_order_id": f"gid://shopify/Order/{i}", "member_id": MEMBER, "financial_status": "paid",
             "total": 4, "placed_at": ago(days=1)} for i in range(5)]))
        self.assertEqual(ranks.recompute(MEMBER)["score"], 20)  # 5 orders of $4: 4 points each, no 50-point base

    def test_free_member_at_rank_four_gets_standard_rates(self):
        self.use(membership_db("free"))
        self.db.rows["member_profiles"][0]["rank_level"] = 4
        self.assertEqual(plans.deposit_terms(MEMBER)["rate"], 0.25)
        self.assertEqual(plans.consultation_quote(MEMBER)["price"], 85.0)
        self.assertEqual(plans.contact_status(MEMBER)["pro_allowance"], 0)  # the allowance is a plan perk, not a rank one

    def test_rank_api_and_points_redemption(self):
        client = self.client(self.activity_db())
        status = client.get("/members/rank", headers=AUTH).json()
        self.assertEqual((status["name"], status["score"], status["next"]["at"]), ("Scout", 295, 350))
        refused = client.post("/members/points/redeem", json={"reward": "contact_credit"}, headers=AUTH)
        self.assertEqual(refused.status_code, 409)
        self.db.rows["commerce_orders"].append({"id": "o2", "shopify_order_id": "gid://shopify/Order/2", "member_id": MEMBER,
                                                "financial_status": "paid", "total": 400, "placed_at": ago(days=1)})
        done = client.post("/members/points/redeem", json={"reward": "contact_credit"}, headers=AUTH)
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()["balance"], 295 + 250 - 500)
        self.assertEqual(plans.contact_status(MEMBER)["credits"], 1)


class ShopifyInvoiceTests(unittest.TestCase):
    def test_deposit_credit_becomes_a_fixed_discount_and_services_skip_shipping(self):
        from app.commerce import shopify
        calls = []

        def graphql(query, variables, client=None):
            calls.append(variables)
            if "draftOrderCreate" in query:
                return {"draftOrderCreate": {"draftOrder": {"id": "gid://shopify/DraftOrder/1", "invoiceUrl": "https://x/i"},
                                             "userErrors": []}}
            return {"draftOrderInvoiceSend": {"draftOrder": {"invoiceUrl": "https://x/i"}, "userErrors": []}}
        with patch.object(shopify, "admin_graphql", side_effect=graphql):
            shopify.create_invoice(invoice_id="i1", email="m@example.com", title="Wig", unit_price=320, currency="USD",
                                   quantity=1, note="n", credit=150)
            shopify.create_invoice(invoice_id="i2", email="m@example.com", title="Consultation", unit_price=100,
                                   currency="USD", quantity=1, note="n", kind="consultation", requires_shipping=False)
        order, service_call = calls[0]["input"], calls[2]["input"]
        self.assertEqual(order["appliedDiscount"], {"title": "Sourcing deposit paid", "description": "Sourcing deposit paid",
                                                    "value": 150, "valueType": "FIXED_AMOUNT"})
        self.assertNotIn("appliedDiscount", service_call)
        self.assertFalse(service_call["lineItems"][0]["requiresShipping"])
        self.assertIn({"key": "fayfort_invoice_kind", "value": "consultation"}, service_call["customAttributes"])


class PaidWebhookTests(Case):
    def test_paid_credit_pack_order_adds_credits_through_the_order_webhook(self):
        iid = str(uuid.UUID(int=9))
        self.use(membership_db("free", commerce_invoices=[{"id": iid, "member_id": MEMBER, "status": "sent", "kind": "contact_credits",
                                                          "details": {"pack": "single", "credits": 1}, "title": "Contact",
                                                          "amount": 15, "currency": "USD"}]))
        order = {"id": 777, "name": "#1003", "financial_status": "paid", "currency": "USD", "total_price": "15.00",
                 "note_attributes": [{"name": "fayfort_invoice_id", "value": iid}], "line_items": []}
        commerce_service.record_order(order)
        commerce_service.record_order(order)
        self.assertEqual(plans.contact_status(MEMBER)["credits"], 1)


if __name__ == "__main__":
    unittest.main()
