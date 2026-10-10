from __future__ import annotations
import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.events.router import _close_websocket, create_events_router
from app.database.events import publish_business_event

BUSINESS = "00000000-0000-0000-0000-000000000001"
USER = "00000000-0000-0000-0000-000000000002"

class EventApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_events_router())
        self.client = TestClient(app)

    def test_websocket_close_ignores_peer_disconnect_race(self):
        socket = Mock()
        socket.close = AsyncMock(side_effect=WebSocketDisconnect(1006))

        asyncio.run(_close_websocket(socket, code=1011, reason="stream failed"))

        socket.close.assert_awaited_once_with(code=1011, reason="stream failed")

    @patch("app.events.router.list_business_events", return_value=[{"id":7,"event_type":"handoff.requested"}])
    @patch("app.events.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_event_feed_is_business_authenticated_and_cursor_based(self, identity, list_events):
        response = self.client.get(f"/businesses/{BUSINESS}/events?after_id=5&limit=20", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["next_after_id"], 7)
        list_events.assert_called_once_with(BUSINESS, 5, 20)

    @patch("app.events.router.trusted_business_member", return_value={"user_id":USER,"role":"owner"})
    def test_event_feed_rejects_negative_cursor_and_unbounded_page_size(self, identity):
        negative = self.client.get(f"/businesses/{BUSINESS}/events?after_id=-1", headers={"Authorization":"Bearer test"})
        too_many = self.client.get(f"/businesses/{BUSINESS}/events?limit=201", headers={"Authorization":"Bearer test"})
        self.assertEqual(negative.status_code, 422)
        self.assertEqual(too_many.status_code, 422)

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

    def test_delivery_retry_event_accepts_only_sanitized_scalar_fields(self):
        inserted = Mock()
        inserted.data = [{"id": 9}]
        with patch("app.database.events.supabase.table") as table:
            table.return_value.insert.return_value.execute.return_value = inserted
            result = publish_business_event(
                BUSINESS, "channel.delivery_retried", "channel_delivery", "delivery-id",
                {"delivery_id":"delivery-id", "status":"rejected", "updated_by":USER},
            )
            self.assertEqual(result, {"id": 9})
            payload = table.return_value.insert.call_args.args[0]
            self.assertEqual(payload["event_type"], "channel.delivery_retried")
            self.assertEqual(payload["payload"]["delivery_id"], "delivery-id")

            with self.assertRaises(ValueError):
                publish_business_event(
                    BUSINESS, "channel.delivery_retried", "channel_delivery", "delivery-id",
                    {"delivery_id":"delivery-id", "content":"private message"},
                )
            self.assertEqual(table.return_value.insert.call_count, 1)

    @patch("app.events.router.list_business_events", side_effect=[[{"id":8,"event_type":"channel.inbound.processed","payload":{"channel":"manual_test"}}], []])
    @patch("app.events.router.consume_event_ticket", return_value=USER)
    def test_websocket_requires_one_time_ticket_then_streams_sanitized_event(self, consume, list_events):
        with self.client.websocket_connect(f"/businesses/{BUSINESS}/events/ws") as socket:
            socket.send_json({"ticket":"a-valid-long-one-time-ticket-string","after_id":7})
            self.assertEqual(socket.receive_json()["type"], "ready")
            packet = socket.receive_json()
            self.assertEqual(packet["event"]["id"], 8)
            consume.assert_called_once_with(BUSINESS, "a-valid-long-one-time-ticket-string")

    @patch("app.events.router.list_business_events", side_effect=[
        [{"id":8,"event_type":"handoff.requested"}],
        [{"id":9,"event_type":"handoff.assigned"}],
        [],
    ])
    @patch("app.events.router.consume_event_ticket", return_value=USER)
    def test_websocket_replays_every_page_after_cursor_without_a_gap(self, consume, list_events):
        with self.client.websocket_connect(f"/businesses/{BUSINESS}/events/ws") as socket:
            socket.send_json({"ticket":"a-valid-long-one-time-ticket-string","after_id":7})
            self.assertEqual(socket.receive_json(), {"type":"ready","after_id":7})
            self.assertEqual(socket.receive_json()["event"]["id"], 8)
            self.assertEqual(socket.receive_json()["event"]["id"], 9)
            socket.close()
        self.assertEqual(list_events.call_args_list[0].args, (BUSINESS, 7, 100))
        self.assertEqual(list_events.call_args_list[1].args, (BUSINESS, 8, 100))

    @patch("app.events.router.consume_event_ticket", return_value=None)
    def test_websocket_rejects_expired_or_already_used_ticket(self, consume):
        with self.assertRaises(WebSocketDisconnect) as closed:
            with self.client.websocket_connect(f"/businesses/{BUSINESS}/events/ws") as socket:
                socket.send_json({"ticket":"a-valid-long-one-time-ticket-string","after_id":0})
                socket.receive_json()
        self.assertEqual(closed.exception.code, 4401)

    @patch("app.events.router.consume_event_ticket", return_value=USER)
    def test_websocket_rejects_invalid_cursor_without_starting_stream(self, consume):
        with self.assertRaises(WebSocketDisconnect) as closed:
            with self.client.websocket_connect(f"/businesses/{BUSINESS}/events/ws") as socket:
                socket.send_json({"ticket":"a-valid-long-one-time-ticket-string","after_id":-1})
                socket.receive_json()
        self.assertEqual(closed.exception.code, 4400)
        consume.assert_called_once_with(BUSINESS, "a-valid-long-one-time-ticket-string")

if __name__ == "__main__":
    unittest.main()
