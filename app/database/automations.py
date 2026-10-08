from __future__ import annotations
from typing import Any
from app.database.client import supabase

AUTOMATION_FIELDS = "id,business_id,name,trigger_type,action_type,conditions,enabled,created_at,updated_at"
EXECUTION_FIELDS = "id,business_id,automation_id,status,idempotency_key,result,error_code,triggered_by,created_at,completed_at"

def list_automations(business_id: str) -> list[dict[str, Any]]:
    response = supabase.table("business_automations").select(AUTOMATION_FIELDS).eq("business_id", business_id).order("created_at", desc=True).execute()
    return response.data or []

def create_automation(business_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    response = supabase.table("business_automations").insert({"business_id": business_id, **payload, "enabled": False}).execute()
    if not response.data:
        raise RuntimeError("Automation was not created")
    return {k:v for k,v in response.data[0].items() if k in AUTOMATION_FIELDS.split(",")}

def get_automation(business_id: str, automation_id: str) -> dict[str, Any] | None:
    response = supabase.table("business_automations").select(AUTOMATION_FIELDS).eq("business_id", business_id).eq("id", automation_id).limit(1).execute()
    return response.data[0] if response.data else None

def set_automation_enabled(business_id: str, automation_id: str, enabled: bool) -> dict[str, Any] | None:
    response = (supabase.table("business_automations").update({"enabled": enabled}).eq("business_id", business_id).eq("id", automation_id).select(AUTOMATION_FIELDS).execute())
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