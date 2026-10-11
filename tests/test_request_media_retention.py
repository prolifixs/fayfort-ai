from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.accounts.request_media_retention import purge_expired_request_evidence


class RequestMediaRetentionTests(unittest.TestCase):
    @patch("app.accounts.request_media_retention.supabase.table")
    def test_no_terminal_events_does_not_query_media(self, table):
        events = MagicMock()
        events.select.return_value.in_.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        source_events = MagicMock()
        source_events.select.return_value.in_.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        table.side_effect = [events, source_events]

        result = purge_expired_request_evidence(now=datetime(2026, 10, 10, tzinfo=timezone.utc))

        self.assertEqual(result, {"eligible": 0, "deleted": 0, "failed": 0})
        self.assertEqual(events.select.return_value.in_.return_value.lt.call_args.args[0], "created_at")
        self.assertEqual(table.call_args_list, [unittest.mock.call("member_request_events"), unittest.mock.call("member_request_events")])

    @patch("app.accounts.request_media_retention._remove_storage_object")
    @patch("app.accounts.request_media_retention.supabase.table")
    def test_removes_storage_before_metadata_and_keeps_timeline(self, table, remove_storage):
        events = MagicMock()
        events.select.return_value.in_.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "terminal-event", "request_id": "request"},
        ]
        source_events = MagicMock()
        source_events.select.return_value.in_.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        media = MagicMock()
        media.select.return_value.in_.return_value.limit.return_value.execute.return_value.data = [
            {"id": "media-1", "storage_path": "request/event/file.png"},
        ]
        media.delete.return_value.eq.return_value.execute.return_value.data = []
        table.side_effect = [events, media, media, source_events]

        result = purge_expired_request_evidence(now=datetime(2026, 10, 10, tzinfo=timezone.utc))

        self.assertEqual(result, {"eligible": 1, "deleted": 1, "failed": 0})
        remove_storage.assert_called_once_with("request/event/file.png")
        media.delete.return_value.eq.assert_called_once_with("id", "media-1")
        self.assertEqual(events.delete.call_count, 0)

    @patch("app.accounts.request_media_retention._remove_storage_object", side_effect=RuntimeError("storage unavailable"))
    @patch("app.accounts.request_media_retention.supabase.table")
    def test_storage_failure_preserves_metadata_for_retry(self, table, remove_storage):
        events = MagicMock()
        events.select.return_value.in_.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "terminal-event", "request_id": "request"},
        ]
        source_events = MagicMock()
        source_events.select.return_value.in_.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        media = MagicMock()
        media.select.return_value.in_.return_value.limit.return_value.execute.return_value.data = [
            {"id": "media-1", "storage_path": "request/event/file.png"},
        ]
        table.side_effect = [events, media, source_events]
        result = purge_expired_request_evidence(now=datetime(2026, 10, 10, tzinfo=timezone.utc))

        self.assertEqual(result, {"eligible": 1, "deleted": 0, "failed": 1})
        media.delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
