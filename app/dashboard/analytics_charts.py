"""Chart data for Control Center → Analytics: activity, conversations, handoffs and AI use over time.

Everything is bucketed in Python from bounded reads (at most ROW_CAP rows per source), daily for 7 and 30 days and
weekly for 90. Each headline number also has the same-length window just before it, for the change arrows.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

ROW_CAP = 10_000

# Business event types grouped into what staff recognise.
EVENT_GROUPS: list[tuple[str, str, tuple[str, ...]]] = [
    ("messages", "Messages", ("channel.",)),
    ("handoffs", "Handoffs", ("handoff.",)),
    ("automations", "Automations", ("automation.",)),
    ("requests", "Requests", ("request.",)),
    ("setup", "Setup & directory", ("connection.", "directory.", "entitlement.", "business.", "knowledge.", "settings.")),
]

EVENT_LABELS = {
    "channel.inbound.processed": "Messages received",
    "channel.delivery_retried": "Deliveries retried",
    "channel.delivery_reconciled": "Deliveries confirmed",
    "channel.delivery_reconciliation_issue": "Delivery problems",
    "handoff.requested": "Handoffs requested",
    "handoff.assigned": "Handoffs assigned",
    "handoff.taken_over": "Handoffs taken over",
    "handoff.returned_to_automation": "Returned to the AI",
    "handoff.agent_availability_changed": "Availability changes",
    "automation.created": "Automations created",
    "automation.enabled_changed": "Automations switched",
    "automation.execution_recorded": "Automation runs",
    "automation.reconciliation_failed": "Automation failures",
    "automation.reconciliation_recovered": "Automation recoveries",
    "request.status_changed": "Request status changes",
    "request.updated": "Requests corrected",
    "connection.created": "Connections added",
    "connection.status_changed": "Connection status changes",
    "connection.settings_updated": "Connection settings changed",
    "directory.verification_reviewed": "Directory reviews",
    "entitlement.granted": "Access granted",
    "entitlement.revoked": "Access revoked",
}


def event_group(event_type: str) -> str:
    for key, _label, prefixes in EVENT_GROUPS:
        if event_type.startswith(prefixes):
            return key
    return "setup"


def event_label(event_type: str) -> str:
    if event_type in EVENT_LABELS:
        return EVENT_LABELS[event_type]
    return event_type.replace(".", " ").replace("_", " ").capitalize()


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _cost_usd(row: dict[str, Any]) -> float:
    for field in ("actual_cost_micro_usd", "estimated_cost_micro_usd"):
        value = row.get(field)
        if isinstance(value, (int, float)) and value >= 0:
            return float(value) / 1_000_000
    return 0.0


def _tokens(row: dict[str, Any]) -> int:
    value = row.get("total_tokens")
    return value if type(value) is int and value >= 0 else 0


def build_charts(days: int, fetch: Callable[[str, str, str, datetime], list[dict[str, Any]]], now: datetime | None = None) -> dict[str, Any]:
    """fetch(table, columns, time_column, since) returns rows (newest first, capped at ROW_CAP + 1)."""
    now = now or datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    previous_start = start - timedelta(days=days)
    weekly = days > 31
    step = timedelta(days=7 if weekly else 1)

    # Buckets start at midnight UTC; weekly buckets are 7-day steps ending today.
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    count = (days + 6) // 7 if weekly else days
    bucket_starts = [today - step * (count - 1 - index) for index in range(count)]

    def bucket_of(moment: datetime) -> int | None:
        if moment < bucket_starts[0] or moment > now:
            return None
        index = int((moment - bucket_starts[0]) / step)
        return min(index, count - 1)

    truncated = False

    def read(table: str, columns: str, time_column: str, since: datetime) -> list[dict[str, Any]]:
        nonlocal truncated
        rows = fetch(table, columns, time_column, since) or []
        if len(rows) > ROW_CAP:
            truncated = True
            rows = rows[:ROW_CAP]
        return rows

    def split(rows: list[dict[str, Any]], time_column: str) -> tuple[list[tuple[datetime, dict[str, Any]]], int]:
        current: list[tuple[datetime, dict[str, Any]]] = []
        before = 0
        for row in rows:
            moment = _parse(row.get(time_column))
            if moment is None:
                continue
            if moment >= start:
                current.append((moment, row))
            elif moment >= previous_start:
                before += 1
        return current, before

    # Business events -------------------------------------------------------------------------
    events, events_before = split(read("business_events", "event_type,created_at", "created_at", previous_start), "created_at")
    activity = [{key: 0 for key, _label, _prefixes in EVENT_GROUPS} for _ in bucket_starts]
    by_type: Counter[str] = Counter()
    messages_now = 0
    for moment, row in events:
        event_type = str(row.get("event_type") or "unknown")
        by_type[event_type] += 1
        if event_type == "channel.inbound.processed":
            messages_now += 1
        index = bucket_of(moment)
        if index is not None:
            activity[index][event_group(event_type)] += 1

    # Conversations by channel ------------------------------------------------------------------
    conversations, conversations_before = split(
        read("conversations", "channel,created_at", "created_at", previous_start), "created_at")
    channel_totals: Counter[str] = Counter(str(row.get("channel") or "other").lower() for _moment, row in conversations)
    channels = [name for name, _total in channel_totals.most_common(4)]
    conversation_series = [{name: 0 for name in channels + ["other"]} for _ in bucket_starts]
    for moment, row in conversations:
        name = str(row.get("channel") or "other").lower()
        index = bucket_of(moment)
        if index is not None:
            conversation_series[index][name if name in channels else "other"] += 1
    if not any(series["other"] for series in conversation_series):
        for series in conversation_series:
            series.pop("other", None)
        channel_keys = channels
    else:
        channel_keys = channels + ["other"]

    # Handoffs ----------------------------------------------------------------------------------
    handoffs, handoffs_before = split(
        read("conversation_handoffs", "status,requested_at", "requested_at", previous_start), "requested_at")
    handoff_series = [0 for _ in bucket_starts]
    handoff_status: Counter[str] = Counter()
    for moment, row in handoffs:
        handoff_status[str(row.get("status") or "unknown")] += 1
        index = bucket_of(moment)
        if index is not None:
            handoff_series[index] += 1

    # AI use --------------------------------------------------------------------------------------
    ai_rows, ai_before = split(read(
        "ai_usage_events", "operation,total_tokens,estimated_cost_micro_usd,actual_cost_micro_usd,created_at",
        "created_at", previous_start), "created_at")
    ai_series = [{"calls": 0, "tokens": 0, "cost_usd": 0.0} for _ in bucket_starts]
    by_operation: dict[str, dict[str, float]] = {}
    for moment, row in ai_rows:
        operation = str(row.get("operation") or "unknown")
        totals = by_operation.setdefault(operation, {"calls": 0, "tokens": 0, "cost_usd": 0.0})
        totals["calls"] += 1
        totals["tokens"] += _tokens(row)
        totals["cost_usd"] += _cost_usd(row)
        index = bucket_of(moment)
        if index is not None:
            ai_series[index]["calls"] += 1
            ai_series[index]["tokens"] += _tokens(row)
            ai_series[index]["cost_usd"] += _cost_usd(row)

    def change(now_value: int, before_value: int) -> float | None:
        return None if before_value == 0 else (now_value - before_value) / before_value

    labels = [moment.date().isoformat() for moment in bucket_starts]
    return {
        "days": days,
        "bucket": "week" if weekly else "day",
        "start": start.isoformat(),
        "end": now.isoformat(),
        "truncated": truncated,
        "totals": {
            "conversations": {"value": len(conversations), "change": change(len(conversations), conversations_before)},
            "handoffs": {"value": len(handoffs), "change": change(len(handoffs), handoffs_before)},
            "events": {"value": len(events), "change": change(len(events), events_before)},
            "messages": {"value": messages_now},
            "ai_calls": {"value": len(ai_rows), "change": change(len(ai_rows), ai_before)},
            "ai_cost_usd": {"value": round(sum(_cost_usd(row) for _moment, row in ai_rows), 6)},
        },
        "groups": [{"key": key, "label": label} for key, label, _prefixes in EVENT_GROUPS],
        "activity": [{"bucket": label, **values} for label, values in zip(labels, activity)],
        "channels": channel_keys,
        "conversations": [{"bucket": label, **values} for label, values in zip(labels, conversation_series)],
        "handoffs": {
            "series": [{"bucket": label, "requested": value} for label, value in zip(labels, handoff_series)],
            "by_status": dict(handoff_status),
        },
        "ai": {
            "series": [{"bucket": label, "calls": int(v["calls"]), "tokens": int(v["tokens"]), "cost_usd": round(v["cost_usd"], 6)}
                       for label, v in zip(labels, ai_series)],
            "by_operation": sorted(
                ({"operation": name, "calls": int(v["calls"]), "tokens": int(v["tokens"]), "cost_usd": round(v["cost_usd"], 6)}
                 for name, v in by_operation.items()),
                key=lambda item: item["calls"], reverse=True),
        },
        "top_events": [{"event_type": name, "label": event_label(name), "count": total} for name, total in by_type.most_common(8)],
    }
