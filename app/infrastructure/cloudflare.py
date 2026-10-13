"""Minimal Cloudflare API client for the FayFort platform integration.

Only the calls FayFort needs: token verification, zone lookup, named-tunnel listing/creation,
tunnel ingress configuration, connector tokens and DNS records. Responses are reduced to safe
fields; the API token is never logged or returned.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)
API_BASE = "https://api.cloudflare.com/client/v4"


class CloudflareError(Exception):
    """A Cloudflare call failed. `code` is a safe, stable identifier for UI and audit."""

    def __init__(self, code: str, status_code: int | None = None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class CloudflareClient:
    def __init__(self, api_token: str, account_id: str = "", *, transport: httpx.BaseTransport | None = None):
        if not api_token:
            raise CloudflareError("token_missing")
        self.account_id = account_id
        self._client = httpx.Client(
            base_url=API_BASE, timeout=15, transport=transport,
            headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("Cloudflare request failed: %s %s (%s)", method, path.split("?")[0], type(exc).__name__)
            raise CloudflareError("cloudflare_unreachable") from exc
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code in (401, 403):
            raise CloudflareError("token_rejected", response.status_code)
        if response.status_code == 404:
            raise CloudflareError("not_found", response.status_code)
        if response.status_code >= 400 or not isinstance(body, dict) or body.get("success") is False:
            codes = [str(error.get("code")) for error in (body.get("errors") or []) if isinstance(error, dict)]
            logger.warning("Cloudflare rejected %s %s: http=%s codes=%s", method, path.split("?")[0], response.status_code, codes)
            raise CloudflareError("cloudflare_rejected", response.status_code)
        return body.get("result")

    def _account(self) -> str:
        if not self.account_id:
            raise CloudflareError("account_missing")
        return self.account_id

    # -- token and zone -------------------------------------------------------------------
    def verify_token(self) -> dict[str, Any]:
        """User tokens verify at /user; account-owned tokens at /accounts/{id}."""
        try:
            result = self._call("GET", "/user/tokens/verify")
        except CloudflareError as exc:
            if exc.code not in {"token_rejected", "cloudflare_rejected"} or not self.account_id:
                raise
            result = self._call("GET", f"/accounts/{self.account_id}/tokens/verify")
        if not isinstance(result, dict) or result.get("status") != "active":
            raise CloudflareError("token_inactive")
        return {"status": "active", "expires_on": result.get("expires_on")}

    def find_zone(self, zone_name: str) -> dict[str, Any]:
        params: dict[str, str] = {"name": zone_name}
        if self.account_id:
            params["account.id"] = self.account_id
        zones = self._call("GET", "/zones", params=params) or []
        if not zones:
            raise CloudflareError("zone_not_found")
        zone = zones[0]
        return {
            "id": str(zone.get("id")), "name": zone.get("name"), "status": zone.get("status"),
            "name_servers": list(zone.get("name_servers") or []),
            "account_id": str((zone.get("account") or {}).get("id") or self.account_id or ""),
        }

    # -- tunnels --------------------------------------------------------------------------
    def list_tunnels(self) -> list[dict[str, Any]]:
        rows = self._call("GET", f"/accounts/{self._account()}/cfd_tunnel", params={"is_deleted": "false", "per_page": 100}) or []
        return [_safe_tunnel(row) for row in rows if isinstance(row, dict)]

    def create_tunnel(self, name: str) -> dict[str, Any]:
        row = self._call("POST", f"/accounts/{self._account()}/cfd_tunnel", json={"name": name, "config_src": "cloudflare"})
        return _safe_tunnel(row or {})

    def tunnel_token(self, tunnel_id: str) -> str:
        token = self._call("GET", f"/accounts/{self._account()}/cfd_tunnel/{tunnel_id}/token")
        if not isinstance(token, str) or not token:
            raise CloudflareError("tunnel_token_missing")
        return token

    def tunnel_ingress(self, tunnel_id: str) -> list[dict[str, Any]]:
        result = self._call("GET", f"/accounts/{self._account()}/cfd_tunnel/{tunnel_id}/configurations") or {}
        ingress = ((result.get("config") or {}).get("ingress") or []) if isinstance(result, dict) else []
        return [rule for rule in ingress if isinstance(rule, dict)]

    def put_tunnel_ingress(self, tunnel_id: str, ingress: list[dict[str, Any]]) -> None:
        self._call("PUT", f"/accounts/{self._account()}/cfd_tunnel/{tunnel_id}/configurations",
                   json={"config": {"ingress": ingress}})

    # -- DNS ------------------------------------------------------------------------------
    def dns_records(self, zone_id: str, name: str) -> list[dict[str, Any]]:
        rows = self._call("GET", f"/zones/{zone_id}/dns_records", params={"name": name}) or []
        return [{"id": str(r.get("id")), "type": r.get("type"), "name": r.get("name"), "content": r.get("content"),
                 "proxied": r.get("proxied")} for r in rows if isinstance(r, dict)]

    def create_tunnel_cname(self, zone_id: str, hostname: str, tunnel_id: str) -> dict[str, Any]:
        return self._call("POST", f"/zones/{zone_id}/dns_records", json={
            "type": "CNAME", "name": hostname, "content": f"{tunnel_id}.cfargotunnel.com", "proxied": True,
            "comment": "Managed by FayFort AI (tunnel hostname)",
        }) or {}

    def update_tunnel_cname(self, zone_id: str, record_id: str, hostname: str, tunnel_id: str) -> dict[str, Any]:
        return self._call("PUT", f"/zones/{zone_id}/dns_records/{record_id}", json={
            "type": "CNAME", "name": hostname, "content": f"{tunnel_id}.cfargotunnel.com", "proxied": True,
            "comment": "Managed by FayFort AI (tunnel hostname)",
        }) or {}


def _safe_tunnel(row: dict[str, Any]) -> dict[str, Any]:
    connections = [
        {"colo_name": c.get("colo_name"), "opened_at": c.get("opened_at"), "client_version": c.get("client_version"),
         "is_pending_reconnect": bool(c.get("is_pending_reconnect"))}
        for c in (row.get("connections") or []) if isinstance(c, dict)
    ]
    return {
        "id": str(row.get("id") or ""), "name": row.get("name"), "status": row.get("status") or "unknown",
        "created_at": row.get("created_at"), "conns_active_at": row.get("conns_active_at"),
        "conns_inactive_at": row.get("conns_inactive_at"), "connections": connections,
    }


def merge_ingress(rules: list[dict[str, Any]], hostname: str, service: str) -> list[dict[str, Any]]:
    """Set hostname -> service, keep other hostname rules, and end with exactly one catch-all 404 rule."""
    kept = [r for r in rules if r.get("hostname") and r.get("hostname") != hostname]
    return [*kept, {"hostname": hostname, "service": service}, {"service": "http_status:404"}]
