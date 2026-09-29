from __future__ import annotations

from typing import Any

from app.database.client import supabase


_UPDATE_FIELDS = {
    "request_type",
    "status",
    "details",
    "required_information",
    "missing_information",
    "related_request_id",
}


def get_customer_request(request_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("customer_requests").select("*")
        .eq("id", request_id).limit(1).execute()
    )
    return response.data[0] if response.data else None


def get_current_customer_request(conversation_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("customer_requests").select("*")
        .eq("conversation_id", conversation_id)
        .in_("status", ["active", "awaiting_customer"])
        .order("created_at", desc=True).limit(1).execute()
    )
    return response.data[0] if response.data else None


def list_customer_requests(
    customer_id: str,
) -> list[dict[str, Any]]:
    response = (
        supabase.table("customer_requests").select("*")
        .eq("customer_id", customer_id)
        .order("created_at", desc=False).execute()
    )
    return response.data or []


def create_customer_request(
    customer_id: str,
    conversation_id: str,
    request_type: str,
    details: dict[str, Any] | None = None,
    required_information: list[str] | None = None,
    missing_information: list[str] | None = None,
    related_request_id: str | None = None,
    status: str = "active",
) -> dict[str, Any]:
    payload = {
        "customer_id": customer_id,
        "conversation_id": conversation_id,
        "request_type": request_type,
        "details": details or {},
        "required_information": required_information or [],
        "missing_information": missing_information or [],
        "related_request_id": related_request_id,
        "status": status,
    }
    response = supabase.table("customer_requests").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Customer request was not created")
    return response.data[0]


def update_customer_request(
    request_id: str,
    **updates: Any,
) -> dict[str, Any] | None:
    invalid_fields = set(updates) - _UPDATE_FIELDS
    if invalid_fields:
        raise ValueError(f"Unsupported request fields: {sorted(invalid_fields)}")
    if not updates:
        return get_customer_request(request_id)
    response = (
        supabase.table("customer_requests").update(updates)
        .eq("id", request_id).execute()
    )
    return response.data[0] if response.data else None
