from __future__ import annotations

import logging
import uuid
from typing import Any

from app.database.client import supabase

logger = logging.getLogger(__name__)


def _token_count(usage: dict[str, Any], key: str) -> int | None:
    value = usage.get(key)
    return value if type(value) is int and value >= 0 else None


def normalize_provider_usage(data: Any) -> dict[str, int | None]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if not isinstance(usage, dict):
        return {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}
    prompt = _token_count(usage, "prompt_tokens")
    completion = _token_count(usage, "completion_tokens")
    total = _token_count(usage, "total_tokens")
    if total is None and prompt is not None and completion is not None:
        total = prompt + completion
    return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total}


def resolved_provider_model(data: Any, requested_model: str) -> str:
    if isinstance(data, dict):
        actual = data.get("model")
        if isinstance(actual, str) and actual.strip():
            return actual.strip()[:200]
    return requested_model[:200]


def record_ai_usage(
    *,
    business_id: str | None,
    operation: str,
    model: str,
    request_status: str,
    usage: dict[str, int | None] | None = None,
    conversation_id: str | None = None,
    source_message_id: str | None = None,
    request_id: str | None = None,
    provider: str | None = None,
    estimated_cost_micro_usd: int | None = None,
    actual_cost_micro_usd: int | None = None,
    budget_reservation_id: str | None = None,
) -> None:
    """Persist metadata-only provider usage without risking a completed reply."""
    if not business_id:
        return
    measured = usage or {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}
    try:
        supabase.table("ai_usage_events").insert({
            "request_id": request_id or str(uuid.uuid4()),
            "business_id": business_id,
            "operation": operation,
            "model": model,
            "request_status": request_status,
            "conversation_id": conversation_id,
            "source_message_id": source_message_id,
            "provider": provider,
            "estimated_cost_micro_usd": estimated_cost_micro_usd,
            "actual_cost_micro_usd": actual_cost_micro_usd,
            "budget_reservation_id": budget_reservation_id,
            **measured,
        }).execute()
    except Exception as exc:
        # Meter outages must not discard an already generated customer reply.
        # Spend enforcement will use a separate fail-closed reservation path.
        logger.error("AI usage ledger write failed: operation=%s error=%s", operation, type(exc).__name__)
