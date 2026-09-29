from __future__ import annotations

from typing import Any

from app.database.client import supabase


_ACTION_UPDATE_FIELDS = {
    "intent_id",
    "action_key",
    "status",
    "input",
    "result",
    "requires_confirmation",
    "error",
}


def create_action(
    conversation_id: str,
    action_key: str,
    intent_id: str | None = None,
    status: str = "pending",
    input_data: dict[str, Any] | None = None,
    requires_confirmation: bool = False,
) -> dict[str, Any]:
    payload = {
        "conversation_id": conversation_id,
        "intent_id": intent_id,
        "action_key": action_key,
        "status": status,
        "input": input_data or {},
        "result": {},
        "requires_confirmation": requires_confirmation,
    }
    response = supabase.table("conversation_actions").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Action was not created")
    return response.data[0]


def get_action(action_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("conversation_actions").select("*")
        .eq("id", action_id).limit(1).execute()
    )
    return response.data[0] if response.data else None


def list_conversation_actions(conversation_id: str) -> list[dict[str, Any]]:
    response = (
        supabase.table("conversation_actions").select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=False).execute()
    )
    return response.data or []


def get_pending_action(conversation_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("conversation_actions").select("*")
        .eq("conversation_id", conversation_id).eq("status", "pending")
        .order("created_at", desc=True).limit(1).execute()
    )
    return response.data[0] if response.data else None


def update_action(action_id: str, **updates: Any) -> dict[str, Any] | None:
    invalid_fields = set(updates) - _ACTION_UPDATE_FIELDS
    if invalid_fields:
        raise ValueError(f"Unsupported action fields: {sorted(invalid_fields)}")
    if not updates:
        return get_action(action_id)
    response = (
        supabase.table("conversation_actions").update(updates)
        .eq("id", action_id).execute()
    )
    return response.data[0] if response.data else None


def complete_action(
    action_id: str,
    result: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    return update_action(action_id, status="completed", result=result or {})


def fail_action(action_id: str, error: str) -> dict[str, Any] | None:
    return update_action(action_id, status="failed", error=error)
