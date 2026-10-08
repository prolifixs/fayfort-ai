from __future__ import annotations
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from scripts.layer7_cli import main

ROOT = Path(__file__).resolve().parents[1]

class Layer7CliTests(unittest.TestCase):
    def test_help_lists_manual_simulation_command(self):
        result = subprocess.run([sys.executable, "-m", "scripts.layer7_cli", "--help"], cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("simulate-manual", result.stdout)

    def test_simulation_posts_normalized_event_with_bearer_token(self):
        response = Mock(is_success=True)
        response.json.return_value = {"status": "processed"}
        with patch.dict(os.environ, {"FAYFORT_ACCESS_TOKEN": "test-token"}), patch(
            "scripts.layer7_cli.httpx.post", return_value=response
        ) as post:
            result = main([
                "simulate-manual", "--base-url", "http://localhost:8001/",
                "--business-id", "00000000-0000-0000-0000-000000000001",
                "--customer-external-id", "cli-customer",
                "--provider-event-id", "event-123", "--content", "Hello",
            ])
        self.assertEqual(result, 0)
        args, kwargs = post.call_args
        self.assertEqual(args[0], "http://localhost:8001/channels/manual/inbound")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-token")
        self.assertEqual(kwargs["json"]["provider_event_id"], "event-123")
        self.assertEqual(kwargs["json"]["content"], "Hello")

    def test_connection_create_cli_posts_nonsecret_settings(self):
        response = Mock(is_success=True)
        response.json.return_value = {"connection": {"status": "setup_required"}}
        with patch.dict(os.environ, {"FAYFORT_ACCESS_TOKEN": "test-token"}), patch(
            "scripts.layer7_cli.httpx.post", return_value=response
        ) as post:
            result = main([
                "connections-create", "--base-url", "http://localhost:8001",
                "--business-id", "00000000-0000-0000-0000-000000000001",
                "--provider", "instagram", "--display-name", "Support Inbox",
                "--safe-settings", '{"inbound_enabled":true}',
            ])
        self.assertEqual(result, 0)
        args, kwargs = post.call_args
        self.assertEqual(args[0], "http://localhost:8001/businesses/00000000-0000-0000-0000-000000000001/connections")
        self.assertEqual(kwargs["json"]["safe_settings"], {"inbound_enabled": True})
        self.assertNotIn("credential", kwargs["json"])
    def test_automation_dry_run_cli_posts_idempotency_key(self):
        response = Mock(is_success=True)
        response.json.return_value = {"status": "dry_run"}
        with patch.dict(os.environ, {"FAYFORT_ACCESS_TOKEN": "test-token"}), patch(
            "scripts.layer7_cli.httpx.post", return_value=response
        ) as post:
            result = main([
                "automations-dry-run", "--base-url", "http://localhost:8001",
                "--business-id", "00000000-0000-0000-0000-000000000001",
                "--automation-id", "00000000-0000-0000-0000-000000000002",
                "--idempotency-key", "dryrun-1",
            ])
        self.assertEqual(result, 0)
        args, kwargs = post.call_args
        self.assertEqual(args[0], "http://localhost:8001/businesses/00000000-0000-0000-0000-000000000001/automations/00000000-0000-0000-0000-000000000002/dry-run")
        self.assertEqual(kwargs["json"]["idempotency_key"], "dryrun-1")
    def test_handoff_takeover_cli_uses_business_scoped_route(self):
        response = Mock(is_success=True)
        response.json.return_value = {"handoff": {"status": "active"}}
        with patch.dict(os.environ, {"FAYFORT_ACCESS_TOKEN": "test-token"}), patch(
            "scripts.layer7_cli.httpx.post", return_value=response
        ) as post:
            result = main([
                "handoffs-take-over", "--base-url", "http://localhost:8001",
                "--business-id", "00000000-0000-0000-0000-000000000001",
                "--handoff-id", "00000000-0000-0000-0000-000000000002",
            ])
        self.assertEqual(result, 0)
        self.assertEqual(post.call_args.args[0], "http://localhost:8001/businesses/00000000-0000-0000-0000-000000000001/handoffs/00000000-0000-0000-0000-000000000002/take-over")
    def test_event_feed_cli_uses_cursor_and_limit(self):
        response = Mock(is_success=True)
        response.json.return_value = {"events": []}
        with patch.dict(os.environ, {"FAYFORT_ACCESS_TOKEN": "test-token"}), patch(
            "scripts.layer7_cli.httpx.get", return_value=response
        ) as get:
            result = main([
                "events-list", "--base-url", "http://localhost:8001",
                "--business-id", "00000000-0000-0000-0000-000000000001",
                "--after-id", "12", "--limit", "25",
            ])
        self.assertEqual(result, 0)
        self.assertEqual(get.call_args.args[0], "http://localhost:8001/businesses/00000000-0000-0000-0000-000000000001/events")
        self.assertEqual(get.call_args.kwargs["params"], {"after_id":12, "limit":25})
    def test_simulation_requires_access_token_without_printing_it(self):
        environment = dict(os.environ)
        environment.pop("FAYFORT_ACCESS_TOKEN", None)
        result = subprocess.run([
            sys.executable, "-m", "scripts.layer7_cli", "simulate-manual",
            "--business-id", "00000000-0000-0000-0000-000000000001",
            "--customer-external-id", "cli-test", "--provider-event-id", "cli-event-test",
            "--content", "Test",
        ], cwd=ROOT, env=environment, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("FAYFORT_ACCESS_TOKEN", result.stderr)
        self.assertNotIn("Bearer", result.stderr)

if __name__ == "__main__":
    unittest.main()
