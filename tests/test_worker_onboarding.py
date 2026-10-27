"""Operations restructure R7 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): the welcome tour and first-week checklist."""
from __future__ import annotations

import unittest

from tests import test_operations_phase_b as phase_b
from tests.test_operations_phase_b import ADMIN, ITEM_A, WORKER


class OnboardingTests(unittest.TestCase):
    B = phase_b.PhaseBTests
    tearDown, h, item = B.tearDown, B.h, B.item

    def setUp(self):
        self.B.setUp(self)
        self.db.tables["fayfort_workers"][0].update({"job_title": "Sourcing agent", "onboarding_progress": {}})
        self.db.tables["worker_shifts"] = []

    def state(self, who="worker"):
        return self.client.get("/operations/me/onboarding", headers=self.h(who)).json()

    def test_new_worker_gets_the_tour_and_a_checklist_for_their_desks(self):
        found = self.state()
        self.assertTrue(found["show_tour"])
        self.assertEqual(found["departments"], ["sourcing", "member_support"])
        keys = [item["key"] for item in found["checklist"]]
        self.assertEqual(keys, ["tour", "clock_in", "claim", "guide_sourcing", "finish_sourcing", "guide_member_support", "finish_member_support"])
        self.assertEqual(found["done"], 0)

    def test_items_tick_themselves_from_what_happened(self):
        self.db.tables["worker_shifts"] = [{"worker_id": WORKER, "id": "s1"}]
        self.db.tables["operations_work_events"].append({"id": "e1", "actor_user_id": WORKER, "event_type": "claimed", "work_item_id": ITEM_A})
        self.item(ITEM_A).update({"status": "completed", "assigned_worker_id": WORKER})
        done = {item["key"] for item in self.state()["checklist"] if item["done"]}
        self.assertEqual(done, {"clock_in", "claim", "finish_sourcing"})

    def test_finishing_the_tour_and_reading_a_guide(self):
        self.assertEqual(self.client.post("/operations/me/onboarding/guide_sourcing", headers=self.h("worker")).status_code, 200)
        self.assertEqual(self.client.post("/operations/me/onboarding/claim", headers=self.h("worker")).status_code, 422)
        self.assertEqual(self.client.post("/operations/me/onboarding/tour", headers=self.h("worker")).status_code, 200)
        found = self.state()
        self.assertFalse(found["show_tour"])
        self.assertIsNotNone(found["completed_at"])
        done = {item["key"] for item in found["checklist"] if item["done"]}
        self.assertEqual(done, {"tour", "guide_sourcing"})

    def test_administrators_are_not_pushed_the_tour(self):
        self.db.tables["fayfort_workers"].append({"user_id": ADMIN, "status": "active", "onboarding_progress": {}})
        found = self.state("admin")
        self.assertFalse(found["show_tour"])
        self.assertIn("handoff", [item["key"] for item in found["checklist"]])  # all desks, Conversations included


if __name__ == "__main__":
    unittest.main()
