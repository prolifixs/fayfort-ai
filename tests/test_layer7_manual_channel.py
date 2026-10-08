from __future__ import annotations
import unittest
from unittest.mock import patch
from uuid import uuid4
from app.channels.manual import ManualChannelAuthorizationError, process_manual_inbound
from app.schemas.channel import ManualInboundPayload, normalize_manual_event

class ManualChannelTests(unittest.TestCase):
    def setUp(self):
        self.payload = ManualInboundPayload(
            business_id=str(uuid4()),
            customer_external_id="cli-customer-1",
            provider_event_id="event-001",
            content="Hello FayFort",
        )

    def test_normalizes_provider_event_without_changing_message(self):
        event = normalize_manual_event(self.payload)
        self.assertEqual(event.provider, "manual_test")
        self.assertEqual(event.provider_event_id, "event-001")
        self.assertEqual(event.content, "Hello FayFort")

    def test_rejects_unauthenticated_business_before_side_effects(self):
        called = []
        with self.assertRaises(ManualChannelAuthorizationError):
            process_manual_inbound(
                self.payload, None, lambda *_: called.append("pipeline") or {},
                identity_check=lambda *_: False,
                conversation_resolver=lambda **_: called.append("conversation") or {},
            )
        self.assertEqual(called, [])

    @patch("app.channels.manual.publish_business_event")
    def test_processes_once_and_records_response(self, publish_event):
        calls = []
        result = process_manual_inbound(
            self.payload, "Bearer trusted",
            lambda cid, body, auth: {"conversation_id": cid, "response": "Hello back", "ai_message": {"id": "response-id"}},
            identity_check=lambda *_: True,
            conversation_resolver=lambda **_: {"id": "conversation-id"},
            event_claimer=lambda **kwargs: (True, {"id": "event-row"}),
            event_completer=lambda **kwargs: calls.append(kwargs),
            event_failer=lambda **kwargs: self.fail("unexpected failure"),
        )
        self.assertEqual(result["status"], "processed")
        self.assertEqual(result["response"], "Hello back")
        self.assertEqual(calls[0]["event_id"], "event-row")
        self.assertEqual(calls[0]["response_message_id"], "response-id")

    def test_duplicate_event_does_not_run_pipeline(self):
        calls = []
        result = process_manual_inbound(
            self.payload, "Bearer trusted", lambda *_: calls.append("pipeline") or {},
            identity_check=lambda *_: True,
            conversation_resolver=lambda **_: {"id": "conversation-id"},
            event_claimer=lambda **_: (False, {"id": "old", "status": "processed", "conversation_id": "prior-conversation"}),
        )
        self.assertEqual(result["status"], "duplicate")
        self.assertEqual(result["conversation_id"], "prior-conversation")
        self.assertEqual(calls, [])

    def test_pipeline_failure_is_recorded_and_propagated(self):
        failures = []
        with self.assertRaises(RuntimeError):
            process_manual_inbound(
                self.payload, "Bearer trusted", lambda *_: {"error": "pipeline failed"},
                identity_check=lambda *_: True,
                conversation_resolver=lambda **_: {"id": "conversation-id"},
                event_claimer=lambda **_: (True, {"id": "event-row"}),
                event_failer=lambda **kwargs: failures.append(kwargs),
            )
        self.assertEqual(failures, [{"event_id": "event-row", "reason_code": "pipeline_error"}])

if __name__ == "__main__":
    unittest.main()