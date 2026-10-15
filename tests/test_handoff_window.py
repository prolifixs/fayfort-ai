from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.handoffs import window

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
BUSINESS = "00000000-0000-0000-0000-000000000001"
CONVERSATION = "00000000-0000-0000-0000-000000000002"


def ago(minutes: float) -> str:
    return (NOW - timedelta(minutes=minutes)).isoformat()


class EvaluateTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.multiple(window.settings, HANDOFF_WAIT_MINUTES=15, HANDOFF_IDLE_MINUTES=30,
                                 HANDOFF_HOLDING_INTERVAL_MINUTES=5)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_waiting_gets_a_holding_reply_at_most_every_interval(self):
        state = window.evaluate(opened_at=ago(3), last_human_at=None, last_reply_at=ago(3), now=NOW)
        self.assertEqual((state.phase, state.holding_due), ("waiting", False))
        state = window.evaluate(opened_at=ago(8), last_human_at=None, last_reply_at=ago(6), now=NOW)
        self.assertEqual((state.phase, state.holding_due), ("waiting", True))

    def test_nobody_replied_within_the_window_returns_to_ai(self):
        state = window.evaluate(opened_at=ago(16), last_human_at=None, last_reply_at=ago(10), now=NOW)
        self.assertEqual(state.phase, "expired")

    def test_active_person_keeps_ai_quiet_then_idle_window_returns_to_ai(self):
        state = window.evaluate(opened_at=ago(40), last_human_at=ago(2), last_reply_at=ago(2), now=NOW)
        self.assertEqual((state.phase, state.holding_due), ("human_active", False))
        state = window.evaluate(opened_at=ago(40), last_human_at=ago(10), last_reply_at=ago(10), now=NOW)
        self.assertEqual((state.phase, state.holding_due), ("human_active", True))
        state = window.evaluate(opened_at=ago(60), last_human_at=ago(31), last_reply_at=ago(31), now=NOW)
        self.assertEqual(state.phase, "expired")

    def test_a_reply_from_before_the_handoff_does_not_count(self):
        state = window.evaluate(opened_at=ago(5), last_human_at=ago(50), last_reply_at=ago(5), now=NOW)
        self.assertEqual(state.phase, "waiting")


class PipelineTests(unittest.TestCase):
    def _send(self, handoff, timeline, *, expired_closes=True):
        from app import main
        created = []

        def create(**kwargs):
            row = {"id": f"m{len(created)}", **kwargs}
            created.append(row)
            return row
        with (
            patch.object(main, "get_conversation", return_value={"business_id": BUSINESS, "summary": ""}),
            patch.object(main, "create_message", side_effect=create),
            patch.object(main, "active_handoff_for_conversation", return_value=handoff),
            patch.object(main.handoff_window, "conversation_timeline", return_value=timeline),
            patch.object(main.handoff_window, "close_handoff_for_timeout", return_value=expired_closes) as close,
            patch.object(main, "list_messages", side_effect=RuntimeError("AI path reached")),
            patch.object(main, "analyze_intent", side_effect=RuntimeError("AI path reached")) as analyze,
        ):
            try:
                result = main._send_message_core(CONVERSATION, {"content": "hello?"}, inbound_context={
                    "channel": "instagram", "provider_event_id": "e1", "automation_reply_enabled": True})
            except RuntimeError as exc:
                result = {"ai_path": str(exc)}
        return result, created, close, analyze

    def test_waiting_customer_gets_a_holding_reply_instead_of_silence(self):
        recent = (datetime.now(timezone.utc) - timedelta(minutes=8)).isoformat()
        older = (datetime.now(timezone.utc) - timedelta(minutes=7)).isoformat()
        result, created, close, analyze = self._send(
            {"id": "h1", "status": "requested", "requested_at": recent, "business_id": BUSINESS}, (None, older))
        self.assertTrue(result["automation_paused"])
        self.assertEqual(result["ai_message"]["sender_type"], "ai")
        self.assertIn("a member of our team has your message", result["ai_message"]["content"])
        analyze.assert_not_called()
        close.assert_not_called()

    def test_expired_handoff_closes_and_the_ai_answers(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        result, created, close, analyze = self._send(
            {"id": "h1", "status": "requested", "requested_at": old, "business_id": BUSINESS}, (None, old))
        close.assert_called_once()
        self.assertEqual(close.call_args.args[1], "no_reply_within_window")
        self.assertEqual(result, {"ai_path": "AI path reached"})


class SweepTests(unittest.TestCase):
    def test_sweep_closes_expired_handoffs_and_tells_the_customer(self):
        handoffs = [
            {"id": "h-old", "business_id": BUSINESS, "conversation_id": "c1", "requested_by": "u1", "assigned_to": None,
             "status": "requested", "requested_at": ago(40)},
            {"id": "h-new", "business_id": BUSINESS, "conversation_id": "c2", "requested_by": "u1", "assigned_to": None,
             "status": "requested", "requested_at": ago(2)},
        ]
        inserted = []
        db = MagicMock()

        def table(name):
            query = MagicMock()
            if name == "conversation_handoffs":
                query.select.return_value.in_.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=handoffs)
            if name == "messages":
                query.insert.side_effect = lambda row: inserted.append(row) or SimpleNamespace(
                    execute=lambda: SimpleNamespace(data=[{"id": "resume", **row}]))
            return query
        db.table.side_effect = table
        delivered = []
        with (
            patch.object(window, "_db", return_value=db),
            patch.object(window, "conversation_timeline", return_value=(None, None)),
            patch.object(window, "close_handoff_for_timeout", return_value=True) as close,
            patch.multiple(window.settings, HANDOFF_WAIT_MINUTES=15, HANDOFF_IDLE_MINUTES=30, HANDOFF_HOLDING_INTERVAL_MINUTES=5),
        ):
            closed = window.sweep_business_handoffs(deliver=lambda handoff, message: delivered.append(handoff["id"]), now=NOW)
        self.assertEqual(closed, 1)
        self.assertEqual(close.call_args.args[0]["id"], "h-old")
        self.assertEqual(inserted[0]["content"], window.RESUMED_REPLY)
        self.assertEqual(delivered, ["h-old"])


class KeepaliveTests(unittest.TestCase):
    def test_blip_reads_writes_and_touches_auth(self):
        from app.infrastructure import keepalive
        client = MagicMock()
        with patch("app.database.client.supabase", client):
            result = keepalive.blip()
        tables = [call.args[0] for call in client.table.call_args_list]
        self.assertIn("directory_categories", tables)
        self.assertIn("platform_heartbeats", tables)
        client.auth.admin.list_users.assert_called_once()
        self.assertIn("at", result)


if __name__ == "__main__":
    unittest.main()
