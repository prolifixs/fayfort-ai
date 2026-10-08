from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.database.client import supabase

DELIVERY_FIELDS = (
    "id,business_id,connection_id,conversation_id,message_id,channel,status,"
    "attempt_count,provider_message_id,safe_error_code,last_attempt_at,delivered_at,created_at,updated_at"
)


def begin_delivery_attempt(
    *, business_id: str, connection_id: str, conversation_id: str,
    message_id: str, channel: str, retry_rejected: bool = False,
) -> tuple[dict[str, Any] | None, bool]:
    """Claim one provider send. Unknown/in-flight/success states never resend."""
    existing = (supabase.table("channel_deliveries").select(DELIVERY_FIELDS)
        .eq("business_id", business_id).eq("message_id", message_id).limit(1).execute()).data
    if existing:
        current = existing[0]
        if current["status"] == "sent" or current["status"] in {"sending", "unknown"}:
            return current, False
        if current["status"] != "rejected" or not retry_rejected:
            return current, False
        attempt_number = int(current.get("attempt_count") or 0) + 1
        claimed = (supabase.table("channel_deliveries").update({
            "status": "sending", "attempt_count": attempt_number,
            "safe_error_code": None,
            "last_attempt_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", current["id"]).eq("status", "rejected")
          .eq("attempt_count", current.get("attempt_count", 0)).select(DELIVERY_FIELDS).execute()).data
        if not claimed:
            return current, False
        delivery = claimed[0]
    else:
        now = datetime.now(timezone.utc).isoformat()
        try:
            created = (supabase.table("channel_deliveries").insert({
                "business_id": business_id, "connection_id": connection_id,
                "conversation_id": conversation_id, "message_id": message_id,
                "channel": channel, "status": "sending", "attempt_count": 1,
                "last_attempt_at": now,
            }).select(DELIVERY_FIELDS).execute()).data
        except Exception:
            # A concurrent request may have won the unique message_id claim.
            existing = (supabase.table("channel_deliveries").select(DELIVERY_FIELDS)
                .eq("business_id", business_id).eq("message_id", message_id).limit(1).execute()).data
            if existing:
                return existing[0], False
            raise
        if not created:
            raise RuntimeError("Outbound delivery record was not created")
        delivery = created[0]
        attempt_number = 1

    try:
        supabase.table("channel_delivery_attempts").insert({
            "delivery_id": delivery["id"], "attempt_number": attempt_number,
            "status": "sending",
        }).execute()
    except Exception:
        finish_delivery_attempt(delivery["id"], attempt_number, "unknown", "attempt_log_unavailable")
        raise
    return delivery, True


def finish_delivery_attempt(
    delivery_id: str, attempt_number: int, status: str,
    safe_error_code: str | None = None, provider_message_id: str | None = None,
) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc).isoformat()
    attempt = (supabase.table("channel_delivery_attempts").update({
        "status": status, "provider_message_id": provider_message_id,
        "safe_error_code": safe_error_code, "completed_at": now,
    }).eq("delivery_id", delivery_id).eq("attempt_number", attempt_number)
      .select("id").execute()).data
    delivery = (supabase.table("channel_deliveries").update({
        "status": status, "provider_message_id": provider_message_id,
        "safe_error_code": safe_error_code,
        "delivered_at": now if status == "sent" else None,
    }).eq("id", delivery_id).select(DELIVERY_FIELDS).execute()).data
    if not attempt or not delivery:
        raise RuntimeError("Outbound delivery result could not be persisted")
    return delivery[0]


def get_delivery_for_message(business_id: str, message_id: str) -> dict[str, Any] | None:
    rows = (supabase.table("channel_deliveries").select(DELIVERY_FIELDS)
        .eq("business_id", business_id).eq("message_id", message_id).limit(1).execute()).data
    return rows[0] if rows else None


def get_delivery(business_id: str, delivery_id: str) -> dict[str, Any] | None:
    rows = (supabase.table("channel_deliveries").select(DELIVERY_FIELDS)
        .eq("business_id", business_id).eq("id", delivery_id).limit(1).execute()).data
    return rows[0] if rows else None


def list_deliveries_for_messages(business_id: str, message_ids: list[str]) -> list[dict[str, Any]]:
    if not message_ids:
        return []
    return (supabase.table("channel_deliveries").select(DELIVERY_FIELDS)
        .eq("business_id", business_id).in_("message_id", message_ids)
        .order("created_at", desc=True).limit(200).execute()).data or []
