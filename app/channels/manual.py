from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.database.channel_events import (
    claim_inbound_event,
    mark_inbound_event_failed,
    mark_inbound_event_processed,
)
from app.database.conversations import get_or_create_conversation
from app.directory.identity import has_trusted_business_identity
from app.database.events import publish_business_event
from app.schemas.channel import ManualInboundPayload, normalize_manual_event


logger = logging.getLogger(__name__)


class ManualChannelAuthorizationError(Exception):
    pass


def process_manual_inbound(
    payload: ManualInboundPayload,
    authorization: str | None,
    message_handler: Callable[[str, dict[str, str], str | None], dict[str, Any]],
    *,
    identity_check: Callable[[str | None, str], bool] | None = None,
    conversation_resolver: Callable[..., dict[str, Any]] | None = None,
    event_claimer: Callable[..., tuple[bool, dict[str, Any]]] | None = None,
    event_completer: Callable[..., None] | None = None,
    event_failer: Callable[..., None] | None = None,
    channel_override: str | None = None,
    require_identity: bool = True,
    connection_id: str | None = None,
) -> dict[str, Any]:
    """Normalize an inbound message and pass it through the existing pipeline."""
    event = normalize_manual_event(payload)
    if channel_override:
        event = event.model_copy(update={"provider": channel_override})
    identity_check = identity_check or has_trusted_business_identity
    conversation_resolver = conversation_resolver or get_or_create_conversation
    event_claimer = event_claimer or claim_inbound_event
    event_completer = event_completer or mark_inbound_event_processed
    event_failer = event_failer or mark_inbound_event_failed

    business_id = str(event.business_id)
    if require_identity and not identity_check(authorization, business_id):
        raise ManualChannelAuthorizationError

    conversation_values = {
        "business_id": business_id,
        "customer_external_id": event.customer_external_id,
        "channel": event.provider,
    }
    if connection_id:
        conversation_values["business_connection_id"] = connection_id
    conversation = conversation_resolver(**conversation_values)
    claimed, stored_event = event_claimer(
        business_id=business_id,
        channel=event.provider,
        provider_event_id=event.provider_event_id,
    )
    if not claimed:
        return {
            "status": "duplicate",
            "provider_event_id": event.provider_event_id,
            "event_status": stored_event.get("status"),
            "conversation_id": stored_event.get("conversation_id") or conversation["id"],
        }

    try:
        result = message_handler(
            conversation["id"],
            {"content": event.content},
            authorization,
        )
        if not isinstance(result, dict) or result.get("error"):
            raise RuntimeError("conversation pipeline returned an error")
        ai_message = result.get("ai_message") or {}
        event_completer(
            event_id=stored_event["id"],
            conversation_id=conversation["id"],
            response_message_id=ai_message.get("id"),
        )
        publish_business_event(business_id, "channel.inbound.processed", "conversation", conversation["id"], {"channel":event.provider, "conversation_id":conversation["id"], "provider_event_id":event.provider_event_id, "response_message_id":ai_message.get("id")})
    except Exception:
        try:
            event_failer(event_id=stored_event["id"], reason_code="pipeline_error")
        except Exception:
            logger.exception("Could not mark manual channel event as failed")
        raise

    return {
        "status": "processed",
        "provider_event_id": event.provider_event_id,
        "conversation_id": conversation["id"],
        "response": result.get("response"),
        "ai_message": result.get("ai_message"),
    }
