from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from app.database.automations import create_execution, get_automation


def run_automation(business_id: str, automation_id: str, *, dry_run: bool, idempotency_key: str, trigger_id: str | None, conversation_id: str | None) -> dict[str, Any]:
    automation = get_automation(business_id, automation_id)
    if automation is None:
        return {"error": "not_found"}
    if not dry_run and not automation.get("enabled"):
        return {"error": "disabled"}
    result = {
        "action_type": automation["action_type"],
        "would_execute": True,
        "side_effect": "none" if dry_run else "internal_test_record_only",
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
        "triggered_by": "dashboard_or_cli",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": execution.get("status"), "duplicate": not created, "execution": execution, "result": execution.get("result") or result}
