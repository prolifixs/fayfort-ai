"""Operations restructure R5 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): Member support cards and the dispute case file."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.accounts.support_desk import support_overview
from tests import test_operations_phase_b as phase_b
from tests.test_operations_phase_b import MEMBER, REQ_A, WORKER

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
CASE = "00000000-0000-0000-0000-0000000000d1"
CASE_ITEM = "00000000-0000-0000-0000-0000000000d2"
CARD_ITEM = "00000000-0000-0000-0000-0000000000d3"
CHAT = phase_b.CHAT


class SupportDeskTests(unittest.TestCase):
    B = phase_b.PhaseBTests
    tearDown, h, item = B.tearDown, B.h, B.item

    def setUp(self):
        self.B.setUp(self)
        self.db.tables["operations_worker_departments"].append({"worker_id": WORKER, "department": "disputes", "can_claim": True})
        self.db.tables["member_purchase_requests"] = [{"id": REQ_A, "member_id": MEMBER, "request_title": "Lace wig for Ada",
                                                       "request_description": "22 inch", "created_at": "2026-10-01T00:00:00Z"}]
        self.db.tables["member_conversations"][0]["linked_request_id"] = REQ_A
        self.db.tables["operations_dispute_cases"] = [{"id": CASE, "member_request_id": REQ_A}]
        self.db.tables["operations_work_items"] += [
            {"id": CASE_ITEM, "department": "disputes", "work_type": "dispute_case", "status": "open", "assigned_worker_id": None,
             "dispute_case_id": CASE, "summary": "Wig arrived damaged", "version": 1},
            {"id": CARD_ITEM, "department": "disputes", "work_type": "membership_dispute", "status": "claimed", "assigned_worker_id": WORKER,
             "summary": "Card dispute", "version": 1,
             "metadata": {"source_kind": "stripe_dispute", "source_id": "dp_1", "member_id": MEMBER, "stripe_link": "https://dashboard.stripe.com/disputes/dp_1"}},
        ]
        self.db.tables["operations_sourcing_member_options"] = [{"request_id": REQ_A, "status": "selected", "product_name": "Body wave wig", "price_amount": 180, "currency": "USD"}]
        self.db.tables["commerce_invoices"] = [
            {"id": "i1", "request_id": REQ_A, "member_id": MEMBER, "title": "Deposit", "kind": "deposit", "amount": 90, "currency": "USD", "status": "paid", "shopify_order_id": None, "created_at": "2026-10-02T00:00:00Z"},
            {"id": "i2", "request_id": None, "member_id": MEMBER, "title": "Satin bonnet", "kind": "order", "amount": 12, "currency": "USD", "status": "failed", "error": "Email missing", "created_at": "2026-10-26T00:00:00Z"},
            {"id": "i3", "request_id": None, "member_id": MEMBER, "title": "Old invoice", "kind": "order", "amount": 40, "currency": "USD", "status": "sent", "sent_at": "2026-10-20T00:00:00Z", "created_at": "2026-10-20T00:00:00Z"},
            {"id": "i4", "request_id": None, "member_id": MEMBER, "title": "New invoice", "kind": "order", "amount": 40, "currency": "USD", "status": "sent", "sent_at": "2026-10-27T00:00:00Z", "created_at": "2026-10-27T00:00:00Z"},
        ]
        self.db.tables["commerce_giveaways"] = [
            {"id": "g1", "title": "Wig week", "prize_text": "A wig", "ends_at": "2026-10-26T00:00:00Z", "winner_count": 1, "status": "open"},
            {"id": "g2", "title": "Bonnet drop", "prize_text": "Bonnet", "ends_at": "2026-11-02T00:00:00Z", "winner_count": 3, "status": "open"},
            {"id": "g3", "title": "Done", "ends_at": "2026-10-01T00:00:00Z", "status": "drawn"},
        ]
        self.db.tables["commerce_giveaway_entries"] = [{"giveaway_id": "g1"}, {"giveaway_id": "g1"}, {"giveaway_id": "g2"}]
        self.db.tables["operations_work_items"].append(
            {"id": "00000000-0000-0000-0000-0000000000d4", "department": "member_support", "work_type": "giveaway_draw", "status": "open",
             "metadata": {"source_kind": "giveaway", "source_id": "g1"}, "summary": "Draw", "version": 1})
        self.db.tables["billing_disputes"] = [{"stripe_dispute_id": "dp_1", "member_id": MEMBER, "amount": 14.99, "currency": "usd",
                                               "reason": "fraudulent", "status": "needs_response", "evidence_due_by": "2026-11-03T00:00:00Z",
                                               "stripe_invoice_id": "in_1"}]
        self.db.tables["member_subscription_payments"] = [{"stripe_invoice_id": "in_1", "member_id": MEMBER, "plan": "pro", "amount": 14.99, "currency": "usd", "paid_at": "2026-10-01T00:00:00Z"}]

    def test_support_overview(self):
        found = support_overview(self.db, now=NOW)
        self.assertEqual([row["id"] for row in found["failed_invoices"]], ["i2"])
        self.assertEqual(found["failed_invoices"][0]["member_name"], "Ada Obi")
        self.assertEqual([row["id"] for row in found["unpaid_invoices"]], ["i3"])  # only the ones older than 3 days
        self.assertEqual([(g["id"], g["entries"], g["work_item_id"]) for g in found["giveaways_to_draw"]],
                         [("g1", 2, "00000000-0000-0000-0000-0000000000d4")])
        self.assertEqual([g["id"] for g in found["giveaways_running"]], ["g2"])

    def test_order_dispute_case_file(self):
        unclaimed = self.client.get(f"/operations/work-items/{CASE_ITEM}/case-file", headers=self.h("worker")).json()["case_file"]
        self.assertEqual(unclaimed["kind"], "order_dispute")
        self.assertEqual(unclaimed["order"]["title"], "Lace wig for Ada")
        self.assertEqual(unclaimed["order"]["stage"], "submitted")
        self.assertEqual(unclaimed["order"]["chosen"]["product_name"], "Body wave wig")
        self.assertEqual(unclaimed["payments"][0]["kind"], "deposit")
        self.assertEqual(unclaimed["member"]["name"], "Ada Obi")
        self.assertIsNone(unclaimed["chat"])
        self.assertTrue(unclaimed["chat_locked"])
        admin = self.client.get(f"/operations/work-items/{CASE_ITEM}/case-file", headers=self.h("admin")).json()["case_file"]
        self.assertEqual(admin["chat"]["messages"][0]["content"], "Hi, anyone?")

    def test_card_dispute_case_file(self):
        found = self.client.get(f"/operations/work-items/{CARD_ITEM}/case-file", headers=self.h("worker")).json()["case_file"]
        self.assertEqual(found["kind"], "card_dispute")
        self.assertEqual((found["dispute"]["reason"], found["dispute"]["currency"]), ("fraudulent", "USD"))
        self.assertEqual(found["payments"][0]["title"], "Pro plan")
        self.assertTrue(found["payments"][0]["disputed"])
        self.assertEqual(found["links"][0]["url"], "https://dashboard.stripe.com/disputes/dp_1")
        self.assertIsNotNone(found["chat"])  # claimed by this worker

    def test_rules(self):
        self.assertEqual(self.client.get(f"/operations/work-items/{phase_b.ITEM_A}/case-file", headers=self.h("admin")).status_code, 409)
        self.assertEqual(self.client.get("/operations/member-support/overview", headers=self.h("worker")).status_code, 200)
        self.who["Bearer disputes"] = {"user_id": "00000000-0000-0000-0000-0000000000e6", "role": "worker"}
        self.db.tables["operations_worker_departments"].append({"worker_id": "00000000-0000-0000-0000-0000000000e6", "department": "disputes", "can_claim": True})
        self.assertEqual(self.client.get("/operations/member-support/overview", headers=self.h("disputes")).status_code, 403)


if __name__ == "__main__":
    unittest.main()
