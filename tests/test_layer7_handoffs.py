from __future__ import annotations
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.handoffs.router import create_handoffs_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
CONVERSATION = "00000000-0000-0000-0000-000000000002"
HANDOFF = "00000000-0000-0000-0000-000000000003"
USER = "00000000-0000-0000-0000-000000000004"

class HandoffApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_handoffs_router())
        self.client = TestClient(app)

    @patch("app.handoffs.router.list_handoffs", return_value=([{"id":HANDOFF,"status":"requested"}], 2))
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_handoff_queue_is_fifo_paged_and_returns_exact_total(self, identity, list_rows):
        response = self.client.get(f"/businesses/{BUSINESS}/handoffs?status=waiting&limit=1&offset=1", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"handoffs":[{"id":HANDOFF,"status":"requested"}],"total":2,"has_more":False,"next_offset":None})
        list_rows.assert_called_once_with(BUSINESS, "waiting", limit=1, offset=1)

    @patch("app.handoffs.router.handoff_capacity_summary", return_value={"available_slots":2,"response_latency_samples":[1,2,3,4,5]})
    @patch("app.handoffs.router.list_handoffs", return_value=([{"id":HANDOFF,"status":"requested"}], 3))
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_waiting_queue_includes_capacity_based_estimates(self, identity, list_rows, capacity):
        response = self.client.get(f"/businesses/{BUSINESS}/handoffs?status=waiting&limit=1&with_estimates=true", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        item = response.json()["handoffs"][0]
        self.assertEqual(item["queue_position"], 1)
        self.assertEqual(item["wait_estimate"]["status"], "estimated")
        capacity.assert_called_once_with(BUSINESS)

    @patch("app.handoffs.router.publish_business_event")
    @patch("app.handoffs.router.update_handoff_availability", return_value={"handoff_availability":"available","handoff_available_until":"2026-10-09T20:00:00+00:00","handoff_max_active":4,"handoff_availability_updated_at":"2026-10-09T19:00:00+00:00"})
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"member"})
    def test_agent_can_set_bounded_self_availability_with_audited_capacity(self, identity, update, publish):
        until = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        response = self.client.patch(f"/businesses/{BUSINESS}/handoffs/availability", headers={"Authorization":"Bearer test"}, json={"availability":"available","available_until":until,"max_active_handoffs":4})
        self.assertEqual(response.status_code, 200)
        update.assert_called_once()
        self.assertEqual(update.call_args.args[:3], (BUSINESS, USER, "available"))
        publish.assert_called_once()

    @patch("app.handoffs.router.update_handoff_availability")
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"member"})
    def test_available_state_requires_timezone_aware_expiry_and_never_writes_when_invalid(self, identity, update):
        response = self.client.patch(f"/businesses/{BUSINESS}/handoffs/availability", headers={"Authorization":"Bearer test"}, json={"availability":"available","available_until":"2026-10-09T20:00:00","max_active_handoffs":4})
        self.assertEqual(response.status_code, 422)
        update.assert_not_called()

    @patch("app.handoffs.router.create_handoff")
    @patch("app.handoffs.router.conversation_belongs_to_business", return_value=True)
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_request_is_scoped_to_business_conversation(self, identity, belongs, create):
        create.return_value = {"id":HANDOFF,"status":"requested","requested_by":USER}
        response = self.client.post(f"/businesses/{BUSINESS}/handoffs?conversation_id={CONVERSATION}", headers={"Authorization":"Bearer test"}, json={"reason":"customer requested an agent"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(create.call_args.args[:3], (BUSINESS, CONVERSATION, USER))

    @patch("app.handoffs.router.assign_handoff")
    @patch("app.handoffs.router.get_business_member", return_value={"user_id":USER,"status":"active"})
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_assignment_requires_active_business_member(self, identity, member, assign):
        assign.return_value = ("ok", {"id":HANDOFF,"status":"assigned"})
        response = self.client.post(f"/businesses/{BUSINESS}/handoffs/{HANDOFF}/assign", headers={"Authorization":"Bearer test"}, json={"agent_id":USER})
        self.assertEqual(response.status_code, 200)
        member.assert_called_once_with(BUSINESS, USER)

    @patch("app.handoffs.router.assign_handoff")
    @patch("app.handoffs.router.get_business_member", return_value={"user_id":USER,"status":"inactive"})
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_assignment_rejects_inactive_agent_before_mutating_handoff(self, identity, member, assign):
        response = self.client.post(f"/businesses/{BUSINESS}/handoffs/{HANDOFF}/assign", headers={"Authorization":"Bearer test"}, json={"agent_id":USER})
        self.assertEqual(response.status_code, 422)
        assign.assert_not_called()

    @patch("app.handoffs.router.take_over_handoff")
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_takeover_reports_wrong_assignee(self, identity, takeover):
        takeover.return_value = ("not_assignee", {"id":HANDOFF,"status":"assigned"})
        response = self.client.post(f"/businesses/{BUSINESS}/handoffs/{HANDOFF}/take-over", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 403)

    @patch("app.handoffs.router.list_active_business_members", return_value=[{"user_id":USER,"role":"owner"}])
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_agent_directory_requires_business_membership_and_is_scoped(self, identity, agents):
        response = self.client.get(f"/businesses/{BUSINESS}/handoffs/agents", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"agents":[{"user_id":USER,"role":"owner"}]})
        agents.assert_called_once_with(BUSINESS)

    @patch("app.handoffs.router.list_handoff_events", return_value=[{"id":"event-1","event_type":"taken_over"}])
    @patch("app.handoffs.router.get_handoff", return_value={"id":HANDOFF,"business_id":BUSINESS})
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_history_requires_a_handoff_in_the_requested_business(self, identity, handoff, events):
        response = self.client.get(f"/businesses/{BUSINESS}/handoffs/{HANDOFF}/events", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"events":[{"id":"event-1","event_type":"taken_over"}]})
        handoff.assert_called_once_with(BUSINESS, HANDOFF)
        events.assert_called_once_with(BUSINESS, HANDOFF)

class HandoffPipelineTests(unittest.TestCase):
    @patch("app.main.analyze_intent")
    @patch("app.main.active_handoff_for_conversation", return_value={"id":HANDOFF,"status":"active"})
    @patch("app.main.create_message", return_value={"id":"customer-message"})
    @patch("app.main.trusted_business_member", return_value={"user_id":USER,"role":"admin"})
    @patch("app.main.get_conversation", return_value={"id":CONVERSATION,"business_id":BUSINESS})
    def test_customer_message_during_handoff_does_not_run_ai(self, conversation, identity, create_message, active, analyze):
        from app.main import send_message
        result = send_message(CONVERSATION, {"content":"I need a human"}, "Bearer test")
        self.assertTrue(result["automation_paused"])
        self.assertIsNone(result["ai_message"])
        analyze.assert_not_called()

class HandoffAutomationSuppressionTests(unittest.TestCase):
    @patch("app.channels.manual.run_inbound_automations")
    @patch("app.channels.manual.mark_inbound_automation_complete")
    @patch("app.channels.manual.publish_business_event")
    def test_active_handoff_suppresses_all_inbound_automation_triggers(self, publish_event, mark_complete, run_automations):
        payload = {
            "business_id": BUSINESS,
            "customer_external_id": "manual-test-customer",
            "provider_event_id": "active-handoff-event",
            "content": "Please connect me with the agent.",
        }
        from app.channels.manual import process_manual_inbound
        from app.schemas.channel import ManualInboundPayload
        process_result = process_manual_inbound(
            ManualInboundPayload(**payload),
            "Bearer test",
            lambda *_args: self.fail("legacy message handler should not run"),
            identity_check=lambda *_args: True,
            conversation_resolver=lambda **_kwargs: {"id":CONVERSATION},
            event_claimer=lambda **_kwargs: (True, {"id":"inbound-event-row"}),
            event_completer=lambda **_kwargs: None,
            event_failer=lambda **_kwargs: self.fail("suppressed inbound should be marked processed"),
            inbound_message_handler=lambda *_args, **_kwargs: {
                "conversation_id": CONVERSATION,
                "automation_paused": True,
                "ai_message": None,
            },
        )
        self.assertEqual(process_result["status"], "processed")
        publish_event.assert_called_once()
        run_automations.assert_not_called()

if __name__ == "__main__":
    unittest.main()
