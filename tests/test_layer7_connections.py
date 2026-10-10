from __future__ import annotations
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.connections.router import create_connections_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
CONNECTION = "00000000-0000-0000-0000-000000000002"

class ConnectionApiTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(create_connections_router())
        self.client = TestClient(self.app)

    @patch("app.connections.router.publish_business_event")
    @patch("app.connections.router.create_connection")
    @patch("app.connections.router.has_trusted_business_identity", return_value=False)
    def test_requires_business_membership_before_mutation(self, identity, create, event):
        response = self.client.post(f"/businesses/{BUSINESS}/connections", json={"provider":"instagram","display_name":"Support"})
        self.assertEqual(response.status_code, 401)
        create.assert_not_called()

    @patch("app.connections.router.publish_business_event")
    @patch("app.connections.router.create_connection")
    @patch("app.connections.router.has_trusted_business_identity", return_value=True)
    def test_create_starts_setup_and_accepts_only_safe_settings(self, identity, create, event):
        create.return_value = {"id": CONNECTION, "business_id": BUSINESS, "provider":"instagram", "display_name":"Support", "status":"setup_required", "credential_status":"not_configured", "safe_settings":{"default_language":"en"}}
        response = self.client.post(f"/businesses/{BUSINESS}/connections", headers={"Authorization":"Bearer test"}, json={"provider":"instagram", "display_name":"Support", "safe_settings":{"default_language":"en"}})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["connection"]["status"], "setup_required")
        self.assertNotIn("credential_ref", response.json()["connection"])
        rejected = self.client.post(f"/businesses/{BUSINESS}/connections", headers={"Authorization":"Bearer test"}, json={"provider":"instagram", "display_name":"Unsafe", "safe_settings":{"api_key":"do-not-store"}})
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(create.call_count, 1)

    @patch("app.connections.router.publish_business_event")
    @patch("app.connections.router.transition_connection")
    @patch("app.connections.router.has_trusted_business_identity", return_value=True)
    def test_resume_does_not_claim_provider_connected(self, identity, update, event):
        update.return_value = ("ok", {"id": CONNECTION, "status":"setup_required", "credential_status":"not_configured"})
        response = self.client.post(f"/businesses/{BUSINESS}/connections/{CONNECTION}/resume", headers={"Authorization":"Bearer test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(update.call_args.args[2], "resume")
        self.assertNotEqual(response.json()["connection"]["status"], "connected")

    @patch("app.connections.router.publish_business_event")
    @patch("app.connections.router.update_connection_settings")
    @patch("app.connections.router.get_connection_credentials", return_value={"access_token": "configured-token"})
    @patch("app.connections.router.get_connection", return_value={"id": CONNECTION, "provider": "instagram", "status": "setup_required", "credential_status": "configured", "safe_settings": {"outbound_enabled": True}})
    @patch("app.connections.router.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_auto_reply_cannot_be_enabled_before_connection_verification(self, _member, _connection, credentials, update, event):
        response = self.client.patch(
            f"/businesses/{BUSINESS}/connections/{CONNECTION}/settings",
            headers={"Authorization": "Bearer test"},
            json={"safe_settings": {"auto_reply_enabled": True}},
        )
        self.assertEqual(response.status_code, 409)
        credentials.assert_not_called()
        update.assert_not_called()
        event.assert_not_called()

    @patch("app.connections.router.publish_business_event")
    @patch("app.connections.router.update_connection_settings")
    @patch("app.connections.router.get_connection_credentials", return_value={"access_token": "configured-token"})
    @patch("app.connections.router.get_connection", return_value={"id": CONNECTION, "provider": "manual_test", "status": "connected", "credential_status": "configured", "safe_settings": {"outbound_enabled": True}})
    @patch("app.connections.router.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_auto_reply_cannot_be_enabled_for_provider_without_adapter(self, _member, _connection, credentials, update, event):
        response = self.client.patch(
            f"/businesses/{BUSINESS}/connections/{CONNECTION}/settings",
            headers={"Authorization": "Bearer test"},
            json={"safe_settings": {"auto_reply_enabled": True}},
        )
        self.assertEqual(response.status_code, 409)
        credentials.assert_not_called()
        update.assert_not_called()
        event.assert_not_called()

    @patch("app.connections.router.publish_business_event")
    @patch("app.connections.router.update_connection_settings")
    @patch("app.connections.router.get_connection_credentials", return_value={"access_token": "configured-token"})
    @patch("app.connections.router.get_connection", return_value={"id": CONNECTION, "provider": "instagram", "status": "connected", "credential_status": "configured", "safe_settings": {"outbound_enabled": True}})
    @patch("app.connections.router.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_verified_instagram_can_enable_auto_reply_with_credentials(self, _member, _connection, credentials, update, event):
        update.return_value = {"id": CONNECTION, "status": "connected", "safe_settings": {"outbound_enabled": True, "auto_reply_enabled": True}}
        response = self.client.patch(
            f"/businesses/{BUSINESS}/connections/{CONNECTION}/settings",
            headers={"Authorization": "Bearer test"},
            json={"safe_settings": {"auto_reply_enabled": True}},
        )
        self.assertEqual(response.status_code, 200)
        credentials.assert_called_once_with(BUSINESS, CONNECTION)
        update.assert_called_once_with(BUSINESS, CONNECTION, {"auto_reply_enabled": True})
        self.assertEqual(event.call_args.args[1], "connection.settings_updated")

    @patch("app.connections.router.save_connection_credentials", return_value=True)
    @patch("app.connections.router.list_connections", return_value=[{"id": CONNECTION, "provider": "messenger"}])
    @patch("app.connections.router.trusted_business_member", return_value={"user_id": "member-1", "role": "owner"})
    def test_messenger_credentials_are_saved_to_vault_only_for_messenger(self, _member, _connections, save):
        response = self.client.put(
            f"/businesses/{BUSINESS}/connections/{CONNECTION}/credentials/messenger",
            headers={"Authorization": "Bearer test"},
            json={"app_id": "app-1", "app_secret": "secret", "page_id": "page-1", "page_access_token": "page-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"credential_status": "configured", "status": "setup_required"})
        self.assertEqual(save.call_args.args, (BUSINESS, CONNECTION, {"app_id": "app-1", "app_secret": "secret", "page_id": "page-1", "page_access_token": "page-token"}))

    @patch("app.connections.router.mark_connection_messenger_verified", return_value={"status": "connected"})
    @patch("app.connections.router.requests.post")
    @patch("app.connections.router.requests.get")
    @patch("app.connections.router.get_connection_credentials", return_value={"page_id": "page-1", "page_access_token": "page-token"})
    @patch("app.connections.router.list_connections", return_value=[{"id": CONNECTION, "provider": "messenger", "status": "setup_required"}])
    @patch("app.connections.router.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_messenger_verification_checks_page_and_message_subscription(self, _member, _connections, _credentials, get, post, verified):
        profile = unittest.mock.Mock(status_code=200)
        profile.json.return_value = {"id": "page-1", "name": "FayFort Support"}
        get.return_value = profile
        subscribed = unittest.mock.Mock(status_code=200)
        subscribed.json.return_value = {"success": True}
        post.return_value = subscribed

        response = self.client.post(
            f"/businesses/{BUSINESS}/connections/{CONNECTION}/verify-messenger",
            headers={"Authorization": "Bearer test"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"verified": True, "webhook_subscribed": True, "account_id": "page-1", "page_name": "FayFort Support", "status": "connected"})
        self.assertIn("/v26.0/page-1", get.call_args.args[0])
        self.assertIn("/v26.0/page-1/subscribed_apps", post.call_args.args[0])
        self.assertEqual(post.call_args.kwargs["params"], {"subscribed_fields": "messages"})
        verified.assert_called_once_with(BUSINESS, CONNECTION, "page-1", "FayFort Support")

if __name__ == "__main__":
    unittest.main()
