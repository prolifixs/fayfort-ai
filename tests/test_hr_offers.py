"""HR and hiring H4 (docs/HR_AND_HIRING_PLAN.md): the offer letter, accepting by link with a typed signature,
declining, expiry, and Hire turning the candidate into a staff invitation and an employment record."""
from __future__ import annotations

import unittest
from datetime import timedelta
from unittest.mock import patch

from app.hr import offers
from tests.test_hr_hiring import NOW, HrCase

NEW_WORKER = "00000000-0000-0000-0000-0000000000d1"


class OfferCase(HrCase):
    def applied(self) -> tuple[str, str]:
        job = self.open_job()
        token = self.client.post(f"/public/careers/jobs/{job['slug']}/apply", json=self.application()).json()["status_token"]
        return token, self.db.rows["hr_applications"][0]["id"]

    def send(self, application_id: str, **extra):
        return self.client.post(f"/hr/applications/{application_id}/offers", headers=self.auth("hr"), json={
            "departments": ["sourcing"], "start_date": "2026-11-16", "hours_per_week": 40,
            "extra_terms": "You'll get a FayFort phone for work.", **extra})


class OfferTests(OfferCase):
    def test_the_offer_letter_is_filled_in_and_says_pay_is_agreed_separately(self):
        _token, application_id = self.applied()
        preview = self.client.post(f"/hr/applications/{application_id}/offer-preview", headers=self.auth("hr"),
                                   json={"departments": ["sourcing"], "start_date": "2026-11-16"}).json()
        letter = preview["letter"]
        for text in ("Dear Amaka Obi", "role of Sourcing agent", "Team: Sourcing desk", "Start date: 16 November 2026",
                     "Probation: 3 months", "Pay and how you are paid are agreed with you separately", "open until 9 November 2026"):
            self.assertIn(text, letter)
        self.assertNotIn("{", letter)
        self.assertEqual(self.client.post(f"/hr/applications/{application_id}/offer-preview", headers=self.auth("hr"),
                                          json={"start_date": "2026-10-01"}).status_code, 422)

    def test_sending_moves_to_offer_emails_a_link_and_the_candidate_accepts_with_their_name(self):
        token, application_id = self.applied()
        sent = self.send(application_id)
        self.assertEqual(sent.status_code, 201, sent.text)
        self.assertEqual(self.db.rows["hr_applications"][0]["stage"], "offer")
        self.assertEqual(self.db.rows["email_outbox"][-1]["template"], "hr_offer_sent")
        view = self.client.get(f"/public/careers/status/{token}").json()["application"]
        self.assertEqual(view["offer"]["status"], "sent")
        self.assertIn("FayFort phone", view["offer"]["letter"])
        wrong = self.client.post(f"/public/careers/status/{token}/offer/accept", json={"signature": "Amaka"})
        self.assertEqual(wrong.status_code, 422)
        self.assertIn("Amaka Obi", wrong.json()["detail"])
        accepted = self.client.post(f"/public/careers/status/{token}/offer/accept", json={"signature": "  amaka  OBI "},
                                    headers={"cf-connecting-ip": "203.0.113.9"})
        self.assertEqual(accepted.json()["application"]["offer"]["status"], "accepted")
        offer = self.db.rows["hr_offers"][0]
        self.assertEqual((offer["signature_name"], offer["signature_ip"]), ("amaka  OBI", "203.0.113.9"))
        self.assertEqual(self.db.rows["email_outbox"][-1]["template"], "hr_offer_accepted")
        self.assertTrue(any(n["notification_type"] == "hiring" for n in self.db.rows["operations_worker_notifications"]))

    def test_one_open_offer_at_a_time_and_withdrawing_tells_the_candidate(self):
        _token, application_id = self.applied()
        self.send(application_id)
        self.assertEqual(self.send(application_id).status_code, 409)
        offer_id = self.db.rows["hr_offers"][0]["id"]
        self.client.post(f"/hr/offers/{offer_id}/withdraw", headers=self.auth("hr"))
        self.assertEqual(self.db.rows["email_outbox"][-1]["template"], "hr_offer_withdrawn")
        self.assertEqual(self.send(application_id).status_code, 201)

    def test_declining_and_expiry(self):
        token, application_id = self.applied()
        self.send(application_id, expires_in_days=2)
        self.client.post(f"/public/careers/status/{token}/offer/decline", json={"reason": "I took another job"})
        self.assertEqual(self.db.rows["hr_offers"][0]["status"], "declined")
        self.client.post(f"/hr/applications/{application_id}/stage", headers=self.auth("hr"),
                         json={"stage": "interview", "notify": False})
        self.send(application_id, expires_in_days=2)
        self.assertEqual(offers.expire(NOW + timedelta(days=3)), 1)
        self.assertEqual(self.db.rows["hr_offers"][1]["status"], "expired")
        late = self.client.post(f"/public/careers/status/{token}/offer/accept", json={"signature": "Amaka Obi"})
        self.assertEqual(late.status_code, 409)

    def test_hr_can_change_the_letter_template_with_known_placeholders_only(self):
        bad = self.client.put("/hr/settings", headers=self.auth("hr"), json={"offer_template": "Hi {name}, pay {salary}"})
        self.assertEqual(bad.status_code, 422)
        self.client.put("/hr/settings", headers=self.auth("hr"), json={"offer_template": "Hi {name}, welcome as {job_title}.",
                                                                       "probation_months": 6})
        _token, application_id = self.applied()
        letter = self.client.post(f"/hr/applications/{application_id}/offer-preview", headers=self.auth("hr"),
                                  json={"start_date": "2026-11-16"}).json()
        self.assertEqual(letter["letter"], "Hi Amaka Obi, welcome as Sourcing agent.")
        self.assertEqual(letter["offer"]["probation_months"], 6)


class HireTests(OfferCase):
    def accepted(self) -> str:
        token, application_id = self.applied()
        self.send(application_id)
        self.client.post(f"/public/careers/status/{token}/offer/accept", json={"signature": "Amaka Obi"})
        return application_id

    def test_hire_needs_an_accepted_offer(self):
        _token, application_id = self.applied()
        self.send(application_id)
        refused = self.client.post(f"/hr/applications/{application_id}/hire", headers=self.auth("hr"))
        self.assertEqual(refused.status_code, 409)

    def test_hire_sends_the_staff_invitation_and_starts_the_employment_record(self):
        application_id = self.accepted()
        calls = []

        def fake_invite(actor, payload):
            calls.append((actor, payload.email, payload.staff_role, payload.job_title, payload.departments))
            return {"user_id": NEW_WORKER, "kind": "new_account"}

        with patch("app.workforce.onboarding.invite", side_effect=fake_invite):
            hired = self.client.post(f"/hr/applications/{application_id}/hire", headers=self.auth("hr"))
        self.assertEqual(hired.status_code, 200, hired.text)
        self.assertEqual(calls[0][1:], ("amaka@example.com", "staff", "Sourcing agent", ["sourcing"]))
        employment = self.db.rows["hr_employment"][0]
        self.assertEqual((employment["worker_id"], employment["start_date"], employment["probation_end"], employment["hours_per_week"]),
                         (NEW_WORKER, "2026-11-16", "2027-02-16", 40))
        application = self.db.rows["hr_applications"][0]
        self.assertEqual((application["stage"], application["hired_worker_id"]), ("hired", NEW_WORKER))
        # The signed offer is the first document on their record, and their timeline starts.
        self.assertEqual((self.db.rows["hr_documents"][0]["kind"], self.db.rows["hr_documents"][0]["title"]), ("offer", "Signed offer: Sourcing agent"))
        self.assertEqual(self.db.rows["hr_employment_events"][0]["kind"], "hired")
        again = self.client.post(f"/hr/applications/{application_id}/hire", headers=self.auth("hr"))
        self.assertEqual(again.status_code, 409)

    def test_an_onboarding_problem_is_shown_and_nothing_changes(self):
        application_id = self.accepted()
        from app.workforce import onboarding
        with patch("app.workforce.onboarding.invite", side_effect=onboarding.OnboardingError("This account is already on the team.")):
            refused = self.client.post(f"/hr/applications/{application_id}/hire", headers=self.auth("hr"))
        self.assertEqual((refused.status_code, refused.json()["detail"]), (409, "This account is already on the team."))
        self.assertEqual(self.db.rows["hr_applications"][0]["stage"], "offer")
        self.assertEqual(self.db.rows.get("hr_employment", []), [])

    def test_hired_people_are_kept_when_details_expire(self):
        application_id = self.accepted()
        with patch("app.workforce.onboarding.invite", return_value={"user_id": NEW_WORKER, "kind": "existing_account"}):
            self.client.post(f"/hr/applications/{application_id}/hire", headers=self.auth("hr"))
        self.db.rows["hr_candidates"][0]["retain_until"] = "2026-01-01"
        from app.hr import service
        self.assertEqual(service.anonymise_expired(), 0)
        self.assertEqual(self.db.rows["hr_candidates"][0]["email"], "amaka@example.com")


if __name__ == "__main__":
    unittest.main()
