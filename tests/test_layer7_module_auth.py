from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"


class PlatformAdminBoundaryTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value=None)
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "ordinary-admin", "role": "admin"})
    def test_active_business_admin_without_platform_claim_cannot_grant(self, member, platform_admin, table):
        response = self.client.post(
            f"/businesses/{BUSINESS}/entitlements",
            headers={"Authorization": "Bearer business-admin-token"},
            json={
                "tool_id": "category_market_search",
                "access_level": "premium",
                "reason": "Approved by business owner",
            },
        )
        self.assertEqual(response.status_code, 403)
        member.assert_called_once()
        platform_admin.assert_called_once()
        table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
