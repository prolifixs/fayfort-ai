from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router

USER = "00000000-0000-0000-0000-000000000010"


class MemberThemePickerApiTests(TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_standard_member_can_apply_published_theme(self, identity, get_user, table):
        profiles = MagicMock()
        profiles.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"member_tier": "standard"}
        profiles.update.return_value.eq.return_value.select.return_value.execute.return_value.data = [{"selected_theme": "spring-dawn"}]
        themes = MagicMock()
        themes.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "theme_id": "spring-dawn", "status": "published", "requires_paid": True, "published_revision": 2,
        }
        table.side_effect = lambda name: profiles if name == "member_profiles" else themes
        response = self.client.put("/members/me/theme", headers={"Authorization": "Bearer member-token"}, json={"theme_id": "spring-dawn"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"selected_theme": "spring-dawn"})
        profiles.update.assert_called_once_with({"selected_theme": "spring-dawn"})

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_draft_theme_cannot_be_applied_even_by_paid_member(self, identity, get_user, table):
        profiles = MagicMock()
        profiles.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"member_tier": "pro"}
        themes = MagicMock()
        themes.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "theme_id": "spring-dawn", "status": "draft", "requires_paid": True, "published_revision": None,
        }
        table.side_effect = lambda name: profiles if name == "member_profiles" else themes
        response = self.client.put("/members/me/theme", headers={"Authorization": "Bearer member-token"}, json={"theme_id": "spring-dawn"})
        self.assertEqual(response.status_code, 404)
        self.assertIn("published theme", response.json()["detail"])
        profiles.update.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_free_member_cannot_apply_published_paid_theme(self, identity, get_user, table):
        profiles = MagicMock()
        profiles.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"member_tier": "free"}
        themes = MagicMock()
        themes.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "theme_id": "spring-dawn", "status": "published", "requires_paid": True, "published_revision": 2,
        }
        table.side_effect = lambda name: profiles if name == "member_profiles" else themes
        response = self.client.put("/members/me/theme", headers={"Authorization": "Bearer member-token"}, json={"theme_id": "spring-dawn"})
        self.assertEqual(response.status_code, 403)
        profiles.update.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10T00:00:00Z")))
    @patch("app.accounts.router.trusted_user_id", return_value=USER)
    def test_catalog_shows_base_and_published_themes_only_with_apply_entitlement(self, identity, get_user, table):
        profiles = MagicMock()
        profiles.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"member_tier": "free", "selected_theme": "base"}
        themes = MagicMock()
        themes.select.return_value.eq.return_value.order.return_value.execute.return_value.data = [
            {"theme_id": "spring-dawn", "display_name": "Spring Dawn", "description": "Green", "status": "published", "requires_paid": True, "published_revision": 2},
        ]
        revisions = MagicMock()
        colors = {"page_background": "#0B1A33", "surface": "#12264A", "text": "#EAF1FB", "muted_text": "#A9BCD8",
                  "accent": "#4FA3FF", "accent_foreground": "#06122A", "border": "#3A5A8C", "focus": "#7CC0FF"}
        revisions.select.return_value.in_.return_value.execute.return_value.data = [
            {"theme_id": "spring-dawn", "revision": 1, "palette_preset": "old", "wrapper_style": "clean", "colors": colors},
            {"theme_id": "spring-dawn", "revision": 2, "palette_preset": "koko-water-navy", "wrapper_style": "soft", "colors": colors, "font_family": "montserrat"},
        ]
        tries = MagicMock()
        tries.select.return_value.eq.return_value.gte.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"theme_id": "spring-dawn", "started_at": "2026-10-19T10:00:00+00:00"}]
        table.side_effect = lambda name: (profiles if name == "member_profiles" else revisions if name == "member_theme_revisions"
                                          else tries if name == "member_theme_tries" else themes)
        response = self.client.get("/members/themes", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        # Every choice carries its published design so the chooser can draw it.
        self.assertEqual(body["themes"][0]["design"]["colors"]["accent"], "#005A9C")
        self.assertEqual(body["themes"][1]["design"], {"palette_preset": "koko-water-navy", "wrapper_style": "soft", "colors": colors, "font_family": "montserrat"})
        revisions.select.return_value.in_.assert_called_once_with("theme_id", ["spring-dawn"])
        self.assertEqual(body["tries"], {"limit": 3, "left": 2, "next_at": None, "seconds": 15})
        self.assertEqual([theme["theme_id"] for theme in body["themes"]], ["base", "spring-dawn"])
        self.assertTrue(body["themes"][0]["can_apply"])
        self.assertFalse(body["themes"][1]["can_apply"])
        themes.select.assert_called_once_with("theme_id,display_name,description,status,requires_paid,published_revision")
