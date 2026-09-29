from __future__ import annotations

from typing import Any

from app.database.client import supabase


def get_customer_by_identity(
    business_id: str,
    channel: str,
    external_customer_id: str,
) -> dict[str, Any] | None:
    response = (
        supabase.table("customers").select("*")
        .eq("business_id", business_id)
        .eq("channel", channel)
        .eq("external_customer_id", external_customer_id)
        .limit(1).execute()
    )
    return response.data[0] if response.data else None


def get_customer(customer_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("customers").select("*")
        .eq("id", customer_id).limit(1).execute()
    )
    return response.data[0] if response.data else None


def upsert_customer(
    business_id: str,
    channel: str,
    external_customer_id: str,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "business_id": business_id,
        "channel": channel,
        "external_customer_id": external_customer_id,
        "profile": profile or {},
    }
    response = supabase.table("customers").upsert(
        payload,
        on_conflict="business_id,channel,external_customer_id",
    ).execute()
    if not response.data:
        raise RuntimeError("Customer was not created or updated")
    return response.data[0]


def update_customer_profile(
    customer_id: str,
    profile: dict[str, Any],
) -> dict[str, Any] | None:
    response = (
        supabase.table("customers").update({"profile": profile})
        .eq("id", customer_id).execute()
    )
    return response.data[0] if response.data else None
