from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.directory.identity import has_trusted_business_identity


class DirectoryIdentityTests(unittest.TestCase):
    @patch("app.directory.identity.get_business_member")
    @patch("app.directory.identity.supabase.auth.get_user")
    def test_valid_token_requires_active_membership(self, get_user, get_member):
        get_user.return_value = SimpleNamespace(user=SimpleNamespace(id="user-1"))
        get_member.return_value = {"user_id": "user-1", "status": "active"}
        self.assertTrue(has_trusted_business_identity("Bearer valid-token", "business-1"))
        get_member.assert_called_once_with("business-1", "user-1")

        get_member.return_value = {"user_id": "user-1", "status": "inactive"}
        self.assertFalse(has_trusted_business_identity("Bearer valid-token", "business-1"))

    @patch("app.directory.identity.supabase.auth.get_user")
    def test_missing_malformed_or_invalid_token_fails_closed(self, get_user):
        self.assertFalse(has_trusted_business_identity(None, "business-1"))
        self.assertFalse(has_trusted_business_identity("Basic token", "business-1"))
        get_user.side_effect = RuntimeError("invalid token")
        self.assertFalse(has_trusted_business_identity("Bearer invalid", "business-1"))
        get_user.assert_called_once_with("invalid")


if __name__ == "__main__":
    unittest.main()
