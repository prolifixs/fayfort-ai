"""HR H6 (docs/HR_AND_HIRING_PLAN.md section 3.5): time off. Today is Monday 2 Nov 2026 (China)."""
from __future__ import annotations

import unittest
from datetime import date, timezone
from unittest.mock import patch

from app.bookings import engine
from app.hr import leave
from tests.test_hr_hiring import NOW, OTHER, WORKER, HrCase


class LeaveCase(HrCase):
    def setUp(self):
        super().setUp()
        self.db.rows["hr_leave_types"] = [
            {"key": "annual", "name": "Annual leave", "yearly_days": 12, "needs_approval": True, "active": True, "position": 1},
            {"key": "sick", "name": "Sick leave", "yearly_days": 6, "needs_approval": True, "active": True, "position": 2},
            {"key": "unpaid", "name": "Unpaid leave", "yearly_days": None, "needs_approval": True, "active": True, "position": 3}]
        self.db.rows["hr_settings"] = [{"id": 1, "work_days": [0, 1, 2, 3, 4]}]
        self.db.rows["hr_public_holidays"] = [{"day": "2026-11-11", "name": "Company day", "region": "china"}]
        # Ben (staff) reports to Ada (HR).
        self.db.rows["hr_employment"] = [{"worker_id": OTHER, "manager_id": WORKER, "start_date": "2026-01-05"}]
        self.names = patch("app.workforce.team.people", side_effect=lambda ids: {i: {"name": {WORKER: "Ada Eze", OTHER: "Ben Li"}.get(i, "X")} for i in ids})
        self.names.start()
        self.engine_clock = patch.object(engine, "now_utc", return_value=NOW)
        self.engine_clock.start()

    def tearDown(self):
        self.engine_clock.stop()
        self.names.stop()
        super().tearDown()

    def ask(self, **fields):
        return self.client.post("/hr/my/time-off", headers=self.auth("staff"),
                                json={"leave_type": "annual", "start_date": "2026-11-09", "end_date": "2026-11-13", **fields})


class CountingTests(unittest.TestCase):
    def test_only_working_days_that_are_not_holidays_count(self):
        days = leave.count_days(date(2026, 11, 9), date(2026, 11, 15), days_off={"2026-11-11"}, working=[0, 1, 2, 3, 4])
        self.assertEqual(days, 4)  # Mon to Fri minus the holiday; the weekend doesn't count
        self.assertEqual(leave.count_days(date(2026, 11, 9), date(2026, 11, 9), "morning", days_off=set(), working=[0, 1, 2, 3, 4]), 0.5)

    def test_allowance_is_pro_rated_from_the_start_date(self):
        self.assertEqual(leave.allowance(12, date(2026, 7, 1), 2026), 6.0)
        self.assertEqual(leave.allowance(12, date(2025, 3, 1), 2026), 12.0)
        self.assertEqual(leave.allowance(12, date(2027, 1, 1), 2026), 0.0)

    def test_half_days_block_half_the_china_day(self):
        begin, end = leave.span(date(2026, 11, 9), date(2026, 11, 9), "afternoon")
        self.assertEqual((begin.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()),
                         ("2026-11-09T05:00:00+00:00", "2026-11-09T16:00:00+00:00"))


class RequestTests(LeaveCase):
    def test_asking_counts_days_tells_the_manager_and_blocks_nothing_until_approved(self):
        made = self.ask(note="Family visit")
        self.assertEqual(made.status_code, 201, made.text)
        row = self.db.rows["staff_time_off"][0]
        self.assertEqual((row["status"], row["days"], row["leave_type"]), ("requested", 4.0, "annual"))
        notice = self.db.rows["operations_worker_notifications"][0]
        self.assertEqual((notice["worker_id"], notice["notification_type"]), (WORKER, "time_off"))
        self.assertIn("Ben Li asked for annual leave", notice["title"])
        balance = next(b for b in made.json()["balances"] if b["key"] == "annual")
        self.assertEqual((balance["allowance"], balance["pending"], balance["left"]), (12.0, 4.0, 8.0))
        self.assertEqual(engine.time_off(OTHER), [])  # requested leave doesn't block bookings

    def test_the_manager_approves_and_the_leave_blocks_bookings(self):
        self.ask()
        row_id = self.db.rows["staff_time_off"][0]["id"]
        self.assertEqual(self.client.post(f"/hr/time-off/{row_id}/decide", headers=self.auth("staff"), json={"decision": "approve"}).status_code, 403)
        mine = self.client.get("/hr/my/time-off", headers=self.auth("hr")).json()
        self.assertEqual([r["name"] for r in mine["to_answer"]], ["Ben Li"])
        approved = self.client.post(f"/hr/time-off/{row_id}/decide", headers=self.auth("hr"), json={"decision": "approve", "note": "Enjoy"})
        self.assertEqual(approved.json()["time_off"]["status"], "approved")
        self.assertEqual(len(engine.time_off(OTHER)), 1)
        self.assertTrue(any(n["title"] == "Your annual leave was approved" and n["worker_id"] == OTHER for n in self.db.rows["operations_worker_notifications"]))
        balance = next(b for b in self.client.get("/hr/my/time-off", headers=self.auth("staff")).json()["balances"] if b["key"] == "annual")
        self.assertEqual((balance["used"], balance["left"]), (4.0, 8.0))

    def test_overlaps_past_dates_weekends_and_half_days_are_checked(self):
        self.ask()
        self.assertEqual(self.ask(start_date="2026-11-12", end_date="2026-11-16").status_code, 409)
        self.assertEqual(self.ask(start_date="2026-10-20", end_date="2026-10-21").status_code, 422)
        sick_afterwards = self.client.post("/hr/my/time-off", headers=self.auth("staff"), json={"leave_type": "sick", "start_date": "2026-10-28"})
        self.assertEqual(sick_afterwards.status_code, 201)
        self.assertEqual(self.ask(start_date="2026-11-14", end_date="2026-11-15").status_code, 422)  # a weekend
        self.assertEqual(self.ask(start_date="2026-11-16", end_date="2026-11-17", half_day="morning").status_code, 422)
        half = self.ask(start_date="2026-11-16", end_date="2026-11-16", half_day="morning")
        self.assertEqual(half.status_code, 201)
        self.assertEqual(self.db.rows["staff_time_off"][-1]["days"], 0.5)

    def test_cancelling_and_hr_recording_leave(self):
        self.ask()
        row_id = self.db.rows["staff_time_off"][0]["id"]
        self.client.post(f"/hr/my/time-off/{row_id}/cancel", headers=self.auth("staff"))
        self.assertEqual(self.db.rows["staff_time_off"][0]["status"], "cancelled")
        recorded = self.client.post(f"/hr/people/{OTHER}/time-off", headers=self.auth("hr"),
                                    json={"leave_type": "sick", "start_date": "2026-10-26", "end_date": "2026-10-27"})
        self.assertEqual(recorded.json()["time_off"]["status"], "approved")
        calendar = self.client.get("/hr/time-off?month=2026-10", headers=self.auth("hr")).json()
        self.assertEqual([(l["name"], l["type_name"]) for l in calendar["leave"]], [("Ben Li", "Sick leave")])
        self.assertEqual(self.client.get("/hr/time-off", headers=self.auth("staff")).status_code, 403)

    def test_settings_allowances_working_days_and_holidays(self):
        saved = self.client.put("/hr/leave-settings", headers=self.auth("hr"), json={
            "leave_types": [{"key": "annual", "yearly_days": 15.4}], "work_days": [0, 1, 2, 3, 4, 5],
            "holidays": [{"day": "2026-12-25", "name": "Christmas", "region": "nigeria"}]}).json()
        self.assertEqual(next(t for t in saved["leave_types"] if t["key"] == "annual")["yearly_days"], 15.5)
        self.assertEqual(saved["work_days"], [0, 1, 2, 3, 4, 5])
        self.assertEqual([h["name"] for h in saved["holidays"]], ["Christmas"])
        self.assertEqual(self.client.put("/hr/leave-settings", headers=self.auth("hr"), json={"work_days": []}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
