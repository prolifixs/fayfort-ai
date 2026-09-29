from __future__ import annotations

from typing import Any

from app.database.client import supabase


_INTENT_UPDATE_FIELDS = {
    "intent_key",
    "intent_status",
    "goal",
    "entities",
    "required_information",
    "missing_information",
    "confidence",
    "source_message_id",
    "customer_confirmed",
    "confirmation_requested",
    "metadata",
    "customer_id",
    "customer_request_id",
}


def create_intent(
    conversation_id: str,
    intent_key: str,
    goal: str | None = None,
    entities: dict[str, Any] | None = None,
    required_information: list[str] | None = None,
    missing_information: list[str] | None = None,
    confidence: float | None = None,
    source_message_id: str | None = None,
    customer_confirmed: bool = False,
    confirmation_requested: bool = False,
    metadata: dict[str, Any] | None = None,
    customer_id: str | None = None,
    customer_request_id: str | None = None,
) -> dict[str, Any]:
    payload = {
        "conversation_id": conversation_id,
        "intent_key": intent_key,
        "intent_status": "active",
        "goal": goal,
        "entities": entities or {},
        "required_information": required_information or [],
        "missing_information": missing_information or [],
        "confidence": confidence,
        "source_message_id": source_message_id,
        "customer_confirmed": customer_confirmed,
        "confirmation_requested": confirmation_requested,
        "metadata": metadata or {},
        "customer_id": customer_id,
        "customer_request_id": customer_request_id,
    }
    response = supabase.table("conversation_intents").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Intent was not created")
    return response.data[0]


def get_intent(intent_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("conversation_intents").select("*")
        .eq("id", intent_id).limit(1).execute()
    )
    return response.data[0] if response.data else None


def list_conversation_intents(conversation_id: str) -> list[dict[str, Any]]:
    response = (
        supabase.table("conversation_intents").select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=False).execute()
    )
    return response.data or []


def get_active_intent(conversation_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("conversation_intents").select("*")
        .eq("conversation_id", conversation_id)
        .eq("intent_status", "active")
        .order("created_at", desc=True).limit(1).execute()
    )
    return response.data[0] if response.data else None


def update_intent(intent_id: str, **updates: Any) -> dict[str, Any] | None:
    invalid_fields = set(updates) - _INTENT_UPDATE_FIELDS
    if invalid_fields:
        raise ValueError(f"Unsupported intent fields: {sorted(invalid_fields)}")
    if not updates:
        return get_intent(intent_id)
    response = (
        supabase.table("conversation_intents").update(updates)
        .eq("id", intent_id).execute()
    )
    return response.data[0] if response.data else None


def close_intent(intent_id: str) -> dict[str, Any] | None:
    return update_intent(intent_id, intent_status="completed")
