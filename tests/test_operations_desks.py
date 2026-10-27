"""Operations restructure R2 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): desks, their pipeline stages and My work counts."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.accounts.desks import DESK_STAGES, desk_stage, desk_summaries, my_due_counts
from tests import test_operations_phase_b as phase_b
from tests.test_operations_phase_b import ADMIN, ITEM_A, ITEM_B, REQ_B

NOW = datetime(2026, 10, 27, 4, 0, tzinfo=timezone.utc)  # 12:00 in China


class DeskStageTests(unittest.TestCase):
    def test_sourcing_follows_the_request_timeline(self):
        row = {"department": "sourcing", "work_type": "member_request", "status": "open", "member_request_id": "r"}
        self.assertEqual(desk_stage(row, "submitted"), "review")
        self.assertEqual(desk_stage(row, "sourcing"), "sourcing")
        self.assertEqual(desk_stage(row, "options_sent"), "with_member")
        self.assertEqual(desk_stage(row, "needs_member_input"), "with_member")
        self.assertEqual(desk_stage(row, "purchase_confirmed"), "paid")
        self.assertEqual(desk_stage(row, None), "review")
        self.assertEqual(desk_stage({**row, "work_type": "group_buy", "member_request_id": None}), "group_buy")

    def test_fulfillment_and_shop_orders(self):
        row = {"department": "fulfillment", "work_type": "member_request", "status": "claimed", "member_request_id": "r"}
        self.assertEqual(desk_stage(row, "purchase_confirmed"), "confirmed")
        self.assertEqual(desk_stage(row, "item_in_warehouse"), "warehouse")
        self.assertEqual(desk_stage(row, "in_transit"), "on_the_way")
        self.assertEqual(desk_stage({**row, "work_type": "store_order", "member_request_id": None}), "shop_order")

    def test_work_types_and_status_fallback(self):
        self.assertEqual(desk_stage({"department": "member_support", "work_type": "tour_booking", "status": "open"}), "bookings")
        self.assertEqual(desk_stage({"department": "member_support", "work_type": "invoice_failed", "status": "open"}), "money")
        self.assertEqual(desk_stage({"department": "store_team", "work_type": "list_find", "status": "open"}), "finds")
        self.assertEqual(desk_stage({"department": "conversation_intake", "member_conversation_id": "c", "status": "open"}), "member_app")
        self.assertEqual(desk_stage({"department": "conversation_intake", "handoff_id": "h", "status": "open"}), "customer")
        self.assertEqual(desk_stage({"department": "disputes", "work_type": "dispute_case", "status": "waiting"}), "waiting")
        self.assertEqual(desk_stage({"department": "store_team", "work_type": "something_new", "status": "blocked"}), "blocked")

    def test_every_stage_has_a_label(self):
        for department, stages in DESK_STAGES.items():
            keys = [key for key, _ in stages]
            self.assertEqual(len(keys), len(set(keys)), department)


class DeskSummaryTests(unittest.TestCase):
    def rows(self):
        past, later = (NOW - timedelta(hours=2)).isoformat(), (NOW + timedelta(hours=3)).isoformat()
        return [
            {"department": "sourcing", "work_type": "member_request", "status": "open", "member_request_id": "r1", "due_at": past},
            {"department": "sourcing", "work_type": "member_request", "status": "claimed", "member_request_id": "r2",
             "assigned_worker_id": "me", "claimed_until": later, "due_at": later},
            {"department": "sourcing", "work_type": "member_request", "status": "claimed", "member_request_id": "r3",
             "assigned_worker_id": "other", "claimed_until": past},
            {"department": "sourcing", "work_type": "member_request", "status": "waiting", "member_request_id": "r4"},
            {"department": "sourcing", "work_type": "member_request", "status": "completed", "member_request_id": "r5"},
            {"department": "disputes", "work_type": "dispute_case", "status": "open"},
        ]

    def test_counts_for_my_desks_only(self):
        stages = {"r1": "submitted", "r2": "sourcing", "r3": "options_sent", "r4": "options_sent"}
        desks = desk_summaries(self.rows(), stages, "me", ["sourcing"], now=NOW)
        self.assertEqual(len(desks), 1)
        sourcing = desks[0]
        self.assertEqual((sourcing["total"], sourcing["available"], sourcing["mine"], sourcing["waiting"], sourcing["overdue"]),
                         (4, 2, 1, 1, 1))  # open + the lapsed claim are free; the completed one doesn't count
        counts = {stage["key"]: stage["count"] for stage in sourcing["stages"]}
        self.assertEqual(counts["review"], 1)
        self.assertEqual(counts["sourcing"], 1)
        self.assertEqual(counts["with_member"], 2)
        self.assertEqual(counts["paid"], 0)  # the pipeline keeps its shape
        self.assertNotIn("blocked", counts)  # status fallbacks only appear when used

    def test_disputes_always_show_status_stages(self):
        disputes = desk_summaries(self.rows(), {}, "me", ["disputes"], now=NOW)[0]
        self.assertEqual([stage["key"] for stage in disputes["stages"]], ["new", "working", "waiting", "blocked"])

    def test_my_due_counts_use_the_china_day(self):
        rows = [{"due_at": (NOW - timedelta(minutes=5)).isoformat()},
                {"due_at": (NOW + timedelta(hours=11)).isoformat()},   # 23:00 China: today
                {"due_at": (NOW + timedelta(hours=13)).isoformat()},   # 01:00 China tomorrow
                {"due_at": None}]
        self.assertEqual(my_due_counts(rows, now=NOW), {"mine": 4, "mine_due_today": 1, "mine_overdue": 1})


class DeskEndpointTests(unittest.TestCase):
    """Reuses the phase B fake database: a worker on Sourcing and Member support, two sourcing requests."""
    B = phase_b.PhaseBTests
    setUp, tearDown, h, item = B.setUp, B.tearDown, B.h, B.item

    def test_desks_endpoint(self):
        worker = self.client.get("/operations/desks", headers=self.h("worker")).json()
        self.assertEqual([desk["department"] for desk in worker["desks"]], ["sourcing", "member_support"])
        sourcing = worker["desks"][0]
        self.assertEqual(sourcing["available"], 2)
        self.assertEqual({s["key"]: s["count"] for s in sourcing["stages"]}["review"], 2)
        admin = self.client.get("/operations/desks", headers=self.h("admin")).json()
        self.assertEqual(len(admin["desks"]), 6)

    def test_desk_scope_lists_the_whole_desk_with_stages(self):
        self.item(ITEM_B).update({"status": "waiting", "assigned_worker_id": ADMIN})
        self.db.tables["member_request_events"].append({"request_id": REQ_B, "stage": "options_sent", "sequence_no": 2})
        listed = self.client.get("/operations/work-items?scope=desk&department=sourcing", headers=self.h("worker")).json()
        stages = {row["id"]: row["desk_stage"] for row in listed["work_items"]}
        self.assertEqual(stages, {ITEM_A: "review", ITEM_B: "with_member"})  # waiting work on the desk shows too
        available = self.client.get("/operations/work-items?scope=available&department=sourcing", headers=self.h("worker")).json()
        self.assertEqual([row["id"] for row in available["work_items"]], [ITEM_A])

    def test_desk_scope_needs_a_desk_the_worker_is_on(self):
        self.assertEqual(self.client.get("/operations/work-items?scope=desk", headers=self.h("worker")).status_code, 422)
        other = self.client.get("/operations/work-items?scope=desk&department=disputes", headers=self.h("worker")).json()
        self.assertEqual(other["work_items"], [])


if __name__ == "__main__":
    unittest.main()
