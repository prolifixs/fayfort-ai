from typing import Any

from app.database.client import supabase


def list_businesses() -> list[dict[str, Any]]:
    response = (
        supabase
        .table("businesses")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )

    return response.data or []


def get_business(business_id: str) -> dict[str, Any] | None:
    response = (
        supabase
        .table("businesses")
        .select("*")
        .eq("id", business_id)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


def create_business(
    name: str,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "name": name,
        "settings": settings or {},
    }

    response = (
        supabase
        .table("businesses")
        .insert(payload)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Business was not created")

    return response.data[0]