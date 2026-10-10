from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.page_limit = None

    def select(self, value):
        self.selected = value
        return self

    def eq(self, key, value):
        self.filters.append(("eq", key, value))
        return self

    def gte(self, key, value):
        self.filters.append(("gte", key, value))
        return self

    def lt(self, key, value):
        self.filters.append(("lt", key, value))
        return self

    def order(self, key, desc=False):
        self.ordering = (key, desc)
        return self

    def limit(self, value):
        self.page_limit = value
        return self

    def execute(self):
        return type("Result", (), {"data": self.rows[:self.page_limit]})()


class AnalyticsWorkflowTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    @patch("app.dashboard.modules.supabase.table")
    def test_counts_cap_at_500_and_activity_pages_have_cursor(self, table, member):
        sample = [
            {"id": 501 - index, "event_type": "message.received" if index % 2 else "handoff.requested",
             "entity_type": "conversation", "entity_id": f"conversation-{index}", "payload": {},
             "created_at": "2026-10-09T00:00:00+00:00"}
            for index in range(501)
        ]
        page = [
            {"id": 100 - index, "event_type": "message.received", "entity_type": "conversation",
             "entity_id": f"conversation-{index}", "payload": {},
             "created_at": "2026-10-09T00:00:00+00:00"}
            for index in range(51)
        ]
        queries = [FakeQuery(sample), FakeQuery(page)]
        query_queue = list(queries)
        table.side_effect = lambda name: type("Table", (), {"select": lambda _self, value: query_queue.pop(0).select(value)})()

        response = self.client.get(
            f"/businesses/{BUSINESS}/analytics?days=30&limit=50",
            headers={"Authorization": "Bearer owner-token"},
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["sampled_events"], 500)
        self.assertTrue(result["summary_truncated"])
        self.assertEqual(sum(result["event_counts"].values()), 500)
        self.assertEqual(len(result["events"]), 50)
        self.assertTrue(result["has_more"])
        self.assertEqual(result["next_before_id"], 51)
        self.assertEqual(set(result["events"][0]), {"id", "event_type", "entity_type", "entity_id", "created_at"})

    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "member"})
    @patch("app.dashboard.modules.supabase.table")
    def test_selected_window_cursor_and_business_scope_are_applied(self, table, member):
        rows = [{"id": 11, "event_type": "settings.updated", "entity_type": "business",
                 "entity_id": BUSINESS, "payload": {}, "created_at": "2026-10-09T00:00:00+00:00"}]
        queries = [FakeQuery(rows), FakeQuery(rows)]
        query_queue = list(queries)
        table.side_effect = lambda name: type("Table", (), {"select": lambda _self, value: query_queue.pop(0).select(value)})()

        response = self.client.get(
            f"/businesses/{BUSINESS}/analytics?days=7&limit=10&before_id=20",
            headers={"Authorization": "Bearer member-token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["days"], 7)
        self.assertEqual(response.json()["events"][0]["id"], 11)
        self.assertIn(("eq", "business_id", BUSINESS), queries[0].filters)
        self.assertIn(("lt", "id", 20), queries[1].filters)
        self.assertEqual(queries[0].ordering, ("id", True))

    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "member"})
    @patch("app.dashboard.modules.supabase.table")
    def test_unsupported_window_and_out_of_range_page_size_are_rejected(self, table, member):
        invalid_window = self.client.get(
            f"/businesses/{BUSINESS}/analytics?days=14",
            headers={"Authorization": "Bearer member-token"},
        )
        invalid_limit = self.client.get(
            f"/businesses/{BUSINESS}/analytics?limit=101",
            headers={"Authorization": "Bearer member-token"},
        )
        self.assertEqual(invalid_window.status_code, 422)
        self.assertEqual(invalid_limit.status_code, 422)
        table.assert_not_called()

    @patch("app.dashboard.modules.trusted_business_member", return_value=None)
    @patch("app.dashboard.modules.supabase.table")
    def test_unauthorized_analytics_does_not_query_events(self, table, member):
        response = self.client.get(f"/businesses/{BUSINESS}/analytics")
        self.assertEqual(response.status_code, 401)
        table.assert_not_called()

    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.supabase.rpc")
    def test_ai_usage_summary_groups_calls_and_keeps_unknown_usage_visible(self, rpc, table, member):
        rows = [
            {"operation": "intent", "model": "openai/gpt-oss-120b", "provider": "deepinfra", "request_status": "completed", "prompt_tokens": 80,
             "completion_tokens": 20, "total_tokens": 100, "source_message_id": "message-1"},
            {"operation": "response", "model": "openai/gpt-oss-120b", "provider": "deepinfra", "request_status": "completed", "prompt_tokens": 100,
             "completion_tokens": 30, "total_tokens": 130, "source_message_id": "message-1"},
            {"operation": "intent", "model": "openai/gpt-oss-120b", "provider": "deepinfra", "request_status": "unknown", "prompt_tokens": None,
             "completion_tokens": None, "total_tokens": None, "source_message_id": "message-2"},
        ]
        query = FakeQuery(rows)
        table.return_value.select.return_value = query
        rpc.return_value.execute.return_value.data = {
            "limit_micro_usd": 25_000_000,
            "committed_micro_usd": 1_200,
            "pending_micro_usd": 200,
            "remaining_micro_usd": 24_998_800,
            "month_start": "2026-10-01T00:00:00Z",
        }

        response = self.client.get(
            f"/businesses/{BUSINESS}/ai-usage?days=30",
            headers={"Authorization": "Bearer owner-token"},
        )

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["sampled_requests"], 3)
        self.assertEqual(result["reported_usage_requests"], 2)
        self.assertEqual(result["unknown_usage_requests"], 1)
        self.assertEqual(result["source_messages"], 2)
        self.assertEqual(result["message_call_distribution"], {"1": 1, "2": 1})
        self.assertEqual(result["total_tokens"], 230)
        self.assertEqual(result["operations"]["intent"]["calls"], 2)
        self.assertEqual(result["operations"]["response"]["completion_tokens"], 30)
        self.assertEqual(result["providers"], {"deepinfra": 3})
        self.assertEqual(result["budget"]["limit_usd"], 25)
        self.assertEqual(result["budget"]["committed_usd"], 0.0012)
        self.assertIn(("eq", "business_id", BUSINESS), query.filters)
        self.assertEqual(rpc.call_args.args[0], "get_ai_usage_budget_status")


if __name__ == "__main__":
    unittest.main()
