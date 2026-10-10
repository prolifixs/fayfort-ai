from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"


class DirectorySearchBusinessBoundaryTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.lookup_directory")
    @patch("app.dashboard.modules.get_conversation", return_value={"id": "conversation-1", "business_id": "other-business"})
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_directory_search_rejects_conversation_from_another_business(self, _member, _conversation, lookup):
        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/search",
            headers={"Authorization": "Bearer member"},
            json={"tool_id": "hotel_search", "conversation_id": "conversation-1", "query": "hotel"},
        )
        self.assertEqual(response.status_code, 404)
        lookup.assert_not_called()

    @patch("app.dashboard.modules.lookup_directory")
    @patch("app.dashboard.modules.get_conversation")
    @patch("app.dashboard.modules.trusted_business_member", return_value=None)
    def test_directory_search_requires_a_signed_in_business_member(self, _member, conversation, lookup):
        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/search",
            headers={"Authorization": "Bearer invalid"},
            json={"tool_id": "hotel_search", "conversation_id": "conversation-1", "query": "hotel"},
        )
        self.assertEqual(response.status_code, 401)
        conversation.assert_not_called()
        lookup.assert_not_called()


if __name__ == "__main__":
    unittest.main()
