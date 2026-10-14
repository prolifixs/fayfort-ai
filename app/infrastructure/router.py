"""Platform-admin Infrastructure API: Cloudflare connection, tunnels, public hostnames and webhook endpoints.

Every route requires the server-managed platform-admin claim. Secrets (the Cloudflare API token and
tunnel connector tokens) are stored in the Supabase vault, never logged, and only a connector install
command is ever returned, on an explicit audited request.
"""
from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.config.settings import settings
from app.directory.identity import trusted_platform_admin
from app.infrastructure import store
from app.infrastructure.cloudflare import CloudflareClient, CloudflareError, merge_ingress
from app.infrastructure.preflight import WEBHOOK_CHANNELS, webhook_preflight

logger = logging.getLogger(__name__)
PROVIDER = "cloudflare"
STATUS_CACHE_SECONDS = 30
HOSTNAME_LABEL = re.compile(r"^api(-[a-z0-9]{1,20})?$")
TUNNEL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{2,62}$")


class CloudflareCredentialsInput(BaseModel):
    api_token: str = Field(min_length=20, max_length=200)
    account_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    zone_name: str = Field(min_length=3, max_length=253)

    @field_validator("api_token", "zone_name")
    @classmethod
    def strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("zone_name")
    @classmethod
    def lowercase_zone(cls, value: str) -> str:
        value = value.lower().rstrip(".")
        if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", value):
            raise ValueError("Enter a domain such as fayfort.com")
        return value


class WebhookEndpointInput(BaseModel):
    public_url: str = Field(max_length=300)

    @field_validator("public_url")
    @classmethod
    def https_base(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not re.fullmatch(r"https://[a-z0-9.-]+(:\d+)?", value.lower()):
            raise ValueError("Use the HTTPS base address only, e.g. https://api-dev.fayfort.com")
        return value


class TunnelCreateInput(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip().lower()
        if not TUNNEL_NAME.fullmatch(value):
            raise ValueError("Use 3-63 lowercase letters, digits or dashes, e.g. fayfort-api-dev")
        return value


class HostnameInput(BaseModel):
    tunnel_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    label: str = Field(description="Subdomain label such as api or api-dev")
    confirm: bool = False

    @field_validator("label")
    @classmethod
    def managed_label(cls, value: str) -> str:
        value = value.strip().lower()
        if not HOSTNAME_LABEL.fullmatch(value):
            raise ValueError("FayFort only manages api or api-<name> hostnames")
        return value


class InstallCommandInput(BaseModel):
    platform: Literal["windows", "linux"] = "windows"


def create_infrastructure_router(
    admin_identity: Callable[[str | None], dict | None] = trusted_platform_admin,
    client_factory: Callable[[str, str], CloudflareClient] = lambda token, account: CloudflareClient(token, account),
    preflight: Callable[[str, str, str], list[tuple[str, bool, str]]] = webhook_preflight,
) -> APIRouter:
    router = APIRouter(prefix="/platform/infrastructure", tags=["platform infrastructure"])
    cache: dict[str, Any] = {"at": 0.0, "value": None}

    def require_admin(authorization: str | None) -> dict:
        admin = admin_identity(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin

    def cloudflare() -> tuple[CloudflareClient, dict[str, Any]]:
        integration = store.get_integration(PROVIDER)
        credentials = store.get_integration_credentials(PROVIDER) if integration else None
        if not integration or not credentials or not credentials.get("api_token"):
            raise HTTPException(status_code=409, detail="Connect Cloudflare first.")
        safe = integration.get("safe_settings") or {}
        return client_factory(credentials["api_token"], str(safe.get("account_id") or "")), safe

    def cloudflare_failure(exc: CloudflareError) -> HTTPException:
        messages = {
            "token_rejected": "Cloudflare rejected the API token. Check its permissions and expiry.",
            "token_inactive": "The Cloudflare API token is not active.",
            "zone_not_found": "That domain was not found in the Cloudflare account. Enter the root domain (for example fayfort.com) and check that the token has Zone · Zone · Read for it.",
            "cloudflare_unreachable": "Cloudflare could not be reached. Try again.",
            "not_found": "Cloudflare could not find that resource.",
        }
        return HTTPException(status_code=502 if exc.code == "cloudflare_unreachable" else 422,
                             detail={"message": messages.get(exc.code, "Cloudflare rejected the request."), "code": exc.code})

    def webhook_rows() -> list[dict[str, Any]]:
        saved = {row["channel"]: row for row in store.list_webhook_endpoints()}
        rows = []
        for channel in WEBHOOK_CHANNELS:
            row = saved.get(channel)
            public_url = (row or {}).get("public_url") or ""
            suggested = settings.PUBLIC_API_URL.rstrip("/") if not row and settings.PUBLIC_API_URL else None
            try:
                last_event = store.last_inbound_event_at(channel)
            except Exception:
                logger.exception("Last inbound event could not be read for %s", channel)
                last_event = None
            rows.append({
                "channel": channel,
                "public_url": public_url or None,
                "suggested_public_url": suggested,
                "callback_url": f"{public_url}/webhooks/{channel}" if public_url else None,
                "last_preflight_at": (row or {}).get("last_preflight_at"),
                "last_preflight_ok": (row or {}).get("last_preflight_ok"),
                "last_preflight_results": (row or {}).get("last_preflight_results") or [],
                "last_event_at": last_event,
            })
        return rows

    def live_cloudflare_view(client: CloudflareClient) -> dict[str, Any]:
        tunnels = client.list_tunnels()
        for tunnel in tunnels:
            try:
                tunnel["hostnames"] = [
                    {"hostname": rule.get("hostname"), "service": rule.get("service")}
                    for rule in client.tunnel_ingress(tunnel["id"]) if rule.get("hostname")
                ]
            except CloudflareError as exc:
                tunnel["hostnames"] = []
                tunnel["hostnames_error"] = exc.code
        return {"tunnels": tunnels}

    @router.get("")
    def infrastructure_status(refresh: bool = False, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            integration = store.get_integration(PROVIDER)
        except Exception:
            logger.exception("Platform integration could not be loaded")
            raise HTTPException(status_code=503, detail="Infrastructure settings could not be loaded. Apply the platform infrastructure migration.")
        live: dict[str, Any] = {"tunnels": [], "error_code": None}
        if integration and integration.get("status") == "verified":
            if not refresh and cache["value"] is not None and time.monotonic() - cache["at"] < STATUS_CACHE_SECONDS:
                live = cache["value"]
            else:
                client = None
                try:
                    client, _ = cloudflare()
                    live = {**live_cloudflare_view(client), "error_code": None}
                except CloudflareError as exc:
                    live = {"tunnels": [], "error_code": exc.code}
                finally:
                    if client:
                        client.close()
                cache.update(at=time.monotonic(), value=live)
        return {
            "cloudflare": integration or {"provider": PROVIDER, "status": "not_configured", "safe_settings": {}},
            "tunnels": live["tunnels"],
            "cloudflare_error_code": live["error_code"],
            "webhooks": webhook_rows(),
            "local_api": {"base_url": f"http://{settings.API_HOST}:{settings.API_PORT}", "public_api_url": settings.PUBLIC_API_URL or None},
            "recent_events": store.recent_audit(),
        }

    @router.put("/cloudflare/credentials")
    def save_cloudflare_credentials(payload: CloudflareCredentialsInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        client = client_factory(payload.api_token, payload.account_id)
        try:
            client.verify_token()
            zone = client.find_zone(payload.zone_name)
            client.list_tunnels()  # proves the Cloudflare Tunnel permission
        except CloudflareError as exc:
            store.audit(admin["user_id"], "cloudflare.verify_failed", {"code": exc.code})
            raise cloudflare_failure(exc)
        finally:
            client.close()
        safe = {"account_id": payload.account_id, "zone_name": zone["name"], "zone_id": zone["id"],
                "zone_status": zone["status"], "name_servers": zone["name_servers"]}
        if not store.save_integration_credentials(PROVIDER, {"api_token": payload.api_token}, safe, admin["user_id"]):
            raise HTTPException(status_code=503, detail="Cloudflare credentials could not be saved.")
        store.mark_integration(PROVIDER, status="verified", error_code=None)
        cache.update(at=0.0, value=None)
        store.audit(admin["user_id"], "cloudflare.verified", {"zone_name": zone["name"], "zone_status": zone["status"]})
        return {"status": "verified", "safe_settings": safe}

    @router.post("/cloudflare/verify")
    def reverify_cloudflare(authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        client, safe = cloudflare()
        try:
            client.verify_token()
            zone = client.find_zone(str(safe.get("zone_name") or ""))
            client.list_tunnels()
        except CloudflareError as exc:
            store.mark_integration(PROVIDER, status="error", error_code=exc.code)
            store.audit(admin["user_id"], "cloudflare.verify_failed", {"code": exc.code})
            raise cloudflare_failure(exc)
        finally:
            client.close()
        safe = {**safe, "zone_id": zone["id"], "zone_status": zone["status"], "name_servers": zone["name_servers"]}
        store.mark_integration(PROVIDER, status="verified", error_code=None, safe_settings=safe)
        cache.update(at=0.0, value=None)
        return {"status": "verified", "safe_settings": safe}

    @router.post("/cloudflare/tunnels", status_code=201)
    def create_tunnel(payload: TunnelCreateInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        client, _ = cloudflare()
        try:
            if any(t.get("name") == payload.name for t in client.list_tunnels()):
                raise HTTPException(status_code=409, detail="A tunnel with that name already exists.")
            tunnel = client.create_tunnel(payload.name)
        except CloudflareError as exc:
            raise cloudflare_failure(exc)
        finally:
            client.close()
        cache.update(at=0.0, value=None)
        store.audit(admin["user_id"], "cloudflare.tunnel_created", {"tunnel_id": tunnel["id"], "name": tunnel["name"]})
        return {"tunnel": tunnel}

    @router.post("/cloudflare/hostnames")
    def route_hostname(payload: HostnameInput, authorization: str | None = Header(default=None)):
        """Point <label>.<zone> at a tunnel: ingress rule to the local API plus a proxied CNAME.

        Never overwrites a DNS record FayFort did not create (anything not pointing at a tunnel)."""
        admin = require_admin(authorization)
        if not payload.confirm:
            raise HTTPException(status_code=400, detail="Confirm the hostname change before it is applied.")
        client, safe = cloudflare()
        zone_id, zone_name = str(safe.get("zone_id") or ""), str(safe.get("zone_name") or "")
        hostname = f"{payload.label}.{zone_name}"
        service = f"http://127.0.0.1:{settings.API_PORT}"
        try:
            if not any(t["id"] == payload.tunnel_id for t in client.list_tunnels()):
                raise HTTPException(status_code=404, detail="Tunnel not found in this Cloudflare account.")
            records = client.dns_records(zone_id, hostname)
            unmanaged = [r for r in records if not (r.get("type") == "CNAME" and str(r.get("content") or "").endswith(".cfargotunnel.com"))]
            if unmanaged:
                raise HTTPException(status_code=409, detail=f"{hostname} already has a DNS record FayFort does not manage. Remove or rename it in Cloudflare first.")
            client.put_tunnel_ingress(payload.tunnel_id, merge_ingress(client.tunnel_ingress(payload.tunnel_id), hostname, service))
            if records:
                client.update_tunnel_cname(zone_id, records[0]["id"], hostname, payload.tunnel_id)
                dns_action = "updated"
            else:
                client.create_tunnel_cname(zone_id, hostname, payload.tunnel_id)
                dns_action = "created"
        except CloudflareError as exc:
            store.audit(admin["user_id"], "cloudflare.hostname_failed", {"hostname": hostname, "code": exc.code})
            raise cloudflare_failure(exc)
        finally:
            client.close()
        cache.update(at=0.0, value=None)
        store.audit(admin["user_id"], "cloudflare.hostname_routed",
                    {"hostname": hostname, "tunnel_id": payload.tunnel_id, "service": service, "dns": dns_action})
        return {"hostname": hostname, "service": service, "dns": dns_action, "public_url": f"https://{hostname}"}

    @router.post("/cloudflare/tunnels/{tunnel_id}/install-command")
    def connector_install_command(tunnel_id: str, payload: InstallCommandInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        if not re.fullmatch(r"[0-9a-f-]{36}", tunnel_id):
            raise HTTPException(status_code=422, detail="Invalid tunnel ID.")
        client, _ = cloudflare()
        try:
            token = client.tunnel_token(tunnel_id)
        except CloudflareError as exc:
            raise cloudflare_failure(exc)
        finally:
            client.close()
        store.audit(admin["user_id"], "cloudflare.install_command_viewed", {"tunnel_id": tunnel_id, "platform": payload.platform})
        command = (f"cloudflared.exe service install {token}" if payload.platform == "windows"
                   else f"sudo cloudflared service install {token}")
        return {"command": command, "note": "Run once on the machine that hosts the API. Treat this command like a password."}

    @router.put("/webhooks/{channel}")
    def save_webhook_endpoint(channel: str, payload: WebhookEndpointInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        if channel not in WEBHOOK_CHANNELS:
            raise HTTPException(status_code=404, detail="Unknown webhook channel.")
        row = store.save_webhook_endpoint(channel, payload.public_url, admin["user_id"])
        store.audit(admin["user_id"], "webhook.endpoint_saved", {"channel": channel, "public_url": payload.public_url})
        return {"endpoint": row, "callback_url": f"{payload.public_url}/webhooks/{channel}"}

    @router.post("/webhooks/{channel}/preflight")
    def run_webhook_preflight(channel: str, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        if channel not in WEBHOOK_CHANNELS:
            raise HTTPException(status_code=404, detail="Unknown webhook channel.")
        saved = {row["channel"]: row for row in store.list_webhook_endpoints()}.get(channel)
        if not saved:
            raise HTTPException(status_code=409, detail="Save the public address for this webhook first.")
        if not settings.META_VERIFY_TOKEN:
            raise HTTPException(status_code=409, detail="META_VERIFY_TOKEN is not set in the API's .env.")
        checks = preflight(saved["public_url"], settings.META_VERIFY_TOKEN, channel)
        results = [{"name": name, "ok": ok, "detail": detail} for name, ok, detail in checks]
        ok = all(item["ok"] for item in results)
        store.record_preflight(channel, ok, results)
        store.audit(admin["user_id"], "webhook.preflight", {"channel": channel, "ok": ok})
        return {"ok": ok, "results": results, "callback_url": f"{saved['public_url']}/webhooks/{channel}"}

    return router
