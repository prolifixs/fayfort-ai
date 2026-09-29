from __future__ import annotations

from datetime import datetime, timezone

from app.database.client import supabase


def has_business_entitlement(business_id: str, tool_id: str, access_level: str = "premium") -> bool:
    now = datetime.now(timezone.utc)
    response = (
        supabase.table("business_tool_entitlements")
        .select("starts_at,expires_at")
        .eq("business_id", business_id)
        .eq("tool_id", tool_id)
        .eq("access_level", access_level)
        .eq("status", "active")
        .execute()
    )
    for row in response.data or []:
        starts_at = _parse_datetime(row.get("starts_at"))
        expires_at = _parse_datetime(row.get("expires_at"))
        if starts_at and starts_at <= now and (expires_at is None or expires_at > now):
            return True
    return False


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
