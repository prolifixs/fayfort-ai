from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router
from app.config.settings import settings


USER = "00000000-0000-0000-0000-000000000010"
ADMIN = "00000000-0000-0000-0000-000000000020"


class MemberAndWorkerAccountTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    @patch("app.accounts.router.trusted_user_id", return_value=None)
    @patch("app.accounts.router.supabase.table")
    def test_member_profile_requires_verified_authenticated_identity(self, table, identity):
        response = self.client.get("/members/me")
        self.assertEqual(response.status_code, 401)
        identity.assert_called_once_with(None)
        table.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at=None)))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_unverified_member_cannot_read_profile(self, identity, get_user, table):
        response = self.client.get("/members/me", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Verify your email", response.json()["detail"])
        table.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_verified_member_reads_only_their_profile_projection(self, identity, get_user, table):
        query = MagicMock()
        query.maybe_single.return_value.execute.return_value.data = {
            "user_id": USER, "display_name": None, "points_balance": 0, "rank_level": 1, "subrank": 1,
            "created_at": "2026-10-10T00:00:00Z",
        }
        table.return_value.select.return_value.eq.return_value = query
        response = self.client.get("/members/me", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["profile"]["user_id"], USER)
        table.assert_called_once_with("member_profiles")
        table.return_value.select.assert_called_once_with("user_id,display_name,points_balance,rank_level,subrank,created_at")
        table.return_value.select.return_value.eq.assert_called_once_with("user_id", USER)

    @patch("app.accounts.router.supabase.auth.admin.invite_user_by_email")
    @patch("app.accounts.router.trusted_platform_admin", return_value=None)
    def test_non_admin_cannot_invite_worker_or_touch_auth(self, admin, invite):
        response = self.client.post("/platform/workers", json={"email": "worker@example.com"})
        self.assertEqual(response.status_code, 403)
        admin.assert_called_once()
        invite.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.admin.invite_user_by_email", return_value=SimpleNamespace(user=SimpleNamespace(id=USER)))
    @patch("app.accounts.router.trusted_platform_admin", return_value={"user_id": ADMIN})
    def test_platform_admin_invites_worker_without_business_role(self, trusted_admin, invite, table):
        query = MagicMock()
        table.return_value.insert.return_value = query
        response = self.client.post(
            "/platform/workers", headers={"Authorization": "Bearer admin-token"},
            json={"email": " Worker@Example.com "},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["worker"], {
            "user_id": USER, "email": "worker@example.com", "status": "invited", "invitation_sent": True,
        })
        invite.assert_called_once_with(
            "worker@example.com",
            options={"redirect_to": settings.WORKER_INVITE_REDIRECT_URL},
        )
        table.assert_called_once_with("fayfort_workers")
        table.return_value.insert.assert_called_once_with({
            "user_id": USER, "status": "invited", "provisioned_by": ADMIN,
        })

    @patch("app.accounts.router.supabase.auth.admin.delete_user")
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.admin.invite_user_by_email", return_value=SimpleNamespace(user=SimpleNamespace(id=USER)))
    @patch("app.accounts.router.trusted_platform_admin", return_value={"user_id": ADMIN})
    def test_failed_worker_registry_write_rolls_back_invited_auth_identity(self, trusted_admin, invite, table, delete_user):
        table.return_value.insert.return_value.execute.side_effect = RuntimeError("database unavailable")
        response = self.client.post(
            "/platform/workers", headers={"Authorization": "Bearer admin-token"},
            json={"email": "worker@example.com"},
        )
        self.assertEqual(response.status_code, 503)
        delete_user.assert_called_once_with(USER)

    @patch("app.accounts.router.supabase.auth.admin.invite_user_by_email")
    @patch("app.accounts.router.trusted_platform_admin", return_value={"user_id": ADMIN})
    def test_invalid_email_does_not_call_auth_admin(self, trusted_admin, invite):
        response = self.client.post(
            "/platform/workers", headers={"Authorization": "Bearer admin-token"},
            json={"email": "not-an-email"},
        )
        self.assertEqual(response.status_code, 422)
        invite.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_verified_worker_reads_only_their_worker_status(self, identity, get_user, table):
        query = MagicMock()
        query.maybe_single.return_value.execute.return_value.data = {
            "status": "active", "created_at": "2026-10-10T00:00:00Z",
        }
        table.return_value.select.return_value.eq.return_value = query
        response = self.client.get("/workers/me", headers={"Authorization": "Bearer worker-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"worker": {"status": "active", "created_at": "2026-10-10T00:00:00Z"}})
        table.assert_called_once_with("fayfort_workers")
        table.return_value.select.assert_called_once_with("status,created_at")
        table.return_value.select.return_value.eq.assert_called_once_with("user_id", USER)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_verified_account_without_worker_row_returns_not_provisioned(self, identity, get_user, table):
        query = MagicMock()
        query.maybe_single.return_value.execute.return_value = None
        table.return_value.select.return_value.eq.return_value = query
        response = self.client.get("/workers/me", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "This account is not provisioned as a FayFort worker."})

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at=None)))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_unverified_worker_cannot_read_worker_status(self, identity, get_user, table):
        response = self.client.get("/workers/me", headers={"Authorization": "Bearer worker-token"})
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
