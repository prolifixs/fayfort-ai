from __future__ import annotations

import json
import logging
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.infrastructure.cloudflare import CloudflareClient, CloudflareError, merge_ingress
from app.infrastructure.router import create_infrastructure_router

ADMIN = {"user_id": "00000000-0000-0000-0000-0000000000aa"}
ACCOUNT = "0123456789abcdef0123456789abcdef"
TUNNEL = "11111111-2222-3333-4444-555555555555"
TOKEN = "cf-secret-token-value-1234567890"
CONNECTOR_TOKEN = "eyJhIjoiY29ubmVjdG9yLXNlY3JldCJ9"


class FakeCloudflare:
    """Records calls; behaves like a small Cloudflare account with one zone and one tunnel."""

    def __init__(self, dns=None, fail=None):
        self.calls: list[tuple] = []
        self.dns = dns if dns is not None else []
        self.fail = fail or {}
        self.ingress = [{"hostname": "other.fayfort.com", "service": "http://127.0.0.1:9000"}, {"service": "http_status:404"}]

    def _maybe_fail(self, name):
        if name in self.fail:
            raise CloudflareError(self.fail[name])

    def verify_token(self):
        self.calls.append(("verify",)); self._maybe_fail("verify"); return {"status": "active"}

    def find_zone(self, name):
        self.calls.append(("zone", name)); self._maybe_fail("zone")
        return {"id": "zone-1", "name": name, "status": "active", "name_servers": ["a.ns.cloudflare.com"], "account_id": ACCOUNT}

    def list_tunnels(self):
        self.calls.append(("tunnels",)); self._maybe_fail("tunnels")
        return [{"id": TUNNEL, "name": "fayfort-api-dev", "status": "healthy", "connections": []}]

    def create_tunnel(self, name):
        self.calls.append(("create_tunnel", name)); return {"id": "new-id", "name": name, "status": "inactive", "connections": []}

    def tunnel_ingress(self, tunnel_id):
        self.calls.append(("ingress", tunnel_id)); return list(self.ingress)

    def put_tunnel_ingress(self, tunnel_id, ingress):
        self.calls.append(("put_ingress", tunnel_id, ingress)); self.ingress = ingress

    def tunnel_token(self, tunnel_id):
        self.calls.append(("token", tunnel_id)); return CONNECTOR_TOKEN

    def dns_records(self, zone_id, name):
        self.calls.append(("dns", zone_id, name)); return list(self.dns)

    def create_tunnel_cname(self, zone_id, hostname, tunnel_id):
        self.calls.append(("create_cname", hostname, tunnel_id)); return {}

    def update_tunnel_cname(self, zone_id, record_id, hostname, tunnel_id):
        self.calls.append(("update_cname", record_id, hostname, tunnel_id)); return {}

    def close(self):
        pass


class FakeStore:
    def __init__(self, configured=True):
        self.integration = {"provider": "cloudflare", "status": "verified",
                            "safe_settings": {"account_id": ACCOUNT, "zone_id": "zone-1", "zone_name": "fayfort.com"}} if configured else None
        self.secret = {"api_token": TOKEN} if configured else None
        self.endpoints: dict[str, dict] = {}
        self.audits: list[tuple] = []

    def get_integration(self, provider): return self.integration
    def get_integration_credentials(self, provider): return self.secret

    def save_integration_credentials(self, provider, secret, safe, actor):
        self.secret, self.integration = secret, {"provider": provider, "status": "configured", "safe_settings": safe}; return True

    def mark_integration(self, provider, *, status, error_code, safe_settings=None):
        self.integration = {**(self.integration or {}), "status": status, "health_error_code": error_code}
        if safe_settings is not None:
            self.integration["safe_settings"] = safe_settings

    def list_webhook_endpoints(self): return list(self.endpoints.values())

    def save_webhook_endpoint(self, channel, public_url, actor):
        self.endpoints[channel] = {"channel": channel, "public_url": public_url}; return self.endpoints[channel]

    def record_preflight(self, channel, ok, results): self.endpoints[channel].update(last_preflight_ok=ok, last_preflight_results=results)
    def last_inbound_event_at(self, channel): return "2026-10-13T15:00:00+00:00" if channel == "instagram" else None
    def audit(self, actor, action, details): self.audits.append((action, details))
    def recent_audit(self, limit=20): return [{"action": a, "details": d} for a, d in self.audits][-limit:]


def build(store=None, fake=None, admin=ADMIN, preflight=None):
    store = store or FakeStore()
    fake = fake or FakeCloudflare()
    app = FastAPI()
    app.include_router(create_infrastructure_router(
        admin_identity=lambda authorization: admin,
        client_factory=lambda token, account: fake,
        preflight=preflight or (lambda url, token, channel: [("public URL uses HTTPS", True, url)]),
    ))
    return TestClient(app), store, fake


class InfrastructureRouterTests(unittest.TestCase):
    def client(self, **kwargs):
        client, store, fake = build(**kwargs)
        patcher = patch("app.infrastructure.router.store", store)
        patcher.start()
        self.addCleanup(patcher.stop)
        return client, store, fake

    def test_non_admins_are_refused_everywhere(self):
        client, _, fake = self.client(admin=None)
        self.assertEqual(client.get("/platform/infrastructure").status_code, 403)
        self.assertEqual(client.post("/platform/infrastructure/cloudflare/verify").status_code, 403)
        self.assertEqual(client.put("/platform/infrastructure/webhooks/instagram", json={"public_url": "https://api.fayfort.com"}).status_code, 403)
        self.assertEqual(client.post("/platform/infrastructure/cloudflare/hostnames", json={"tunnel_id": TUNNEL, "label": "api", "confirm": True}).status_code, 403)
        self.assertEqual(fake.calls, [])

    def test_saving_credentials_verifies_token_zone_and_tunnel_permission_and_never_returns_the_token(self):
        client, store, fake = self.client(store=FakeStore(configured=False))
        response = client.put("/platform/infrastructure/cloudflare/credentials",
                              json={"api_token": TOKEN, "account_id": ACCOUNT, "zone_name": "FayFort.com."})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(TOKEN, response.text)
        self.assertEqual([c[0] for c in fake.calls], ["verify", "zone", "tunnels"])
        self.assertEqual(fake.calls[1], ("zone", "fayfort.com"))
        self.assertEqual(store.secret, {"api_token": TOKEN})
        self.assertEqual(store.integration["status"], "verified")
        self.assertNotIn(TOKEN, json.dumps(store.audits))

    def test_rejected_token_is_reported_with_a_safe_code_and_nothing_is_saved(self):
        client, store, _ = self.client(store=FakeStore(configured=False), fake=FakeCloudflare(fail={"verify": "token_rejected"}))
        response = client.put("/platform/infrastructure/cloudflare/credentials",
                              json={"api_token": TOKEN, "account_id": ACCOUNT, "zone_name": "fayfort.com"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "token_rejected")
        self.assertIsNone(store.secret)

    def test_status_lists_tunnels_hostnames_and_webhooks_without_secrets(self):
        client, store, _ = self.client()
        store.endpoints["instagram"] = {"channel": "instagram", "public_url": "https://api-dev.fayfort.com"}
        body = client.get("/platform/infrastructure").json()
        self.assertEqual(body["tunnels"][0]["status"], "healthy")
        self.assertEqual(body["tunnels"][0]["hostnames"][0]["hostname"], "other.fayfort.com")
        instagram = next(w for w in body["webhooks"] if w["channel"] == "instagram")
        self.assertEqual(instagram["callback_url"], "https://api-dev.fayfort.com/webhooks/instagram")
        self.assertEqual(instagram["last_event_at"], "2026-10-13T15:00:00+00:00")
        self.assertNotIn(TOKEN, json.dumps(body))

    def test_hostname_routing_requires_confirmation(self):
        client, _, fake = self.client()
        response = client.post("/platform/infrastructure/cloudflare/hostnames", json={"tunnel_id": TUNNEL, "label": "api-dev"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(fake.calls, [])

    def test_only_api_hostnames_can_be_managed(self):
        client, _, fake = self.client()
        for label in ["www", "@", "mail", "app", "api.evil"]:
            response = client.post("/platform/infrastructure/cloudflare/hostnames", json={"tunnel_id": TUNNEL, "label": label, "confirm": True})
            self.assertEqual(response.status_code, 422, label)
        self.assertEqual(fake.calls, [])

    def test_hostname_routing_adds_ingress_and_creates_a_proxied_tunnel_cname(self):
        client, store, fake = self.client()
        with patch("app.infrastructure.router.settings.API_PORT", 8001):
            response = client.post("/platform/infrastructure/cloudflare/hostnames", json={"tunnel_id": TUNNEL, "label": "api-dev", "confirm": True})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["public_url"], "https://api-dev.fayfort.com")
        put = next(c for c in fake.calls if c[0] == "put_ingress")
        self.assertEqual(put[2], [
            {"hostname": "other.fayfort.com", "service": "http://127.0.0.1:9000"},
            {"hostname": "api-dev.fayfort.com", "service": "http://127.0.0.1:8001"},
            {"service": "http_status:404"},
        ])
        self.assertIn(("create_cname", "api-dev.fayfort.com", TUNNEL), fake.calls)
        self.assertEqual(store.audits[-1][0], "cloudflare.hostname_routed")

    def test_existing_unmanaged_dns_record_is_never_overwritten(self):
        fake = FakeCloudflare(dns=[{"id": "r1", "type": "A", "name": "api.fayfort.com", "content": "76.76.21.21"}])
        client, _, fake = self.client(fake=fake)
        response = client.post("/platform/infrastructure/cloudflare/hostnames", json={"tunnel_id": TUNNEL, "label": "api", "confirm": True})
        self.assertEqual(response.status_code, 409)
        self.assertFalse(any(c[0] in {"put_ingress", "create_cname", "update_cname"} for c in fake.calls))

    def test_existing_tunnel_cname_is_repointed(self):
        fake = FakeCloudflare(dns=[{"id": "r1", "type": "CNAME", "name": "api.fayfort.com", "content": "old.cfargotunnel.com"}])
        client, _, fake = self.client(fake=fake)
        response = client.post("/platform/infrastructure/cloudflare/hostnames", json={"tunnel_id": TUNNEL, "label": "api", "confirm": True})
        self.assertEqual(response.status_code, 200)
        self.assertIn(("update_cname", "r1", "api.fayfort.com", TUNNEL), fake.calls)

    def test_install_command_is_audited_and_the_connector_token_is_not_logged(self):
        client, store, _ = self.client()
        with self.assertNoLogs("app.infrastructure", level=logging.DEBUG):
            response = client.post(f"/platform/infrastructure/cloudflare/tunnels/{TUNNEL}/install-command", json={"platform": "windows"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["command"], f".\\cloudflared.exe service install {CONNECTOR_TOKEN}")
        self.assertEqual(store.audits[-1], ("cloudflare.install_command_viewed", {"tunnel_id": TUNNEL, "platform": "windows"}))
        self.assertNotIn(CONNECTOR_TOKEN, json.dumps(store.audits))

    def test_webhook_endpoint_requires_https_base_and_runs_server_side_preflight(self):
        seen = {}

        def preflight(url, token, channel):
            seen.update(url=url, token=token, channel=channel)
            return [("public URL uses HTTPS", True, url), ("webhook verification challenge", True, "HTTP 200")]

        client, store, _ = self.client(preflight=preflight)
        self.assertEqual(client.put("/platform/infrastructure/webhooks/instagram", json={"public_url": "http://x.test"}).status_code, 422)
        self.assertEqual(client.put("/platform/infrastructure/webhooks/instagram", json={"public_url": "https://api-dev.fayfort.com/"}).status_code, 200)
        with patch("app.infrastructure.router.settings.META_VERIFY_TOKEN", "verify-secret"):
            response = client.post("/platform/infrastructure/webhooks/instagram/preflight")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(seen, {"url": "https://api-dev.fayfort.com", "token": "verify-secret", "channel": "instagram"})
        self.assertNotIn("verify-secret", response.text)
        self.assertTrue(store.endpoints["instagram"]["last_preflight_ok"])


class CloudflareClientTests(unittest.TestCase):
    def test_client_sends_bearer_token_and_reduces_tunnels_to_safe_fields(self):
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append((request.method, request.url.path, request.headers.get("authorization")))
            return httpx.Response(200, json={"success": True, "result": [{
                "id": TUNNEL, "name": "fayfort-api-dev", "status": "healthy", "credentials_file": {"secret": "x"},
                "connections": [{"colo_name": "sjc06", "opened_at": "2026-10-13T00:00:00Z", "client_version": "2026.9.3", "origin_ip": "1.2.3.4"}],
            }]})

        client = CloudflareClient(TOKEN, ACCOUNT, transport=httpx.MockTransport(handler))
        tunnels = client.list_tunnels()
        self.assertEqual(seen[0], ("GET", f"/client/v4/accounts/{ACCOUNT}/cfd_tunnel", f"Bearer {TOKEN}"))
        self.assertEqual(tunnels[0]["connections"][0], {"colo_name": "sjc06", "opened_at": "2026-10-13T00:00:00Z", "client_version": "2026.9.3", "is_pending_reconnect": False})
        self.assertNotIn("credentials_file", tunnels[0])

    def test_client_maps_auth_failures_to_safe_codes(self):
        client = CloudflareClient(TOKEN, ACCOUNT, transport=httpx.MockTransport(lambda r: httpx.Response(403, json={"success": False})))
        with self.assertRaises(CloudflareError) as raised:
            client.list_tunnels()
        self.assertEqual(raised.exception.code, "token_rejected")

    def test_merge_ingress_replaces_the_hostname_and_keeps_one_catch_all(self):
        rules = [{"hostname": "api.fayfort.com", "service": "http://127.0.0.1:8000"}, {"service": "http_status:404"}]
        self.assertEqual(merge_ingress(rules, "api.fayfort.com", "http://127.0.0.1:8001"),
                         [{"hostname": "api.fayfort.com", "service": "http://127.0.0.1:8001"}, {"service": "http_status:404"}])


class InfrastructureMonitorTests(unittest.TestCase):
    def run_cycle(self, fake, store, preflight_ok=True):
        from app.infrastructure.monitor import run_health_checks
        recorded = []

        def record(key, label, healthy, detail):
            recorded.append((key, healthy, detail))
            return not healthy

        def preflight(url, token, channel):
            return [("public URL uses HTTPS", True, url), ("webhook verification challenge", preflight_ok, "HTTP 200" if preflight_ok else "HTTP 502")]

        with patch("app.infrastructure.monitor.store", store), patch("app.infrastructure.monitor.settings.META_VERIFY_TOKEN", "verify-secret"):
            observed = run_health_checks(record=record, client_factory=lambda token, account: fake, preflight=preflight)
        return recorded, observed

    def test_healthy_tunnel_and_webhook_are_recorded_healthy(self):
        store = FakeStore()
        store.endpoints["instagram"] = {"channel": "instagram", "public_url": "https://api-dev.fayfort.com"}
        recorded, observed = self.run_cycle(FakeCloudflare(), store)
        self.assertEqual([(k, h) for k, h, _ in recorded], [("cloudflare:api", True), (f"tunnel:{TUNNEL}", True), ("webhook:instagram", True)])
        self.assertTrue(store.endpoints["instagram"]["last_preflight_ok"])
        self.assertFalse(any(item["alerted"] for item in observed))

    def test_down_tunnel_failing_webhook_and_rejected_token_raise_alerts(self):
        store = FakeStore()
        store.endpoints["instagram"] = {"channel": "instagram", "public_url": "https://api-dev.fayfort.com"}
        fake = FakeCloudflare()
        fake.list_tunnels = lambda: [{"id": TUNNEL, "name": "fayfort-api-dev", "status": "down", "connections": []},
                                     {"id": "never-run", "name": "spare", "status": "inactive", "connections": []}]
        recorded, _ = self.run_cycle(fake, store, preflight_ok=False)
        self.assertIn((f"tunnel:{TUNNEL}", False, "Tunnel status: down; 0 connector link(s)."), recorded)
        self.assertFalse(any(key == "tunnel:never-run" for key, _, _ in recorded))
        webhook = next(r for r in recorded if r[0] == "webhook:instagram")
        self.assertFalse(webhook[1])
        self.assertIn("webhook verification challenge (HTTP 502)", webhook[2])
        self.assertNotIn("verify-secret", json.dumps(recorded))

        recorded, _ = self.run_cycle(FakeCloudflare(fail={"tunnels": "token_rejected"}), FakeStore())
        self.assertEqual(recorded, [("cloudflare:api", False, "Cloudflare check failed: token rejected.")])

    def test_nothing_is_checked_before_cloudflare_is_connected(self):
        recorded, _ = self.run_cycle(FakeCloudflare(), FakeStore(configured=False))
        self.assertEqual(recorded, [])


if __name__ == "__main__":
    unittest.main()


class FindZoneTests(unittest.TestCase):
    def _client(self, zones_by_name):
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            name = request.url.params.get("name")
            seen.append(name)
            return httpx.Response(200, json={"success": True, "result": zones_by_name.get(name, [])})

        return CloudflareClient("token", "acct", transport=httpx.MockTransport(handler)), seen

    def test_hostname_resolves_to_its_zone(self):
        zone = {"id": "z1", "name": "fayfort.com", "status": "active", "name_servers": [], "account": {"id": "acct"}}
        client, seen = self._client({"fayfort.com": [zone]})
        found = client.find_zone("www.fayfort.com")
        self.assertEqual(found["name"], "fayfort.com")
        self.assertEqual(seen, ["www.fayfort.com", "fayfort.com"])

    def test_unknown_domain_is_zone_not_found_without_querying_the_tld(self):
        client, seen = self._client({})
        with self.assertRaises(CloudflareError) as ctx:
            client.find_zone("www.example.org")
        self.assertEqual(ctx.exception.code, "zone_not_found")
        self.assertEqual(seen, ["www.example.org", "example.org"])
