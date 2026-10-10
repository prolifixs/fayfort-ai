from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app import main


BUSINESS = "business-1"
CONVERSATION = "conversation-1"
USER = "member-1"


class LegacyConversationMessageAuthorizationTests(unittest.TestCase):
    @patch("app.main._send_message_core")
    @patch("app.main.trusted_business_member", return_value=None)
    @patch("app.main.get_conversation", return_value={"id": CONVERSATION, "business_id": BUSINESS})
    def test_post_rejects_missing_or_inactive_membership_before_processing(self, _conversation, identity, send_core):
        with self.assertRaises(HTTPException) as raised:
            main.send_message(CONVERSATION, {"content": "not an inbound message"}, "Bearer invalid")
        self.assertEqual(raised.exception.status_code, 404)
        identity.assert_called_once_with("Bearer invalid", BUSINESS)
        send_core.assert_not_called()

    @patch("app.main._send_message_core", return_value={"response": "ok"})
    @patch("app.main.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    @patch("app.main.get_conversation", return_value={"id": CONVERSATION, "business_id": BUSINESS})
    def test_post_runs_only_after_membership_for_conversation_business(self, _conversation, identity, send_core):
        result = main.send_message(CONVERSATION, {"content": "member submitted"}, "Bearer valid")
        self.assertEqual(result, {"response": "ok"})
        identity.assert_called_once_with("Bearer valid", BUSINESS)
        send_core.assert_called_once_with(CONVERSATION, {"content": "member submitted"}, "Bearer valid")

    @patch("app.main.list_messages", return_value=[{"id": "message-1", "sender_type": "customer", "content": "hello", "created_at": "now", "external_message_id": "private-provider-id"}])
    @patch("app.main.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    @patch("app.main.get_conversation", return_value={"id": CONVERSATION, "business_id": BUSINESS})
    def test_get_requires_membership_and_returns_only_safe_message_fields(self, _conversation, identity, list_messages):
        result = main.conversation_messages(CONVERSATION, "Bearer valid")
        self.assertEqual(result["messages"], [{"id": "message-1", "sender_type": "customer", "content": "hello", "created_at": "now"}])
        identity.assert_called_once_with("Bearer valid", BUSINESS)
        list_messages.assert_called_once_with(CONVERSATION, limit=100)

    @patch("app.main.list_messages")
    @patch("app.main.trusted_business_member", return_value=None)
    @patch("app.main.get_conversation", return_value={"id": CONVERSATION, "business_id": BUSINESS})
    def test_get_hides_cross_business_conversation_and_does_not_read_messages(self, _conversation, _identity, list_messages):
        with self.assertRaises(HTTPException) as raised:
            main.conversation_messages(CONVERSATION, "Bearer other-business-member")
        self.assertEqual(raised.exception.status_code, 404)
        list_messages.assert_not_called()


if __name__ == "__main__":
    unittest.main()
