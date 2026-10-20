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
            "member_tier": "free", "selected_theme": "base",
            "created_at": "2026-10-10T00:00:00Z",
        }
        table.return_value.select.return_value.eq.return_value = query
        response = self.client.get("/members/me", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["profile"]["user_id"], USER)
        self.assertNotIn("member_photo_path", response.json()["profile"])
        self.assertIsNone(response.json()["profile"]["profile_photo_url"])
        # The profile row first; saved addresses (for profile completion) come from their own table.
        self.assertEqual(table.call_args_list[0].args, ("member_profiles",))
        table.return_value.select.assert_any_call("user_id,display_name,first_name,last_name,username,points_balance,rank_level,subrank,member_tier,selected_theme,member_photo_path,shipping_phone,shipping_address_line1,shipping_address_line2,shipping_city,shipping_region,shipping_postal_code,shipping_country,onboarding_completed_at,created_at")
        table.return_value.select.return_value.eq.assert_any_call("user_id", USER)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_verified_member_can_update_own_shipping_details(self, identity, get_user, table):
        profile = {
            "user_id": USER, "shipping_phone": "+1 (555) 123-4567", "shipping_address_line1": "10 Main St",
            "shipping_address_line2": None, "shipping_city": "Oakland", "shipping_region": "CA",
            "shipping_postal_code": "94612", "shipping_country": "US",
        }
        table.return_value.update.return_value.eq.return_value.select.return_value.execute.return_value.data = [profile]
        response = self.client.patch("/members/me", headers={"Authorization": "Bearer member-token"}, json={
            "shipping_phone": " +1 (555) 123-4567 ", "shipping_address_line1": " 10 Main St ",
            "shipping_address_line2": "", "shipping_city": " Oakland ", "shipping_region": " CA ",
            "shipping_postal_code": "94612", "shipping_country": " US ",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["profile"]["shipping_city"], "Oakland")
        table.assert_called_once_with("member_profiles")
        table.return_value.update.assert_called_once_with({
            "shipping_phone": "+1 (555) 123-4567", "shipping_address_line1": "10 Main St",
            "shipping_address_line2": None, "shipping_city": "Oakland", "shipping_region": "CA",
            "shipping_postal_code": "94612", "shipping_country": "US",
        })
        table.return_value.update.return_value.eq.assert_called_once_with("user_id", USER)

    @patch("app.accounts.router.supabase.table")
    def test_shipping_details_reject_invalid_phone_and_incomplete_address(self, table):
        headers = {"Authorization": "Bearer member-token"}
        invalid_phone = self.client.patch("/members/me", headers=headers, json={"shipping_phone": "not a phone"})
        incomplete_address = self.client.patch("/members/me", headers=headers, json={"shipping_city": "Oakland"})
        self.assertEqual(invalid_phone.status_code, 422)
        self.assertEqual(incomplete_address.status_code, 422)
        table.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_member_cannot_change_tier_or_profile_fields_through_shipping_update(self, identity, get_user, table):
        response = self.client.patch("/members/me", headers={"Authorization": "Bearer member-token"}, json={
            "shipping_phone": "+1 555 123 4567", "member_tier": "pro",
        })
        self.assertEqual(response.status_code, 422)
        table.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_member_can_only_select_currently_available_base_theme(self, identity, get_user, table):
        table.return_value.update.return_value.eq.return_value.select.return_value.execute.return_value.data = [{"selected_theme": "base"}]
        response = self.client.put("/members/me/theme", headers={"Authorization": "Bearer member-token"}, json={"theme_id": "base"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"selected_theme": "base"})
        table.return_value.update.assert_called_once_with({"selected_theme": "base"})
        table.return_value.update.return_value.eq.assert_called_once_with("user_id", USER)
        table.return_value.update.return_value.eq.return_value.select.assert_called_once_with("selected_theme")

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_member_cannot_select_unlaunched_premium_theme(self, identity, get_user, table):
        response = self.client.put("/members/me/theme", headers={"Authorization": "Bearer member-token"}, json={"theme_id": "premium-midnight"})
        self.assertEqual(response.status_code, 404)
        self.assertIn("published theme", response.json()["detail"])
        self.assertEqual([call.args[0] for call in table.call_args_list], ["member_profiles", "member_themes"])
        table.return_value.update.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_theme_request_cannot_smuggle_client_managed_tier(self, identity, get_user, table):
        response = self.client.put("/members/me/theme", headers={"Authorization": "Bearer member-token"}, json={"theme_id": "base", "member_tier": "pro"})
        self.assertEqual(response.status_code, 422)
        table.assert_not_called()

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
            options={"redirect_to": "http://127.0.0.1:5173/auth/callback?audience=staff&type=invite"},
        )
        self.assertEqual([call.args[0] for call in table.call_args_list], ["fayfort_workers", "workforce_audit"])
        self.assertEqual(table.return_value.insert.call_args_list[0].args[0], {
            "user_id": USER, "status": "invited", "provisioned_by": ADMIN,
        })
        self.assertEqual(table.return_value.insert.call_args_list[1].args[0], {
            "actor_id": ADMIN, "target_id": USER, "target_email": "worker@example.com",
            "action": "invited", "detail": {},
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
