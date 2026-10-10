from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"


class ConversationListApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.list_conversations")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_list_applies_business_filters_and_bounded_pagination(self, _member, list_rows):
        list_rows.return_value = [
            {"id": "c1", "business_id": BUSINESS, "channel": "instagram", "status": "open", "private_field": "omit"},
            {"id": "c2", "business_id": BUSINESS, "channel": "instagram", "status": "open"},
            {"id": "c3", "business_id": BUSINESS, "channel": "instagram", "status": "open"},
        ]

        response = self.client.get(
            f"/businesses/{BUSINESS}/conversations",
            headers={"Authorization": "Bearer signed-in-member"},
            params={"status": "open", "channel": "instagram", "limit": 2, "offset": 4},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["conversations"]), 2)
        self.assertTrue(response.json()["has_more"])
        self.assertEqual(response.json()["next_offset"], 6)
        self.assertNotIn("private_field", response.json()["conversations"][0])
        list_rows.assert_called_once_with(BUSINESS, "open", "instagram", limit=3, offset=4)

    @patch("app.dashboard.modules.list_conversations")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_page_size_is_capped_by_api_contract(self, _member, list_rows):
        response = self.client.get(
            f"/businesses/{BUSINESS}/conversations",
            headers={"Authorization": "Bearer signed-in-member"},
            params={"limit": 101},
        )
        self.assertEqual(response.status_code, 422)
        list_rows.assert_not_called()


if __name__ == "__main__":
    unittest.main()
