"""Operations restructure R4 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): the Sourcing and Fulfillment desks."""
from __future__ import annotations

import unittest

from app.accounts.desks import desk_stage
from app.accounts.sourcing_desk import catalog_search, deposits_due, money_states, shop_orders, trends
from tests import test_operations_phase_b as phase_b
from tests.test_operations_phase_b import ITEM_A, ITEM_B, MEMBER, REQ_A, REQ_B, WORKER

REQ_C = "00000000-0000-0000-0000-0000000000ec"


class MoneyStageTests(unittest.TestCase):
    def test_money_moves_the_sourcing_stage(self):
        row = {"department": "sourcing", "work_type": "member_request", "status": "waiting", "member_request_id": "r"}
        self.assertEqual(desk_stage(row, "under_review", "deposit"), "deposit")
        self.assertEqual(desk_stage(row, "options_sent", "chosen"), "chosen")
        self.assertEqual(desk_stage(row, "options_sent", "invoice"), "invoice")
        self.assertEqual(desk_stage(row, "purchase_confirmed", "invoice"), "paid")  # paid wins
        self.assertEqual(desk_stage(row, "sourcing", None), "sourcing")


class SourcingDeskTests(unittest.TestCase):
    B = phase_b.PhaseBTests
    tearDown, h, item = B.tearDown, B.h, B.item

    def setUp(self):
        self.B.setUp(self)
        self.db.tables["operations_worker_departments"].append({"worker_id": WORKER, "department": "fulfillment", "can_claim": True})
        self.db.tables["member_purchase_requests"] = [
            {"id": REQ_A, "member_id": MEMBER, "request_title": "Lace wig for Ada", "expected_total": 200, "expected_currency": "USD", "created_at": "2026-10-20T00:00:00Z"},
            {"id": REQ_B, "member_id": MEMBER, "request_title": "Lace wig for Bola", "expected_total": None, "expected_currency": None, "created_at": "2026-10-21T00:00:00Z"},
            {"id": REQ_C, "member_id": MEMBER, "request_title": "Ankara", "expected_total": 90, "expected_currency": "USD", "created_at": "2026-10-22T00:00:00Z"},
        ]
        self.db.tables["operations_work_items"].append(
            {"id": "00000000-0000-0000-0000-00000000000c", "department": "sourcing", "status": "waiting", "assigned_worker_id": WORKER,
             "member_request_id": REQ_C, "summary": "Ankara", "version": 1, "work_type": "member_request"})
        self.db.tables["commerce_invoices"] = [{"id": "dep1", "request_id": REQ_C, "kind": "deposit", "status": "sent", "member_id": MEMBER}]
        self.db.tables["operations_sourcing_member_options"] = []
        self.db.tables["commerce_trend_items"] = [
            {"id": "t1", "canonical_url": "https://tiktok.com/a", "platform": "tiktok", "title": "Satin bonnet", "status": "open", "want_count": 37, "share_count": 40, "last_shared_at": "2026-10-26T00:00:00Z"},
            {"id": "t2", "canonical_url": "https://tiktok.com/b", "platform": "tiktok", "title": "Edge brush", "status": "pooling", "want_count": 12, "share_count": 12,
             "pool_target": 10, "pool_price": 4.5, "pool_currency": "USD", "last_shared_at": "2026-10-25T00:00:00Z"},
            {"id": "t3", "canonical_url": "https://x.com/c", "platform": "x", "title": "Old", "status": "dismissed", "want_count": 99, "share_count": 99},
        ]
        self.db.tables["directory_products"] = [
            {"id": "p1", "name": "Body wave lace wig 22 inch", "source": "shopify", "active": True, "price_min": 120, "currency": "USD"},
            {"id": "p2", "name": "Lace front glue", "source": "fayfort", "active": True, "min_order": 50},
            {"id": "p3", "name": "Lace wig old", "source": "fayfort", "active": False},
        ]
        self.db.tables["commerce_orders"] = [
            {"id": "o1", "shopify_order_id": "5001", "order_name": "#1042", "financial_status": "paid", "fulfillment_status": None,
             "cancelled_at": None, "total": "184.00", "currency": "USD", "line_items": [{"quantity": 1}, {"quantity": 2}], "placed_at": "2026-10-26T08:00:00Z"},
            {"id": "o2", "shopify_order_id": "5002", "order_name": "#1043", "financial_status": "pending", "fulfillment_status": None, "placed_at": "2026-10-26T09:00:00Z"},
            {"id": "o3", "shopify_order_id": "5000", "order_name": "#1041", "financial_status": "paid", "fulfillment_status": "fulfilled", "placed_at": "2099-01-01T00:00:00Z"},
        ]
        self.db.tables["operations_work_items"].append(
            {"id": "00000000-0000-0000-0000-0000000000f0", "department": "fulfillment", "status": "open", "assigned_worker_id": None,
             "work_type": "store_order", "metadata": {"source_kind": "shopify_order", "source_id": "5001"}, "summary": "Pack #1042", "version": 1})

    def test_money_states(self):
        self.db.tables["operations_sourcing_member_options"] = [{"request_id": REQ_A, "status": "selected"}]
        self.assertEqual(money_states(self.db, [REQ_A, REQ_B, REQ_C]), {REQ_A: "chosen", REQ_C: "deposit"})
        self.db.tables["commerce_invoices"].append({"id": "o", "request_id": REQ_A, "kind": "order", "status": "sent"})
        self.assertEqual(money_states(self.db, [REQ_A])[REQ_A], "invoice")

    def test_trends_most_wanted_first(self):
        found = trends(self.db)
        self.assertEqual([t["id"] for t in found], ["t1", "t2"])
        self.assertTrue(found[1]["ready"])
        self.assertEqual(found[1]["pool"]["progress"], 1.0)

    def test_deposits_due_skip_asked_and_pro(self):
        due = deposits_due(self.db, lambda member: {"tier": "free", "rate": 0.5})
        self.assertEqual([d["request_id"] for d in due], [REQ_A, REQ_B])  # REQ_C already has a deposit invoice
        self.assertEqual(due[0]["suggested_deposit"], 100.0)
        self.assertEqual(due[0]["work_item_id"], ITEM_A)
        self.assertEqual(deposits_due(self.db, lambda member: {"tier": "pro", "rate": 0.0}), [])

    def test_catalog_search_needs_every_word(self):
        self.assertEqual([p["id"] for p in catalog_search(self.db, "lace wig")], ["p1"])
        self.assertEqual(catalog_search(self.db, "lace")[1]["where"], "Sourcing catalog")
        self.assertEqual(catalog_search(self.db, "x"), [])

    def test_shop_orders_to_pack(self):
        orders = shop_orders(self.db)
        self.assertEqual(orders["to_pack_count"], 1)
        self.assertEqual(orders["to_pack"][0]["units"], 3)
        self.assertEqual(orders["to_pack"][0]["work_item_id"], "00000000-0000-0000-0000-0000000000f0")
        self.assertEqual(orders["shipped_this_week"], 1)

    def test_endpoints_are_for_the_desk(self):
        self.assertEqual(self.client.get("/operations/sourcing/overview", headers=self.h("worker")).status_code, 200)
        self.assertEqual(self.client.get("/operations/fulfillment/orders", headers=self.h("worker")).status_code, 200)
        self.who["Bearer support"] = {"user_id": "00000000-0000-0000-0000-0000000000e7", "role": "worker"}
        self.db.tables["operations_worker_departments"].append(
            {"worker_id": "00000000-0000-0000-0000-0000000000e7", "department": "member_support", "can_claim": True})
        self.assertEqual(self.client.get("/operations/sourcing/overview", headers=self.h("support")).status_code, 403)
        self.assertEqual(self.client.get("/operations/catalog?q=lace", headers=self.h("support")).status_code, 200)

    def test_start_a_pool(self):
        started = self.client.post("/operations/sourcing/trends/00000000-0000-0000-0000-0000000000a7/pool", headers=self.h("worker"),
                                   json={"target": 20, "price": 6.5, "currency": "USD"})
        self.assertEqual(started.status_code, 404)
        self.db.tables["commerce_trend_items"][0]["id"] = "00000000-0000-0000-0000-0000000000a7"
        started = self.client.post("/operations/sourcing/trends/00000000-0000-0000-0000-0000000000a7/pool", headers=self.h("worker"),
                                   json={"target": 20, "price": 6.5, "currency": "USD", "note": "Ships in 3 weeks"})
        self.assertEqual(started.status_code, 200, started.text)
        trend = self.db.tables["commerce_trend_items"][0]
        self.assertEqual((trend["status"], trend["pool_target"], trend["pool_price"]), ("pooling", 20, 6.5))
        bad = self.client.post("/operations/sourcing/trends/00000000-0000-0000-0000-0000000000a7/pool", headers=self.h("worker"),
                               json={"target": 1, "price": 6.5, "currency": "usd"})
        self.assertEqual(bad.status_code, 422)

    def test_list_carries_money_stage(self):
        listed = self.client.get("/operations/work-items?scope=desk&department=sourcing", headers=self.h("worker")).json()["work_items"]
        stages = {row["id"]: row["desk_stage"] for row in listed}
        self.assertEqual(stages["00000000-0000-0000-0000-00000000000c"], "deposit")
        self.assertEqual(stages[ITEM_B], "review")


if __name__ == "__main__":
    unittest.main()
