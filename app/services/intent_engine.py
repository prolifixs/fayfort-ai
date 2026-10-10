from __future__ import annotations

import json
import logging
from typing import Any

import requests

from app.config.settings import settings
from app.schemas.intent import (
    ClassificationStatus,
    IntentName,
    IntentResult,
    NextAction,
)
from app.services.ai_usage import normalize_provider_usage, record_ai_usage, resolved_provider_model
from app.services.ai_budget import (
    AIBudgetError,
    AIBudgetExceeded,
    cost_from_provider_usage,
    reserve_ai_usage_budget,
    settle_ai_usage_budget,
)


logger = logging.getLogger(__name__)
_STATE_CONFIDENCE_THRESHOLD = 0.55

_SYSTEM_PROMPT = f"""
You classify customer messages for FayFort and return one JSON object only.
Detect the language of the latest customer message, not the business knowledge or
older conversation. Return a short BCP-47 language code (for example en, zh,
zh-Hant); use und when the message is too short or ambiguous to identify.
Choose exactly one intent from: {", ".join(item.value for item in IntentName)}.
Choose exactly one action from: {", ".join(item.value for item in NextAction)}.
Use the full conversation, summary, and business knowledge. Keep existing facts
when the customer adds details or corrects them. A new subject may change the
intent while retaining relevant known information. Do not invent facts.
Set confidence from 0 to 1. Use unknown and clarification_needed=true when the
request is unclear. Mark can_handle_automatically=false for human handoff or
requests that require unsupported business judgment. Do not perform actions.
known_information is the current request's known fields. required_information
lists fields needed for this request; missing_information lists required fields
that are still unknown. customer_information may contain only explicitly
provided customer profile facts using these keys: name, company, country,
email, phone. Omit absent facts; never infer them. Use cleared_information or
cleared_customer_information only when the customer explicitly removes a fact.
Set request_relationship to continue when this turn updates the current request,
related when it starts a separate request tied to the same opportunity, new for
an unrelated request, and unclear when the relationship cannot be determined.
Set request_lifecycle_update to cancel only when the customer explicitly
cancels; otherwise use none. Do not claim a request is completed.
Return keys: intent, language, action, confidence, known_information,
required_information, missing_information, customer_information,
cleared_information, cleared_customer_information, request_relationship,
request_lifecycle_update, clarification_needed, can_handle_automatically,
metadata.
The missing_information value must always be a JSON array of strings, such as
["quantity", "target_price"], never an object. Do not include chain-of-thought
or explanatory prose.
""".strip()


def _context_message(
    customer_message: str,
    conversation_history: list[dict[str, Any]] | None,
    conversation_summary: str,
    knowledge_context: str,
) -> str:
    history_lines = []
    for item in conversation_history or []:
        sender = item.get("sender_type", "unknown")
        content = (item.get("content") or "").strip()
        if content:
            history_lines.append(f"{sender}: {content}")

    return "\n\n".join(
        [
            f"CONVERSATION SUMMARY:\n{conversation_summary or '(none)'}",
            "RECENT CONVERSATION:\n" + ("\n".join(history_lines) or "(none)"),
            f"BUSINESS KNOWLEDGE:\n{knowledge_context or '(none)'}",
            f"LATEST CUSTOMER MESSAGE:\n{customer_message}",
        ]
    )


def _parse_model_result(content: Any) -> IntentResult:
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    if not isinstance(content, str):
        raise ValueError("Model response content was not text")

    raw = content.strip()
    if raw.startswith("```"):
        raw = raw.removeprefix("```json").removeprefix("```")
        raw = raw.removesuffix("```").strip()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Model response must be a JSON object")

    # Some model responses encode absent fields as {"field": null}; the
    # contract represents those same missing fields as a list of field names.
    missing = parsed.get("missing_information")
    if isinstance(missing, dict):
        parsed["missing_information"] = list(missing)
    elif isinstance(missing, str):
        parsed["missing_information"] = [missing]

    for field in (
        "required_information",
        "cleared_information",
        "cleared_customer_information",
    ):
        value = parsed.get(field)
        if isinstance(value, str):
            parsed[field] = [value]
        elif isinstance(value, dict):
            parsed[field] = list(value)
        elif value is None:
            parsed[field] = []

    parsed.setdefault("language", "und")
    if not isinstance(parsed["language"], str) or not parsed["language"].strip():
        parsed["language"] = "und"
    else:
        parsed["language"] = parsed["language"].strip().replace("_", "-").lower()
    parsed.setdefault("customer_information", {})
    parsed.setdefault("known_information", {})
    parsed.setdefault("request_relationship", "unclear")
    parsed.setdefault("request_lifecycle_update", "none")
    confidence = parsed.get("confidence", 0)
    parsed["classification_status"] = (
        ClassificationStatus.AMBIGUOUS.value
        if parsed.get("intent") == IntentName.UNKNOWN.value
        or not isinstance(confidence, (int, float))
        or confidence < _STATE_CONFIDENCE_THRESHOLD
        else ClassificationStatus.CLASSIFIED.value
    )

    return IntentResult.model_validate(parsed)


def _fallback(reason: str) -> IntentResult:
    return IntentResult(
        intent=IntentName.UNKNOWN,
        action=NextAction.CLARIFY_INTENT,
        confidence=0.0,
        classification_status=(
            ClassificationStatus.PROVIDER_ERROR
            if reason == "provider_error"
            else ClassificationStatus.INVALID_OUTPUT
        ),
        clarification_needed=True,
        can_handle_automatically=False,
        metadata={"fallback_reason": reason},
    )


def analyze_intent(
    customer_message: str,
    conversation_history: list[dict[str, Any]] | None = None,
    conversation_summary: str = "",
    knowledge_context: str = "",
    business_id: str | None = None,
    conversation_id: str | None = None,
    source_message_id: str | None = None,
) -> IntentResult:
    """Analyze a turn and return a validated, non-executing intent decision."""
    if not customer_message.strip():
        raise ValueError("customer_message cannot be empty")

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _context_message(
                customer_message,
                conversation_history,
                conversation_summary,
                knowledge_context,
            ),
        },
    ]
    reservation = None
    try:
        reservation = reserve_ai_usage_budget(
            business_id=business_id,
            operation="intent",
            messages=messages,
            max_output_tokens=700,
        )
        response = requests.post(
            settings.HF_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {settings.HF_TOKEN}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.HF_MODEL,
                "messages": messages,
                "temperature": 0,
                "max_tokens": 700,
                "stream": False,
                "response_format": {"type": "json_object"},
            },
            timeout=60,
        )
        response.raise_for_status()
        body = response.json()
        usage = normalize_provider_usage(body)
        actual_cost = cost_from_provider_usage(reservation, usage)
        settle_ai_usage_budget(reservation, actual_cost)
        record_ai_usage(
            business_id=business_id, operation="intent", model=resolved_provider_model(body, settings.HF_MODEL),
            request_status="completed", usage=normalize_provider_usage(body),
            conversation_id=conversation_id, source_message_id=source_message_id,
            request_id=reservation.request_id, provider=reservation.provider,
            estimated_cost_micro_usd=reservation.reserved_micro_usd,
            actual_cost_micro_usd=actual_cost,
            budget_reservation_id=reservation.request_id,
        )
        content = body["choices"][0]["message"]["content"]
        return _parse_model_result(content)
    except AIBudgetError as exc:
        reason = "budget_exceeded" if isinstance(exc, AIBudgetExceeded) else "budget_unavailable"
        logger.warning("Intent inference skipped by AI budget control: %s", reason)
        return _fallback(reason)
    except requests.RequestException as exc:
        logger.warning("Intent provider request failed: %s", type(exc).__name__)
        if reservation is not None:
            settle_ai_usage_budget(reservation, None)
        record_ai_usage(
            business_id=business_id, operation="intent", model=settings.HF_MODEL,
            request_status="unknown",
            conversation_id=conversation_id, source_message_id=source_message_id,
            request_id=reservation.request_id if reservation else None,
            provider=reservation.provider if reservation else None,
            estimated_cost_micro_usd=reservation.reserved_micro_usd if reservation else None,
            budget_reservation_id=reservation.request_id if reservation else None,
        )
        return _fallback("provider_error")
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("Intent provider response was invalid: %s", type(exc).__name__)
        return _fallback("invalid_response")
