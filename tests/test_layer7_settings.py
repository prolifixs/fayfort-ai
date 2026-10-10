from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
UPDATED_AT = "2026-10-09T18:00:00Z"


class SettingsWorkflowTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.supabase.rpc")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    def test_settings_update_uses_allowlisted_cas_rpc_and_returns_saved_values(self, member, rpc):
        rpc.return_value.execute.return_value.data = {
            "id": BUSINESS,
            "name": "Updated name",
            "description": None,
            "created_at": UPDATED_AT,
            "updated_at": "2026-10-09T18:01:00+00:00",
        }
        response = self.client.patch(
            f"/businesses/{BUSINESS}/settings",
            headers={"Authorization": "Bearer owner-token"},
            json={"expected_updated_at": UPDATED_AT, "name": " Updated name ", "description": "   "},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["business"]["name"], "Updated name")
        self.assertIsNone(response.json()["business"]["description"])
        rpc.assert_called_once_with("update_business_settings", {
            "p_business_id": BUSINESS,
            "p_updated_by": "owner-1",
            "p_expected_updated_at": "2026-10-09T18:00:00+00:00",
            "p_update_name": True,
            "p_name": "Updated name",
            "p_update_description": True,
            "p_description": None,
        })

    @patch("app.dashboard.modules.supabase.rpc")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    def test_stale_settings_edit_returns_conflict_without_reporting_success(self, member, rpc):
        rpc.return_value.execute.return_value.data = {"error": "conflict"}
        response = self.client.patch(
            f"/businesses/{BUSINESS}/settings",
            headers={"Authorization": "Bearer owner-token"},
            json={"expected_updated_at": UPDATED_AT, "name": "New name"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("Refresh", response.json()["detail"])

    @patch("app.dashboard.modules.supabase.rpc")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "member"})
    def test_non_admin_cannot_update_settings(self, member, rpc):
        response = self.client.patch(
            f"/businesses/{BUSINESS}/settings",
            headers={"Authorization": "Bearer member-token"},
            json={"expected_updated_at": UPDATED_AT, "name": "New name"},
        )
        self.assertEqual(response.status_code, 403)
        rpc.assert_not_called()

    @patch("app.dashboard.modules.supabase.rpc")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    def test_empty_patch_and_unknown_fields_are_rejected_before_mutation(self, member, rpc):
        empty = self.client.patch(
            f"/businesses/{BUSINESS}/settings",
            headers={"Authorization": "Bearer owner-token"},
            json={"expected_updated_at": UPDATED_AT},
        )
        unknown = self.client.patch(
            f"/businesses/{BUSINESS}/settings",
            headers={"Authorization": "Bearer owner-token"},
            json={"expected_updated_at": UPDATED_AT, "name": "Name", "settings": {"outbound": True}},
        )
        self.assertEqual(empty.status_code, 422)
        self.assertEqual(unknown.status_code, 422)
        rpc.assert_not_called()

    @patch("app.dashboard.modules.supabase.rpc")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-1", "role": "owner"})
    def test_audit_rpc_failure_fails_closed(self, member, rpc):
        rpc.return_value.execute.side_effect = RuntimeError("audit insert failed")
        response = self.client.patch(
            f"/businesses/{BUSINESS}/settings",
            headers={"Authorization": "Bearer owner-token"},
            json={"expected_updated_at": UPDATED_AT, "name": "New name"},
        )
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
