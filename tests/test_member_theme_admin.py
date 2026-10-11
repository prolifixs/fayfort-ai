from __future__ import annotations

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router

ADMIN = "00000000-0000-0000-0000-000000000099"
DESIGN = {
    "palette_preset": "ocean-blue",
    "wrapper_style": "soft",
    "colors": {
        "page_background": "#FFFFFF", "surface": "#F7F9FA", "text": "#17212B",
        "muted_text": "#526170", "accent": "#005A9C", "accent_foreground": "#FFFFFF",
        "border": "#637180", "focus": "#005A9C",
    },
}


class MemberThemeAdminTests(TestCase):
    def setUp(self):
        self.admin_patch = patch("app.accounts.router.trusted_platform_admin", return_value={"user_id": ADMIN})
        self.admin = self.admin_patch.start()
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    def tearDown(self):
        self.admin_patch.stop()

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_theme_studio_requires_platform_admin(self, table):
        self.admin.return_value = None
        headers = {"Authorization": "Bearer worker-token"}
        responses = [
            self.client.get("/platform/themes", headers=headers),
            self.client.post("/platform/themes", headers=headers, json={"theme_id": "spring-dawn", "display_name": "Spring Dawn", "design": DESIGN}),
            self.client.post("/platform/themes/spring-dawn/draft", headers=headers, json={"display_name": "Spring Dawn", "design": DESIGN}),
            self.client.post("/platform/themes/spring-dawn/publish", headers=headers),
            self.client.post("/platform/themes/spring-dawn/archive", headers=headers),
        ]
        self.assertEqual([response.status_code for response in responses], [403] * 5)
        table.assert_not_called()

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_platform_admin_creates_private_paid_theme_draft(self, table):
        theme_insert = MagicMock()
        theme_insert.insert.return_value.select.return_value.execute.return_value.data = [{
            "theme_id": "spring-dawn", "display_name": "Spring Dawn", "description": None,
            "status": "draft", "draft_revision": None, "published_revision": None,
        }]
        revision_insert = MagicMock()
        theme_update = MagicMock()
        table.side_effect = [theme_insert, revision_insert, theme_update]

        response = self.client.post("/platform/themes", headers={"Authorization": "Bearer admin-token"}, json={
            "theme_id": "Spring-Dawn", "display_name": "Spring Dawn", "design": DESIGN,
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["theme"]["draft_revision"], 1)
        theme_insert.insert.assert_called_once()
        created = theme_insert.insert.call_args.args[0]
        self.assertEqual(created["theme_id"], "spring-dawn")
        self.assertEqual(created["status"], "draft")
        self.assertTrue(created["requires_paid"])
        revision_insert.insert.assert_called_once()
        self.assertEqual(revision_insert.insert.call_args.args[0]["revision"], 1)

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_create_rejects_inaccessible_contrast_before_database_write(self, table):
        bad_design = {**DESIGN, "colors": {**DESIGN["colors"], "text": "#999999"}}
        response = self.client.post("/platform/themes", headers={"Authorization": "Bearer admin-token"}, json={
            "theme_id": "low-contrast", "display_name": "Low Contrast", "design": bad_design,
        })
        self.assertEqual(response.status_code, 422)
        table.assert_not_called()

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_create_returns_bounded_platform_admin_diagnostic_on_write_failure(self, table):
        class DatabaseFailure(Exception):
            code = "XX000"
            message = "write failed: " + ("x" * 400)

        theme_insert = MagicMock()
        theme_insert.insert.return_value.select.return_value.execute.side_effect = DatabaseFailure()
        table.return_value = theme_insert
        response = self.client.post("/platform/themes", headers={"Authorization": "Bearer admin-token"}, json={
            "theme_id": "diagnostic-theme", "display_name": "Diagnostic Theme", "design": DESIGN,
        })
        self.assertEqual(response.status_code, 503)
        detail = response.json()["detail"]
        self.assertTrue(detail.startswith("The theme draft could not be created. Diagnostic: write failed:"))
        self.assertIn("(XX000)", detail)
        self.assertLessEqual(len(detail), 320)

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_edit_published_theme_creates_revision_without_replacing_published(self, table):
        theme_read = MagicMock()
        theme_read.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "theme_id": "spring-dawn", "status": "published",
        }
        latest_read = MagicMock()
        latest_read.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [{"revision": 4}]
        revision_write = MagicMock()
        theme_write = MagicMock()
        table.side_effect = [theme_read, latest_read, revision_write, theme_write]

        response = self.client.post("/platform/themes/spring-dawn/draft", headers={"Authorization": "Bearer admin-token"}, json={
            "display_name": "Spring Dawn", "description": "Updated palette", "design": DESIGN,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"theme_id": "spring-dawn", "draft_revision": 5, "status": "published"})
        self.assertEqual(revision_write.insert.call_args.args[0]["revision"], 5)
        update = theme_write.update.call_args.args[0]
        self.assertEqual(update["draft_revision"], 5)
        self.assertEqual(update["draft_display_name"], "Spring Dawn")
        self.assertNotIn("published_revision", update)
        self.assertNotIn("display_name", update)
        self.assertNotIn("description", update)
        self.assertNotIn("status", update)

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_publish_copies_draft_pointer_to_published_pointer(self, table):
        read = MagicMock()
        read.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"status": "draft", "draft_revision": 2, "display_name": "Spring Dawn", "draft_display_name": "Spring Dawn", "draft_description": None}
        write = MagicMock()
        table.side_effect = [read, write]
        response = self.client.post("/platform/themes/spring-dawn/publish", headers={"Authorization": "Bearer admin-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(write.update.call_args.args[0]["published_revision"], 2)
        self.assertEqual(write.update.call_args.args[0]["status"], "published")

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_archive_published_theme_keeps_catalog_record_and_marks_archived(self, table):
        read = MagicMock()
        read.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "status": "published", "published_revision": 3,
        }
        write = MagicMock()
        table.side_effect = [read, write]

        response = self.client.post("/platform/themes/spring-dawn/archive", headers={"Authorization": "Bearer admin-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"theme_id": "spring-dawn", "status": "archived"})
        update = write.update.call_args.args[0]
        self.assertEqual(update["status"], "archived")
        self.assertNotIn("published_revision", update)
        self.assertNotIn("theme_id", update)

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_publish_without_draft_does_not_write(self, table):
        read = MagicMock()
        read.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "status": "draft", "draft_revision": None, "display_name": "Spring Dawn",
            "draft_display_name": "Spring Dawn", "draft_description": None,
        }
        table.return_value = read

        response = self.client.post("/platform/themes/spring-dawn/publish", headers={"Authorization": "Bearer admin-token"})

        self.assertEqual(response.status_code, 409)
        self.assertIn("Save a valid draft", response.json()["detail"])
        self.assertEqual(table.call_count, 1)
        read.update.assert_not_called()

    @patch("app.accounts.member_theme_admin.supabase.table")
    def test_fayfort_base_cannot_be_archived(self, table):
        response = self.client.post("/platform/themes/base/archive", headers={"Authorization": "Bearer admin-token"})
        self.assertEqual(response.status_code, 409)
        table.assert_not_called()


if __name__ == "__main__":
    import unittest
    unittest.main()
