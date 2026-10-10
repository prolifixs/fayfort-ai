from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from app.database.client import supabase

SAFE_FIELDS = "id,business_id,provider,display_name,status,credential_status,provider_account_id,provider_username,health_checked_at,health_error_code,safe_settings,created_at,updated_at"


def list_connections(business_id: str) -> list[dict[str, Any]]:
    response = supabase.table("business_connections").select(SAFE_FIELDS).eq("business_id", business_id).order("created_at", desc=True).execute()
    return response.data or []


def create_connection(business_id: str, provider: str, display_name: str, safe_settings: dict[str, Any]) -> dict[str, Any]:
    response = supabase.table("business_connections").insert({
        "business_id": business_id,
        "provider": provider,
        "display_name": display_name,
        "status": "setup_required",
        "credential_status": "not_configured",
        "safe_settings": safe_settings,
    }).execute()
    if not response.data:
        raise RuntimeError("Connection was not created")
    return {key: value for key, value in response.data[0].items() if key in SAFE_FIELDS.split(",")}


def get_connection(business_id: str, connection_id: str) -> dict[str, Any] | None:
    response = supabase.table("business_connections").select(SAFE_FIELDS).eq("business_id", business_id).eq("id", connection_id).limit(1).execute()
    return response.data[0] if response.data else None


def transition_connection(business_id: str, connection_id: str, action: str) -> tuple[str, dict[str, Any] | None]:
    current = get_connection(business_id, connection_id)
    if current is None:
        return "not_found", None
    old_status = current["status"]
    transitions = {
        "pause": {"setup_required", "connected", "error"},
        "resume": {"paused", "disconnected", "error"},
        "disconnect": {"setup_required", "connected", "paused", "error"},
    }
    if action == "disconnect" and old_status == "disconnected":
        return "ok", current
    if action not in transitions or old_status not in transitions[action]:
        return "conflict", current
    next_status = {"pause": "paused", "resume": "setup_required", "disconnect": "disconnected"}[action]
    response = (supabase.table("business_connections").update({"status": next_status})
        .eq("business_id", business_id).eq("id", connection_id).eq("status", old_status)
        .select(SAFE_FIELDS).execute())
    if not response.data:
        return "conflict", None
    return "ok", response.data[0]


def update_connection_settings(business_id: str, connection_id: str, safe_settings: dict[str, Any]) -> dict[str, Any] | None:
    current = get_connection(business_id, connection_id)
    if current is None:
        return None
    merged = {**(current.get("safe_settings") or {}), **safe_settings}
    response = (supabase.table("business_connections").update({"safe_settings": merged})
        .eq("business_id", business_id).eq("id", connection_id)
        .select(SAFE_FIELDS).execute())
    return response.data[0] if response.data else None


def save_connection_credentials(business_id: str, connection_id: str, payload: dict[str, str]) -> bool:
    response = supabase.rpc("set_business_connection_credentials", {
        "p_business_id": business_id,
        "p_connection_id": connection_id,
        "p_secret_payload": payload,
    }).execute()
    saved = bool(response.data)
    if saved:
        (supabase.table("business_connections").update({
            "health_checked_at": None,
            "health_error_code": None,
        }).eq("business_id", business_id).eq("id", connection_id).execute())
    return saved


def get_connection_credentials(business_id: str, connection_id: str) -> dict[str, str] | None:
    response = supabase.rpc("get_business_connection_credentials", {
        "p_business_id": business_id,
        "p_connection_id": connection_id,
    }).execute()
    return response.data if isinstance(response.data, dict) else None


def mark_connection_instagram_verified(
    business_id: str, connection_id: str, account_id: str, username: str
) -> dict[str, Any] | None:
    response = (supabase.table("business_connections").update({
        "provider_account_id": account_id,
        "provider_username": username,
        "status": "connected",
        "health_checked_at": datetime.now(timezone.utc).isoformat(),
        "health_error_code": None,
    }).eq("business_id", business_id).eq("id", connection_id)
      .eq("provider", "instagram").select(SAFE_FIELDS).execute())
    return response.data[0] if response.data else None


def mark_connection_instagram_error(
    business_id: str, connection_id: str, error_code: str
) -> dict[str, Any] | None:
    response = (supabase.table("business_connections").update({
        "status": "error",
        "health_checked_at": datetime.now(timezone.utc).isoformat(),
        "health_error_code": error_code,
    }).eq("business_id", business_id).eq("id", connection_id)
      .eq("provider", "instagram").select(SAFE_FIELDS).execute())
    return response.data[0] if response.data else None


def list_instagram_connections_for_account(account_id: str) -> list[dict[str, Any]]:
    response = (supabase.table("business_connections")
        .select("id,business_id,provider,provider_account_id,status,safe_settings")
        .eq("provider", "instagram")
        .eq("provider_account_id", account_id)
        .execute())
    return response.data or []


def mark_connection_messenger_verified(
    business_id: str, connection_id: str, page_id: str, page_name: str
) -> dict[str, Any] | None:
    response = (supabase.table("business_connections").update({
        "provider_account_id": page_id,
        "provider_username": page_name,
        "status": "connected",
        "health_checked_at": datetime.now(timezone.utc).isoformat(),
        "health_error_code": None,
    }).eq("business_id", business_id).eq("id", connection_id)
      .eq("provider", "messenger").select(SAFE_FIELDS).execute())
    return response.data[0] if response.data else None


def mark_connection_messenger_error(
    business_id: str, connection_id: str, error_code: str
) -> dict[str, Any] | None:
    response = (supabase.table("business_connections").update({
        "status": "error",
        "health_checked_at": datetime.now(timezone.utc).isoformat(),
        "health_error_code": error_code,
    }).eq("business_id", business_id).eq("id", connection_id)
      .eq("provider", "messenger").select(SAFE_FIELDS).execute())
    return response.data[0] if response.data else None


def list_messenger_connections_for_page(page_id: str) -> list[dict[str, Any]]:
    response = (supabase.table("business_connections")
        .select("id,business_id,provider,provider_account_id,status,safe_settings")
        .eq("provider", "messenger")
        .eq("provider_account_id", page_id)
        .execute())
    return response.data or []
