from __future__ import annotations

import hashlib
import hmac
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.channels.messenger import create_messenger_webhook_router
from app.channels.messenger_outbound import deliver_messenger_text


BUSINESS = "00000000-0000-0000-0000-000000000001"
CONNECTION = "00000000-0000-0000-0000-000000000002"
CONVERSATION = "00000000-0000-0000-0000-000000000003"
MESSAGE = "00000000-0000-0000-0000-000000000004"
DELIVERY = "00000000-0000-0000-0000-000000000005"
PAGE_ID = "page-123"
APP_SECRET = "test-app-secret"


def setup_webhook(message_handler=None, outbound=None):
    app = FastAPI()
    app.include_router(create_messenger_webhook_router(
        "webhook-token", message_handler or Mock(return_value={"status": "ok"}),
        outbound_handler=outbound,
        inbound_message_handler=Mock(return_value={"ai_message": {"id": MESSAGE}}),
    ))
    return TestClient(app)


def signed_payload(payload: dict) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Hub-Signature-256": f"sha256={signature}"}


def outbound_fixtures():
    connection = {
        "id": CONNECTION, "business_id": BUSINESS, "provider": "messenger",
        "provider_account_id": PAGE_ID, "status": "connected",
        "safe_settings": {"outbound_enabled": True},
    }
    credentials = {"page_access_token": "vault-token"}
    conversation = {"id": CONVERSATION, "customer_external_id": "customer-psid"}
    message = {"id": MESSAGE, "content": "A short reply", "sender_type": "agent"}
    return connection, credentials, conversation, message


class MessengerWebhookTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "object": "page",
            "entry": [{"id": PAGE_ID, "messaging": [{
                "sender": {"id": "customer-psid"},
                "recipient": {"id": PAGE_ID},
                "timestamp": 1791500000000,
                "message": {"mid": "mid.1", "text": "Hello"},
            }]}],
        }
        self.connection = {
            "id": CONNECTION, "business_id": BUSINESS, "provider": "messenger",
            "provider_account_id": PAGE_ID, "status": "connected",
            "safe_settings": {"inbound_enabled": True, "auto_reply_enabled": False},
        }

    def test_verification_uses_constant_time_token_check(self):
        client = setup_webhook()
        ok = client.get("/webhooks/messenger", params={"hub.mode": "subscribe", "hub.verify_token": "webhook-token", "hub.challenge": "challenge"})
        bad = client.get("/webhooks/messenger", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "challenge"})
        self.assertEqual((ok.status_code, ok.text), (200, "challenge"))
        self.assertEqual(bad.status_code, 403)

    @patch("app.channels.messenger.get_connection_credentials", return_value={"app_secret": APP_SECRET, "page_access_token": "token"})
    @patch("app.channels.messenger.list_messenger_connections_for_page")
    @patch("app.channels.messenger.process_manual_inbound", return_value={"status": "processed", "conversation_id": CONVERSATION})
    def test_signed_page_message_enters_normalized_pipeline(self, process, list_connections, _credentials):
        list_connections.return_value = [self.connection]
        client = setup_webhook()
        raw, headers = signed_payload(self.payload)
        response = client.post("/webhooks/messenger", content=raw, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "accepted", "processed": 1})
        args = process.call_args
        self.assertEqual(args.kwargs["channel_override"], "messenger")
        self.assertFalse(args.kwargs["require_identity"])
        self.assertFalse(args.kwargs["automation_reply_enabled"])

    @patch("app.channels.messenger.get_connection_credentials", return_value={"app_secret": APP_SECRET})
    @patch("app.channels.messenger.list_messenger_connections_for_page")
    @patch("app.channels.messenger.process_manual_inbound")
    def test_invalid_signature_fails_before_processing(self, process, list_connections, _credentials):
        list_connections.return_value = [self.connection]
        client = setup_webhook()
        response = client.post("/webhooks/messenger", json=self.payload, headers={"X-Hub-Signature-256": "sha256=invalid"})
        self.assertEqual(response.status_code, 401)
        process.assert_not_called()

    @patch("app.channels.messenger.get_connection_credentials", return_value={"app_secret": APP_SECRET})
    @patch("app.channels.messenger.list_messenger_connections_for_page")
    @patch("app.channels.messenger.process_manual_inbound")
    def test_duplicate_inbound_is_not_counted_as_new_processing(self, process, list_connections, _credentials):
        list_connections.return_value = [self.connection]
        process.return_value = {"status": "duplicate", "conversation_id": CONVERSATION}
        client = setup_webhook()
        raw, headers = signed_payload(self.payload)
        response = client.post("/webhooks/messenger", content=raw, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["processed"], 0)

    @patch("app.channels.messenger.mark_inbound_delivery_outcome")
    @patch("app.channels.messenger.get_connection_credentials", return_value={"app_secret": APP_SECRET, "page_access_token": "vault-token"})
    @patch("app.channels.messenger.list_messenger_connections_for_page")
    @patch("app.channels.messenger.process_manual_inbound", return_value={"status": "processed", "conversation_id": CONVERSATION, "ai_message": {"id": MESSAGE, "content": "Welcome"}})
    def test_opted_in_auto_reply_uses_messenger_sender_and_reconciles_delivery(self, process, list_connections, _credentials, reconcile):
        connection = {**self.connection, "safe_settings": {"inbound_enabled": True, "auto_reply_enabled": True}}
        list_connections.return_value = [connection]
        sender = Mock(return_value={"status": "sent", "safe_error_code": None})
        client = setup_webhook(outbound=sender)
        raw, headers = signed_payload(self.payload)

        response = client.post("/webhooks/messenger", content=raw, headers=headers)

        self.assertEqual(response.status_code, 200)
        process.assert_called_once()
        self.assertTrue(process.call_args.kwargs["automation_reply_enabled"])
        sender.assert_called_once()
        self.assertEqual(sender.call_args.kwargs["recipient_id"], "customer-psid")
        self.assertTrue(sender.call_args.kwargs["require_auto_reply"])
        reconcile.assert_called_once_with(MESSAGE, "sent", None)

    def test_invalid_object_shape_is_rejected(self):
        client = setup_webhook()
        response = client.post("/webhooks/messenger", json=[], headers={"X-Hub-Signature-256": "sha256=synthetic"})
        self.assertEqual(response.status_code, 400)


class MessengerOutboundTests(unittest.TestCase):
    @patch("app.channels.messenger_outbound.requests.post")
    @patch("app.channels.messenger_outbound.finish_delivery_attempt")
    @patch("app.channels.messenger_outbound._latest_customer_message_at")
    @patch("app.channels.messenger_outbound.begin_delivery_attempt")
    def test_send_uses_page_send_api_and_persists_provider_receipt(self, begin, latest, finish, post):
        connection, credentials, conversation, message = outbound_fixtures()
        latest.return_value = datetime.now(timezone.utc)
        begin.return_value = ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True)
        response = Mock(status_code=200)
        response.json.return_value = {"message_id": "mid.provider"}
        post.return_value = response
        finish.return_value = {"id": DELIVERY, "status": "sent"}

        result = deliver_messenger_text(connection=connection, credentials=credentials, conversation=conversation, message=message)

        self.assertEqual(result["status"], "sent")
        self.assertEqual(result["provider_message_id"], "mid.provider")
        self.assertEqual(post.call_args.args[0], "https://graph.facebook.com/v26.0/page-123/messages")
        self.assertEqual(post.call_args.kwargs["json"], {"recipient": {"id": "customer-psid"}, "messaging_type": "RESPONSE", "message": {"text": "A short reply"}})
        begin.assert_called_once_with(business_id=BUSINESS, connection_id=CONNECTION, conversation_id=CONVERSATION, message_id=MESSAGE, channel="messenger", retry_rejected=False)

    @patch("app.channels.messenger_outbound.requests.post")
    @patch("app.channels.messenger_outbound.finish_delivery_attempt")
    @patch("app.channels.messenger_outbound._latest_customer_message_at")
    @patch("app.channels.messenger_outbound.begin_delivery_attempt")
    def test_expired_24_hour_window_is_rejected_without_send(self, begin, latest, finish, post):
        connection, credentials, conversation, message = outbound_fixtures()
        latest.return_value = datetime.now(timezone.utc) - timedelta(hours=25)
        begin.return_value = ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True)
        finish.return_value = {"id": DELIVERY, "status": "rejected"}
        result = deliver_messenger_text(connection=connection, credentials=credentials, conversation=conversation, message=message)
        self.assertEqual(result["safe_error_code"], "response_window_expired")
        post.assert_not_called()
        finish.assert_called_once_with(DELIVERY, 1, "rejected", "response_window_expired")

    @patch("app.channels.messenger_outbound.requests.post", side_effect=requests.ReadTimeout("uncertain"))
    @patch("app.channels.messenger_outbound.finish_delivery_attempt")
    @patch("app.channels.messenger_outbound._latest_customer_message_at")
    @patch("app.channels.messenger_outbound.begin_delivery_attempt")
    def test_ambiguous_timeout_is_unknown_and_not_replayed(self, begin, latest, finish, post):
        connection, credentials, conversation, message = outbound_fixtures()
        latest.return_value = datetime.now(timezone.utc)
        begin.side_effect = [
            ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True),
            ({"id": DELIVERY, "attempt_count": 1, "status": "unknown"}, False),
        ]
        finish.return_value = {"id": DELIVERY, "status": "unknown"}
        first = deliver_messenger_text(connection=connection, credentials=credentials, conversation=conversation, message=message)
        second = deliver_messenger_text(connection=connection, credentials=credentials, conversation=conversation, message=message)
        self.assertEqual(first["status"], "unknown")
        self.assertEqual(second["status"], "unknown")
        self.assertTrue(second["duplicate"])
        post.assert_called_once()


if __name__ == "__main__":
    unittest.main()
