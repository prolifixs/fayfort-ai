from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.accounts.operations import DisputeCaseCreate, DisputeCaseUpdate, SourcingCandidateCreate, SourcingCandidateUpdate, SourcingBatchCreate, SourcingOptionsShare, WorkItemTransition
from app.accounts.router import create_accounts_router

ADMIN = "00000000-0000-0000-0000-000000000010"
WORKER = "00000000-0000-0000-0000-000000000020"
WORK_ITEM = "00000000-0000-0000-0000-000000000030"
REQUEST = "00000000-0000-0000-0000-000000000040"
DISPUTE_CASE = "00000000-0000-0000-0000-000000000050"


class DepartmentalOperationsTests(unittest.TestCase):
    @property
    def client(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        return TestClient(app)

    def test_sourcing_candidate_requires_complete_http_url_and_evidence(self):
        with self.assertRaises(ValidationError):
            SourcingCandidateCreate(product_name="Blue coat", product_url="javascript:alert(1)", evidence_note="checked")
        candidate = SourcingCandidateCreate(product_name=" Blue coat ", product_url="https://shop.example/item", evidence_note=" Verified details ", currency="usd")
        self.assertEqual(candidate.product_name, "Blue coat")
        self.assertEqual(candidate.evidence_note, "Verified details")
        self.assertEqual(candidate.currency, "USD")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value=None)
    @patch("app.accounts.operations.supabase.table")
    def test_worker_notifications_require_active_fayfort_staff(self, table, identity):
        response = self.client.get("/operations/me/notifications")

        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_notification_inbox_and_preference_are_scoped_to_signed_in_worker(self, table, identity):
        unread_query = MagicMock()
        unread_query.select.return_value.eq.return_value.is_.return_value.is_.return_value.execute.return_value.count = 2
        inbox_query = MagicMock()
        inbox_query.select.return_value.eq.return_value.is_.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "notice-1", "work_item_id": WORK_ITEM, "notification_type": "work_assigned",
             "title": "Work assigned", "body": "Review a request.", "href": "/operations?work_item=" + WORK_ITEM,
             "read_at": None, "dismissed_at": None, "created_at": "2026-10-12T00:00:00Z"},
        ]
        preference_query = MagicMock()
        preference_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "sound_enabled": True,
        }
        table.side_effect = [unread_query, inbox_query, preference_query]

        response = self.client.get("/operations/me/notifications", headers={"Authorization": "Bearer worker-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["unread_count"], 2)
        self.assertTrue(response.json()["sound_enabled"])
        self.assertEqual(response.json()["notifications"][0]["id"], "notice-1")
        for query in (unread_query, inbox_query, preference_query):
            query.select.return_value.eq.assert_called_once_with("worker_id", WORKER)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_mark_all_read_only_touches_the_signed_in_workers_unread_notices(self, table, identity):
        query = MagicMock()
        chain = query.update.return_value.eq.return_value.is_.return_value.is_.return_value
        chain.execute.return_value.data = [{"id": "n1"}, {"id": "n2"}]
        table.return_value = query

        response = self.client.post("/operations/me/notifications/read-all", headers={"Authorization": "Bearer worker-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"marked_read": 2})
        table.assert_called_once_with("operations_worker_notifications")
        self.assertIn("read_at", query.update.call_args.args[0])
        query.update.return_value.eq.assert_called_once_with("worker_id", WORKER)
        query.update.return_value.eq.return_value.is_.assert_called_once_with("read_at", "null")
        query.update.return_value.eq.return_value.is_.return_value.is_.assert_called_once_with("dismissed_at", "null")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value=None)
    @patch("app.accounts.operations.supabase.table")
    def test_mark_all_read_requires_staff(self, table, identity):
        response = self.client.post("/operations/me/notifications/read-all")
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_sound_preference_is_saved_for_signed_in_worker(self, table, identity):
        query = MagicMock()
        query.upsert.return_value.select.return_value.execute.return_value.data = [{
            "worker_id": WORKER, "sound_enabled": True, "updated_at": "2026-10-12T00:00:00Z",
        }]
        table.return_value = query

        response = self.client.put("/operations/me/notification-preferences",
            headers={"Authorization": "Bearer worker-token"}, json={"sound_enabled": True})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["preference"]["sound_enabled"])
        query.upsert.assert_called_once()
        self.assertEqual(query.upsert.call_args.args[0]["worker_id"], WORKER)

    def test_dispute_case_payloads_trim_and_validate_required_fields(self):
        created = DisputeCaseCreate(category="item_condition", summary="  Box arrived damaged  ", next_action="  Review photos  ")
        self.assertEqual(created.summary, "Box arrived damaged")
        self.assertEqual(created.next_action, "Review photos")
        with self.assertRaises(ValidationError):
            DisputeCaseCreate(category="unknown", summary="Issue", next_action="Review")
        with self.assertRaises(ValidationError):
            DisputeCaseUpdate(expected_version=1, status="resolved", resolution="   ")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_admin_opens_separate_dispute_case_from_request_work_item(self, table, rpc, identity):
        query = MagicMock()
        query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "fulfillment", "status": "completed",
            "assigned_worker_id": WORKER, "member_request_id": REQUEST, "dispute_case_id": None,
        }
        table.return_value = query
        rpc.return_value.execute.return_value.data = {
            "dispute_case": {"id": "case-1", "status": "open"},
            "work_item": {"id": "dispute-work-1", "department": "disputes", "dispute_case_id": "case-1"},
        }

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/dispute-cases", json={
            "category": "delivery", "summary": "Parcel marked delivered but not received.",
            "next_action": "Verify carrier delivery evidence.",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["work_item"]["department"], "disputes")
        rpc.assert_called_once_with("create_operations_dispute_case", {
            "p_actor_id": ADMIN, "p_actor_type": "platform_admin", "p_request_id": REQUEST,
            "p_category": "delivery", "p_summary": "Parcel marked delivered but not received.",
            "p_next_action": "Verify carrier delivery evidence.", "p_due_at": None,
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_worker_needs_disputes_access_before_opening_case(self, table, rpc, identity):
        item_query = MagicMock()
        item_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "fulfillment", "status": "completed",
            "assigned_worker_id": WORKER, "member_request_id": REQUEST, "dispute_case_id": None,
        }
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        table.side_effect = [item_query, department_query]

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/dispute-cases", json={
            "category": "delivery", "summary": "Parcel not received.", "next_action": "Check delivery evidence.",
        })

        self.assertEqual(response.status_code, 403)
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_admin_dispute_update_uses_optimistic_versioned_rpc(self, table, rpc, identity):
        case_query = MagicMock()
        case_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": DISPUTE_CASE, "version": 3,
        }
        item_query = MagicMock()
        item_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "dispute-work-1", "department": "disputes", "status": "open", "assigned_worker_id": None,
        }
        table.side_effect = [case_query, item_query]
        rpc.return_value.execute.return_value.data = {"id": DISPUTE_CASE, "status": "investigating", "version": 4}

        response = self.client.patch(f"/operations/dispute-cases/{DISPUTE_CASE}", json={
            "expected_version": 3, "status": "investigating",
        })

        self.assertEqual(response.status_code, 200)
        rpc.assert_called_once_with("update_operations_dispute_case", {
            "p_case_id": DISPUTE_CASE, "p_actor_id": ADMIN, "p_expected_version": 3,
            "p_status": "investigating", "p_resolution": None,
        })

    def test_sourcing_candidate_requote_payload_uses_same_validation(self):
        with self.assertRaises(ValidationError):
            SourcingCandidateUpdate(product_name="Revised quote", product_url="file:///quote", evidence_note="checked")
        updated = SourcingCandidateUpdate(product_name=" Revised quote ", product_url="https://shop.example/revised", price_amount=44.0, currency="usd", evidence_note=" Verified again ")
        self.assertEqual(updated.product_name, "Revised quote")
        self.assertEqual(updated.currency, "USD")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_admin_updates_only_candidate_attached_to_selected_work_item(self, table, identity):
        item_query = MagicMock()
        item_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "member_request_id": REQUEST,
            "assigned_worker_id": None,
        }
        candidate_query = MagicMock()
        candidate_query.update.return_value.eq.return_value.eq.return_value.eq.return_value.select.return_value.execute.return_value.data = [{
            "id": "00000000-0000-0000-0000-000000000050", "product_name": "Revised quote",
            "supplier_name": None, "product_url": "https://shop.example/revised", "price_amount": 44.0,
            "currency": "USD", "availability": None, "evidence_note": "Verified again",
            "created_by": ADMIN, "created_at": "2026-10-12T00:00:00Z",
        }]
        table.side_effect = [item_query, candidate_query]

        response = self.client.patch(
            f"/operations/work-items/{WORK_ITEM}/sourcing-candidates/00000000-0000-0000-0000-000000000050",
            json={"product_name": "Revised quote", "product_url": "https://shop.example/revised", "price_amount": 44.0, "currency": "usd", "evidence_note": "Verified again"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["candidate"]["price_amount"], 44.0)
        candidate_query.update.assert_called_once()
        candidate_query.update.return_value.eq.assert_called_once_with("id", "00000000-0000-0000-0000-000000000050")
        candidate_query.update.return_value.eq.return_value.eq.assert_called_once_with("work_item_id", WORK_ITEM)
        candidate_query.update.return_value.eq.return_value.eq.return_value.eq.assert_called_once_with("member_request_id", REQUEST)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_cannot_edit_candidate_without_owning_claim(self, table, identity):
        item_query = MagicMock()
        item_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "member_request_id": REQUEST,
            "assigned_worker_id": "00000000-0000-0000-0000-000000000099",
        }
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        table.side_effect = [item_query, department_query]

        response = self.client.patch(
            f"/operations/work-items/{WORK_ITEM}/sourcing-candidates/00000000-0000-0000-0000-000000000050",
            json={"product_name": "Revised quote", "product_url": "https://shop.example/revised", "evidence_note": "Verified again"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(table.call_count, 2)

    def test_sourcing_batch_rejects_duplicate_items(self):
        with self.assertRaises(ValidationError):
            SourcingBatchCreate(title="Sourcing batch", work_item_ids=[WORK_ITEM, WORK_ITEM])

    def test_member_sourcing_option_share_limits_and_deduplicates_candidates(self):
        with self.assertRaises(ValidationError):
            SourcingOptionsShare(candidate_ids=[WORK_ITEM, WORK_ITEM])
        with self.assertRaises(ValidationError):
            SourcingOptionsShare(candidate_ids=[WORK_ITEM] * 11)
        payload = SourcingOptionsShare(candidate_ids=[WORK_ITEM], member_note="  Compare the size options.  ")
        self.assertEqual(payload.member_note, "Compare the size options.")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_admin_shares_only_selected_candidate_ids_through_atomic_rpc(self, table, rpc, identity):
        query = MagicMock()
        query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "member_request_id": REQUEST,
            "assigned_worker_id": None,
        }
        table.return_value = query
        rpc.return_value.execute.return_value.data = [{"id": "option-1", "product_name": "Blue coat"}]

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/sourcing-options", json={
            "candidate_ids": [REQUEST], "member_note": "Compare these colors.",
        })

        self.assertEqual(response.status_code, 201)
        rpc.assert_called_once_with("share_operations_sourcing_options", {
            "p_request_id": REQUEST, "p_work_item_id": WORK_ITEM, "p_candidate_ids": [REQUEST],
            "p_actor_id": ADMIN, "p_member_note": "Compare these colors.",
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_admin_sourcing_batch_creation_uses_atomic_audited_rpc(self, rpc, identity):
        rpc.return_value.execute.return_value.data = {"id": "batch-1", "title": "Spring jackets"}
        response = self.client.post("/operations/sourcing/batches", json={"title": "Spring jackets", "work_item_ids": [WORK_ITEM]})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["batch"]["id"], "batch-1")
        rpc.assert_called_once_with("create_operations_sourcing_batch", {
            "p_actor_id": ADMIN, "p_title": "Spring jackets", "p_work_item_ids": [WORK_ITEM], "p_is_admin": True,
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value=None)
    @patch("app.accounts.operations.supabase.table")
    def test_operations_api_requires_trusted_staff(self, table, identity):
        response = self.client.get("/operations/work-items")
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_presence_heartbeat_upserts_worker_timestamp(self, table, identity):
        query = MagicMock()
        query.upsert.return_value.execute.return_value.data = [{"worker_id": WORKER, "last_seen_at": "2026-10-11T10:00:00+00:00"}]
        table.return_value = query

        response = self.client.post("/operations/presence")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["online"])
        self.assertEqual(query.upsert.call_args.kwargs["on_conflict"], "worker_id")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_cannot_view_workforce_roster(self, table, identity):
        response = self.client.get("/operations/workforce")
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_cannot_view_global_automation_health(self, table, identity):
        response = self.client.get("/operations/automation-health")
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_admin_automation_health_projects_safe_recent_runs_and_schedule_errors(self, table, identity):
        automation_query = MagicMock()
        automation_query.select.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "automation-1", "business_id": "business-12345678", "name": "Daily sync",
             "trigger_type": "scheduled_interval", "enabled": True, "schedule_next_run_at": None,
             "schedule_attempts": 2, "schedule_last_error_code": "scheduled_run_failed"},
        ]
        execution_query = MagicMock()
        execution_query.select.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "run-1", "business_id": "business-12345678", "automation_id": "automation-1",
             "status": "failed", "error_code": "scheduled_run_failed", "triggered_by": "scheduler",
             "created_at": "2026-10-11T10:00:00+00:00", "completed_at": None,
             "result": {"sensitive": "must not be returned"}},
        ]
        table.side_effect = [automation_query, execution_query]

        response = self.client.get("/operations/automation-health")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["summary"]["failed_runs"], 1)
        self.assertEqual(body["summary"]["schedule_issues"], 1)
        self.assertEqual(body["recent_runs"][0]["automation_name"], "Daily sync")
        self.assertEqual(body["recent_runs"][0]["business_ref"], "business")
        self.assertEqual(body["schedule_issues"][0]["last_error_code"], "scheduled_run_failed")
        self.assertNotIn("result", body["recent_runs"][0])
        self.assertNotIn("business_id", body["recent_runs"][0])
        self.assertEqual(execution_query.select.call_args.args[0], "id,business_id,automation_id,status,error_code,triggered_by,created_at,completed_at")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_admin_workforce_aggregates_presence_departments_and_assignments(self, table, identity):
        worker_query = MagicMock()
        worker_query.select.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "user_id": WORKER, "status": "active", "handoff_availability": "available", "handoff_max_active": 3,
        }]
        presence_query = MagicMock()
        presence_query.select.return_value.in_.return_value.execute.return_value.data = [{
            "worker_id": WORKER, "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }]
        department_query = MagicMock()
        department_query.select.return_value.in_.return_value.execute.return_value.data = [
            {"worker_id": WORKER, "department": "sourcing", "can_claim": True},
        ]
        work_query = MagicMock()
        work_query.select.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "id": WORK_ITEM, "summary": "Source requested item", "department": "sourcing", "status": "claimed",
            "assigned_worker_id": WORKER, "assigned_automation_key": None, "priority": "normal",
        }]
        table.side_effect = [worker_query, presence_query, department_query, work_query]

        response = self.client.get("/operations/workforce")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["summary"]["online_workers"], 1)
        self.assertEqual(body["workers"][0]["departments"], ["sourcing"])
        self.assertEqual(body["workers"][0]["current_work"][0]["id"], WORK_ITEM)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_admin_can_set_worker_departments_through_audited_rpc(self, rpc, identity):
        rpc.return_value.execute.return_value.data = [{"worker_id": WORKER, "department": "sourcing", "can_claim": True}]

        response = self.client.put(f"/operations/workers/{WORKER}/departments", json={"departments": ["sourcing"]})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["departments"][0]["department"], "sourcing")
        rpc.assert_called_once_with("set_operations_worker_departments", {
            "p_actor_id": ADMIN, "p_worker_id": WORKER, "p_departments": ["sourcing"],
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_worker_cannot_manage_department_access(self, rpc, identity):
        response = self.client.put(f"/operations/workers/{WORKER}/departments", json={"departments": ["sourcing"]})

        self.assertEqual(response.status_code, 403)
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_worker_claim_uses_atomic_claim_rpc(self, rpc, identity):
        rpc.return_value.execute.return_value.data = {"id": WORK_ITEM, "status": "claimed", "version": 2}
        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/claim")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["work_item"]["status"], "claimed")
        rpc.assert_called_once_with("claim_operations_work_item", {
            "p_work_item_id": WORK_ITEM, "p_worker_id": WORKER,
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_worker_cannot_view_all_departments(self, rpc, identity):
        response = self.client.get("/operations/work-items?scope=all")
        self.assertEqual(response.status_code, 403)
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_authorized_handoff_queue_resolves_its_business_conversation(self, table, identity):
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"department": "conversation_intake"},
        ]
        work_query = MagicMock()
        work_query.select.return_value = work_query
        work_query.eq.return_value = work_query
        work_query.in_.return_value = work_query
        work_query.order.return_value = work_query
        work_query.limit.return_value = work_query
        work_query.execute.return_value.data = [{
            "id": WORK_ITEM, "department": "conversation_intake", "status": "open",
            "handoff_id": REQUEST, "business_conversation_id": None,
            "assigned_worker_id": None, "claimed_until": None,
        }]
        handoff_query = MagicMock()
        handoff_query.select.return_value.in_.return_value.execute.return_value.data = [
            {"id": REQUEST, "conversation_id": "00000000-0000-0000-0000-000000000050"},
        ]
        table.side_effect = [work_query, department_query, handoff_query]

        response = self.client.get("/operations/work-items?scope=available&department=conversation_intake")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["work_items"][0]["business_conversation_id"], "00000000-0000-0000-0000-000000000050")
        self.assertEqual(table.call_args_list[-1].args[0], "conversation_handoffs")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_platform_admin_creation_uses_single_audited_rpc(self, rpc, identity):
        rpc.return_value.execute.return_value.data = {"id": WORK_ITEM, "status": "open"}
        response = self.client.post("/operations/work-items", json={
            "department": "sourcing", "work_type": "supplier_research",
            "summary": "Find a suitable replacement", "next_action": "Search the approved catalog.",
            "source_type": "member_request", "source_id": REQUEST, "priority": "high",
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["work_item"]["id"], WORK_ITEM)
        rpc.assert_called_once_with("create_operations_work_item", {
            "p_actor_id": ADMIN, "p_department": "sourcing", "p_work_type": "supplier_research",
            "p_summary": "Find a suitable replacement", "p_next_action": "Search the approved catalog.",
            "p_source_type": "member_request", "p_source_id": REQUEST, "p_priority": "high",
            "p_due_at": None, "p_assigned_worker_id": None,
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    @patch("app.accounts.operations.supabase.rpc")
    def test_only_assigned_worker_can_transition_and_version_is_sent(self, rpc, table, identity):
        query = MagicMock()
        query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": WORKER,
        }
        table.return_value = query
        rpc.return_value.execute.return_value.data = {"id": WORK_ITEM, "status": "waiting", "version": 3}
        response = self.client.patch(f"/operations/work-items/{WORK_ITEM}", json={
            "expected_version": 2, "status": "waiting", "next_action": "Review the member's reply.",
            "waiting_on": "member", "waiting_reason": "Need a preferred color.",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(rpc.call_args.args[0], "transition_operations_work_item")
        self.assertEqual(rpc.call_args.args[1]["p_expected_version"], 2)
        self.assertEqual(rpc.call_args.args[1]["p_actor_id"], WORKER)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    @patch("app.accounts.operations.supabase.rpc")
    def test_worker_cannot_transition_an_unassigned_item(self, rpc, table, identity):
        query = MagicMock()
        query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": None,
        }
        table.return_value = query

        response = self.client.patch(f"/operations/work-items/{WORK_ITEM}", json={
            "expected_version": 1, "status": "claimed", "next_action": "Start sourcing.",
        })

        # Out-of-scope work is deliberately indistinguishable from a missing item.
        self.assertEqual(response.status_code, 404)
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    @patch("app.accounts.operations.supabase.rpc")
    def test_stale_transition_version_returns_refreshable_conflict(self, rpc, table, identity):
        query = MagicMock()
        query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": WORKER,
        }
        table.return_value = query
        rpc.return_value.execute.side_effect = RuntimeError("work item version conflict")

        response = self.client.patch(f"/operations/work-items/{WORK_ITEM}", json={
            "expected_version": 1, "status": "waiting", "next_action": "Wait for member reply.",
            "waiting_on": "member", "waiting_reason": "Need a preferred color.",
        })

        self.assertEqual(response.status_code, 409)
        self.assertIn("Refresh", response.json()["detail"])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    def test_claim_conflict_does_not_return_a_false_success(self, rpc, identity):
        rpc.return_value.execute.side_effect = RuntimeError("work item is currently claimed")

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/claim")

        self.assertEqual(response.status_code, 409)
        self.assertIn("no longer available", response.json()["detail"])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_accessible_member_request_work_exposes_minimal_source_context(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": WORKER,
            "member_request_id": REQUEST,
        }
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "request_title": "Find a blue jacket", "request_description": "Size M",
            "product_name_snapshot": None, "source_type": "url", "source_url": "https://example.com/item",
            "created_at": "2026-10-11T10:00:00+00:00", "updated_at": "2026-10-11T10:00:00+00:00",
        }
        event_query = MagicMock()
        event_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "event-1", "sequence_no": 1, "stage": "submitted", "member_note": None,
             "created_at": "2026-10-11T10:00:00+00:00"},
        ]
        schedule_query = MagicMock()
        schedule_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        occurrence_query = MagicMock()
        occurrence_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        media_query = MagicMock()
        media_query.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []
        table.side_effect = [work_query, request_query, event_query, media_query, schedule_query, occurrence_query]

        response = self.client.get(f"/operations/work-items/{WORK_ITEM}/source-context")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source_type"], "member_request")
        self.assertEqual(body["request"]["request_title"], "Find a blue jacket")
        self.assertEqual(body["request"]["events"][0]["stage"], "submitted")
        self.assertIsNone(body["request"]["recurring_schedule"])
        self.assertNotIn("member_id", body["request"])
        self.assertEqual(body["request"]["events"][0]["details"], {})
        self.assertEqual(body["request"]["events"][0]["media"], [])
        self.assertNotIn("member_id", request_query.select.call_args.args[0])
        self.assertIn("details", event_query.select.call_args.args[0])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_recurring_cycle_context_falls_back_to_occurrence_when_origin_schedule_is_absent(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": None,
            "member_request_id": REQUEST,
        }
        request_query = MagicMock()
        request_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "request_title": "[ACCEPTANCE TEST] Recurring cycle", "request_description": "Synthetic cycle",
            "product_name_snapshot": None, "source_type": "describe", "source_url": None,
            "created_at": "2026-10-11T10:00:00+00:00", "updated_at": "2026-10-11T10:00:00+00:00",
        }
        request_events_query = MagicMock()
        request_events_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "event-2", "sequence_no": 1, "stage": "submitted", "member_note": None,
             "created_at": "2026-10-11T10:00:00+00:00"},
        ]
        origin_schedule_query = MagicMock()
        origin_schedule_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = None
        occurrence_query = MagicMock()
        occurrence_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "schedule_id": "schedule-1", "occurrence_number": 2, "due_at": "2026-10-11T10:00:00+00:00",
            "status": "created",
        }
        schedule_query = MagicMock()
        schedule_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "schedule-1", "cadence": "monthly", "interval_count": 1, "interval_unit": "months",
            "units_per_order": 3, "occurrence_limit": 3, "time_zone": "America/Los_Angeles",
            "next_occurrence_number": 3, "next_due_at": "2026-11-11T18:00:00+00:00",
            "expires_at": "2027-10-11T18:00:00+00:00", "status": "cancelled",
            "created_at": "2026-10-11T10:00:00+00:00", "updated_at": "2026-10-11T10:00:00+00:00",
        }
        occurrences_query = MagicMock()
        occurrences_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "occ-1", "occurrence_number": 1, "request_id": "request-1",
             "due_at": "2026-09-11T18:00:00+00:00", "status": "created", "quote_accepted_at": None},
            {"id": "occ-2", "occurrence_number": 2, "request_id": REQUEST,
             "due_at": "2026-10-11T10:00:00+00:00", "status": "created", "quote_accepted_at": None},
        ]
        schedule_events_query = MagicMock()
        schedule_events_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "schedule-event-1", "sequence_no": 1, "event_type": "activated",
             "occurrence_number": 1, "details": {}, "created_at": "2026-09-11T18:00:00+00:00"},
        ]
        media_query = MagicMock()
        media_query.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []
        table.side_effect = [work_query, request_query, request_events_query, media_query, origin_schedule_query,
                             occurrence_query, schedule_query, occurrences_query, schedule_events_query]

        response = self.client.get(f"/operations/work-items/{WORK_ITEM}/source-context")

        self.assertEqual(response.status_code, 200)
        recurring = response.json()["request"]["recurring_schedule"]
        self.assertEqual(recurring["id"], "schedule-1")
        self.assertEqual(recurring["current_occurrence"]["occurrence_number"], 2)
        self.assertEqual(len(recurring["occurrences"]), 2)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_assigned_worker_gets_read_only_member_conversation_context(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "member_conversation_id": REQUEST,
        }
        conversation_query = MagicMock()
        conversation_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "title": "Find a gift", "linked_request_id": None, "retention_hold": False,
        }
        message_query = MagicMock()
        message_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "message-1", "sender_type": "member", "content": "I need a blue scarf.",
             "related_product_ids": [], "created_at": "2026-10-11T10:00:00+00:00"},
        ]
        table.side_effect = [work_query, conversation_query, message_query]

        response = self.client.get(f"/operations/work-items/{WORK_ITEM}/source-context")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source_type"], "member_conversation")
        self.assertEqual(body["conversation"]["messages"][0]["content"], "I need a blue scarf.")
        self.assertNotIn("member_id", body["conversation"])
        self.assertNotIn("member_id", conversation_query.select.call_args.args[0])
        conversation_query.update.assert_not_called()
        message_query.insert.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_authorized_handoff_context_includes_business_scoped_read_only_transcript(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "business_id": "00000000-0000-0000-0000-000000000060", "handoff_id": REQUEST,
            "business_conversation_id": "00000000-0000-0000-0000-000000000050",
        }
        handoff_query = MagicMock()
        handoff_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REQUEST, "conversation_id": "00000000-0000-0000-0000-000000000050",
            "status": "active", "reason": "Customer asked for an agent.",
            "requested_at": "2026-10-11T10:00:00+00:00", "updated_at": "2026-10-11T10:05:00+00:00",
            "closed_at": None,
        }
        conversation_query = MagicMock()
        conversation_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "00000000-0000-0000-0000-000000000050", "business_id": "00000000-0000-0000-0000-000000000060",
            "channel": "instagram", "status": "open", "created_at": "2026-10-11T09:55:00+00:00",
            "last_message_at": "2026-10-11T10:05:00+00:00", "summary": "Product inquiry",
        }
        message_query = MagicMock()
        message_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [{
            "id": "message-1", "sender_type": "customer", "content": "Do you have this in blue?",
            "created_at": "2026-10-11T10:00:00+00:00",
        }]
        table.side_effect = [work_query, handoff_query, conversation_query, message_query]

        response = self.client.get(f"/operations/work-items/{WORK_ITEM}/source-context")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["source_type"], "business_conversation")
        self.assertEqual(body["handoff"]["status"], "active")
        self.assertEqual(body["handoff"]["reason"], "Customer asked for an agent.")
        self.assertEqual(body["conversation"]["messages"][0]["content"], "Do you have this in blue?")
        self.assertNotIn("customer_external_id", body["conversation"])
        self.assertEqual(handoff_query.select.call_args.args[0], "id,conversation_id,status,reason,requested_at,updated_at,closed_at")
        first_filter = handoff_query.select.return_value.eq
        self.assertEqual(first_filter.call_args.args, ("id", REQUEST))
        self.assertEqual(first_filter.return_value.eq.call_args.args, ("business_id", "00000000-0000-0000-0000-000000000060"))
        self.assertEqual(conversation_query.select.call_args.args[0], "id,business_id,channel,status,created_at,last_message_at,summary")
        self.assertEqual(message_query.select.call_args.args[0], "id,sender_type,content,created_at")
        self.assertEqual(conversation_query.select.return_value.eq.return_value.eq.call_args.args, ("business_id", "00000000-0000-0000-0000-000000000060"))
        message_query.insert.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_assigned_worker_can_reply_to_unlinked_member_conversation(self, table, rpc, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "member_conversation_id": REQUEST, "member_request_id": None,
        }
        table.return_value = work_query
        rpc.return_value.execute.return_value.data = {
            "id": "message-2", "sender_type": "worker", "content": "I can help with that.",
            "related_product_ids": [], "created_at": "2026-10-11T10:00:00+00:00",
        }

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/member-reply", json={
            "content": "  I can help with that.  ",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message"]["sender_type"], "worker")
        self.assertEqual(rpc.call_args.args[0], "send_operations_member_conversation_reply")
        self.assertEqual(rpc.call_args.args[1]["p_actor_id"], WORKER)
        self.assertEqual(rpc.call_args.args[1]["p_content"], "I can help with that.")

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_worker_cannot_reply_to_member_conversation_owned_by_another_worker(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": ADMIN,
            "member_conversation_id": REQUEST, "member_request_id": None,
        }
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"department": "conversation_intake"},
        ]
        table.side_effect = [work_query, department_query]

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/member-reply", json={"content": "Hello"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(table.call_count, 2)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_unassigned_worker_cannot_read_member_conversation_context(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": None,
            "member_conversation_id": REQUEST,
        }
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"department": "conversation_intake"},
        ]
        table.side_effect = [work_query, department_query]

        response = self.client.get(f"/operations/work-items/{WORK_ITEM}/source-context")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(table.call_count, 2)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_work_item_history_is_scoped_and_excludes_event_details(self, table, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": WORKER,
        }
        event_query = MagicMock()
        event_query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "event-1", "sequence_no": 1, "event_type": "claimed", "actor_type": "worker",
             "previous_department": "sourcing", "next_department": "sourcing", "previous_status": "open",
             "next_status": "claimed", "reason": None, "created_at": "2026-10-11T10:00:00+00:00"},
        ]
        table.side_effect = [work_query, event_query]

        response = self.client.get(f"/operations/work-items/{WORK_ITEM}/events")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["events"][0]["next_status"], "claimed")
        self.assertNotIn("details", response.json()["events"][0])
        self.assertNotIn("actor_user_id", event_query.select.call_args.args[0])
        self.assertNotIn("details", event_query.select.call_args.args[0])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    @patch("app.accounts.operations.supabase.rpc")
    def test_worker_can_transfer_claimed_work_to_an_authorized_department(self, rpc, table, identity):
        source_query = MagicMock()
        source_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": WORKER,
        }
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"department": "fulfillment"},
        ]
        table.side_effect = [source_query, department_query]
        rpc.return_value.execute.return_value.data = {"id": WORK_ITEM, "department": "fulfillment"}

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/transfer", json={
            "expected_version": 2, "department": "fulfillment",
            "next_action": "Confirm the warehouse intake details.", "reason": "Sourcing completed.",
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(rpc.call_args.args[0], "transfer_operations_work_item")
        self.assertEqual(rpc.call_args.args[1]["p_actor_id"], WORKER)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    @patch("app.accounts.operations.supabase.rpc")
    def test_even_admin_cannot_transfer_fulfillment_back_to_sourcing(self, rpc, table, identity):
        source_query = MagicMock()
        source_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "fulfillment", "assigned_worker_id": WORKER,
        }
        table.return_value = source_query

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/transfer", json={
            "expected_version": 2, "department": "sourcing",
            "next_action": "Restart sourcing.", "reason": "Do not reverse warehouse work.",
        })

        self.assertEqual(response.status_code, 409)
        self.assertIn("cannot be routed back to sourcing", response.json()["detail"])
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    @patch("app.accounts.operations.supabase.rpc")
    def test_worker_cannot_transfer_work_to_an_unauthorized_department(self, rpc, table, identity):
        source_query = MagicMock()
        source_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "sourcing", "assigned_worker_id": WORKER,
        }
        department_query = MagicMock()
        department_query.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"department": "fulfillment"},
        ]
        table.side_effect = [source_query, department_query]

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/transfer", json={
            "expected_version": 2, "department": "disputes",
            "next_action": "Review the dispute.", "reason": "Escalating.",
        })

        self.assertEqual(response.status_code, 403)
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_business_handoff_cannot_use_generic_status_transition(self, table, rpc, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "handoff_id": REQUEST,
        }
        table.return_value = work_query

        response = self.client.patch(f"/operations/work-items/{WORK_ITEM}", json={
            "expected_version": 2, "status": "completed", "next_action": "Close handoff",
        })

        self.assertEqual(response.status_code, 409)
        rpc.assert_not_called()

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_business_handoff_cannot_use_generic_department_transfer(self, table, rpc, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "handoff_id": REQUEST,
        }
        table.return_value = work_query

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/transfer", json={
            "expected_version": 2, "department": "sourcing", "next_action": "Source item",
            "reason": "Customer selected a product.",
        })

        self.assertEqual(response.status_code, 409)
        rpc.assert_not_called()
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.get_conversation", return_value=None)
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_assigned_worker_can_send_business_handoff_reply(self, table, rpc, get_conversation, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "business_id": "00000000-0000-0000-0000-000000000060", "handoff_id": REQUEST,
            "member_request_id": None,
        }
        table.return_value = work_query
        rpc.return_value.execute.return_value.data = {
            "id": "business-message-1", "conversation_id": "00000000-0000-0000-0000-000000000050",
            "sender_type": "agent", "content": "I can help with that.", "created_at": "2026-10-11T10:00:00+00:00",
        }

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/business-reply", json={
            "content": "  I can help with that.  ",
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message"]["content"], "I can help with that.")
        self.assertEqual(response.json()["delivery_status"], "recorded_not_delivered")
        self.assertIsNone(response.json()["delivery_error_code"])
        rpc.assert_called_once_with("send_operations_business_handoff_reply", {
            "p_work_item_id": WORK_ITEM, "p_actor_id": WORKER, "p_content": "I can help with that.",
        })

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.deliver_messenger_text")
    @patch("app.accounts.operations.get_connection_credentials", return_value={"page_access_token": "token", "page_id": "page-1"})
    @patch("app.accounts.operations.get_connection")
    @patch("app.accounts.operations.get_conversation")
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_business_handoff_reply_reports_messenger_delivery_outcome(self, table, rpc, get_conversation,
                                                                       get_connection, credentials, deliver, identity):
        business_id = "00000000-0000-0000-0000-000000000060"
        conversation_id = "00000000-0000-0000-0000-000000000050"
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "business_id": business_id, "handoff_id": REQUEST, "member_request_id": None,
        }
        table.return_value = work_query
        message = {"id": "business-message-2", "conversation_id": conversation_id, "sender_type": "agent",
                   "content": "Thanks for waiting.", "created_at": "2026-10-13T10:00:00+00:00"}
        rpc.return_value.execute.return_value.data = message
        conversation = {"id": conversation_id, "business_id": business_id, "business_connection_id": "connection-1",
                        "customer_external_id": "psid-1"}
        get_conversation.return_value = conversation
        connection = {"id": "connection-1", "business_id": business_id, "provider": "messenger", "status": "connected"}
        get_connection.return_value = connection
        deliver.return_value = {"status": "rejected", "safe_error_code": "response_window_expired"}

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/business-reply", json={"content": "Thanks for waiting."})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["delivery_status"], "rejected")
        self.assertEqual(response.json()["delivery_error_code"], "response_window_expired")
        deliver.assert_called_once_with(connection=connection, credentials={"page_access_token": "token", "page_id": "page-1"},
                                        conversation=conversation, message=message)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.rpc")
    @patch("app.accounts.operations.supabase.table")
    def test_assigned_worker_can_return_business_handoff_to_automation(self, table, rpc, identity):
        work_query = MagicMock()
        work_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": WORK_ITEM, "department": "conversation_intake", "assigned_worker_id": WORKER,
            "handoff_id": REQUEST,
        }
        table.return_value = work_query
        rpc.return_value.execute.return_value.data = {"id": WORK_ITEM, "status": "completed"}

        response = self.client.post(f"/operations/work-items/{WORK_ITEM}/return-to-automation")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["work_item"]["status"], "completed")
        rpc.assert_called_once_with("return_operations_business_handoff_to_automation", {
            "p_work_item_id": WORK_ITEM, "p_actor_id": WORKER,
        })

    def test_waiting_transition_requires_reason_and_wait_target(self):
        with self.assertRaises(ValidationError):
            WorkItemTransition(expected_version=1, status="waiting", next_action="Follow up")
        valid = WorkItemTransition(expected_version=1, status="waiting", next_action="Follow up",
            waiting_on="supplier", waiting_reason="Waiting for supplier pricing.")
        self.assertEqual(valid.waiting_on, "supplier")


if __name__ == "__main__":
    unittest.main()
