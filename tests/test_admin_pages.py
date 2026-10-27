"""Operations restructure R1: admin-only pages refuse workers at the door (app/admin_pages.py)."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.admin_pages import admin_only_path
from app.main import app

B = "/businesses/b16f5070-322f-4e86-a18d-243fa54e75c4"


class AdminOnlyPathTests(unittest.TestCase):
    def test_admin_pages(self):
        for tail in ("automations", "automations/x/runs", "connections", "entitlements", "verification", "analytics",
                     "ai-usage", "settings", "channels", "channel-deliveries", "directory/tools", "directory/products/1",
                     "knowledge", "knowledge/docs", "faqs", "handoffs/agents"):
            self.assertTrue(admin_only_path(f"{B}/{tail}"), tail)

    def test_worker_pages_stay_open(self):
        for tail in ("handoffs", "handoffs/availability", "handoffs/1/claim", "conversations", "conversations/1/messages",
                     "requests", "directory", "knowledgeable", "settingsx"):
            self.assertFalse(admin_only_path(f"{B}/{tail}"), tail)
        self.assertFalse(admin_only_path("/dashboard/businesses"))
        self.assertFalse(admin_only_path("/members/me"))


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_worker_refused(self):
        with patch("app.admin_pages.trusted_platform_admin", return_value=None):
            response = self.client.get(f"{B}/automations", headers={"Authorization": "Bearer worker"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("administrator", response.json()["detail"])

    def test_preflight_passes(self):
        response = self.client.options(f"{B}/automations", headers={"Origin": "https://app.fayfort.com", "Access-Control-Request-Method": "GET"})
        self.assertNotEqual(response.status_code, 403)

    def test_admin_passes_guard(self):
        with patch("app.admin_pages.trusted_platform_admin", return_value={"user_id": "a"}):
            response = self.client.get(f"{B}/automations", headers={"Authorization": "Bearer admin"})
        self.assertNotEqual(response.json().get("detail"), "Only a FayFort administrator can open this page.")


if __name__ == "__main__":
    unittest.main()
