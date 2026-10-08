from __future__ import annotations
import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.events.router import create_events_router
from app.database.events import publish_business_event

BUSINESS = "00000000-0000-0000-0000-000000000001"
USER = "00000000-0000-0000-0000-000000000002"

class EventApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_events_router())
        self.client = TestClient(app)

    @patch("app.events.router.list_business_events", return_value=[{"id":7,"event_type":"handoff.requested"}])
    @patch("app.events.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_event_feed_is_business_authenticated_and_cursor_based(self, identity, list_events):
        response = self.client.get(f"/businesses/{BUSINESS}/events?after_id=5&limit=20", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["next_after_id"], 7)
        list_events.assert_called_once_with(BUSINESS, 5, 20)

    @patch("app.events.router.issue_event_ticket", return_value=("one-use-ticket-value-000000000000000000000000", "2099-01-01T00:00:00+00:00"))
    @patch("app.events.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_websocket_ticket_is_short_lived_and_returned_to_member(self, identity, issue):
        response = self.client.post(f"/businesses/{BUSINESS}/events/ticket", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["use_once"])
        issue.assert_called_once_with(BUSINESS, USER)

    def test_event_payload_rejects_message_body_before_database_write(self):
        with patch("app.database.events.supabase.table") as table:
            with self.assertRaises(ValueError):
                publish_business_event(BUSINESS, "channel.inbound.processed", "conversation", "conversation-id", {"content":"private message"})
        table.assert_not_called()

    @patch("app.events.router.list_business_events", side_effect=[[{"id":8,"event_type":"channel.inbound.processed","payload":{"channel":"manual_test"}}], []])
    @patch("app.events.router.consume_event_ticket", return_value=USER)
    def test_websocket_requires_one_time_ticket_then_streams_sanitized_event(self, consume, list_events):
        with self.client.websocket_connect(f"/businesses/{BUSINESS}/events/ws") as socket:
            socket.send_json({"ticket":"a-valid-long-one-time-ticket-string","after_id":7})
            self.assertEqual(socket.receive_json()["type"], "ready")
            packet = socket.receive_json()
            self.assertEqual(packet["event"]["id"], 8)
            consume.assert_called_once_with(BUSINESS, "a-valid-long-one-time-ticket-string")

if __name__ == "__main__":
    unittest.main()
