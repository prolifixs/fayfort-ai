from __future__ import annotations
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.automations.router import create_automations_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
AUTOMATION = "00000000-0000-0000-0000-000000000002"

class AutomationApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_automations_router())
        self.client = TestClient(app)

    @patch("app.automations.router.publish_business_event")
    @patch("app.automations.router.create_automation")
    @patch("app.automations.router.has_trusted_business_identity", return_value=True)
    def test_create_is_disabled_and_limited_to_internal_test_action(self, identity, create, event):
        create.return_value = {"id": AUTOMATION, "enabled": False, "action_type":"record_test_run"}
        response = self.client.post(f"/businesses/{BUSINESS}/automations", headers={"Authorization":"Bearer test"}, json={"name":"Test flow", "trigger_type":"manual_test"})
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["automation"]["enabled"])
        self.assertEqual(create.call_args.args[1]["action_type"], "record_test_run")
        rejected = self.client.post(f"/businesses/{BUSINESS}/automations", headers={"Authorization":"Bearer test"}, json={"name":"Unsafe", "trigger_type":"manual_test", "action_type":"send_external_message"})
        self.assertEqual(rejected.status_code, 422)

    @patch("app.automations.router.run_automation")
    @patch("app.automations.router.has_trusted_business_identity", return_value=True)
    def test_dry_run_does_not_enable_or_execute_side_effects(self, identity, run):
        run.return_value = {"status":"dry_run", "duplicate":False, "result":{"side_effect":"none"}}
        response = self.client.post(f"/businesses/{BUSINESS}/automations/{AUTOMATION}/dry-run", headers={"Authorization":"Bearer test"}, json={"idempotency_key":"dry-1"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(run.call_args.kwargs["dry_run"])
        self.assertEqual(response.json()["result"]["side_effect"], "none")

    @patch("app.automations.router.run_automation")
    @patch("app.automations.router.has_trusted_business_identity", return_value=True)
    def test_disabled_automation_execution_is_conflict(self, identity, run):
        run.return_value = {"error":"disabled"}
        response = self.client.post(f"/businesses/{BUSINESS}/automations/{AUTOMATION}/execute", headers={"Authorization":"Bearer test"}, json={"idempotency_key":"run-1"})
        self.assertEqual(response.status_code, 409)

    @patch("app.automations.service.create_execution")
    @patch("app.automations.service.get_automation")
    def test_duplicate_execution_returns_persisted_result(self, get, create):
        get.return_value = {"id": AUTOMATION, "action_type":"record_test_run", "trigger_type":"manual_test", "enabled":True}
        create.return_value = (False, {"status":"succeeded", "result":{"action_type":"record_test_run", "saved":"original"}})
        from app.automations.service import run_automation
        result = run_automation(BUSINESS, AUTOMATION, dry_run=False, idempotency_key="same-key", trigger_id=None, conversation_id=None)
        self.assertTrue(result["duplicate"])
        self.assertEqual(result["result"]["saved"], "original")
if __name__ == "__main__":
    unittest.main()
