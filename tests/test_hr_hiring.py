"""HR and hiring H1 (docs/HR_AND_HIRING_PLAN.md): jobs, the careers API, applying with a CV, the candidate's private
status link, HR access and the 12-month retention."""
from __future__ import annotations

import base64
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.hr import router as hr_router
from app.hr import service as hr
from tests.test_store_team import ADMIN, WORKER, OTHER, Db

NOW = datetime(2026, 11, 2, 2, 0, tzinfo=timezone.utc)
PDF = base64.b64encode(b"%PDF-1.7 a short CV").decode()


def staff_for(token: str | None):
    return {"admin": {"user_id": ADMIN, "role": "platform_admin"}, "hr": {"user_id": WORKER, "role": "worker"},
            "staff": {"user_id": OTHER, "role": "worker"}}.get((token or "").replace("Bearer ", ""))


class HrCase(unittest.TestCase):
    def setUp(self):
        self.db = Db({"fayfort_workers": [
            {"user_id": WORKER, "status": "active", "staff_role": "staff", "hr_access": True},
            {"user_id": OTHER, "status": "active", "staff_role": "staff", "hr_access": False}]})
        self.previous = commerce_db.client
        commerce_db.client = self.db
        self.clock = patch.object(hr, "now_utc", return_value=NOW)
        self.clock.start()
        app = FastAPI()
        app.include_router(hr_router.create_hr_router(staff_for))
        self.client = TestClient(app)

    def tearDown(self):
        self.clock.stop()
        commerce_db.client = self.previous

    def auth(self, who: str) -> dict:
        return {"Authorization": f"Bearer {who}"}

    def open_job(self, **extra) -> dict:
        created = self.client.post("/hr/jobs", headers=self.auth("hr"), json={
            "title": "Sourcing agent", "department": "sourcing", "summary": "Find the right suppliers in Guangzhou "
            "for members and check the goods before they ship.", "duties": ["Search markets and factories"],
            "requirements": ["Fluent Mandarin"], "questions": [
                {"label": "Have you worked in Baima market?", "kind": "yes_no"},
                {"label": "Which shift suits you?", "kind": "choice", "options": ["Morning", "Afternoon"]}],
            **extra})
        self.assertEqual(created.status_code, 201, created.text)
        job = created.json()["job"]
        opened = self.client.post(f"/hr/jobs/{job['id']}/status", headers=self.auth("hr"), json={"status": "open"})
        self.assertEqual(opened.status_code, 200, opened.text)
        return opened.json()["job"]

    def application(self, **extra) -> dict:
        body = {"full_name": "Amaka Obi", "email": "Amaka@Example.com", "phone": "+234 800 000 0000",
                "location": "Lagos, Nigeria", "languages": "English, Mandarin", "keep_details": True,
                "answers": [{"id": "q1", "answer": True}, {"id": "q2", "answer": "Morning"}],
                "cv_name": "amaka-cv.pdf", "cv_type": "application/pdf", "cv_base64": PDF}
        body.update(extra)
        return body


class JobTests(HrCase):
    def test_hr_staff_create_and_open_a_job_and_it_shows_on_the_careers_page(self):
        job = self.open_job(pay_range="8,000 to 10,000 CNY a month")
        self.assertEqual((job["slug"], job["status"]), ("sourcing-agent", "open"))
        public = self.client.get("/public/careers/jobs").json()["jobs"]
        self.assertEqual([j["title"] for j in public], ["Sourcing agent"])
        self.assertIsNone(public[0]["pay_range"])  # only shown when ticked
        self.assertEqual(public[0]["location_label"], "Guangzhou office")
        self.assertNotIn("created_by", public[0])

    def test_a_job_needs_its_description_before_it_opens(self):
        job = self.client.post("/hr/jobs", headers=self.auth("hr"), json={"title": "Store assistant"}).json()["job"]
        refused = self.client.post(f"/hr/jobs/{job['id']}/status", headers=self.auth("hr"), json={"status": "open"})
        self.assertEqual(refused.status_code, 422)
        self.assertIn("short description", refused.json()["detail"])
        self.assertEqual(self.client.get("/public/careers/jobs").json()["jobs"], [])

    def test_only_hr_staff_the_ceo_and_the_owner_can_hire(self):
        self.assertEqual(self.client.get("/hr/jobs", headers=self.auth("staff")).status_code, 403)
        self.assertEqual(self.client.get("/hr/jobs").status_code, 403)
        self.assertTrue(self.client.get("/hr/me", headers=self.auth("hr")).json()["can_hire"])
        self.assertFalse(self.client.get("/hr/me", headers=self.auth("staff")).json()["can_hire"])
        self.db.rows["fayfort_workers"][1]["staff_role"] = "ceo"
        self.assertEqual(self.client.get("/hr/jobs", headers=self.auth("staff")).status_code, 200)

    def test_the_owner_gives_and_removes_hr_access(self):
        with patch("app.workforce.team.people", return_value={OTHER: {"name": "Ada"}}):
            self.assertEqual(self.client.put(f"/hr/access/{OTHER}", headers=self.auth("hr"),
                                             json={"hr_access": True}).status_code, 403)
            given = self.client.put(f"/hr/access/{OTHER}", headers=self.auth("admin"), json={"hr_access": True})
        self.assertEqual(given.status_code, 200)
        self.assertTrue(next(w for w in given.json()["workers"] if w["user_id"] == OTHER)["hr_access"])
        self.assertTrue(self.client.get("/hr/me", headers=self.auth("staff")).json()["can_hire"])


class ApplyTests(HrCase):
    def test_applying_saves_the_cv_privately_emails_a_status_link_and_shows_the_status(self):
        job = self.open_job()
        sent = self.client.post(f"/public/careers/jobs/{job['slug']}/apply", json=self.application())
        self.assertEqual(sent.status_code, 201, sent.text)
        token = sent.json()["status_token"]
        candidate = self.db.rows["hr_candidates"][0]
        self.assertEqual((candidate["email"], candidate["retain_until"]), ("amaka@example.com", "2027-11-02"))
        application = self.db.rows["hr_applications"][0]
        self.assertEqual(application["token_hash"], hr.hash_token(token))
        self.assertNotIn(token, str(application))
        self.assertTrue(application["cv_path"].startswith("cvs/2026/11/"))
        self.assertEqual(self.db.uploads[0][0], application["cv_path"])
        self.assertEqual([a["answer"] for a in application["answers"]], ["Yes", "Morning"])
        email = self.db.rows["email_outbox"][0]
        self.assertEqual((email["to_email"], email["template"]), ("amaka@example.com", "hr_received"))
        self.assertIn(f"https://www.fayfort.com/careers/status/{token}", email["payload"]["html"])

        status = self.client.get(f"/public/careers/status/{token}").json()["application"]
        self.assertEqual((status["first_name"], status["stage"], status["job_title"]), ("Amaka", "applied", "Sourcing agent"))
        self.assertEqual([s["state"] for s in status["steps"]], ["current", "todo", "todo", "todo", "todo"])
        self.assertNotIn("email", status)
        self.assertEqual(self.client.get("/public/careers/status/not-a-real-token").status_code, 404)

    def test_the_cv_must_really_be_a_pdf_or_word_file_and_5_mb_or_less(self):
        job = self.open_job()
        fake = base64.b64encode(b"MZ this is not a pdf").decode()
        refused = self.client.post(f"/public/careers/jobs/{job['slug']}/apply", json=self.application(cv_base64=fake))
        self.assertEqual(refused.status_code, 415)
        big = base64.b64encode(b"%PDF-" + b"0" * (5 * 1024 * 1024)).decode()
        self.assertEqual(self.client.post(f"/public/careers/jobs/{job['slug']}/apply",
                                          json=self.application(cv_base64=big)).status_code, 413)
        self.assertEqual(self.db.rows.get("hr_applications", []), [])

    def test_required_answers_consent_and_one_application_per_role(self):
        job = self.open_job()
        url = f"/public/careers/jobs/{job['slug']}/apply"
        self.assertIn("Baima", self.client.post(url, json=self.application(answers=[])).json()["detail"])
        self.assertEqual(self.client.post(url, json=self.application(keep_details=False)).status_code, 422)
        self.assertEqual(self.client.post(url, json=self.application()).status_code, 201)
        again = self.client.post(url, json=self.application(email="amaka@example.com"))
        self.assertEqual(again.status_code, 409)
        self.assertEqual(len(self.db.rows["hr_candidates"]), 1)

    def test_the_hidden_field_and_the_robot_check(self):
        job = self.open_job()
        url = f"/public/careers/jobs/{job['slug']}/apply"
        self.assertEqual(self.client.post(url, json=self.application(website="spam.example")).json(), {"received": True})
        self.assertEqual(self.db.rows.get("hr_applications", []), [])
        with patch.object(hr_router.settings, "TURNSTILE_SECRET_KEY", "secret"), \
                patch.object(hr_router.httpx, "post", return_value=SimpleNamespace(json=lambda: {"success": False})):
            self.assertEqual(self.client.post(url, json=self.application(captcha_token="bad")).status_code, 400)
        with patch.object(hr_router.settings, "TURNSTILE_SECRET_KEY", "secret"), \
                patch.object(hr_router.httpx, "post", return_value=SimpleNamespace(json=lambda: {"success": True})):
            self.assertEqual(self.client.post(url, json=self.application(captcha_token="ok")).status_code, 201)

    def test_closed_roles_take_no_applications(self):
        job = self.open_job()
        self.client.post(f"/hr/jobs/{job['id']}/status", headers=self.auth("hr"), json={"status": "closed"})
        self.assertEqual(self.client.post(f"/public/careers/jobs/{job['slug']}/apply",
                                          json=self.application()).status_code, 404)


class PipelineAndPrivacyTests(HrCase):
    def applied(self) -> tuple[str, str]:
        job = self.open_job()
        token = self.client.post(f"/public/careers/jobs/{job['slug']}/apply", json=self.application()).json()["status_token"]
        return token, self.db.rows["hr_applications"][0]["id"]

    def test_hr_sees_the_application_moves_it_and_the_candidate_sees_the_new_stage(self):
        token, application_id = self.applied()
        listed = self.client.get("/hr/applications", headers=self.auth("hr")).json()["applications"]
        self.assertEqual((listed[0]["name"], listed[0]["job_title"]), ("Amaka Obi", "Sourcing agent"))
        detail = self.client.get(f"/hr/applications/{application_id}", headers=self.auth("hr")).json()
        self.assertNotIn("token_hash", detail["application"])
        moved = self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"),
                                 json={"stage": "interview"})
        self.assertEqual(moved.json()["application"]["stage"], "interview")
        steps = self.client.get(f"/public/careers/status/{token}").json()["application"]["steps"]
        self.assertEqual([s["state"] for s in steps], ["done", "done", "current", "todo", "todo"])
        no_reason = self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"),
                                     json={"stage": "not_moving_forward"})
        self.assertEqual(no_reason.status_code, 422)
        self.client.post(f"/hr/applications/{application_id}/notes", headers=self.auth("hr"), json={"text": "Strong call"})
        kinds = [e["kind"] for e in self.client.get(f"/hr/applications/{application_id}",
                                                    headers=self.auth("hr")).json()["events"]]
        self.assertEqual(kinds, ["applied", "email_sent", "stage_changed", "email_sent", "note"])

    def test_opening_a_cv_is_recorded(self):
        _token, application_id = self.applied()
        bucket = SimpleNamespace(create_signed_url=lambda path, seconds: {"signedURL": "https://x.supabase.co/cv?token=1"})
        with patch.object(Db, "storage", SimpleNamespace(from_=lambda _b: bucket)):
            url = self.client.get(f"/hr/applications/{application_id}/cv", headers=self.auth("hr")).json()["url"]
        self.assertTrue(url.startswith("https://"))
        self.assertIn("cv_viewed", [e["kind"] for e in self.db.rows["hr_application_events"]])
        self.assertIn("hr.cv.viewed", [a["action"] for a in self.db.rows["commerce_admin_audit"]])

    def test_the_candidate_can_withdraw_and_delete_their_details(self):
        token, _application_id = self.applied()
        withdrawn = self.client.post(f"/public/careers/status/{token}/withdraw").json()["application"]
        self.assertEqual(withdrawn["stage"], "withdrew")
        self.assertEqual(self.client.post(f"/public/careers/status/{token}/delete").json(), {"deleted": True})
        candidate = self.db.rows["hr_candidates"][0]
        self.assertEqual((candidate["email"], candidate["full_name"], candidate["phone"]), (None, None, None))
        application = self.db.rows["hr_applications"][0]
        self.assertEqual((application["cv_path"], application["token_hash"], application["answers"]), (None, None, []))
        self.assertEqual(self.db.uploads, [])
        self.assertEqual(self.client.get(f"/public/careers/status/{token}").status_code, 404)

    def test_details_are_anonymised_after_12_months_unless_hired(self):
        self.applied()
        self.db.rows["hr_candidates"][0]["retain_until"] = "2026-11-01"
        self.assertEqual(hr.anonymise_expired(), 1)
        self.assertIsNone(self.db.rows["hr_candidates"][0]["email"])
        self.assertEqual(hr.anonymise_expired(), 0)


class StageEmailTests(HrCase):
    def applied(self) -> tuple[str, str]:
        job = self.open_job(trial_task=True, trial_paid=True)
        token = self.client.post(f"/public/careers/jobs/{job['slug']}/apply", json=self.application()).json()["status_token"]
        return token, self.db.rows["hr_applications"][0]["id"]

    def test_moving_a_candidate_emails_them_a_fresh_link_and_old_links_keep_working(self):
        token, application_id = self.applied()
        self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"), json={"stage": "trial_task"})
        email = self.db.rows["email_outbox"][-1]
        self.assertEqual((email["template"], email["to_email"]), ("hr_stage_trial_task", "amaka@example.com"))
        self.assertIn("and it's paid", email["payload"]["text"])
        fresh = email["payload"]["text"].split("/careers/status/")[1].split()[0]
        self.assertNotEqual(fresh, token)
        for link in (token, fresh):
            self.assertEqual(self.client.get(f"/public/careers/status/{link}").json()["application"]["stage"], "trial_task")

    def test_staff_can_move_without_emailing_and_closing_sends_a_kind_note(self):
        _token, application_id = self.applied()
        self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"),
                         json={"stage": "screening", "notify": False})
        self.assertEqual(len(self.db.rows["email_outbox"]), 1)
        reasons = self.client.get("/hr/applications", headers=self.auth("hr")).json()["close_reasons"]
        self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"),
                         json={"stage": "not_moving_forward", "reason": reasons[0]})
        email = self.db.rows["email_outbox"][-1]
        self.assertEqual(email["template"], "hr_stage_not_moving_forward")
        self.assertNotIn(reasons[0], email["payload"]["text"])  # the reason stays inside FayFort
        self.assertEqual(self.db.rows["hr_applications"][0]["close_reason"], reasons[0])

    def test_deleting_details_removes_every_link(self):
        token, application_id = self.applied()
        self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"), json={"stage": "screening"})
        self.client.post(f"/public/careers/status/{token}/delete")
        self.assertEqual(self.db.rows["hr_status_links"], [])


if __name__ == "__main__":
    unittest.main()
