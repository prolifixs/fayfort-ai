from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.analytics_charts import build_charts, event_group, event_label
from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)


def at(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


class BuildChartsTests(unittest.TestCase):
    def rows(self):
        return {
            "business_events": [
                {"event_type": "channel.inbound.processed", "created_at": at(0.1)},
                {"event_type": "channel.inbound.processed", "created_at": at(1.2)},
                {"event_type": "handoff.requested", "created_at": at(1.3)},
                {"event_type": "automation.execution_recorded", "created_at": at(3)},
                {"event_type": "connection.created", "created_at": at(5)},
                {"event_type": "channel.inbound.processed", "created_at": at(9)},  # previous window
            ],
            "conversations": [
                {"channel": "instagram", "created_at": at(0.2)},
                {"channel": "instagram", "created_at": at(2)},
                {"channel": "messenger", "created_at": at(2.5)},
                {"channel": "instagram", "created_at": at(10)},
                {"channel": "instagram", "created_at": at(11)},
            ],
            "conversation_handoffs": [
                {"status": "requested", "requested_at": at(0.3)},
                {"status": "returned", "requested_at": at(4)},
            ],
            "ai_usage_events": [
                {"operation": "response", "total_tokens": 1000, "actual_cost_micro_usd": 2000, "estimated_cost_micro_usd": 9000, "created_at": at(0.5)},
                {"operation": "intent", "total_tokens": None, "actual_cost_micro_usd": None, "estimated_cost_micro_usd": 500, "created_at": at(1.5)},
                {"operation": "response", "total_tokens": 400, "created_at": at(8)},
            ],
        }

    def fetch(self, table, columns, time_column, since):
        return [row for row in self.rows()[table] if datetime.fromisoformat(row[time_column]) >= since]

    def test_buckets_totals_and_changes(self):
        result = build_charts(7, self.fetch, now=NOW)
        self.assertEqual(result["bucket"], "day")
        self.assertEqual(len(result["activity"]), 7)
        self.assertEqual(result["activity"][-1]["bucket"], "2026-10-19")
        self.assertEqual(result["totals"]["events"]["value"], 5)
        self.assertEqual(result["totals"]["events"]["change"], 4.0)
        self.assertEqual(result["totals"]["messages"]["value"], 2)
        self.assertEqual(result["totals"]["conversations"], {"value": 3, "change": 0.5})
        self.assertEqual(result["totals"]["handoffs"], {"value": 2, "change": None})
        self.assertEqual(result["totals"]["ai_calls"]["value"], 2)
        # Actual cost wins over the estimate; the estimate is used when there is no actual cost.
        self.assertAlmostEqual(result["totals"]["ai_cost_usd"]["value"], 0.0025)
        self.assertEqual(sum(day["messages"] for day in result["activity"]), 2)
        self.assertEqual(result["activity"][-1]["messages"], 1)
        self.assertEqual(result["channels"], ["instagram", "messenger"])
        self.assertNotIn("other", result["conversations"][0])
        self.assertEqual(sum(day["instagram"] for day in result["conversations"]), 2)
        self.assertEqual(result["handoffs"]["by_status"], {"requested": 1, "returned": 1})
        self.assertEqual(result["ai"]["by_operation"][0]["operation"], "response")
        self.assertEqual(result["ai"]["by_operation"][0]["tokens"], 1000)
        self.assertEqual(result["top_events"][0], {"event_type": "channel.inbound.processed", "label": "Messages received", "count": 2})
        self.assertFalse(result["truncated"])

    def test_ninety_days_is_weekly(self):
        result = build_charts(90, self.fetch, now=NOW)
        self.assertEqual(result["bucket"], "week")
        self.assertEqual(len(result["activity"]), 13)
        self.assertEqual(sum(week["messages"] for week in result["activity"]), 3)

    def test_caps_rows_and_flags_truncation(self):
        many = [{"event_type": "channel.inbound.processed", "created_at": at(0.1)}] * 10_001
        result = build_charts(7, lambda table, *_: many if table == "business_events" else [], now=NOW)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["totals"]["events"]["value"], 10_000)

    def test_groups_and_labels(self):
        self.assertEqual(event_group("handoff.taken_over"), "handoffs")
        self.assertEqual(event_group("entitlement.granted"), "setup")
        self.assertEqual(event_group("something.new"), "setup")
        self.assertEqual(event_label("automation.execution_recorded"), "Automation runs")
        self.assertEqual(event_label("brand.new_thing"), "Brand new thing")


class ChartsEndpointTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    @patch("app.dashboard.modules.supabase.table")
    def test_endpoint_reads_each_source_for_the_business(self, table, member):
        calls = []

        class Query:
            def __init__(self, name):
                self.name = name

            def select(self, columns):
                calls.append((self.name, columns))
                return self

            def eq(self, key, value):
                assert (key, value) == ("business_id", BUSINESS)
                return self

            def gte(self, *_):
                return self

            def order(self, *_args, **_kwargs):
                return self

            def limit(self, value):
                assert value == 10_001
                return self

            def execute(self):
                return type("Result", (), {"data": []})()

        table.side_effect = Query
        response = self.client.get(f"/businesses/{BUSINESS}/analytics/charts?days=30", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({name for name, _ in calls}, {"business_events", "conversations", "conversation_handoffs", "ai_usage_events"})
        self.assertEqual(len(response.json()["activity"]), 30)

    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    def test_rejects_other_windows(self, member):
        response = self.client.get(f"/businesses/{BUSINESS}/analytics/charts?days=14", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 422)
