from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.directory.identity import has_trusted_business_identity, trusted_platform_admin


class DirectoryIdentityTests(unittest.TestCase):
    @patch("app.directory.identity.supabase.table")
    @patch("app.directory.identity.supabase.auth.get_user")
    def test_control_center_requires_active_fayfort_worker_not_business_membership(self, get_user, table):
        get_user.return_value = SimpleNamespace(user=SimpleNamespace(
            id="user-1", email_confirmed_at="verified", app_metadata={}
        ))
        query = table.return_value.select.return_value.eq.return_value.maybe_single.return_value
        query.execute.return_value = SimpleNamespace(data={"status": "active"})
        self.assertTrue(has_trusted_business_identity("Bearer valid-token", "business-1"))
        table.assert_called_once_with("fayfort_workers")

        query.execute.return_value = SimpleNamespace(data=None)
        self.assertFalse(has_trusted_business_identity("Bearer valid-token", "business-1"))

    @patch("app.directory.identity.supabase.table")
    @patch("app.directory.identity.supabase.auth.get_user")
    def test_platform_admin_is_staff_without_worker_or_business_membership(self, get_user, table):
        get_user.return_value = SimpleNamespace(user=SimpleNamespace(
            id="platform-admin", app_metadata={"platform_admin": True}
        ))
        self.assertTrue(has_trusted_business_identity("Bearer valid-token", "business-1"))
        table.assert_not_called()

    @patch("app.directory.identity.supabase.auth.get_user")
    def test_platform_admin_requires_server_managed_app_metadata(self, get_user):
        get_user.return_value = SimpleNamespace(
            user=SimpleNamespace(
                id="business-admin",
                app_metadata={},
                user_metadata={"platform_admin": True},
            )
        )
        self.assertIsNone(trusted_platform_admin("Bearer valid-token"))

        get_user.return_value = SimpleNamespace(
            user=SimpleNamespace(
                id="platform-admin",
                app_metadata={"platform_admin": True},
                user_metadata={},
            )
        )
        self.assertEqual(
            trusted_platform_admin("Bearer valid-token"),
            {"user_id": "platform-admin"},
        )

    @patch("app.directory.identity.supabase.auth.get_user")
    def test_missing_malformed_or_invalid_token_fails_closed(self, get_user):
        self.assertFalse(has_trusted_business_identity(None, "business-1"))
        self.assertFalse(has_trusted_business_identity("Basic token", "business-1"))
        get_user.side_effect = RuntimeError("invalid token")
        self.assertFalse(has_trusted_business_identity("Bearer invalid", "business-1"))
        get_user.assert_called_once_with("invalid")


if __name__ == "__main__":
    unittest.main()
