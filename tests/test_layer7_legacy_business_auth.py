from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


BUSINESS = "business-1"
USER = "member-1"


class LegacyBusinessRouteAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("app.main.list_client_accounts_for_staff")
    @patch("app.main.trusted_fayfort_staff", return_value=None)
    def test_business_list_rejects_non_staff_without_database_read(self, identity, list_businesses):
        response = self.client.get("/businesses")

        self.assertEqual(response.status_code, 403)
        identity.assert_called_once_with(None)
        list_businesses.assert_not_called()

    @patch("app.main.list_client_accounts_for_staff", return_value=[
        {"business_id": BUSINESS, "name": "Client account"},
    ])
    @patch("app.main.trusted_fayfort_staff", return_value={"user_id": USER, "role": "worker"})
    def test_business_list_returns_managed_client_accounts_to_staff(self, identity, list_businesses):
        response = self.client.get("/businesses", headers={"Authorization": "Bearer valid"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["businesses"], [
            {"business_id": BUSINESS, "name": "Client account"},
        ])
        identity.assert_called_once_with("Bearer valid")
        list_businesses.assert_called_once_with()

    @patch("app.main.list_business_members")
    @patch("app.main.trusted_business_member", return_value=None)
    def test_member_list_requires_fayfort_staff_before_read(self, identity, list_members):
        response = self.client.get(f"/businesses/{BUSINESS}/members")

        self.assertEqual(response.status_code, 401)
        identity.assert_called_once_with(None, BUSINESS)
        list_members.assert_not_called()

    @patch("app.main.list_business_members", return_value=[{
        "user_id": USER,
        "role": "admin",
        "status": "active",
        "joined_at": "2026-10-01T00:00:00Z",
        "private_column": "must not be returned",
    }])
    @patch("app.main.trusted_business_member", return_value={"user_id": USER, "role": "member"})
    def test_member_list_returns_only_safe_fields_for_client_account(self, identity, list_members):
        response = self.client.get(
            f"/businesses/{BUSINESS}/members",
            headers={"Authorization": "Bearer valid"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "business_id": BUSINESS,
            "members": [{
                "user_id": USER,
                "role": "admin",
                "status": "active",
                "joined_at": "2026-10-01T00:00:00Z",
            }],
        })
        identity.assert_called_once_with("Bearer valid", BUSINESS)
        list_members.assert_called_once_with(BUSINESS)

    @patch("app.main.get_or_create_conversation")
    @patch("app.main.trusted_business_member", return_value=None)
    def test_conversation_creation_rejects_non_staff_before_write(self, identity, create_conversation):
        response = self.client.post("/conversations", json={
            "business_id": BUSINESS,
            "customer_external_id": "customer-1",
            "channel": "manual_test",
        })

        self.assertEqual(response.status_code, 401)
        identity.assert_called_once_with(None, BUSINESS)
        create_conversation.assert_not_called()

    @patch("app.main.get_or_create_conversation", return_value={"id": "conversation-1"})
    @patch("app.main.trusted_business_member", return_value={"user_id": USER, "role": "member"})
    def test_conversation_creation_requires_staff_and_preserves_existing_result(self, identity, create_conversation):
        response = self.client.post(
            "/conversations",
            headers={"Authorization": "Bearer valid"},
            json={
                "business_id": BUSINESS,
                "customer_external_id": "customer-1",
                "channel": "manual_test",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"conversation": {"id": "conversation-1"}})
        identity.assert_called_once_with("Bearer valid", BUSINESS)
        create_conversation.assert_called_once_with(
            business_id=BUSINESS,
            customer_external_id="customer-1",
            channel="manual_test",
        )


if __name__ == "__main__":
    unittest.main()
