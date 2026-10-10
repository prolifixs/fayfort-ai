from __future__ import annotations
from typing import Any
from app.database.client import supabase

AUTOMATION_FIELDS = "id,business_id,name,trigger_type,action_type,action_config,conditions,enabled,schedule_interval_seconds,schedule_next_run_at,schedule_attempts,schedule_last_error_code,created_at,updated_at"
EXECUTION_FIELDS = "id,business_id,automation_id,status,idempotency_key,result,error_code,triggered_by,created_at,completed_at"

def list_automations(business_id: str) -> list[dict[str, Any]]:
    response = supabase.table("business_automations").select(AUTOMATION_FIELDS).eq("business_id", business_id).order("created_at", desc=True).execute()
    return response.data or []

def list_enabled_trigger_automations(business_id: str, trigger_type: str) -> list[dict[str, Any]]:
    response = (supabase.table("business_automations").select(AUTOMATION_FIELDS)
        .eq("business_id", business_id).eq("trigger_type", trigger_type)
        .eq("enabled", True).order("created_at").execute())
    return response.data or []

def list_due_scheduled_automations(now: str, limit: int = 100) -> list[dict[str, Any]]:
    response = (supabase.table("business_automations").select(AUTOMATION_FIELDS)
        .eq("trigger_type", "scheduled_interval").eq("enabled", True)
        .lte("schedule_next_run_at", now).order("schedule_next_run_at")
        .limit(limit).execute())
    return response.data or []

def advance_scheduled_automation(
    automation_id: str,
    *,
    next_run_at: str,
    attempts: int,
    last_error_code: str | None,
) -> dict[str, Any] | None:
    response = (supabase.table("business_automations").update({
        "schedule_next_run_at": next_run_at,
        "schedule_attempts": attempts,
        "schedule_last_error_code": last_error_code,
    }).eq("id", automation_id).eq("enabled", True).select(AUTOMATION_FIELDS).execute())
    return response.data[0] if response.data else None

def create_automation(business_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    response = supabase.table("business_automations").insert({"business_id": business_id, **payload, "enabled": False}).execute()
    if not response.data:
        raise RuntimeError("Automation was not created")
    return {k:v for k,v in response.data[0].items() if k in AUTOMATION_FIELDS.split(",")}

def get_automation(business_id: str, automation_id: str) -> dict[str, Any] | None:
    response = supabase.table("business_automations").select(AUTOMATION_FIELDS).eq("business_id", business_id).eq("id", automation_id).limit(1).execute()
    return response.data[0] if response.data else None

def set_automation_enabled(business_id: str, automation_id: str, enabled: bool) -> dict[str, Any] | None:
    existing = get_automation(business_id, automation_id)
    if existing is None:
        return None
    updates: dict[str, Any] = {"enabled": enabled}
    if existing.get("trigger_type") == "scheduled_interval":
        if enabled:
            from datetime import datetime, timedelta, timezone
            updates["schedule_next_run_at"] = (
                datetime.now(timezone.utc) + timedelta(seconds=int(existing["schedule_interval_seconds"]))
            ).isoformat()
            updates["schedule_attempts"] = 0
            updates["schedule_last_error_code"] = None
        else:
            updates["schedule_next_run_at"] = None
    response = (supabase.table("business_automations").update(updates).eq("business_id", business_id).eq("id", automation_id).select(AUTOMATION_FIELDS).execute())
    return response.data[0] if response.data else None

def get_execution(automation_id: str, idempotency_key: str) -> dict[str, Any] | None:
    response = supabase.table("automation_executions").select(EXECUTION_FIELDS).eq("automation_id", automation_id).eq("idempotency_key", idempotency_key).limit(1).execute()
    return response.data[0] if response.data else None

def create_execution(payload: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    try:
        response = supabase.table("automation_executions").insert(payload).execute()
        if response.data:
            return True, response.data[0]
    except Exception:
        existing = get_execution(payload["automation_id"], payload["idempotency_key"])
        if existing:
            return False, existing
        raise
    raise RuntimeError("Automation execution was not recorded")

def list_executions(business_id: str, automation_id: str, limit: int = 50) -> list[dict[str, Any]]:
    response = (supabase.table("automation_executions").select(EXECUTION_FIELDS)
        .eq("business_id", business_id).eq("automation_id", automation_id)
        .order("created_at", desc=True).limit(limit).execute())
    return response.data or []
