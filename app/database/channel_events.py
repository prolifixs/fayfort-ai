from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.database.client import supabase


def claim_inbound_event(
    *, business_id: str, channel: str, provider_event_id: str
) -> tuple[bool, dict[str, Any]]:
    """Insert one durable idempotency claim; return the existing row on replay."""
    try:
        response = supabase.table("channel_events").insert({
            "business_id": business_id,
            "channel": channel,
            "provider_event_id": provider_event_id,
            "event_type": "inbound_message",
            "status": "processing",
        }).execute()
        if response.data:
            return True, response.data[0]
    except Exception:
        existing = (
            supabase.table("channel_events").select("*")
            .eq("business_id", business_id)
            .eq("channel", channel)
            .eq("provider_event_id", provider_event_id)
            .limit(1).execute()
        )
        if existing.data:
            return False, existing.data[0]
        raise
    raise RuntimeError("Channel event claim was not created")


def mark_inbound_event_processed(
    *, event_id: str, conversation_id: str, response_message_id: str | None
) -> None:
    response = (
        supabase.table("channel_events").update({
            "status": "processed",
            "conversation_id": conversation_id,
            "response_message_id": response_message_id,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", event_id).execute()
    )
    if not response.data:
        raise RuntimeError("Channel event was not marked processed")


def mark_inbound_event_failed(*, event_id: str, reason_code: str) -> None:
    response = (
        supabase.table("channel_events").update({
            "status": "failed",
            "reason_code": reason_code,
        }).eq("id", event_id).execute()
    )
    if not response.data:
        raise RuntimeError("Channel event was not marked failed")