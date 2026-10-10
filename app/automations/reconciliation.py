from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.automations.service import run_inbound_automations
from app.database.channel_events import (
    list_pending_inbound_reconciliation,
    mark_event_delivery_reconciled,
    mark_inbound_automation_complete,
    mark_inbound_automation_retryable,
)
from app.database.events import publish_business_event
from app.database.outbound_deliveries import get_delivery_for_message

logger = logging.getLogger(__name__)
POLL_SECONDS = 15


def _publish(business_id: str, event_type: str, event_id: str, payload: dict[str, Any], entity_type: str = "channel_event") -> None:
    try:
        publish_business_event(business_id, event_type, entity_type, event_id, payload)
    except Exception:
        logger.exception("Could not publish inbound reconciliation event: type=%s", event_type)


def reconcile_pending_inbound_events(limit: int = 100) -> int:
    """Repair ledgers for already-processed inbound turns without replaying messages or sends."""
    events = list_pending_inbound_reconciliation(limit)
    reconciled = 0
    for event in events:
        event_id = str(event["id"])
        business_id = str(event["business_id"])
        if event.get("automation_status") == "pending":
            try:
                outcomes = run_inbound_automations(
                    business_id,
                    channel=str(event["channel"]),
                    provider_event_id=str(event["provider_event_id"]),
                    conversation_id=str(event["conversation_id"]),
                    approved_reply_automation_id=(
                        str(event["approved_reply_automation_id"])
                        if event.get("approved_reply_automation_id") else None
                    ),
                    response_message_id=(
                        str(event["response_message_id"])
                        if event.get("response_message_id") else None
                    ),
                )
                mark_inbound_automation_complete(event_id)
                if event.get("automation_last_error_code"):
                    _publish(business_id, "automation.reconciliation_recovered", event_id, {
                        "channel_event_id": event_id,
                        "channel": str(event["channel"]),
                    })
                for outcome in outcomes:
                    if outcome.get("execution_id") and not outcome.get("duplicate"):
                        _publish(business_id, "automation.execution_recorded", str(outcome["execution_id"]), {
                            "automation_id": str(outcome["automation_id"]),
                            "execution_id": str(outcome["execution_id"]),
                            "status": str(outcome["status"]),
                        }, "automation_execution")
                reconciled += 1
            except Exception:
                logger.exception("Inbound automation reconciliation failed: channel_event_id=%s", event_id)
                retry_saved = False
                try:
                    mark_inbound_automation_retryable(event_id)
                    retry_saved = True
                except Exception:
                    logger.exception("Could not preserve retry state: channel_event_id=%s", event_id)
                if retry_saved and not event.get("automation_last_error_code"):
                    _publish(business_id, "automation.reconciliation_failed", event_id, {
                        "channel_event_id": event_id,
                        "channel": str(event.get("channel") or "unknown"),
                        "error_code": "automation_reconciliation_failed",
                    })

        if event.get("delivery_status") == "pending":
            response_message_id = event.get("response_message_id")
            try:
                delivery: dict[str, Any] | None = (
                    get_delivery_for_message(business_id, str(response_message_id))
                    if response_message_id else None
                )
                if delivery is None:
                    # The owner can inspect this discrepancy; provider sends are
                    # never retried by this worker because the outcome is unknown.
                    status, code = "unknown", "delivery_record_missing"
                else:
                    status = str(delivery.get("status") or "unknown")
                    code = delivery.get("safe_error_code")
                    if status == "sending":
                        continue
                    if status not in {"sent", "rejected", "unknown", "blocked"}:
                        status, code = "unknown", "delivery_status_invalid"
                mark_event_delivery_reconciled(event_id, status, code)
                if status == "unknown":
                    _publish(business_id, "channel.delivery_reconciliation_issue", event_id, {
                        "channel_event_id": event_id,
                        "channel": str(event.get("channel") or "unknown"),
                        "error_code": str(code or "provider_result_uncertain"),
                    })
                else:
                    _publish(business_id, "channel.delivery_reconciled", event_id, {
                        "channel_event_id": event_id,
                        "channel": str(event.get("channel") or "unknown"),
                        "delivery_status": status,
                    })
                reconciled += 1
            except Exception:
                logger.exception("Inbound delivery reconciliation failed: channel_event_id=%s", event_id)
    return reconciled


async def reconciliation_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(reconcile_pending_inbound_events)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Inbound reconciliation poll failed")
        await asyncio.sleep(POLL_SECONDS)
