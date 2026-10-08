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

if __name__ == "__main__":
    unittest.main()
