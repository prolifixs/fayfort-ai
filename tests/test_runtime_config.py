from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from app.__main__ import main, runtime_config
from app.config.settings import API_CONTRACT


class RuntimeConfigTests(unittest.TestCase):
    def test_print_config_reports_the_env_port_and_contract(self):
        with patch("app.__main__.settings") as settings, patch("builtins.print") as printed:
            settings.API_HOST, settings.API_PORT, settings.PUBLIC_API_URL = "127.0.0.1", 8123, "https://api-dev.fayfort.com"
            self.assertEqual(main(["--print-config"]), 0)
        self.assertEqual(json.loads(printed.call_args.args[0]), {
            "host": "127.0.0.1", "port": 8123, "base_url": "http://127.0.0.1:8123", "api_contract": API_CONTRACT,
            "public_api_url": "https://api-dev.fayfort.com",
        })

    def test_api_starts_on_the_configured_port(self):
        with patch("app.__main__.settings") as settings, patch("uvicorn.run") as run:
            settings.API_HOST, settings.API_PORT = "127.0.0.1", 8123
            main(["--reload"])
        args, kwargs = run.call_args
        self.assertEqual(args[0], "app.main:app")
        self.assertEqual((kwargs["host"], kwargs["port"], kwargs["reload"]), ("127.0.0.1", 8123, True))

    def test_health_returns_the_shared_contract(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self.assertEqual(TestClient(app).get("/health").json()["api_contract"], API_CONTRACT)
        self.assertEqual(runtime_config()["api_contract"], API_CONTRACT)


class PublicAddressSettingsTests(unittest.TestCase):
    def config(self, **values):
        from app.config.settings import Settings
        base = {"SUPABASE_URL": "http://x", "SUPABASE_ANON_KEY": "x", "SUPABASE_SERVICE_ROLE_KEY": "x", "HF_TOKEN": "x"}
        return Settings(_env_file=None, **{**base, **values})

    def test_cors_includes_local_dashboard_app_origin_and_extras_once(self):
        from app.config.settings import cors_allowed_origins
        config = self.config(APP_PUBLIC_URL="https://app.fayfort.com/", ALLOWED_ORIGINS="https://www.fayfort.com, https://app.fayfort.com,")
        self.assertEqual(cors_allowed_origins(config), [
            "http://127.0.0.1:5173", "http://localhost:5173", "https://app.fayfort.com", "https://www.fayfort.com",
            "https://fayfort.com",
        ])

    def test_default_cors_is_local_dashboard_and_public_website(self):
        from app.config.settings import cors_allowed_origins
        self.assertEqual(cors_allowed_origins(self.config()), [
            "http://127.0.0.1:5173", "http://localhost:5173", "https://www.fayfort.com", "https://fayfort.com"])

    def test_worker_invite_redirect_follows_app_url_unless_overridden(self):
        from app.config.settings import worker_invite_redirect_url
        self.assertEqual(worker_invite_redirect_url(self.config(APP_PUBLIC_URL="https://app.fayfort.com")), "https://app.fayfort.com/auth/callback?audience=staff&type=invite")
        self.assertEqual(worker_invite_redirect_url(self.config()), "http://127.0.0.1:5173/auth/callback?audience=staff&type=invite")
        self.assertEqual(worker_invite_redirect_url(self.config(WORKER_INVITE_REDIRECT_URL="https://x.test/cb")), "https://x.test/cb")


if __name__ == "__main__":
    unittest.main()
