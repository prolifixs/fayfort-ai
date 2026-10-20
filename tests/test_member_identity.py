from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.member_identity import clean_name, suggest_username, username_problem
from app.accounts.router import create_accounts_router

USER = "00000000-0000-0000-0000-000000000010"
OTHER = "00000000-0000-0000-0000-000000000011"
VERIFIED = SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z",
                                                user_metadata={"given_name": "Amaka", "family_name": "Obi"}))


def test_name_and_username_rules():
    assert clean_name("  Amaka   Ngozi ") == "Amaka Ngozi"
    assert clean_name("O'Neil-Smith") == "O'Neil-Smith"
    assert clean_name("Zoë") == "Zoë"
    for bad in ("", "   ", "123", "Ama<script>"):
        with pytest.raises(ValueError):
            clean_name(bad)
    assert username_problem("amaka.obi") is None
    assert username_problem("amaka_22") is None
    assert username_problem("am") == "At least 3 characters."
    assert username_problem("Amaka") is not None  # must already be lowercase
    assert username_problem(".amaka") is not None
    assert username_problem("ama..ka") == "No double dots or underscores."
    assert username_problem("admin") == "That username is reserved."
    assert username_problem("fayfortlagos") == "That username is reserved."
    assert suggest_username("Amaka", "Obi") == "amakaobi"
    assert suggest_username("Zoë", "Ñ") == "zoen"


class MemberIdentityApiTests(TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer member-token"}

    def profiles(self, taken_by=None, saved=None):
        table = MagicMock()
        table.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"user_id": taken_by}] if taken_by else []
        table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = saved or {}
        table.update.return_value.eq.return_value.select.return_value.execute.return_value.data = [
            {"first_name": "Amaka", "last_name": "Obi", "username": "amaka.obi", "display_name": "Amaka Obi"}]
        return table

    @patch("app.accounts.router.supabase.auth.get_user", return_value=VERIFIED)
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_saves_all_three_and_writes_display_name(self, identity, get_user):
        table = self.profiles()
        with patch("app.accounts.member_identity.supabase.table", return_value=table):
            response = self.client.put("/members/me/identity", headers=self.headers,
                                       json={"first_name": " Amaka ", "last_name": "Obi", "username": "@Amaka.Obi"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["complete"])
        table.update.assert_called_once_with({"first_name": "Amaka", "last_name": "Obi", "username": "amaka.obi", "display_name": "Amaka Obi"})

    @patch("app.accounts.router.supabase.auth.get_user", return_value=VERIFIED)
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_rejects_a_taken_or_missing_field(self, identity, get_user):
        with patch("app.accounts.member_identity.supabase.table", return_value=self.profiles(taken_by=OTHER)):
            taken = self.client.put("/members/me/identity", headers=self.headers, json={"first_name": "Amaka", "last_name": "Obi", "username": "amaka"})
            self.assertEqual(taken.status_code, 409)
            missing = self.client.put("/members/me/identity", headers=self.headers, json={"first_name": "Amaka", "last_name": " ", "username": "amaka"})
            self.assertEqual(missing.status_code, 422)
        # Keeping your own username is fine.
        with patch("app.accounts.member_identity.supabase.table", return_value=self.profiles(taken_by=USER)):
            mine = self.client.put("/members/me/identity", headers=self.headers, json={"first_name": "Amaka", "last_name": "Obi", "username": "amaka"})
        self.assertEqual(mine.status_code, 200)

    @patch("app.accounts.member_identity.supabase.auth.get_user", return_value=VERIFIED)
    @patch("app.accounts.router.supabase.auth.get_user", return_value=VERIFIED)
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_suggests_from_the_sign_in_and_checks_usernames(self, identity, get_user, get_user_identity):
        with patch("app.accounts.member_identity.supabase.table", return_value=self.profiles(saved={"first_name": None})):
            body = self.client.get("/members/me/identity", headers=self.headers).json()
            self.assertFalse(body["complete"])
            self.assertEqual(body["suggestion"], {"first_name": "Amaka", "last_name": "Obi", "username": "amakaobi"})
            free = self.client.get("/members/me/username?u=@Amaka_Obi", headers=self.headers).json()
            self.assertEqual(free, {"username": "amaka_obi", "available": True, "reason": None})
            reserved = self.client.get("/members/me/username?u=support", headers=self.headers).json()
            self.assertFalse(reserved["available"])
        with patch("app.accounts.member_identity.supabase.table", return_value=self.profiles(taken_by=OTHER)):
            taken = self.client.get("/members/me/username?u=amaka", headers=self.headers).json()
        self.assertEqual(taken["reason"], "That username is taken.")


def test_completion_needs_all_three():
    from app.accounts.member_addresses import profile_completion
    item = lambda profile: next(i for i in profile_completion(profile, [])["items"] if i["key"] == "name")
    assert item({"display_name": "Amaka Obi"})["done"] is False
    assert item({"first_name": "Amaka", "last_name": "Obi", "username": "amaka"})["done"] is True
