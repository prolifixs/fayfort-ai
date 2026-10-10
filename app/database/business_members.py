from typing import Any
from datetime import datetime, timezone

from app.database.client import supabase


def list_active_business_members(business_id: str) -> list[dict[str, Any]]:
    response = (supabase.table("business_members").select("user_id,role,handoff_availability,handoff_available_until,handoff_max_active,handoff_availability_updated_at")
        .eq("business_id", business_id).eq("status", "active").order("created_at").execute())
    return response.data or []


def update_handoff_availability(
    business_id: str,
    user_id: str,
    availability: str,
    available_until: str | None,
    max_active_handoffs: int,
) -> dict[str, Any] | None:
    response = (supabase.table("business_members").update({
        "handoff_availability": availability,
        "handoff_available_until": available_until,
        "handoff_max_active": max_active_handoffs,
        "handoff_availability_updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("business_id", business_id).eq("user_id", user_id).eq("status", "active")
        .select("user_id,role,handoff_availability,handoff_available_until,handoff_max_active,handoff_availability_updated_at").execute())
    return response.data[0] if response.data else None


def list_business_members(
    business_id: str,
) -> list[dict[str, Any]]:
    response = (
        supabase
        .table("business_members")
        .select("*")
        .eq("business_id", business_id)
        .execute()
    )

    return response.data or []


def get_business_member(
    business_id: str,
    user_id: str,
) -> dict[str, Any] | None:
    response = (
        supabase
        .table("business_members")
        .select("*")
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


def add_business_member(
    business_id: str,
    user_id: str,
    role: str = "member",
) -> dict[str, Any]:
    payload = {
        "business_id": business_id,
        "user_id": user_id,
        "role": role,
    }

    response = (
        supabase
        .table("business_members")
        .insert(payload)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Business member was not created")

    return response.data[0]


def remove_business_member(
    business_id: str,
    user_id: str,
) -> bool:
    response = (
        supabase
        .table("business_members")
        .delete()
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .execute()
    )

    return bool(response.data)
