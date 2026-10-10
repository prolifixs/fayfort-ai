from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from app.database.automations import (
    create_execution,
    get_automation,
    list_enabled_trigger_automations,
)
from app.database.intents import get_active_intent


def run_automation(business_id: str, automation_id: str, *, dry_run: bool, idempotency_key: str, trigger_id: str | None, conversation_id: str | None, triggered_by: str = "dashboard_or_cli") -> dict[str, Any]:
    automation = get_automation(business_id, automation_id)
    if automation is None:
        return {"error": "not_found"}
    if not dry_run and not automation.get("enabled"):
        return {"error": "disabled"}
    if automation.get("action_type") == "send_approved_reply" and not dry_run:
        return {"error": "inbound_only"}
    result = {
        "action_type": automation["action_type"],
        "would_execute": True,
        "side_effect": "none" if dry_run or automation.get("action_type") == "send_approved_reply" else "internal_test_record_only",
        "trigger_type": automation["trigger_type"],
        "trigger_id": trigger_id,
        "conversation_id": conversation_id,
    }
    created, execution = create_execution({
        "business_id": business_id,
        "automation_id": automation_id,
        "status": "dry_run" if dry_run else "succeeded",
        "idempotency_key": idempotency_key,
        "result": result,
        "error_code": None,
        "triggered_by": triggered_by,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": execution.get("status"), "duplicate": not created, "execution": execution, "result": execution.get("result") or result}



def select_approved_reply_automation(
    business_id: str,
    *,
    channel: str,
    intent: str,
    language: str,
) -> dict[str, str] | None:
    """Select the oldest enabled static-reply rule that matches this inbound turn."""
    for automation in list_enabled_trigger_automations(business_id, "conversation_inbound"):
        if automation.get("action_type") != "send_approved_reply":
            continue
        conditions = automation.get("conditions") or {}
        if set(conditions) - {"channel", "intent", "language"}:
            continue
        if conditions.get("channel") and str(conditions["channel"]).casefold() != channel.casefold():
            continue
        if conditions.get("intent") and str(conditions["intent"]).casefold() != intent.casefold():
            continue
        expected_language = str(conditions.get("language") or "").strip().replace("_", "-")
        actual_language = language.strip().replace("_", "-")
        if expected_language and (
            not actual_language
            or actual_language.casefold() == "und"
            or actual_language.casefold() != expected_language.casefold()
        ):
            continue
        config = automation.get("action_config") or {}
        response_text = config.get("response_text")
        if isinstance(response_text, str) and response_text.strip():
            return {
                "automation_id": str(automation["id"]),
                "response_text": response_text.strip(),
            }
    return None

def run_inbound_automations(
    business_id: str,
    *,
    channel: str,
    provider_event_id: str,
    conversation_id: str,
    approved_reply_automation_id: str | None = None,
    response_message_id: str | None = None,
) -> list[dict[str, Any]]:
    """Record enabled inbound-triggered test rules once per provider event.

    This action deliberately has no external side effects. Intent conditions
    reuse the existing Layer 4 classification; unavailable data is skipped.
    """
    outcomes: list[dict[str, Any]] = []
    automations = list_enabled_trigger_automations(business_id, "conversation_inbound")
    active_intent_loaded = False
    active_intent: dict[str, Any] | None = None

    def load_active_intent() -> dict[str, Any] | None:
        nonlocal active_intent_loaded, active_intent
        if not active_intent_loaded:
            try:
                active_intent = get_active_intent(conversation_id)
            except Exception:
                active_intent = None
            active_intent_loaded = True
        return active_intent

    for automation in automations:
        conditions = automation.get("conditions") or {}
        unsupported = set(conditions) - {"channel", "intent", "language"}
        if unsupported:
            outcome = create_execution({
                "business_id": business_id,
                "automation_id": automation["id"],
                "status": "skipped",
                "idempotency_key": f"inbound:{provider_event_id}",
                "result": {"reason": "condition_data_unavailable", "channel": channel},
                "error_code": "condition_data_unavailable",
                "triggered_by": "conversation_inbound",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            outcomes.append({"automation_id": automation["id"], "status": outcome[1].get("status"), "duplicate": not outcome[0]})
            continue
        if conditions.get("channel") and str(conditions["channel"]).strip().casefold() != channel.strip().casefold():
            continue
        if conditions.get("intent"):
            intent_result = load_active_intent()
            actual_intent = str((intent_result or {}).get("intent_key") or "").strip()
            if not actual_intent:
                outcome = create_execution({
                    "business_id": business_id,
                    "automation_id": automation["id"],
                    "status": "skipped",
                    "idempotency_key": f"inbound:{provider_event_id}",
                    "result": {"reason": "condition_data_unavailable", "channel": channel},
                    "error_code": "condition_data_unavailable",
                    "triggered_by": "conversation_inbound",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                })
                outcomes.append({"automation_id": automation["id"], "status": outcome[1].get("status"), "duplicate": not outcome[0]})
                continue
            if actual_intent.casefold() != str(conditions["intent"]).strip().casefold():
                continue
        if conditions.get("language"):
            intent_result = load_active_intent()
            metadata = (intent_result or {}).get("metadata") or {}
            actual_language = str(metadata.get("language") or "").strip().replace("_", "-")
            if not actual_language or actual_language.casefold() == "und":
                outcome = create_execution({
                    "business_id": business_id,
                    "automation_id": automation["id"],
                    "status": "skipped",
                    "idempotency_key": f"inbound:{provider_event_id}",
                    "result": {"reason": "condition_data_unavailable", "channel": channel},
                    "error_code": "condition_data_unavailable",
                    "triggered_by": "conversation_inbound",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                })
                outcomes.append({"automation_id": automation["id"], "status": outcome[1].get("status"), "duplicate": not outcome[0]})
                continue
            expected_language = str(conditions["language"]).strip().replace("_", "-")
            if actual_language.casefold() != expected_language.casefold():
                continue
        if automation.get("action_type") == "send_approved_reply":
            if str(automation["id"]) != str(approved_reply_automation_id or "") or not response_message_id:
                continue
            created, execution = create_execution({
                "business_id": business_id,
                "automation_id": automation["id"],
                "status": "succeeded",
                "idempotency_key": f"inbound:{provider_event_id}",
                "result": {
                    "action_type": "send_approved_reply",
                    "side_effect": "saved_for_opted_in_provider_delivery",
                    "channel": channel,
                    "conversation_id": conversation_id,
                    "response_message_id": response_message_id,
                },
                "error_code": None,
                "triggered_by": "conversation_inbound",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            outcomes.append({
                "automation_id": str(automation["id"]),
                "execution_id": execution.get("id"),
                "status": execution.get("status"),
                "duplicate": not created,
            })
            continue
        outcome = run_automation(
            business_id,
            str(automation["id"]),
            dry_run=False,
            idempotency_key=f"inbound:{provider_event_id}",
            trigger_id=provider_event_id,
            conversation_id=conversation_id,
            triggered_by="conversation_inbound",
        )
        if outcome.get("execution"):
            outcomes.append({
                "automation_id": automation["id"],
                "execution_id": outcome["execution"].get("id"),
                "status": outcome.get("status"),
                "duplicate": outcome.get("duplicate", False),
            })
    return outcomes


def run_scheduled_automation(automation: dict[str, Any]) -> dict[str, Any]:
    scheduled_for = str(automation["schedule_next_run_at"])
    return run_automation(
        str(automation["business_id"]),
        str(automation["id"]),
        dry_run=False,
        idempotency_key=f"schedule:{automation['id']}:{scheduled_for}",
        trigger_id=scheduled_for,
        conversation_id=None,
        triggered_by="scheduled_interval",
    )
