from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

from app.database.client import supabase


PAGE_SIZE = 1000
MAX_ROWS = 20000
TERMINAL_WORK = {"completed", "cancelled"}
TERMINAL_REQUEST = {"delivered", "cancelled"}
TERMINAL_DISPUTE = {"resolved", "closed"}
DEPARTMENTS = ("conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team")


def _all_rows(table: str, fields: str, order_by: str | tuple[str, ...] = "id") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for start in range(0, MAX_ROWS, PAGE_SIZE):
        query = supabase.table(table).select(fields)
        for column in (order_by,) if isinstance(order_by, str) else order_by:
            query = query.order(column)
        page = query.range(start, min(start + PAGE_SIZE - 1, MAX_ROWS - 1)).execute().data or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
    return rows


def _date(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone() if parsed.tzinfo else parsed.astimezone()
    except (TypeError, ValueError):
        return None


def operations_report(days: int) -> dict[str, Any]:
    """Build an admin-only, read-only report and reconciliation snapshot."""
    now = datetime.now().astimezone()
    since = now - timedelta(days=days)
    work = _all_rows(
        "operations_work_items",
        "id,department,status,priority,due_at,assigned_worker_id,assigned_automation_key,member_request_id,dispute_case_id,created_at,completed_at",
    )
    requests = _all_rows("member_purchase_requests", "id,created_at")
    request_events = _all_rows("member_request_events", "request_id,sequence_no,stage,created_at", ("request_id", "sequence_no"))
    cases = _all_rows("operations_dispute_cases", "id,member_request_id,status,created_at,resolved_at")
    candidates = _all_rows("operations_sourcing_candidates", "id,created_at")
    options = _all_rows("operations_sourcing_member_options", "id,status,created_at,selected_at")
    executions = _all_rows("automation_executions", "id,status,created_at")
    automations = _all_rows("business_automations", "id,trigger_type,enabled,schedule_attempts,schedule_last_error_code")

    active_work = [row for row in work if row.get("status") not in TERMINAL_WORK]
    work_by_department: dict[str, Counter[str]] = defaultdict(Counter)
    for row in work:
        work_by_department[str(row.get("department") or "unknown")][str(row.get("status") or "unknown")] += 1

    aging = Counter()
    overdue = 0
    stale_claims = 0
    terminal_request_with_active_work: set[str] = set()
    work_request_ids: set[str] = set()
    dispute_work_ids: set[str] = set()
    work_by_request: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in work:
        request_id = str(row["member_request_id"]) if row.get("member_request_id") else None
        if request_id:
            work_request_ids.add(request_id)
            work_by_request[request_id].append(row)
        if row.get("dispute_case_id"):
            dispute_work_ids.add(str(row["dispute_case_id"]))
        if row.get("status") not in TERMINAL_WORK:
            created = _date(row.get("created_at")) or now
            age_days = max(0, (now - created).total_seconds() / 86400)
            aging["under_1_day" if age_days < 1 else "1_to_7_days" if age_days < 7 else "8_to_30_days" if age_days < 30 else "over_30_days"] += 1
            due = _date(row.get("due_at"))
            if due and due <= now:
                overdue += 1
            claimed_until = _date(row.get("claimed_until"))
            if row.get("status") == "claimed" and claimed_until and claimed_until <= now:
                stale_claims += 1

    latest_request_stage: dict[str, tuple[int, str]] = {}
    for event in request_events:
        request_id = str(event.get("request_id") or "")
        if request_id and (request_id not in latest_request_stage or int(event.get("sequence_no") or 0) > latest_request_stage[request_id][0]):
            latest_request_stage[request_id] = (int(event.get("sequence_no") or 0), str(event.get("stage") or "unknown"))
    request_by_id = {str(row["id"]): row for row in requests if row.get("id")}
    actionable_requests = {
        request_id for request_id in request_by_id
        if latest_request_stage.get(request_id, (0, "submitted"))[1] not in TERMINAL_REQUEST
    }
    missing_request_work = actionable_requests - work_request_ids
    for request_id, (_, stage) in latest_request_stage.items():
        if stage not in TERMINAL_REQUEST:
            continue
        linked = work_by_request.get(request_id, [])
        if linked and any(row.get("status") not in TERMINAL_WORK for row in linked):
            terminal_request_with_active_work.add(request_id)

    active_cases = [row for row in cases if row.get("status") not in TERMINAL_DISPUTE]
    missing_dispute_work = [row for row in active_cases if str(row.get("id")) not in dispute_work_ids]
    stage_counts = Counter(stage for _, stage in latest_request_stage.values())
    recent_executions = [row for row in executions if (_date(row.get("created_at")) or datetime.min.astimezone()) >= since]
    recent_cases = [row for row in cases if (_date(row.get("created_at")) or datetime.min.astimezone()) >= since]
    recent_candidates = [row for row in candidates if (_date(row.get("created_at")) or datetime.min.astimezone()) >= since]
    recent_options = [row for row in options if (_date(row.get("created_at")) or datetime.min.astimezone()) >= since]
    failed_runs = sum(row.get("status") == "failed" for row in recent_executions)
    scheduled = [row for row in automations if row.get("enabled") and row.get("trigger_type") == "scheduled_interval"]
    schedule_issues = [row for row in scheduled if int(row.get("schedule_attempts") or 0) > 0 or row.get("schedule_last_error_code")]

    return {
        "generated_at": now.isoformat(),
        "period_days": days,
        "work": {
            "total": len(work),
            "active": len(active_work),
            "due_overdue": overdue,
            "by_department": {department: dict(work_by_department.get(department, {})) for department in DEPARTMENTS},
            "aging": {key: aging.get(key, 0) for key in ("under_1_day", "1_to_7_days", "8_to_30_days", "over_30_days")},
        },
        "sourcing": {
            "requests_by_latest_stage": dict(sorted(stage_counts.items())),
            "candidates_added": len(recent_candidates),
            "member_options_shared": len(recent_options),
            "member_options_selected": sum(row.get("status") == "selected" and (_date(row.get("selected_at")) or datetime.min.astimezone()) >= since for row in options),
        },
        "disputes": {
            "opened_in_period": len(recent_cases),
            "active": len(active_cases),
            "by_status": dict(Counter(str(row.get("status") or "unknown") for row in cases)),
        },
        "automation": {
            "runs_in_period": len(recent_executions),
            "failed_in_period": failed_runs,
            "enabled_schedules": len(scheduled),
            "schedules_with_issues": len(schedule_issues),
        },
        "reconciliation": {
            "actionable_requests_missing_work": len(missing_request_work),
            "terminal_requests_with_active_work": len(terminal_request_with_active_work),
            "active_disputes_missing_work": len(missing_dispute_work),
            "expired_claims": stale_claims,
            "samples": {
                "actionable_requests_missing_work": sorted(missing_request_work)[:10],
                "terminal_requests_with_active_work": sorted(terminal_request_with_active_work)[:10],
                "active_disputes_missing_work": sorted(str(row.get("id")) for row in missing_dispute_work)[:10],
            },
        },
        "data_limit_reached": any(len(rows) >= MAX_ROWS for rows in (work, requests, request_events, cases, candidates, options, executions, automations)),
    }
