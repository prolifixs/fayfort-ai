"""Customer-requested handoffs: when a customer explicitly asks for a person, open a handoff.

The handoff insert trigger then queues the conversation-intake item in Operations Center, so a
worker can claim it and reply. Only an explicit request opens one (intent `human_handoff` or the
action `handoff_to_agent`); a low-confidence answer never does, so the queue is not flooded.
"""
from __future__ import annotations

import logging
from typing import Any

from app.database.client import supabase
from app.database.handoffs import active_handoff_for_conversation, create_handoff
from app.schemas.intent import IntentName, IntentResult, NextAction

logger = logging.getLogger(__name__)

CUSTOMER_REQUESTED_REASON = "customer_requested"
HANDOFF_REQUESTED_REPLY = (
    "Thanks for your patience. I've asked a member of our team to join this conversation, "
    "and they'll reply here as soon as they can."
)


def customer_asked_for_human(intent: IntentResult) -> bool:
    return intent.intent == IntentName.HUMAN_HANDOFF or intent.action == NextAction.HANDOFF_TO_AGENT


def _requester_for(business_id: str) -> str | None:
    """The handoff is recorded on behalf of the business: its first active owner, else admin."""
    response = (
        supabase.table("business_members").select("user_id,role")
        .eq("business_id", business_id).eq("status", "active").in_("role", ["owner", "admin"])
        .order("created_at").execute()
    )
    rows = response.data or []
    rows.sort(key=lambda row: 0 if row.get("role") == "owner" else 1)
    return str(rows[0]["user_id"]) if rows else None


def request_customer_handoff(business_id: str, conversation_id: str) -> dict[str, Any] | None:
    """Opens a handoff for the conversation, or returns the one already open. Never raises."""
    try:
        existing = active_handoff_for_conversation(business_id, conversation_id)
        if existing:
            return existing
        requester = _requester_for(business_id)
        if requester is None:
            logger.warning("Customer asked for a person but business %s has no active owner or admin", business_id)
            return None
        return create_handoff(business_id, conversation_id, requester, CUSTOMER_REQUESTED_REASON)
    except Exception:
        logger.exception("Customer-requested handoff could not be opened for conversation %s", conversation_id)
        return None
