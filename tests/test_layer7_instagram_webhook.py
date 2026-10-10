from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.channels.instagram import create_instagram_webhook_router


class InstagramWebhookDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_instagram_webhook_router(lambda *_args: {"status": "ok"}))
        self.client = TestClient(app)

    @patch("app.channels.instagram.logger.warning")
    @patch("app.channels.instagram.list_instagram_connections_for_account", return_value=[])
    def test_unmatched_account_is_acknowledged_without_logging_raw_account_id(self, _connections, warning):
        account_id = "private-account-id-12345"
        response = self.client.post(
            "/webhooks/instagram",
            headers={"X-Hub-Signature-256": "sha256=synthetic"},
            json={"object": "instagram", "entry": [{"id": account_id}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "accepted", "processed": 0})
        diagnostic = " ".join(str(part) for part in warning.call_args.args)
        self.assertIn("account_fingerprint=", diagnostic)
        self.assertNotIn(account_id, diagnostic)


if __name__ == "__main__":
    unittest.main()
