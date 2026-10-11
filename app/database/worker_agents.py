from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.database.client import supabase


WORKER_AGENT_FIELDS = (
    "user_id,status,handoff_availability,handoff_available_until,"
    "handoff_max_active,handoff_availability_updated_at"
)


def list_active_fayfort_agents() -> list[dict[str, Any]]:
    response = (
        supabase.table("fayfort_workers")
        .select(WORKER_AGENT_FIELDS)
        .eq("status", "active")
        .order("created_at")
        .execute()
    )
    return response.data or []


def get_fayfort_agent(user_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("fayfort_workers")
        .select(WORKER_AGENT_FIELDS)
        .eq("user_id", user_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def update_fayfort_agent_availability(
    user_id: str,
    availability: str,
    available_until: str | None,
    max_active_handoffs: int,
) -> dict[str, Any] | None:
    response = (
        supabase.table("fayfort_workers")
        .update({
            "handoff_availability": availability,
            "handoff_available_until": available_until,
            "handoff_max_active": max_active_handoffs,
            "handoff_availability_updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("user_id", user_id)
        .eq("status", "active")
        .select(WORKER_AGENT_FIELDS)
        .execute()
    )
    return response.data[0] if response.data else None
