"""HR H7 (docs/HR_AND_HIRING_PLAN.md sections 3.8 and 3.9): reviews and finishing employment. Today: Mon 2 Nov 2026."""
from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from app.hr import reviews
from tests.test_hr_hiring import OTHER, WORKER, HrCase


class ReviewCase(HrCase):
    def setUp(self):
        super().setUp()
        self.db.rows["hr_settings"] = [{"id": 1, "review_every_months": 6}]
        # Ben (staff) reports to Ada (HR); his probation ends on Friday.
        self.db.rows["hr_employment"] = [{"worker_id": OTHER, "manager_id": WORKER, "start_date": "2026-08-03",
                                          "probation_end": "2026-11-06", "probation_passed_at": None, "status": "active"},
                                         {"worker_id": WORKER, "manager_id": None, "start_date": "2026-01-05",
                                          "probation_end": None, "probation_passed_at": None, "status": "active"}]
        self.names = patch("app.workforce.team.people", side_effect=lambda ids: {i: {"name": {WORKER: "Ada Eze", OTHER: "Ben Li"}.get(i, "X")} for i in ids})
        self.names.start()

    def tearDown(self):
        self.names.stop()
        super().tearDown()


class ReviewTests(ReviewCase):
    def test_probation_and_regular_reviews_open_a_week_ahead_once(self):
        # Ben's probation review (due Friday) and Ada's six-month review (due 5 Jul, overdue).
        self.assertEqual(reviews.open_due(date(2026, 11, 2)), 2)
        opened = {(r["worker_id"], r["kind"], r["due_on"]) for r in self.db.rows["hr_reviews"]}
        self.assertEqual(opened, {(OTHER, "probation", "2026-11-06"), (WORKER, "regular", "2026-07-05")})
        self.assertEqual(reviews.open_due(date(2026, 11, 2)), 0)
        notices = {n["worker_id"] for n in self.db.rows["operations_worker_notifications"]}
        self.assertEqual(notices, {OTHER, WORKER})

    def test_self_review_then_the_manager_passes_probation(self):
        reviews.open_due(date(2026, 11, 2))
        review_id = next(r["id"] for r in self.db.rows["hr_reviews"] if r["worker_id"] == OTHER)
        short = self.client.post(f"/hr/my/reviews/{review_id}/self", headers=self.auth("staff"), json={"text": "Good"})
        self.assertEqual(short.status_code, 422)
        self.client.post(f"/hr/my/reviews/{review_id}/self", headers=self.auth("staff"), json={"text": "I learned the Baima suppliers and answered quickly."})
        todo = self.client.get("/hr/reviews/to-do", headers=self.auth("hr")).json()["reviews"]
        mine = next(r for r in todo if r["worker_id"] == OTHER)
        self.assertIn("Baima", mine["self_review"])
        self.assertEqual(set(mine["context"]), {"rating", "rating_count", "hours", "shifts", "finished_work", "leave_days"})
        # Ben can't complete his own review.
        self.assertEqual(self.client.post(f"/hr/reviews/{review_id}/complete", headers=self.auth("staff"), json={
            "scores": {"speed": 4, "care": 4, "accuracy": 4}, "note": "x", "decision": "pass"}).status_code, 403)
        self.assertEqual(self.client.post(f"/hr/reviews/{review_id}/complete", headers=self.auth("hr"), json={
            "scores": {"speed": 4, "care": 3}, "note": "Great", "decision": "pass"}).status_code, 422)
        done = self.client.post(f"/hr/reviews/{review_id}/complete", headers=self.auth("hr"), json={
            "scores": {"speed": 4, "care": 3, "accuracy": 4}, "note": "A great first three months.", "decision": "pass"})
        self.assertEqual(done.status_code, 200, done.text)
        self.assertTrue(self.db.rows["hr_employment"][0]["probation_passed_at"])
        own = self.client.get("/hr/my", headers=self.auth("staff")).json()["reviews"][0]
        self.assertEqual((own["status"], own["scores"]["speed"]), ("completed", 4))

    def test_extend_moves_the_probation_end_and_a_manager_only_sees_their_team(self):
        reviews.open_due(date(2026, 11, 2))
        review_id = next(r["id"] for r in self.db.rows["hr_reviews"] if r["worker_id"] == OTHER)
        self.client.post(f"/hr/reviews/{review_id}/complete", headers=self.auth("hr"), json={
            "scores": {"speed": 2, "care": 3, "accuracy": 2}, "note": "More time on accuracy.", "decision": "extend", "extend_months": 2})
        self.assertEqual(self.db.rows["hr_employment"][0]["probation_end"], "2027-01-06")
        self.assertIsNone(self.db.rows["hr_employment"][0]["probation_passed_at"])
        self.assertEqual(self.client.get("/hr/reviews/to-do", headers=self.auth("staff")).json()["reviews"], [])

    def test_while_open_the_person_does_not_see_the_managers_scores(self):
        reviews.open_due(date(2026, 11, 2))
        review = next(r for r in self.db.rows["hr_reviews"] if r["worker_id"] == OTHER)
        review.update({"scores": {"speed": 1}, "manager_note": "Draft"})
        own = self.client.get("/hr/my", headers=self.auth("staff")).json()["reviews"][0]
        self.assertEqual((own["scores"], own["manager_note"]), ({}, None))


class OffboardingTests(ReviewCase):
    def test_finishing_employment_checklist_and_deactivation_after_the_last_day(self):
        self.db.rows["operations_work_items"] = [{"id": "w1", "assigned_worker_id": OTHER, "status": "claimed"}]
        started = self.client.post(f"/hr/people/{OTHER}/offboarding", headers=self.auth("hr"),
                                   json={"last_day": "2026-11-13", "reason_kind": "resigned", "reason": "Moving to Shenzhen"})
        self.assertEqual(started.status_code, 201, started.text)
        board = started.json()["person"]["offboarding"]
        self.assertEqual((board["open_work"], board["reason_label"]), (1, "Resigned"))
        self.assertEqual(self.client.post(f"/hr/people/{OTHER}/offboarding", headers=self.auth("hr"),
                                          json={"last_day": "2026-11-13", "reason_kind": "resigned"}).status_code, 409)
        released = self.client.post(f"/hr/people/{OTHER}/offboarding/release", headers=self.auth("hr")).json()["person"]["offboarding"]
        self.assertTrue(next(s for s in released["steps_list"] if s["key"] == "work_released")["done"])
        self.assertIn(("release_workforce_assignments", OTHER), [(n, p["p_worker_id"]) for n, p in self.db.rpc_calls])
        saved = self.client.put(f"/hr/people/{OTHER}/offboarding", headers=self.auth("hr"),
                                json={"steps": {"equipment_returned": True}, "exit_note": "Thanks Ben."}).json()["person"]["offboarding"]
        self.assertEqual(saved["exit_note"], "Thanks Ben.")
        self.assertEqual(reviews.finish_due(date(2026, 11, 13)), 0)  # still their last day
        self.assertEqual(reviews.finish_due(date(2026, 11, 14)), 1)
        worker = next(w for w in self.db.rows["fayfort_workers"] if w["user_id"] == OTHER)
        self.assertEqual(worker["status"], "inactive")
        self.assertEqual(self.db.rows["hr_employment"][0]["status"], "finished")
        self.assertEqual(self.db.rows["hr_employment_events"][-1]["kind"], "finished")
        self.assertEqual(reviews.finish_due(date(2026, 11, 15)), 0)

    def test_open_reviews_stop_and_leavers_get_no_new_ones(self):
        reviews.open_due(date(2026, 11, 2))
        self.client.post(f"/hr/people/{OTHER}/offboarding", headers=self.auth("hr"), json={"last_day": "2026-11-30", "reason_kind": "contract_ended"})
        self.assertEqual({r["status"] for r in self.db.rows["hr_reviews"] if r["worker_id"] == OTHER}, {"cancelled"})
        self.db.rows["hr_reviews"] = [r for r in self.db.rows["hr_reviews"] if r["worker_id"] != OTHER]
        reviews.open_due(date(2026, 11, 2))
        self.assertEqual([r for r in self.db.rows["hr_reviews"] if r["worker_id"] == OTHER], [])
        self.client.delete(f"/hr/people/{OTHER}/offboarding", headers=self.auth("hr"))
        reviews.open_due(date(2026, 11, 2))
        self.assertEqual(len([r for r in self.db.rows["hr_reviews"] if r["worker_id"] == OTHER]), 1)

    def test_only_hr_starts_it_and_nobody_offboards_themselves(self):
        self.assertEqual(self.client.post(f"/hr/people/{WORKER}/offboarding", headers=self.auth("staff"),
                                          json={"last_day": "2026-11-13", "reason_kind": "other"}).status_code, 403)
        self.assertEqual(self.client.post(f"/hr/people/{WORKER}/offboarding", headers=self.auth("hr"),
                                          json={"last_day": "2026-11-13", "reason_kind": "other"}).status_code, 409)


if __name__ == "__main__":
    unittest.main()
