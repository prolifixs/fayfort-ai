from __future__ import annotations

import unittest
from unittest.mock import patch

from app.automations.reconciliation import reconcile_pending_inbound_events


EVENT = {
    "id": "event-1",
    "business_id": "business-1",
    "channel": "instagram",
    "provider_event_id": "provider-event-1",
    "conversation_id": "conversation-1",
    "response_message_id": "message-1",
    "approved_reply_automation_id": "automation-1",
    "automation_status": "pending",
    "delivery_status": "pending",
}


class InboundReconciliationTests(unittest.TestCase):
    @patch("app.automations.reconciliation._publish")
    @patch("app.automations.reconciliation.mark_event_delivery_reconciled")
    @patch("app.automations.reconciliation.get_delivery_for_message", return_value={"status": "sent", "safe_error_code": None})
    @patch("app.automations.reconciliation.mark_inbound_automation_complete")
    @patch("app.automations.reconciliation.run_inbound_automations", return_value=[])
    @patch("app.automations.reconciliation.list_pending_inbound_reconciliation", return_value=[EVENT])
    def test_reconciles_automation_and_projects_existing_delivery_without_resending(self, _pending, run, complete, get_delivery, mark_delivery, publish):
        self.assertEqual(reconcile_pending_inbound_events(), 2)
        run.assert_called_once_with(
            "business-1",
            channel="instagram",
            provider_event_id="provider-event-1",
            conversation_id="conversation-1",
            approved_reply_automation_id="automation-1",
            response_message_id="message-1",
        )
        complete.assert_called_once_with("event-1")
        get_delivery.assert_called_once_with("business-1", "message-1")
        mark_delivery.assert_called_once_with("event-1", "sent", None)
        publish.assert_any_call("business-1", "channel.delivery_reconciled", "event-1", {
            "channel_event_id": "event-1", "channel": "instagram", "delivery_status": "sent",
        })

    @patch("app.automations.reconciliation._publish")
    @patch("app.automations.reconciliation.mark_event_delivery_reconciled")
    @patch("app.automations.reconciliation.get_delivery_for_message", return_value=None)
    @patch("app.automations.reconciliation.mark_inbound_automation_retryable")
    @patch("app.automations.reconciliation.run_inbound_automations", side_effect=RuntimeError("temporary ledger outage"))
    @patch("app.automations.reconciliation.list_pending_inbound_reconciliation", return_value=[EVENT])
    def test_keeps_automation_retryable_and_marks_missing_delivery_unknown(self, _pending, _run, retryable, get_delivery, mark_delivery, publish):
        self.assertEqual(reconcile_pending_inbound_events(), 1)
        retryable.assert_called_once_with("event-1")
        get_delivery.assert_called_once_with("business-1", "message-1")
        mark_delivery.assert_called_once_with("event-1", "unknown", "delivery_record_missing")
        publish.assert_any_call("business-1", "automation.reconciliation_failed", "event-1", {
            "channel_event_id": "event-1", "channel": "instagram", "error_code": "automation_reconciliation_failed",
        })
        publish.assert_any_call("business-1", "channel.delivery_reconciliation_issue", "event-1", {
            "channel_event_id": "event-1", "channel": "instagram", "error_code": "delivery_record_missing",
        })

    @patch("app.automations.reconciliation.mark_event_delivery_reconciled")
    @patch("app.automations.reconciliation.get_delivery_for_message", return_value={"status": "sending"})
    @patch("app.automations.reconciliation.mark_inbound_automation_complete")
    @patch("app.automations.reconciliation.run_inbound_automations", return_value=[])
    @patch("app.automations.reconciliation.list_pending_inbound_reconciliation", return_value=[EVENT])
    def test_does_not_close_an_inflight_provider_delivery(self, _pending, _run, _complete, get_delivery, mark_delivery):
        reconcile_pending_inbound_events()
        get_delivery.assert_called_once()
        mark_delivery.assert_not_called()


if __name__ == "__main__":
    unittest.main()
