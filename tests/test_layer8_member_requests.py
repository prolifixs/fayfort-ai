from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router


MEMBER = "00000000-0000-0000-0000-000000000010"
WORKER = "00000000-0000-0000-0000-000000000020"
REQUEST = "00000000-0000-0000-0000-000000000030"
PRODUCT = "00000000-0000-0000-0000-000000000040"


class Layer8MemberRequestTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_create_uses_verified_identity_and_atomic_rpc(self, identity, get_user, rpc):
        rpc.return_value.execute.return_value.data = REQUEST
        response = self.client.post("/members/requests", headers={"Authorization": "Bearer member-token"}, json={
            "request_title": "Source a widget", "request_description": "Need two units", "product_id": PRODUCT,
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"request_id": REQUEST, "stage": "submitted"})
        rpc.assert_called_once_with("create_member_purchase_request", {
            "p_member_id": MEMBER, "p_request_title": "Source a widget",
            "p_request_description": "Need two units", "p_product_id": PRODUCT,
        })

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_list_is_owner_filtered_and_hides_actor_identity(self, identity, get_user, table):
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "id": REQUEST, "member_id": MEMBER, "request_title": "Source widget", "product_id": PRODUCT,
            "product_name_snapshot": "Widget", "request_description": None, "created_at": "now", "updated_at": "now",
        }]
        event_query = MagicMock()
        event_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = [{
            "id": "event-1", "request_id": REQUEST, "sequence_no": 1, "stage": "submitted",
            "member_note": None, "created_at": "now", "actor_user_id": MEMBER,
        }]
        table.side_effect = [request_query, event_query]

        response = self.client.get("/members/requests", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(request_query.select.return_value.eq.call_args.args, ("member_id", MEMBER))
        event = response.json()["requests"][0]["events"][0]
        self.assertEqual(event["stage"], "submitted")
        self.assertNotIn("actor_user_id", event)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_active_assigned_worker_can_append_factual_milestone(self, identity, get_user, rpc, table):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        table.return_value = worker_query
        rpc.return_value.execute.return_value.data = 2

        response = self.client.post(f"/workers/requests/{REQUEST}/events", headers={"Authorization": "Bearer worker-token"}, json={
            "stage": "under_review", "member_note": "A specialist is reviewing this request.",
        })

        self.assertEqual(response.status_code, 200)
        rpc.assert_called_once_with("append_member_request_milestone", {
            "p_request_id": REQUEST, "p_worker_id": WORKER,
            "p_stage": "under_review", "p_member_note": "A specialist is reviewing this request.",
        })

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_inactive_worker_cannot_read_assigned_requests(self, identity, get_user, table):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "inactive"}
        table.return_value = worker_query
        response = self.client.get("/workers/requests", headers={"Authorization": "Bearer worker-token"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_cannot_supply_another_owner_id_or_stage(self, identity, get_user, table):
        response = self.client.post("/members/requests", headers={"Authorization": "Bearer member-token"}, json={
            "request_title": "Source widget", "member_id": WORKER, "stage": "purchase_confirmed",
        })
        self.assertEqual(response.status_code, 422)
        table.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.trusted_platform_admin", return_value=None)
    def test_non_admin_cannot_assign_request(self, admin, table):
        response = self.client.patch(f"/platform/requests/{REQUEST}/assignment", headers={"Authorization": "Bearer token"}, json={"worker_id": WORKER})
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
