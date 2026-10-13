from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.accounts.member_notifications import _project_notifications, create_member_notifications_router

MEMBER = "00000000-0000-0000-0000-000000000010"
NOTIFICATION = "00000000-0000-0000-0000-000000000020"
EVENT = "00000000-0000-0000-0000-000000000030"
REQUEST = "00000000-0000-0000-0000-000000000040"


class MemberNotificationTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_member_notifications_router(lambda authorization: MEMBER))
        self.client = TestClient(app)

    @patch("app.accounts.member_notifications.supabase.table")
    def test_lists_owner_scoped_notifications_and_projects_milestone(self, table):
        notifications = MagicMock()
        notifications.select.return_value.eq.return_value.order.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "id": NOTIFICATION, "notification_type": "request_milestone", "request_event_id": EVENT,
            "worker_message_id": None, "review_id": None, "review_status": None,
            "created_at": "2026-10-10T10:00:00Z", "read_at": None, "banner_dismissed_at": None,
        }]
        unread = MagicMock()
        unread.select.return_value.eq.return_value.is_.return_value.execute.return_value = SimpleNamespace(count=1, data=[])
        events = MagicMock()
        events.select.return_value.in_.return_value.execute.return_value.data = [{
            "id": EVENT, "request_id": REQUEST, "stage": "shipped", "member_note": "On its way.",
            "created_at": "2026-10-10T09:59:00Z",
        }]
        requests = MagicMock()
        requests.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = [{
            "id": REQUEST, "request_title": "Source a lamp",
        }]
        table.side_effect = [notifications, unread, events, requests]

        response = self.client.get("/members/notifications", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["unread_count"], 1)
        item = response.json()["notifications"][0]
        self.assertEqual(item["title"], "Source a lamp")
        self.assertEqual(item["body"], "Item shipped — On its way.")
        self.assertEqual(item["href"], f"/member/products#request-{REQUEST}")
        self.assertIsNone(item["read_at"])
        self.assertEqual(requests.select.return_value.eq.call_args.args, ("member_id", MEMBER))

    @patch("app.accounts.member_notifications.supabase.table")
    def test_mark_read_is_member_scoped_and_idempotent(self, table):
        owned = MagicMock()
        owned.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": NOTIFICATION, "member_id": MEMBER, "read_at": "already-read", "banner_dismissed_at": None,
        }
        table.return_value = owned

        response = self.client.post(f"/members/notifications/{NOTIFICATION}/read", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"notification_id": NOTIFICATION, "read": True})
        owned.update.assert_not_called()
        owned.select.return_value.eq.assert_called_once_with("id", NOTIFICATION)
        owned.select.return_value.eq.return_value.eq.assert_called_once_with("member_id", MEMBER)

    @patch("app.accounts.member_notifications.supabase.table")
    def test_cannot_update_another_members_notification(self, table):
        query = MagicMock()
        query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        table.return_value = query

        response = self.client.post(f"/members/notifications/{NOTIFICATION}/dismiss-banner", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 404)
        query.update.assert_not_called()
        query.select.return_value.eq.assert_called_once_with("id", NOTIFICATION)
        query.select.return_value.eq.return_value.eq.assert_called_once_with("member_id", MEMBER)

    def test_invalid_notification_uuid_is_rejected(self):
        response = self.client.post("/members/notifications/not-an-id/read", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 422)

    def test_verification_gate_is_enforced_before_querying(self):
        def reject(_authorization):
            raise HTTPException(status_code=403, detail="Verify your email")

        app = FastAPI()
        app.include_router(create_member_notifications_router(reject))
        with patch("app.accounts.member_notifications.supabase.table") as table:
            response = TestClient(app).get("/members/notifications")
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.member_notifications.supabase.table")
    def test_projects_recurring_schedule_event_only_for_own_schedule(self, table):
        event_query = MagicMock()
        event_query.select.return_value.in_.return_value.execute.return_value.data = [{
            "id": "schedule-event", "schedule_id": "schedule-1", "event_type": "occurrence_created",
            "occurrence_number": 2, "created_at": "2026-10-12T10:00:00Z",
        }]
        schedule_query = MagicMock()
        schedule_query.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = [{
            "id": "schedule-1", "originating_request_id": REQUEST,
        }]
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = [{
            "id": REQUEST, "request_title": "Find a blue jacket",
        }]
        table.side_effect = [event_query, schedule_query, request_query]

        projected = _project_notifications([{
            "id": NOTIFICATION, "notification_type": "recurring_schedule_update",
            "schedule_event_id": "schedule-event", "created_at": "2026-10-12T10:00:00Z",
            "read_at": None, "banner_dismissed_at": None,
        }], MEMBER)

        self.assertEqual(len(projected), 1)
        self.assertEqual(projected[0]["title"], "Find a blue jacket")
        self.assertEqual(projected[0]["body"], "A new sourcing request was created for this schedule. · cycle 2")
        self.assertEqual(projected[0]["href"], "/member/products")
        self.assertEqual(schedule_query.select.return_value.eq.call_args.args, ("member_id", MEMBER))


if __name__ == "__main__":
    unittest.main()
