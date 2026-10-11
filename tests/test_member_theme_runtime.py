from __future__ import annotations

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router

USER = "00000000-0000-0000-0000-000000000010"
DESIGN = {"palette_preset": "forest-green", "wrapper_style": "framed", "colors": {
    "page_background": "#F6FAF7", "surface": "#FFFFFF", "text": "#15251D", "muted_text": "#4D6257",
    "accent": "#17633E", "accent_foreground": "#FFFFFF", "border": "#61796B", "focus": "#17633E",
}}


class MemberThemeRuntimeTests(TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)
        self.identity = patch("app.accounts.router.trusted_user_id", return_value=USER)
        self.get_user = patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
        self.identity.start()
        self.get_user.start()

    def tearDown(self):
        self.identity.stop()
        self.get_user.stop()

    @patch("app.accounts.router.supabase.table")
    def test_paid_member_gets_published_selected_revision(self, table):
        profile = MagicMock()
        profile.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"member_tier": "standard", "selected_theme": "spring-dawn"}
        theme = MagicMock()
        theme.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"theme_id": "spring-dawn", "display_name": "Spring Dawn", "status": "published", "requires_paid": True, "published_revision": 2}
        revision = MagicMock()
        revision.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"revision": 2, **DESIGN}
        table.side_effect = [profile, theme, revision]

        response = self.client.get("/members/me/theme", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["active_theme"]["theme_id"], "spring-dawn")
        self.assertEqual(response.json()["active_theme"]["design"], DESIGN)
        self.assertIsNone(response.json()["fallback_reason"])

    @patch("app.accounts.router.supabase.table")
    def test_free_member_falls_back_to_base_for_published_paid_theme(self, table):
        profile = MagicMock()
        profile.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"member_tier": "free", "selected_theme": "spring-dawn"}
        theme = MagicMock()
        theme.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"theme_id": "spring-dawn", "display_name": "Spring Dawn", "status": "published", "requires_paid": True, "published_revision": 2}
        table.side_effect = [profile, theme]

        response = self.client.get("/members/me/theme", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["selected_theme"], "spring-dawn")
        self.assertEqual(response.json()["active_theme"]["theme_id"], "base")
        self.assertEqual(response.json()["fallback_reason"], "plan_ineligible")
        self.assertEqual(table.call_args_list[0].args, ("member_profiles",))
        self.assertEqual(table.call_args_list[1].args, ("member_themes",))

    @patch("app.accounts.router.supabase.table")
    def test_member_can_preview_published_theme_without_changing_preference(self, table):
        theme = MagicMock()
        theme.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"theme_id": "spring-dawn", "display_name": "Spring Dawn", "status": "published", "published_revision": 2}
        revision = MagicMock()
        revision.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"revision": 2, **DESIGN}
        table.side_effect = [theme, revision]

        response = self.client.get("/members/themes/spring-dawn/preview", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["design"], DESIGN)
        self.assertEqual(table.call_count, 2)

    @patch("app.accounts.router.supabase.table")
    def test_unpublished_theme_cannot_be_previewed(self, table):
        theme = MagicMock()
        theme.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"theme_id": "spring-dawn", "display_name": "Spring Dawn", "status": "draft", "published_revision": None}
        table.return_value = theme

        response = self.client.get("/members/themes/spring-dawn/preview", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(table.call_count, 1)


if __name__ == "__main__":
    import unittest
    unittest.main()
