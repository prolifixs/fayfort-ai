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
    def test_inbound_intent_condition_reuses_active_layer4_intent(self):
        from app.automations.service import run_inbound_automations
        rule = {"id": AUTOMATION, "conditions": {"intent": "shipping"}}
        execution = {"id": "execution-1", "status": "succeeded"}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=[rule]), \
             patch("app.automations.service.get_active_intent", return_value={"intent_key": "Shipping"}) as active_intent, \
             patch("app.automations.service.run_automation", return_value={"execution": execution, "status": "succeeded", "duplicate": False}) as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-1", conversation_id="conversation-1")
        active_intent.assert_called_once_with("conversation-1")
        run.assert_called_once()
        self.assertEqual(result[0]["status"], "succeeded")

    def test_inbound_intent_mismatch_does_not_execute_rule(self):
        from app.automations.service import run_inbound_automations
        rule = {"id": AUTOMATION, "conditions": {"intent": "shipping"}}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=[rule]), \
             patch("app.automations.service.get_active_intent", return_value={"intent_key": "product_sourcing"}), \
             patch("app.automations.service.run_automation") as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-2", conversation_id="conversation-1")
        self.assertEqual(result, [])
        run.assert_not_called()

    def test_missing_intent_records_skipped(self):
        from app.automations.service import run_inbound_automations
        rule = {"id": AUTOMATION, "conditions": {"intent": "shipping"}}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=[rule]), \
             patch("app.automations.service.get_active_intent", return_value=None), \
             patch("app.automations.service.create_execution", return_value=(True, {"status": "skipped"})) as save, \
             patch("app.automations.service.run_automation") as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-3", conversation_id="conversation-1")
        self.assertEqual(result[0]["status"], "skipped")
        self.assertEqual(save.call_args.args[0]["error_code"], "condition_data_unavailable")
        run.assert_not_called()


    def test_inbound_language_condition_reuses_active_layer4_result(self):
        from app.automations.service import run_inbound_automations
        rule = {"id": AUTOMATION, "conditions": {"language": "zh-Hant"}}
        execution = {"id": "execution-language", "status": "succeeded"}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=[rule]), \
             patch("app.automations.service.get_active_intent", return_value={"intent_key": "unknown", "metadata": {"language": "zh_Hant"}}) as active_intent, \
             patch("app.automations.service.run_automation", return_value={"execution": execution, "status": "succeeded", "duplicate": False}) as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-lang-1", conversation_id="conversation-1")
        active_intent.assert_called_once_with("conversation-1")
        run.assert_called_once()
        self.assertEqual(result[0]["status"], "succeeded")

    def test_intent_and_language_rules_share_one_layer4_read(self):
        from app.automations.service import run_inbound_automations
        rules = [
            {"id": AUTOMATION, "conditions": {"intent": "shipping", "language": "zh-Hant"}},
            {"id": "00000000-0000-0000-0000-000000000003", "conditions": {"language": "zh_Hant"}},
        ]
        execution = {"id": "execution-shared-intent", "status": "succeeded"}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=rules), \
             patch("app.automations.service.get_active_intent", return_value={"intent_key": "shipping", "metadata": {"language": "zh_Hant"}}) as active_intent, \
             patch("app.automations.service.run_automation", return_value={"execution": execution, "status": "succeeded", "duplicate": False}) as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-lang-shared", conversation_id="conversation-1")
        active_intent.assert_called_once_with("conversation-1")
        self.assertEqual(run.call_count, 2)
        self.assertEqual([item["status"] for item in result], ["succeeded", "succeeded"])

    def test_language_mismatch_does_not_execute_rule(self):
        from app.automations.service import run_inbound_automations
        rule = {"id": AUTOMATION, "conditions": {"language": "en"}}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=[rule]), \
             patch("app.automations.service.get_active_intent", return_value={"intent_key": "greeting", "metadata": {"language": "fr"}}), \
             patch("app.automations.service.run_automation") as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-lang-mismatch", conversation_id="conversation-1")
        self.assertEqual(result, [])
        run.assert_not_called()

    def test_unknown_language_records_skipped(self):
        from app.automations.service import run_inbound_automations
        rule = {"id": AUTOMATION, "conditions": {"language": "en"}}
        with patch("app.automations.service.list_enabled_trigger_automations", return_value=[rule]), \
             patch("app.automations.service.get_active_intent", return_value={"intent_key": "greeting", "metadata": {"language": "und"}}), \
             patch("app.automations.service.create_execution", return_value=(True, {"status": "skipped"})) as save, \
             patch("app.automations.service.run_automation") as run:
            result = run_inbound_automations(BUSINESS, channel="instagram", provider_event_id="event-lang-2", conversation_id="conversation-1")
        self.assertEqual(result[0]["status"], "skipped")
        self.assertEqual(save.call_args.args[0]["error_code"], "condition_data_unavailable")
        run.assert_not_called()

if __name__ == "__main__":
    unittest.main()
