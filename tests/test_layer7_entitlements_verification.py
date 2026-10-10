from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router
from app.database.directory.entitlements import has_business_entitlement

BUSINESS = "00000000-0000-0000-0000-000000000001"
USER = "00000000-0000-0000-0000-000000000002"


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 9, tzinfo=timezone.utc)


def query_chain(data):
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.execute.return_value = Mock(data=data)
    return query


class EntitlementWindowTests(unittest.TestCase):
    @patch("app.database.directory.entitlements.supabase.table")
    @patch("app.database.directory.entitlements.datetime", FrozenDateTime)
    def test_active_entitlement_requires_current_start_and_unexpired_end(self, table):
        table.return_value = query_chain([
            {"starts_at": "2026-10-10T00:00:00Z", "expires_at": None},
            {"starts_at": "2026-10-01T00:00:00Z", "expires_at": "2026-10-09T00:00:00Z"},
            {"starts_at": "2026-10-01T00:00:00Z", "expires_at": "2026-10-10T00:00:00Z"},
        ])
        self.assertTrue(has_business_entitlement(BUSINESS, "category_market_search"))
        table.assert_called_once_with("business_tool_entitlements")

    @patch("app.database.directory.entitlements.supabase.table")
    def test_no_matching_active_business_entitlement_denies_access(self, table):
        query = query_chain([])
        table.return_value = query
        self.assertFalse(has_business_entitlement(BUSINESS, "category_market_search"))
        query.eq.assert_any_call("business_id", BUSINESS)
        query.eq.assert_any_call("tool_id", "category_market_search")
        query.eq.assert_any_call("access_level", "premium")
        query.eq.assert_any_call("status", "active")


class VerificationAtomicityApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.publish_business_event")
    @patch("app.dashboard.modules.supabase")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value={"user_id": USER})
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    def test_review_status_and_audit_are_written_in_one_rpc(self, _member, _admin, supabase, event):
        supabase.rpc.return_value.execute.return_value.data = {
            "previous_status": "unknown", "verification_status": "verified"
        }
        response = self.client.post(
            f"/businesses/{BUSINESS}/verification/market/00000000-0000-0000-0000-000000000003",
            headers={"Authorization": "Bearer platform-token"},
            json={"verification_status": "verified", "reason": "Confirmed directly with source"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["review"]["previous_status"], "unknown")
        args, kwargs = supabase.rpc.call_args
        self.assertEqual(args[0], "review_directory_record")
        self.assertEqual(args[1]["p_business_id"], BUSINESS)
        self.assertEqual(args[1]["p_reviewer_user_id"], USER)
        event.assert_called_once()

    @patch("app.dashboard.modules.publish_business_event")
    @patch("app.dashboard.modules.supabase")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value={"user_id": USER})
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    def test_missing_source_record_returns_404_without_event(self, _member, _admin, supabase, event):
        supabase.rpc.return_value.execute.return_value.data = {"error": "not_found"}
        response = self.client.post(
            f"/businesses/{BUSINESS}/verification/market/00000000-0000-0000-0000-000000000003",
            headers={"Authorization": "Bearer platform-token"},
            json={"verification_status": "verified", "reason": "Confirmed directly with source"},
        )
        self.assertEqual(response.status_code, 404)
        event.assert_not_called()

    @patch("app.dashboard.modules.publish_business_event")
    @patch("app.dashboard.modules.supabase")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value={"user_id": USER})
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    def test_rpc_failure_does_not_emit_success_event(self, _member, _admin, supabase, event):
        supabase.rpc.return_value.execute.side_effect = RuntimeError("transaction rolled back")
        response = self.client.post(
            f"/businesses/{BUSINESS}/verification/market/00000000-0000-0000-0000-000000000003",
            headers={"Authorization": "Bearer platform-token"},
            json={"verification_status": "verified", "reason": "Confirmed directly with source"},
        )
        self.assertEqual(response.status_code, 503)
        event.assert_not_called()

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value=None)
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    def test_review_history_is_scoped_to_the_selected_business(self, _member, _admin, table):
        query = Mock()
        for method in ("select", "eq", "in_", "order", "limit"):
            getattr(query, method).return_value = query
        query.execute.return_value = Mock(data=[])
        table.return_value = query
        response = self.client.get(
            f"/businesses/{BUSINESS}/verification",
            headers={"Authorization": "Bearer business-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reviews"], [])
        table.assert_any_call("directory_verification_reviews")
        query.eq.assert_any_call("business_id", BUSINESS)

    @patch("app.dashboard.modules.supabase.rpc")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value=None)
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": USER, "role": "admin"})
    def test_business_admin_without_platform_claim_cannot_review_shared_record(self, _member, _admin, rpc):
        response = self.client.post(
            f"/businesses/{BUSINESS}/verification/market/00000000-0000-0000-0000-000000000003",
            headers={"Authorization": "Bearer business-token"},
            json={"verification_status": "verified", "reason": "Confirmed directly with source"},
        )
        self.assertEqual(response.status_code, 403)
        rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
