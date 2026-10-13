"""Periodic infrastructure health checks (Gate 3).

Every cycle: Cloudflare API access, each named tunnel that has ever run, and each saved webhook
endpoint (read-only preflight). Each result is recorded through `record_platform_infrastructure_health`,
which alerts platform admins in the Operations inbox once per state change. Enabled with
INFRASTRUCTURE_MONITOR_ENABLED=true; interval INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS (default 300).
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from app.config.settings import settings
from app.database.client import supabase
from app.infrastructure import store
from app.infrastructure.cloudflare import CloudflareClient, CloudflareError
from app.infrastructure.preflight import webhook_preflight

logger = logging.getLogger(__name__)


def record_health(check_key: str, label: str, healthy: bool, detail: str | None) -> bool:
    response = supabase.rpc("record_platform_infrastructure_health", {
        "p_check_key": check_key, "p_label": label, "p_healthy": healthy, "p_detail": detail,
    }).execute()
    return bool(response.data)


def run_health_checks(
    *,
    record: Callable[[str, str, bool, str | None], bool] = record_health,
    client_factory: Callable[[str, str], Any] = lambda token, account: CloudflareClient(token, account),
    preflight: Callable[[str, str, str], list[tuple[str, bool, str]]] = webhook_preflight,
) -> list[dict[str, Any]]:
    """Run one cycle and return what was observed (used by tests and logs)."""
    observed: list[dict[str, Any]] = []

    def note(key: str, label: str, healthy: bool, detail: str | None) -> None:
        alerted = record(key, label, healthy, detail)
        observed.append({"check_key": key, "healthy": healthy, "alerted": alerted})

    integration = store.get_integration("cloudflare")
    if integration and integration.get("status") in {"verified", "error"}:
        credentials = store.get_integration_credentials("cloudflare") or {}
        safe = integration.get("safe_settings") or {}
        client = None
        try:
            client = client_factory(credentials.get("api_token", ""), str(safe.get("account_id") or ""))
            tunnels = client.list_tunnels()
            note("cloudflare:api", "Cloudflare API access", True, None)
            for tunnel in tunnels:
                if tunnel.get("status") == "inactive":
                    continue  # created but never run; not an outage
                healthy = tunnel.get("status") == "healthy"
                detail = f"Tunnel status: {tunnel.get('status')}; {len(tunnel.get('connections') or [])} connector link(s)."
                note(f"tunnel:{tunnel['id']}", f"Tunnel {tunnel.get('name') or tunnel['id']}", healthy, detail)
        except CloudflareError as exc:
            note("cloudflare:api", "Cloudflare API access", False, f"Cloudflare check failed: {exc.code.replace('_', ' ')}.")
        finally:
            if client is not None:
                client.close()

    if settings.META_VERIFY_TOKEN:
        for endpoint in store.list_webhook_endpoints():
            checks = preflight(endpoint["public_url"], settings.META_VERIFY_TOKEN, endpoint["channel"])
            results = [{"name": name, "ok": ok, "detail": detail} for name, ok, detail in checks]
            ok = all(item["ok"] for item in results)
            store.record_preflight(endpoint["channel"], ok, results)
            failed = [f"{item['name']} ({item['detail']})" for item in results if not item["ok"]]
            note(f"webhook:{endpoint['channel']}", f"{endpoint['channel'].title()} webhook", ok,
                 None if ok else "Failing: " + "; ".join(failed))
    return observed


async def infrastructure_monitor_loop() -> None:
    interval = max(60, settings.INFRASTRUCTURE_MONITOR_INTERVAL_SECONDS)
    while True:
        try:
            observed = await asyncio.to_thread(run_health_checks)
            alerts = [item["check_key"] for item in observed if item["alerted"]]
            if alerts:
                logger.warning("Infrastructure health changed: %s", ", ".join(alerts))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Infrastructure health check cycle failed")
        await asyncio.sleep(interval)
