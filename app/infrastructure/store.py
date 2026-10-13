"""Database access for platform integrations, webhook endpoints and the infrastructure audit trail."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.database.client import supabase

INTEGRATION_FIELDS = "provider,status,safe_settings,health_checked_at,health_error_code,updated_at"
ENDPOINT_FIELDS = "channel,public_url,last_preflight_at,last_preflight_ok,last_preflight_results,updated_at"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_integration(provider: str) -> dict[str, Any] | None:
    response = supabase.table("platform_integrations").select(INTEGRATION_FIELDS).eq("provider", provider).limit(1).execute()
    return response.data[0] if response.data else None


def save_integration_credentials(provider: str, secret: dict[str, str], safe_settings: dict[str, Any], actor_id: str) -> bool:
    response = supabase.rpc("set_platform_integration_credentials", {
        "p_provider": provider, "p_secret_payload": secret, "p_safe_settings": safe_settings, "p_actor_id": actor_id,
    }).execute()
    return bool(response.data)


def get_integration_credentials(provider: str) -> dict[str, str] | None:
    response = supabase.rpc("get_platform_integration_credentials", {"p_provider": provider}).execute()
    return response.data if isinstance(response.data, dict) else None


def mark_integration(provider: str, *, status: str, error_code: str | None, safe_settings: dict[str, Any] | None = None) -> None:
    values: dict[str, Any] = {"status": status, "health_checked_at": _now(), "health_error_code": error_code, "updated_at": _now()}
    if safe_settings is not None:
        values["safe_settings"] = safe_settings
    supabase.table("platform_integrations").update(values).eq("provider", provider).execute()


def list_webhook_endpoints() -> list[dict[str, Any]]:
    response = supabase.table("platform_webhook_endpoints").select(ENDPOINT_FIELDS).order("channel").execute()
    return response.data or []


def save_webhook_endpoint(channel: str, public_url: str, actor_id: str) -> dict[str, Any]:
    response = supabase.table("platform_webhook_endpoints").upsert({
        "channel": channel, "public_url": public_url, "updated_by": actor_id, "updated_at": _now(),
        "last_preflight_at": None, "last_preflight_ok": None, "last_preflight_results": [],
    }, on_conflict="channel").execute()
    if not response.data:
        raise RuntimeError("Webhook endpoint was not saved")
    return {key: response.data[0].get(key) for key in ENDPOINT_FIELDS.split(",")}


def record_preflight(channel: str, ok: bool, results: list[dict[str, Any]]) -> None:
    supabase.table("platform_webhook_endpoints").update({
        "last_preflight_at": _now(), "last_preflight_ok": ok, "last_preflight_results": results,
    }).eq("channel", channel).execute()


def last_inbound_event_at(channel: str) -> str | None:
    response = (supabase.table("channel_events").select("created_at").eq("channel", channel)
                .order("created_at", desc=True).limit(1).execute())
    return response.data[0]["created_at"] if response.data else None


def audit(actor_id: str, action: str, details: dict[str, Any]) -> None:
    supabase.table("platform_infrastructure_events").insert({"actor_id": actor_id, "action": action, "details": details}).execute()


def recent_audit(limit: int = 20) -> list[dict[str, Any]]:
    response = (supabase.table("platform_infrastructure_events").select("id,action,details,created_at")
                .order("created_at", desc=True).limit(limit).execute())
    return response.data or []
