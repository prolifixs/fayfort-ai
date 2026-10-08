from __future__ import annotations
import unittest
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

    @patch("app.handoffs.router.take_over_handoff")
    @patch("app.handoffs.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_takeover_reports_wrong_assignee(self, identity, takeover):
        takeover.return_value = ("not_assignee", {"id":HANDOFF,"status":"assigned"})
        response = self.client.post(f"/businesses/{BUSINESS}/handoffs/{HANDOFF}/take-over", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 403)

class HandoffPipelineTests(unittest.TestCase):
    @patch("app.main.analyze_intent")
    @patch("app.main.active_handoff_for_conversation", return_value={"id":HANDOFF,"status":"active"})
    @patch("app.main.create_message", return_value={"id":"customer-message"})
    @patch("app.main.get_conversation", return_value={"id":CONVERSATION,"business_id":BUSINESS})
    def test_customer_message_during_handoff_does_not_run_ai(self, conversation, create_message, active, analyze):
        from app.main import send_message
        result = send_message(CONVERSATION, {"content":"I need a human"}, "Bearer test")
        self.assertTrue(result["automation_paused"])
        self.assertIsNone(result["ai_message"])
        analyze.assert_not_called()

if __name__ == "__main__":
    unittest.main()
