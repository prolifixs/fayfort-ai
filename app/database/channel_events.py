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
    *, event_id: str, conversation_id: str, response_message_id: str | None,
    approved_reply_automation_id: str | None = None,
    delivery_status: str = "not_required",
    automation_pending: bool = True,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    response = (
        supabase.table("channel_events").update({
            "status": "processed",
            "conversation_id": conversation_id,
            "response_message_id": response_message_id,
            "approved_reply_automation_id": approved_reply_automation_id,
            "automation_status": "pending" if automation_pending else "complete",
            "automation_completed_at": None if automation_pending else now,
            "automation_last_error_code": None,
            "delivery_status": delivery_status,
            "delivery_safe_error_code": None,
            "processed_at": now,
        }).eq("id", event_id).select("id").execute()
    )
    if not response.data:
        raise RuntimeError("Channel event was not marked processed")


def list_pending_inbound_reconciliation(limit: int = 100) -> list[dict[str, Any]]:
    rows = (supabase.table("channel_events")
        .select("id,business_id,channel,provider_event_id,conversation_id,response_message_id,approved_reply_automation_id,automation_status,automation_last_error_code,delivery_status,delivery_safe_error_code")
        .eq("status", "processed")
        .or_("automation_status.eq.pending,delivery_status.eq.pending")
        .order("processed_at").order("id").limit(limit).execute().data or [])
    return rows


def mark_inbound_automation_complete(event_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    response = (supabase.table("channel_events").update({
        "automation_status": "complete",
        "automation_last_error_code": None,
        "automation_completed_at": now,
    }).eq("id", event_id).eq("status", "processed").select("id").execute())
    if not response.data:
        raise RuntimeError("Inbound automation reconciliation was not recorded")


def mark_inbound_automation_retryable(event_id: str) -> None:
    response = (supabase.table("channel_events").update({
        "automation_last_error_code": "automation_reconciliation_failed",
    }).eq("id", event_id).eq("status", "processed").eq("automation_status", "pending").select("id").execute())
    if not response.data:
        current = (supabase.table("channel_events").select("automation_status")
            .eq("id", event_id).limit(1).execute().data or [])
        if current and current[0].get("automation_status") == "complete":
            return
        raise RuntimeError("Inbound automation retry state was not recorded")


def mark_inbound_delivery_outcome(response_message_id: str, status: str, safe_error_code: str | None = None) -> None:
    response = (supabase.table("channel_events").update({
        "delivery_status": status,
        "delivery_safe_error_code": safe_error_code,
    }).eq("response_message_id", response_message_id).eq("delivery_status", "pending").select("id").execute())
    if not response.data:
        current = (supabase.table("channel_events").select("delivery_status")
            .eq("response_message_id", response_message_id).limit(1).execute().data or [])
        if current and current[0].get("delivery_status") == status:
            return
        raise RuntimeError("Inbound provider delivery outcome was not recorded")


def mark_event_delivery_reconciled(event_id: str, status: str, safe_error_code: str | None = None) -> None:
    response = (supabase.table("channel_events").update({
        "delivery_status": status,
        "delivery_safe_error_code": safe_error_code,
    }).eq("id", event_id).eq("delivery_status", "pending").select("id").execute())
    if not response.data:
        current = (supabase.table("channel_events").select("delivery_status")
            .eq("id", event_id).limit(1).execute().data or [])
        if current and current[0].get("delivery_status") == status:
            return
        raise RuntimeError("Reconciled delivery outcome was not recorded")


def mark_inbound_event_failed(*, event_id: str, reason_code: str) -> None:
    response = (
        supabase.table("channel_events").update({
            "status": "failed",
            "reason_code": reason_code,
        }).eq("id", event_id).execute()
    )
    if not response.data:
        raise RuntimeError("Channel event was not marked failed")
