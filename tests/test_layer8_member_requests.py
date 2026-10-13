from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

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
            "p_source_type": "catalog_product", "p_source_url": None, "p_source_image": None,
        })

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_can_request_from_site_catalog(self, identity, get_user, rpc):
        rpc.return_value.execute.return_value.data = REQUEST
        response = self.client.post("/members/requests", headers={"Authorization": "Bearer member-token"}, json={
            "request_title": "Source the catalog item", "source_type": "catalog_product", "product_id": PRODUCT,
        })
        self.assertEqual(response.status_code, 201)
        rpc.assert_called_once_with("create_member_purchase_request", {
            "p_member_id": MEMBER, "p_request_title": "Source the catalog item",
            "p_request_description": None, "p_product_id": PRODUCT,
            "p_source_type": "catalog_product", "p_source_url": None, "p_source_image": None,
        })

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_can_submit_https_product_link(self, identity, get_user, rpc):
        rpc.return_value.execute.return_value.data = REQUEST
        response = self.client.post("/members/requests", headers={"Authorization": "Bearer member-token"}, json={
            "request_title": "Source this social post", "source_type": "url",
            "source_url": "https://www.instagram.com/p/example/",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(rpc.call_args.args[1]["p_source_url"], "https://www.instagram.com/p/example/")
        self.assertEqual(rpc.call_args.args[1]["p_source_type"], "url")

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_product_link_must_be_https(self, identity, get_user, rpc):
        response = self.client.post("/members/requests", headers={"Authorization": "Bearer member-token"}, json={
            "request_title": "Unsafe link", "source_type": "url", "source_url": "http://example.test/item",
        })
        self.assertEqual(response.status_code, 422)
        rpc.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_option_choice_error_identifies_standard_selection_stage(self, identity, get_user, rpc, table):
        occurrence_query = MagicMock()
        occurrence_query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        table.return_value = occurrence_query
        rpc.return_value.execute.side_effect = RuntimeError("synthetic RPC failure")

        response = self.client.post(f"/members/requests/{REQUEST}/sourcing-option",
            headers={"Authorization": "Bearer member-token"}, json={"option_id": PRODUCT})

        self.assertEqual(response.status_code, 409)
        self.assertIn("Diagnostic: standard_option_selection", response.json()["detail"])
        rpc.assert_called_once_with("select_member_sourcing_option", {
            "p_request_id": REQUEST, "p_option_id": PRODUCT, "p_member_id": MEMBER,
        })

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_option_choice_error_identifies_schedule_lookup_stage(self, identity, get_user, rpc, table):
        occurrence_query = MagicMock()
        occurrence_query.select.return_value.eq.return_value.limit.return_value.execute.side_effect = RuntimeError("synthetic lookup failure")
        table.return_value = occurrence_query

        response = self.client.post(f"/members/requests/{REQUEST}/sourcing-option",
            headers={"Authorization": "Bearer member-token"}, json={"option_id": PRODUCT})

        self.assertEqual(response.status_code, 409)
        self.assertIn("Diagnostic: schedule_lookup", response.json()["detail"])
        rpc.assert_not_called()

    @patch("app.accounts.router.supabase.storage.from_")
    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_can_submit_private_request_screenshot(self, identity, get_user, rpc, storage):
        rpc.return_value.execute.return_value.data = REQUEST
        storage_bucket = MagicMock()
        storage.return_value = storage_bucket
        response = self.client.post("/members/requests/image?request_title=Find+this&filename=item.png",
            headers={"Authorization": "Bearer member-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nPNG DATA")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["source_type"], "image")
        storage_bucket.upload.assert_called_once()
        rpc.assert_called_once()
        self.assertEqual(rpc.call_args.args[1]["p_source_type"], "image")
        self.assertEqual(rpc.call_args.args[1]["p_source_image"]["content_type"], "image/png")

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
        source_query = MagicMock()
        source_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = []
        options_query = MagicMock()
        options_query.select.return_value.in_.return_value.execute.return_value.data = []
        table.side_effect = [request_query, source_query, event_query, options_query]

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
            "p_details": {},
        })

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_shipped_milestone_requires_tracking_number(self, identity, get_user, table, rpc):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        table.return_value = worker_query

        response = self.client.post(f"/workers/requests/{REQUEST}/events", headers={"Authorization": "Bearer worker-token"}, json={
            "stage": "shipped", "member_note": "Dispatched today.",
        })

        self.assertEqual(response.status_code, 422)
        self.assertIn("tracking number is required", response.json()["detail"])
        rpc.assert_not_called()

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_shipped_milestone_stores_tracking_details(self, identity, get_user, table, rpc):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        table.return_value = worker_query
        rpc.return_value.execute.return_value.data = 4

        response = self.client.post(f"/workers/requests/{REQUEST}/events", headers={"Authorization": "Bearer worker-token"}, json={
            "stage": "shipped", "tracking_number": "  FF123  ", "carrier_name": "FayShip",
            "tracking_url": "https://tracking.example.test/FF123",
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sequence_no"], 4)
        rpc.assert_called_once_with("append_member_request_milestone", {
            "p_request_id": REQUEST, "p_worker_id": WORKER, "p_stage": "shipped",
            "p_member_note": None, "p_details": {"tracking_number": "FF123", "carrier_name": "FayShip",
                "tracking_url": "https://tracking.example.test/FF123"},
        })

    @patch("app.accounts.router.supabase.storage.from_")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_warehouse_evidence_upload_checks_assignment_and_stage(self, identity, get_user, table, storage):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "assigned_worker_id": WORKER,
        }
        event_query = MagicMock()
        event_query.select.return_value.eq.return_value.order.return_value.limit.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "event-warehouse", "stage": "item_in_warehouse",
        }
        media_query = MagicMock()
        media_query.insert.return_value.execute.return_value.data = [{"id": "media-1"}]
        table.side_effect = [worker_query, request_query, event_query, media_query]
        storage_bucket = MagicMock()
        storage_bucket.create_signed_url.return_value = {"signedURL": "https://storage.example.test/signed/evidence"}
        storage.return_value = storage_bucket

        response = self.client.post(f"/workers/requests/{REQUEST}/evidence?filename=warehouse.png",
            headers={"Authorization": "Bearer worker-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nPNG DATA")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["media"]["url"], "https://storage.example.test/signed/evidence")
        self.assertNotIn("storage_path", response.json()["media"])
        storage_bucket.upload.assert_called_once()
        self.assertEqual(media_query.insert.call_args.args[0]["event_id"], "event-warehouse")

    @patch("app.accounts.router.supabase.storage.from_")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_operations_fulfillment_claim_can_upload_warehouse_evidence(self, identity, get_user, table, storage):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "assigned_worker_id": "00000000-0000-0000-0000-000000000099",
        }
        claim_query = MagicMock()
        claim_query.select.return_value.eq.return_value.eq.return_value.eq.return_value.eq.return_value.gt.return_value.limit.return_value.execute.return_value.data = [{"id": "work-item"}]
        event_query = MagicMock()
        event_query.select.return_value.eq.return_value.order.return_value.limit.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "event-warehouse", "stage": "item_in_warehouse",
        }
        media_query = MagicMock()
        media_query.insert.return_value.execute.return_value.data = [{"id": "media-1"}]
        table.side_effect = [worker_query, request_query, claim_query, event_query, media_query]
        storage_bucket = MagicMock()
        storage_bucket.create_signed_url.return_value = {"signedURL": "https://storage.example.test/signed/evidence"}
        storage.return_value = storage_bucket

        response = self.client.post(f"/workers/requests/{REQUEST}/evidence?filename=warehouse.png",
            headers={"Authorization": "Bearer worker-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nPNG DATA")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["media"]["id"], "media-1")
        self.assertEqual(media_query.insert.call_args.args[0]["created_by"], WORKER)
        claim_query.select.return_value.eq.return_value.eq.return_value.eq.return_value.eq.return_value.gt.assert_called_once()

    @patch("app.accounts.router.supabase.storage.from_")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_warehouse_evidence_cannot_upload_outside_warehouse_stage(self, identity, get_user, table, storage):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "assigned_worker_id": WORKER,
        }
        event_query = MagicMock()
        event_query.select.return_value.eq.return_value.order.return_value.limit.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "event-sourcing", "stage": "sourcing",
        }
        table.side_effect = [worker_query, request_query, event_query]

        response = self.client.post(f"/workers/requests/{REQUEST}/evidence?filename=warehouse.png",
            headers={"Authorization": "Bearer worker-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nPNG DATA")

        self.assertEqual(response.status_code, 409)
        storage.assert_not_called()

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

    @patch("app.accounts.router.supabase.storage.from_")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_assigned_worker_reads_persisted_warehouse_evidence_after_refresh(self, identity, get_user, table, storage):
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "id": REQUEST, "request_title": "Source widget", "created_at": "now", "updated_at": "now",
        }]
        event_query = MagicMock()
        event_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = [{
            "id": "event-warehouse", "request_id": REQUEST, "sequence_no": 1,
            "stage": "item_in_warehouse", "member_note": None, "details": {}, "created_at": "now",
        }]
        media_query = MagicMock()
        media_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = [{
            "id": "media-1", "event_id": "event-warehouse", "storage_path": "private/path/warehouse.png",
            "content_type": "image/png", "byte_size": 128, "original_filename": "warehouse.png", "created_at": "now",
        }]
        source_query = MagicMock()
        source_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = []
        operations_query = MagicMock()
        operations_query.select.return_value.eq.return_value.eq.return_value.in_.return_value.gt.return_value.execute.return_value.data = []
        table.side_effect = [worker_query, request_query, operations_query, source_query, event_query, media_query]
        storage_bucket = MagicMock()
        storage_bucket.create_signed_url.return_value = {"signedURL": "https://storage.example.test/signed/warehouse"}
        storage.return_value = storage_bucket

        response = self.client.get("/workers/requests", headers={"Authorization": "Bearer worker-token"})

        self.assertEqual(response.status_code, 200)
        media = response.json()["requests"][0]["events"][0]["media"][0]
        self.assertEqual(media["id"], "media-1")
        self.assertEqual(media["url"], "https://storage.example.test/signed/warehouse")
        self.assertNotIn("storage_path", media)
        storage_bucket.create_signed_url.assert_called_once_with("private/path/warehouse.png", 900)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=WORKER)
    def test_active_operations_claim_exposes_request_to_worker_milestone_page(self, identity, get_user, table):
        from datetime import datetime, timedelta, timezone

        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "active"}
        directly_assigned_query = MagicMock()
        directly_assigned_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        operations_query = MagicMock()
        operations_query.select.return_value.eq.return_value.eq.return_value.in_.return_value.gt.return_value.execute.return_value.data = [{
            "id": "operations-work-item", "member_request_id": REQUEST,
            "claimed_until": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }]
        claimed_request_query = MagicMock()
        claimed_request_query.select.return_value.in_.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "id": REQUEST, "request_title": "[ACCEPTANCE TEST] Future recurring edit 2026-10-12",
            "request_description": "Synthetic request", "created_at": "now", "updated_at": "now",
        }]
        source_query = MagicMock()
        source_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = []
        events_query = MagicMock()
        events_query.select.return_value.in_.return_value.order.return_value.execute.return_value.data = [{
            "id": "event-1", "request_id": REQUEST, "sequence_no": 1, "stage": "submitted",
            "member_note": None, "details": {}, "created_at": "now",
        }]
        table.side_effect = [worker_query, directly_assigned_query, operations_query,
            claimed_request_query, source_query, events_query]

        response = self.client.get("/workers/requests", headers={"Authorization": "Bearer worker-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["requests"]), 1)
        self.assertEqual(response.json()["requests"][0]["id"], REQUEST)
        self.assertEqual(response.json()["requests"][0]["operations_work_item_id"], "operations-work-item")

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

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_recurring_intent_records_non_executable_schedule(self, identity, get_user, rpc):
        schedule_id = "00000000-0000-0000-0000-000000000050"
        idempotency_key = "00000000-0000-0000-0000-000000000060"
        rpc.return_value.execute.return_value.data = {
            "request_id": REQUEST, "schedule_intent_id": schedule_id, "status": "awaiting_policy",
        }
        response = self.client.post("/members/requests/recurring-intent",
            headers={"Authorization": "Bearer member-token"}, json={
                "request_title": "Monthly coffee", "source_type": "description",
                "recurrence": {"cadence": "monthly", "units_per_order": 2, "occurrence_count": 6},
                "idempotency_key": idempotency_key,
            })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["schedule_status"], "awaiting_policy")
        self.assertIn("will not create orders or charges", response.json()["message"])
        rpc.assert_called_once_with("create_member_recurring_request_intent", {
            "p_member_id": MEMBER, "p_request_title": "Monthly coffee", "p_request_description": None,
            "p_product_id": None, "p_source_type": "description", "p_source_url": None,
            "p_source_image": None, "p_conversation_id": None,
            "p_recurrence": {"cadence": "monthly", "interval_count": 1, "interval_unit": "months",
                "units_per_order": 2, "occurrence_count": 6},
            "p_idempotency_key": idempotency_key,
        })

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_recurring_custom_interval_requires_count_and_unit(self, identity, get_user, rpc):
        response = self.client.post("/members/requests/recurring-intent",
            headers={"Authorization": "Bearer member-token"}, json={
                "request_title": "Custom recurring item",
                "recurrence": {"cadence": "custom", "units_per_order": 1, "occurrence_count": 3},
                "idempotency_key": "00000000-0000-0000-0000-000000000061",
            })
        self.assertEqual(response.status_code, 422)
        rpc.assert_not_called()

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_can_edit_future_recurring_cycle_units_and_local_date(self, identity, get_user, table, rpc):
        schedule_id = "00000000-0000-0000-0000-000000000070"
        schedule_query = MagicMock()
        schedule_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "time_zone": "America/Los_Angeles", "status": "active", "version": 3,
            "next_due_at": "2026-12-01T18:00:00+00:00", "expires_at": "2027-10-01T00:00:00+00:00",
        }
        table.return_value = schedule_query
        rpc.return_value.execute.return_value.data = {"schedule_id": schedule_id, "version": 4}
        next_local = (datetime.now(ZoneInfo("America/Los_Angeles")).replace(tzinfo=None) + timedelta(days=4)).replace(second=0, microsecond=0)

        response = self.client.patch(f"/members/recurring-schedules/{schedule_id}",
            headers={"Authorization": "Bearer member-token"}, json={
                "expected_version": 3, "units_per_order": 4, "next_due_local": next_local.isoformat(),
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["schedule"]["version"], 4)
        rpc.assert_called_once()
        self.assertEqual(rpc.call_args.args[0], "edit_member_request_schedule")
        self.assertEqual(rpc.call_args.args[1]["p_member_id"], MEMBER)
        self.assertEqual(rpc.call_args.args[1]["p_units_per_order"], 4)
        self.assertEqual(rpc.call_args.args[1]["p_expected_version"], 3)
        self.assertTrue(rpc.call_args.args[1]["p_next_due_at"].endswith("+00:00"))

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_recurring_schedule_edit_uses_earlier_occurrence_for_ambiguous_dst_time(self, identity, get_user, table, rpc):
        schedule_query = MagicMock()
        schedule_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "time_zone": "America/Los_Angeles", "status": "active", "version": 3,
            "next_due_at": "2026-12-01T18:00:00+00:00", "expires_at": "2027-12-01T00:00:00+00:00",
        }
        table.return_value = schedule_query
        rpc.return_value.execute.return_value.data = {"schedule_id": "schedule", "version": 4}

        response = self.client.patch("/members/recurring-schedules/00000000-0000-0000-0000-000000000070",
            headers={"Authorization": "Bearer member-token"}, json={
                "expected_version": 3, "next_due_local": "2026-11-01T01:30:00",
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(rpc.call_args.args[1]["p_next_due_at"], "2026-11-01T08:30:00+00:00")

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_recurring_schedule_edit_advances_nonexistent_dst_time_to_first_valid_minute(self, identity, get_user, table, rpc):
        schedule_query = MagicMock()
        schedule_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "time_zone": "America/Los_Angeles", "status": "active", "version": 3,
            "next_due_at": "2026-12-01T18:00:00+00:00", "expires_at": "2027-12-01T00:00:00+00:00",
        }
        table.return_value = schedule_query
        rpc.return_value.execute.return_value.data = {"schedule_id": "schedule", "version": 4}

        response = self.client.patch("/members/recurring-schedules/00000000-0000-0000-0000-000000000070",
            headers={"Authorization": "Bearer member-token"}, json={
                "expected_version": 3, "next_due_local": "2027-03-14T02:30:00",
            })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(rpc.call_args.args[1]["p_next_due_at"], "2027-03-14T10:00:00+00:00")

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_recurring_schedule_edit_requires_at_least_one_change(self, identity, get_user, table):
        response = self.client.patch("/members/recurring-schedules/00000000-0000-0000-0000-000000000070",
            headers={"Authorization": "Bearer member-token"}, json={"expected_version": 1})
        self.assertEqual(response.status_code, 422)
        table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
