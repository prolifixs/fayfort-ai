"""HR and hiring H3 (docs/HR_AND_HIRING_PLAN.md): interviews booked through the booking engine, the candidate picking
and changing a time, reminders, and blind scorecards."""
from __future__ import annotations

import unittest
from datetime import timedelta
from unittest.mock import patch

from app.bookings import engine
from app.hr import interviews
from tests.test_hr_hiring import NOW, OTHER, WORKER, HrCase


class InterviewCase(HrCase):
    def setUp(self):
        super().setUp()
        self.engine_clock = patch.object(engine, "now_utc", return_value=NOW)
        self.engine_clock.start()
        self.people = patch("app.workforce.team.people", side_effect=lambda ids: {i: {"name": {WORKER: "Ada", OTHER: "Ben"}.get(i, "X")} for i in ids})
        self.people.start()

    def tearDown(self):
        self.people.stop()
        self.engine_clock.stop()
        super().tearDown()

    def applied(self) -> tuple[str, str]:
        job = self.open_job(skills=["Mandarin", "Market knowledge"])
        token = self.client.post(f"/public/careers/jobs/{job['slug']}/apply", json=self.application()).json()["status_token"]
        return token, self.db.rows["hr_applications"][0]["id"]

    def propose(self, application_id: str, **extra):
        return self.client.post(f"/hr/applications/{application_id}/interviews", headers=self.auth("hr"),
                                json={"interviewer_ids": [WORKER, OTHER], "minutes": 45, "window_days": 7,
                                      "call_link": "https://meet.google.com/abc-defg-hij", **extra})

    def latest_link(self) -> str:
        return self.db.rows["email_outbox"][-1]["payload"]["text"].split("/careers/status/")[1].split()[0]


class ProposeAndPickTests(InterviewCase):
    def test_the_candidate_picks_a_time_everyone_is_free_and_each_interviewer_gets_a_booking(self):
        token, application_id = self.applied()
        # Ben is away all of Tuesday 3 Nov (China time), so only times both can do are offered.
        self.db.rows.setdefault("staff_time_off", []).append({"status": "approved", "worker_id": OTHER, "starts_at": "2026-11-02T16:00:00+00:00",
                                                              "ends_at": "2026-11-03T16:00:00+00:00"})
        made = self.propose(application_id)
        self.assertEqual(made.status_code, 201, made.text)
        self.assertEqual(self.db.rows["hr_applications"][0]["stage"], "interview")
        self.assertEqual(self.db.rows["email_outbox"][-1]["template"], "hr_interview_pick")
        status = self.client.get(f"/public/careers/status/{token}").json()["application"]
        offered = status["interview"]["slots"]
        self.assertTrue(offered)
        self.assertTrue(all(not s["starts_at"].startswith("2026-11-03") for s in offered))
        self.assertIsNone(status["interview"]["call_link"])  # shown once the time is booked

        picked = self.client.post(f"/public/careers/status/{token}/interview",
                                  json={"starts_at": offered[0]["starts_at"], "time_zone": "Africa/Lagos"})
        self.assertEqual(picked.status_code, 200, picked.text)
        bookings = self.db.rows["bookings"]
        self.assertEqual(sorted(b["host_id"] for b in bookings), sorted([WORKER, OTHER]))
        self.assertTrue(all(b["kind"] == "interview" and b["status"] == "confirmed" and b["member_id"] is None for b in bookings))
        self.assertEqual(bookings[0]["topic"], "Amaka Obi · Sourcing agent")
        interview = self.db.rows["hr_interviews"][0]
        self.assertEqual((interview["status"], interview["candidate_time_zone"]), ("scheduled", "Africa/Lagos"))
        email = self.db.rows["email_outbox"][-1]
        self.assertEqual(email["template"], "hr_interview_scheduled")
        self.assertIn("(Africa/Lagos)", email["payload"]["text"])
        self.assertIn("https://meet.google.com/abc-defg-hij", email["payload"]["text"])
        self.assertEqual(len([n for n in self.db.rows["operations_worker_notifications"]]), 2)

    def test_a_time_that_is_not_offered_is_refused(self):
        token, application_id = self.applied()
        self.propose(application_id)
        refused = self.client.post(f"/public/careers/status/{token}/interview", json={"starts_at": "2026-11-08T03:00:00+00:00"})
        self.assertEqual(refused.status_code, 409)  # a Sunday
        self.assertEqual(self.db.rows.get("bookings", []), [])

    def test_no_common_time_is_explained_and_nothing_is_saved(self):
        _token, application_id = self.applied()
        self.db.rows.setdefault("staff_time_off", []).append({"status": "approved", "worker_id": OTHER, "starts_at": "2026-11-01T00:00:00+00:00",
                                                              "ends_at": "2026-12-31T00:00:00+00:00"})
        refused = self.propose(application_id)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("no common free time", refused.json()["detail"])
        self.assertEqual(self.db.rows["hr_interviews"], [])

    def test_only_hr_arranges_interviews_and_interviewers_must_be_active(self):
        _token, application_id = self.applied()
        self.assertEqual(self.client.post(f"/hr/applications/{application_id}/interviews", headers=self.auth("staff"),
                                          json={"interviewer_ids": [WORKER]}).status_code, 403)
        self.db.rows["fayfort_workers"][1]["status"] = "inactive"
        self.assertEqual(self.propose(application_id).status_code, 422)


class ChangeAndRemindTests(InterviewCase):
    def booked(self) -> tuple[str, str]:
        token, application_id = self.applied()
        self.propose(application_id)
        slot = self.client.get(f"/public/careers/status/{token}").json()["application"]["interview"]["slots"][-1]
        self.client.post(f"/public/careers/status/{token}/interview", json={"starts_at": slot["starts_at"], "time_zone": "Africa/Lagos"})
        return token, application_id

    def test_the_candidate_can_move_the_time_twice_and_bookings_are_released(self):
        token, _application_id = self.booked()
        moved = self.client.post(f"/public/careers/status/{token}/interview/change")
        self.assertEqual(moved.json()["application"]["interview"]["status"], "proposed")
        self.assertTrue(all(b["status"] == "cancelled" for b in self.db.rows["bookings"]))
        slot = moved.json()["application"]["interview"]["slots"][0]
        self.client.post(f"/public/careers/status/{token}/interview", json={"starts_at": slot["starts_at"]})
        self.client.post(f"/public/careers/status/{token}/interview/change")
        slot = self.client.get(f"/public/careers/status/{token}").json()["application"]["interview"]["slots"][0]
        self.client.post(f"/public/careers/status/{token}/interview", json={"starts_at": slot["starts_at"]})
        third = self.client.post(f"/public/careers/status/{token}/interview/change")
        self.assertEqual(third.status_code, 409)
        self.assertIn("moved twice", third.json()["detail"])

    def test_an_interviewer_cancelling_in_bookings_asks_the_candidate_to_pick_again(self):
        token, _application_id = self.booked()
        mine = next(b for b in self.db.rows["bookings"] if b["host_id"] == WORKER and b["status"] == "confirmed")
        engine.cancel(mine, by="staff", reason="Sick")
        self.assertTrue(all(b["status"] == "cancelled" for b in self.db.rows["bookings"]))
        self.assertEqual(self.db.rows["hr_interviews"][0]["status"], "proposed")
        self.assertEqual(self.db.rows["email_outbox"][-1]["template"], "hr_interview_repick")
        with self.assertRaises(engine.BookingError):
            engine.move(next(b for b in self.db.rows["bookings"]), NOW + timedelta(days=3), by="staff")

    def test_reminders_then_the_interview_is_finished_and_interviewers_asked_for_scorecards(self):
        self.booked()
        interview = self.db.rows["hr_interviews"][0]
        starts = engine.parse(interview["starts_at"])
        self.assertEqual(interviews.sweep(starts - timedelta(hours=20))["reminded"], 1)
        self.assertEqual(interviews.sweep(starts - timedelta(hours=19))["reminded"], 0)
        self.assertEqual(interviews.sweep(starts - timedelta(minutes=50))["reminded"], 1)
        templates = [e["template"] for e in self.db.rows["email_outbox"]]
        self.assertIn("hr_interview_reminder_24h", templates)
        self.assertIn("hr_interview_reminder_1h", templates)
        self.assertEqual(interviews.sweep(starts + timedelta(hours=3))["finished"], 1)
        self.assertEqual(self.db.rows["hr_interviews"][0]["status"], "completed")
        self.assertTrue(all(b["status"] == "completed" for b in self.db.rows["bookings"]))
        self.assertTrue(any(n["title"] == "Fill in your scorecard" for n in self.db.rows["operations_worker_notifications"]))

    def test_deleting_details_cancels_the_interview_and_clears_the_name_from_bookings(self):
        token, _application_id = self.booked()
        self.client.post(f"/public/careers/status/{token}/delete")
        self.assertTrue(all(b["status"] == "cancelled" and b["topic"] == "Candidate (details deleted)" for b in self.db.rows["bookings"]))
        self.assertEqual(self.db.rows["hr_interviews"][0]["status"], "cancelled")


class ScorecardTests(InterviewCase):
    def finished(self) -> tuple[str, str]:
        token, application_id = self.applied()
        self.propose(application_id)
        slot = self.client.get(f"/public/careers/status/{token}").json()["application"]["interview"]["slots"][0]
        self.client.post(f"/public/careers/status/{token}/interview", json={"starts_at": slot["starts_at"]})
        interview = self.db.rows["hr_interviews"][0]
        interviews.sweep(engine.parse(interview["ends_at"]) + timedelta(hours=2))
        return interview["id"], application_id

    def score(self, who: str, interview_id: str, decision: str, value: int = 3):
        return self.client.post(f"/hr/interviews/{interview_id}/scorecard", headers=self.auth(who),
                                json={"ratings": {"Mandarin": value, "Market knowledge": value}, "decision": decision, "note": "Good"})

    def test_interviewers_see_each_others_decisions_only_after_submitting(self):
        interview_id, application_id = self.finished()
        first = self.score("hr", interview_id, "yes", 4)
        self.assertEqual(first.status_code, 200, first.text)
        # Ben (staff, interviewer, no HR access) can open the application but not Ada's decision yet.
        ben = self.client.get(f"/hr/applications/{application_id}", headers=self.auth("staff")).json()
        self.assertEqual((ben["scorecards"]["hidden"], ben["scorecards"]["cards"]), (1, []))
        self.assertNotIn("email", ben["candidate"])
        self.assertFalse(ben["can_manage"])
        second = self.score("staff", interview_id, "maybe", 2).json()["scorecards"]
        self.assertEqual(len(second["cards"]), 2)
        self.assertEqual(second["summary"], {"averages": {"Mandarin": 3.0, "Market knowledge": 3.0}, "yes": 1, "maybe": 1, "no": 0})

    def test_scorecards_need_every_skill_and_only_interviewers_can_score(self):
        interview_id, application_id = self.finished()
        missing = self.client.post(f"/hr/interviews/{interview_id}/scorecard", headers=self.auth("hr"),
                                   json={"ratings": {"Mandarin": 4}, "decision": "yes"})
        self.assertEqual(missing.status_code, 422)
        self.assertEqual(self.score("admin", interview_id, "yes").status_code, 403)
        # The owner, who didn't interview, sees all cards at once.
        self.score("hr", interview_id, "yes")
        owner = self.client.get(f"/hr/applications/{application_id}", headers=self.auth("admin")).json()["scorecards"]
        self.assertEqual((len(owner["cards"]), owner["hidden"]), (1, 0))

    def test_people_who_are_neither_hr_nor_interviewers_cannot_open_the_application(self):
        _interview_id, application_id = self.finished()
        self.assertEqual(self.client.get(f"/hr/applications/{application_id}").status_code, 403)
        # Ben stops being an interviewer: he can no longer open it.
        self.db.rows["hr_interview_interviewers"] = [r for r in self.db.rows["hr_interview_interviewers"] if r["worker_id"] != OTHER]
        self.assertEqual(self.client.get(f"/hr/applications/{application_id}", headers=self.auth("staff")).status_code, 403)


if __name__ == "__main__":
    unittest.main()
