from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.schemas.intent import ActionDecision, IntentResult, NextAction

BUSINESS = "00000000-0000-0000-0000-000000000001"
CONVERSATION = "00000000-0000-0000-0000-000000000002"
OWNER = "00000000-0000-0000-0000-000000000004"


def _members(rows):
    table = MagicMock()
    chain = table.select.return_value.eq.return_value.eq.return_value.in_.return_value.order.return_value
    chain.execute.return_value = MagicMock(data=rows)
    client = MagicMock()
    client.table.return_value = table
    return client


class RequestCustomerHandoffTests(unittest.TestCase):
    def test_opens_a_handoff_on_behalf_of_the_business_owner(self):
        from app.handoffs import automatic
        with (
            patch.object(automatic, "supabase", _members([{"user_id": "admin-1", "role": "admin"}, {"user_id": OWNER, "role": "owner"}])),
            patch.object(automatic, "active_handoff_for_conversation", return_value=None),
            patch.object(automatic, "create_handoff", return_value={"id": "h1", "status": "requested"}) as create,
        ):
            handoff = automatic.request_customer_handoff(BUSINESS, CONVERSATION)
        self.assertEqual(handoff, {"id": "h1", "status": "requested"})
        create.assert_called_once_with(BUSINESS, CONVERSATION, OWNER, "customer_requested")

    def test_reuses_an_open_handoff(self):
        from app.handoffs import automatic
        with (
            patch.object(automatic, "active_handoff_for_conversation", return_value={"id": "h0", "status": "requested"}),
            patch.object(automatic, "create_handoff") as create,
        ):
            self.assertEqual(automatic.request_customer_handoff(BUSINESS, CONVERSATION)["id"], "h0")
        create.assert_not_called()

    def test_failures_never_raise(self):
        from app.handoffs import automatic
        with patch.object(automatic, "active_handoff_for_conversation", side_effect=RuntimeError("db down")):
            self.assertIsNone(automatic.request_customer_handoff(BUSINESS, CONVERSATION))

    def test_only_an_explicit_request_counts(self):
        from app.handoffs.automatic import customer_asked_for_human
        self.assertTrue(customer_asked_for_human(IntentResult(intent="human_handoff", action="handoff_to_agent", confidence=0.9)))
        self.assertTrue(customer_asked_for_human(IntentResult(intent="general_information", action="handoff_to_agent", confidence=0.9)))
        self.assertFalse(customer_asked_for_human(IntentResult(intent="general_information", action="request_human_review", confidence=0.3)))


class PipelineOpensHandoffTests(unittest.TestCase):
    def _run(self, *, auto_reply: bool):
        from app import main
        intent = IntentResult(intent="human_handoff", action="handoff_to_agent", confidence=0.95)
        decision = ActionDecision(action=NextAction.HANDOFF_TO_AGENT, needs_human=True, response_guidance="", should_execute=False)
        with (
            patch.object(main, "get_conversation", return_value={"business_id": BUSINESS, "summary": ""}),
            patch.object(main, "create_message", side_effect=lambda **kwargs: {"id": "m", **kwargs}) as create,
            patch.object(main, "active_handoff_for_conversation", return_value=None),
            patch.object(main, "list_messages", return_value=[]),
            patch.object(main, "build_business_context", return_value=""),
            patch.object(main, "analyze_intent", return_value=intent),
            patch.object(main, "update_customer_state", return_value=None),
            patch.object(main, "lookup_for_message", return_value=None),
            patch.object(main, "prepare_action", return_value=decision),
            patch.object(main, "request_customer_handoff", return_value={"id": "h1", "status": "requested"}) as opened,
            patch.object(main, "_persist_intent_and_action"),
            patch.object(main, "generate_ai_response") as respond,
            patch.object(main, "generate_conversation_summary", return_value=""),
            patch.object(main, "update_conversation_summary"),
        ):
            result = main._send_message_core(
                CONVERSATION, {"content": "I need to speak to a live agent please"},
                inbound_context={"channel": "instagram", "provider_event_id": "evt-1", "automation_reply_enabled": auto_reply},
            )
        return result, opened, respond, create

    def test_explicit_request_opens_handoff_and_tells_the_customer(self):
        from app.handoffs.automatic import HANDOFF_REQUESTED_REPLY
        result, opened, respond, _ = self._run(auto_reply=True)
        opened.assert_called_once_with(BUSINESS, CONVERSATION)
        respond.assert_not_called()
        self.assertEqual(result["response"], HANDOFF_REQUESTED_REPLY)
        self.assertEqual(result["handoff"], {"id": "h1", "status": "requested"})

    def test_handoff_still_opens_when_auto_reply_is_off(self):
        result, opened, respond, _ = self._run(auto_reply=False)
        opened.assert_called_once()
        self.assertIsNone(result["response"])
        self.assertEqual(result["handoff"]["id"], "h1")


if __name__ == "__main__":
    unittest.main()
