from __future__ import annotations
import logging
import secrets
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any
from app.database.client import supabase

logger = logging.getLogger(__name__)
EVENT_TYPES = {
    "channel.inbound.processed", "connection.created", "connection.status_changed",
    "automation.created", "automation.enabled_changed", "automation.execution_recorded",
    "handoff.requested", "handoff.assigned", "handoff.taken_over", "handoff.returned_to_automation",
    "request.status_changed", "entitlement.granted", "entitlement.revoked",
    "directory.verification_reviewed", "business.settings_updated", "connection.settings_updated",
}
SAFE_PAYLOAD_KEYS = {"channel", "status", "conversation_id", "handoff_id", "connection_id", "automation_id", "execution_id", "provider_event_id", "response_message_id", "agent_id", "request_id", "updated_by", "tool_id", "access_level", "source_type", "verification_status", "reviewed_by", "updated_fields"}

def publish_business_event(business_id: str, event_type: str, entity_type: str, entity_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if event_type not in EVENT_TYPES:
        raise ValueError("Unsupported business event type")
    payload = payload or {}
    if set(payload) - SAFE_PAYLOAD_KEYS or any(not isinstance(v, (str, int, float, bool, type(None))) for v in payload.values()):
        raise ValueError("Event payload contains unsupported or non-scalar data")
    try:
        response = supabase.table("business_events").insert({"business_id":business_id, "event_type":event_type, "entity_type":entity_type, "entity_id":entity_id, "payload":payload}).execute()
        return response.data[0] if response.data else None
    except Exception:
        logger.exception("Could not persist business event %s", event_type)
        return None

def list_business_events(business_id: str, after_id: int = 0, limit: int = 100) -> list[dict[str, Any]]:
    response = (supabase.table("business_events").select("id,event_type,entity_type,entity_id,payload,created_at")
        .eq("business_id", business_id).gt("id", after_id).order("id").limit(min(max(limit, 1), 200)).execute())
    return response.data or []

def issue_event_ticket(business_id: str, user_id: str) -> tuple[str, str]:
    ticket = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(seconds=60)
    supabase.table("dashboard_event_tickets").insert({"business_id":business_id, "user_id":user_id, "ticket_hash":sha256(ticket.encode()).hexdigest(), "expires_at":expires.isoformat()}).execute()
    return ticket, expires.isoformat()

def consume_event_ticket(business_id: str, ticket: str) -> str | None:
    ticket_hash = sha256(ticket.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    response = (supabase.table("dashboard_event_tickets").update({"used_at":now})
        .eq("business_id", business_id).eq("ticket_hash", ticket_hash)
        .is_("used_at", "null").gt("expires_at", now).select("user_id").execute())
    return response.data[0]["user_id"] if response.data else None
