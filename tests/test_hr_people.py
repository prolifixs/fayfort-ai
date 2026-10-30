"""HR H5 (docs/HR_AND_HIRING_PLAN.md): people records, documents, policies and My HR."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_hr_hiring import ADMIN, OTHER, WORKER, HrCase
from tests.test_store_team import Db

PDF = b"%PDF-1.7 contract"


class PeopleCase(HrCase):
    def setUp(self):
        super().setUp()
        self.names = patch("app.workforce.team.people",
                           side_effect=lambda ids: {i: {"name": {WORKER: "Ada Eze", OTHER: "Ben Li"}.get(i, "Someone"), "photo_url": None} for i in ids})
        self.names.start()
        self.db.rows["fayfort_workers"][0]["job_title"] = "HR lead"
        self.db.rows["operations_worker_departments"] = [{"worker_id": OTHER, "department": "sourcing"}]

    def tearDown(self):
        self.names.stop()
        super().tearDown()


class RecordTests(PeopleCase):
    def test_a_record_opens_for_people_who_joined_before_hr_and_hr_edits_it(self):
        team = self.client.get("/hr/people", headers=self.auth("hr")).json()["people"]
        self.assertEqual({p["name"] for p in team}, {"Ada Eze", "Ben Li"})
        self.assertFalse(next(p for p in team if p["worker_id"] == OTHER)["has_record"])
        record = self.client.get(f"/hr/people/{OTHER}", headers=self.auth("hr")).json()["person"]
        self.assertEqual((record["status"], record["desks"]), ("active", ["Sourcing desk"]))
        self.assertEqual(record["timeline"][0]["kind"], "record_opened")
        saved = self.client.put(f"/hr/people/{OTHER}", headers=self.auth("hr"), json={
            "job_title": "Senior sourcing agent", "manager_id": WORKER, "start_date": "2026-03-01", "probation_end": "2026-06-01",
            "hours_per_week": 40, "emergency_name": "Mei Li", "emergency_phone": "+86 138 0000 0000"}).json()["person"]
        self.assertEqual((saved["job"]["job_title"], saved["manager_name"]), ("Senior sourcing agent", "Ada Eze"))
        self.assertEqual(self.db.rows["fayfort_workers"][1]["job_title"], "Senior sourcing agent")
        self.assertEqual({e["kind"] for e in saved["timeline"]}, {"record_opened", "job_changed", "details_changed"})
        self.assertEqual(self.client.put(f"/hr/people/{OTHER}", headers=self.auth("hr"), json={"manager_id": OTHER}).status_code, 422)
        self.assertEqual(self.client.get(f"/hr/people/{OTHER}", headers=self.auth("staff")).status_code, 403)

    def test_probation_is_flagged_when_due_then_passed_or_extended(self):
        self.client.put(f"/hr/people/{OTHER}", headers=self.auth("hr"), json={"probation_end": "2026-10-30"})
        self.assertTrue(next(p for p in self.client.get("/hr/people", headers=self.auth("hr")).json()["people"] if p["worker_id"] == OTHER)["probation_due"])
        extended = self.client.post(f"/hr/people/{OTHER}/probation", headers=self.auth("hr"), json={"decision": "extend", "months": 2}).json()["person"]
        self.assertEqual(extended["job"]["probation_end"], "2027-01-02")
        passed = self.client.post(f"/hr/people/{OTHER}/probation", headers=self.auth("hr"), json={"decision": "pass", "note": "Great start"}).json()["person"]
        self.assertTrue(passed["job"]["probation_passed_at"])
        self.assertEqual(self.client.post(f"/hr/people/{OTHER}/probation", headers=self.auth("hr"), json={"decision": "pass"}).status_code, 409)


class DocumentTests(PeopleCase):
    def test_hr_uploads_a_document_the_person_opens_their_own_and_every_opening_is_recorded(self):
        added = self.client.post(f"/hr/people/{OTHER}/documents?kind=contract&title=Employment%20contract&name=contract.pdf",
                                 headers={**self.auth("hr"), "content-type": "application/pdf"}, content=PDF)
        self.assertEqual(added.status_code, 201, added.text)
        doc = self.db.rows["hr_documents"][0]
        self.assertTrue(doc["file_path"].startswith(f"people/{OTHER}/"))
        hidden = self.client.post(f"/hr/people/{OTHER}/documents?kind=other&title=HR%20note&visible=false",
                                  headers={**self.auth("hr"), "content-type": "application/pdf"}, content=PDF)
        self.assertEqual(hidden.status_code, 201)
        bucket = SimpleNamespace(create_signed_url=lambda path, seconds: {"signedURL": "https://x.supabase.co/doc?t=1"})
        with patch.object(Db, "storage", SimpleNamespace(from_=lambda _b: bucket)):
            mine = self.client.get("/hr/my", headers=self.auth("staff")).json()["documents"]
            self.assertEqual([d["title"] for d in mine], ["Employment contract"])
            self.assertEqual(self.client.get(f"/hr/my/documents/{doc['id']}", headers=self.auth("staff")).json()["url"], "https://x.supabase.co/doc?t=1")
            other_doc = self.db.rows["hr_documents"][1]["id"]
            self.assertEqual(self.client.get(f"/hr/my/documents/{other_doc}", headers=self.auth("staff")).status_code, 404)
            self.assertEqual(self.client.get(f"/hr/my/documents/{doc['id']}", headers=self.auth("hr")).status_code, 404)
        self.assertEqual(sum(a["action"] == "hr.document.viewed" for a in self.db.rows["commerce_admin_audit"]), 1)

    def test_only_real_pdf_word_or_images_up_to_10_mb(self):
        bad = self.client.post(f"/hr/people/{OTHER}/documents?kind=contract&title=x",
                               headers={**self.auth("hr"), "content-type": "application/pdf"}, content=b"MZ not a pdf")
        self.assertEqual(bad.status_code, 415)
        zip_ = self.client.post(f"/hr/people/{OTHER}/documents?kind=contract&title=x",
                                headers={**self.auth("hr"), "content-type": "application/zip"}, content=b"PK\x03\x04")
        self.assertEqual(zip_.status_code, 415)
        self.assertEqual(self.client.post(f"/hr/people/{OTHER}/documents?kind=passport&title=x",
                                          headers={**self.auth("hr"), "content-type": "application/pdf"}, content=PDF).status_code, 422)


class PolicyTests(PeopleCase):
    def test_publishing_asks_everyone_to_accept_and_a_new_version_asks_again(self):
        created = self.client.post("/hr/policies", headers=self.auth("hr"), json={
            "title": "Customer data handling", "summary": "Keep members' details private.",
            "body": "Use member details only to do your FayFort work."}).json()["policy"]
        self.assertEqual((created["status"], created["version"]), ("draft", 0))
        self.assertEqual(self.client.get("/hr/my", headers=self.auth("staff")).json()["policies"], [])
        published = self.client.post(f"/hr/policies/{created['id']}/publish", headers=self.auth("hr")).json()["policy"]
        self.assertEqual(published["version"], 1)
        self.assertEqual(len([n for n in self.db.rows["operations_worker_notifications"] if n["title"].startswith("Please read")]), 2)
        mine = self.client.get("/hr/my", headers=self.auth("staff")).json()["policies"]
        self.assertIsNone(mine[0]["accepted_at"])
        text = self.client.get(f"/hr/my/policies/{created['id']}", headers=self.auth("staff")).json()["policy"]
        self.assertIn("member details", text["body"])
        accepted = self.client.post(f"/hr/my/policies/{created['id']}/accept", headers=self.auth("staff"), json={"version": 1}).json()["policies"]
        self.assertTrue(accepted[0]["accepted_at"])
        self.assertEqual(self.client.get("/hr/policies", headers=self.auth("hr")).json()["policies"][0]["accepted"], 1)
        # Edits stay a draft change until published again; then everyone accepts version 2.
        self.client.put(f"/hr/policies/{created['id']}", headers=self.auth("hr"), json={"title": "Customer data handling",
                        "body": "Use member details only to do your FayFort work. Never share screenshots."})
        self.assertIn("member details", self.client.get(f"/hr/my/policies/{created['id']}", headers=self.auth("staff")).json()["policy"]["body"])
        self.assertNotIn("screenshots", self.client.get(f"/hr/my/policies/{created['id']}", headers=self.auth("staff")).json()["policy"]["body"])
        self.client.post(f"/hr/policies/{created['id']}/publish", headers=self.auth("hr"))
        again = self.client.get("/hr/my", headers=self.auth("staff")).json()["policies"][0]
        self.assertEqual((again["accepted_at"], again["accepted_before"]), (None, True))
        stale = self.client.post(f"/hr/my/policies/{created['id']}/accept", headers=self.auth("staff"), json={"version": 1})
        self.assertEqual(stale.status_code, 409)
        who = self.client.get(f"/hr/policies/{created['id']}/acknowledgements", headers=self.auth("hr")).json()
        self.assertEqual((who["version"], [p["accepted_at"] for p in who["people"]]), (2, [None, None]))

    def test_nothing_to_publish_and_my_details(self):
        created = self.client.post("/hr/policies", headers=self.auth("hr"), json={"title": "Working hours", "body": "Clock in when you start your shift."}).json()["policy"]
        self.client.post(f"/hr/policies/{created['id']}/publish", headers=self.auth("hr"))
        self.assertEqual(self.client.post(f"/hr/policies/{created['id']}/publish", headers=self.auth("hr")).status_code, 409)
        mine = self.client.put("/hr/my/details", headers=self.auth("staff"), json={"preferred_name": "Ben", "city": "Guangzhou"}).json()
        self.assertEqual((mine["personal"]["preferred_name"], mine["personal"]["city"]), ("Ben", "Guangzhou"))
        refused = self.client.put("/hr/my/details", headers=self.auth("staff"), json={"job_title": "CEO"})
        self.assertEqual(refused.status_code, 422)


if __name__ == "__main__":
    unittest.main()
