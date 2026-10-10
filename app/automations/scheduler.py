from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.automations.service import run_scheduled_automation
from app.database.automations import (
    advance_scheduled_automation,
    list_due_scheduled_automations,
)
from app.database.events import publish_business_event

logger = logging.getLogger(__name__)
POLL_SECONDS = 15
MAX_RETRY_SECONDS = 900


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def process_due_schedules() -> int:
    now = _utc_now()
    schedules = await asyncio.to_thread(list_due_scheduled_automations, now.isoformat())
    processed = 0
    for automation in schedules:
        scheduled_for = str(automation["schedule_next_run_at"])
        try:
            result = await asyncio.to_thread(run_scheduled_automation, automation)
        except Exception:
            attempts = int(automation.get("schedule_attempts") or 0) + 1
            retry_after = min(15 * (2 ** min(attempts - 1, 6)), MAX_RETRY_SECONDS)
            try:
                await asyncio.to_thread(
                    advance_scheduled_automation,
                    str(automation["id"]),
                    next_run_at=(_utc_now() + timedelta(seconds=retry_after)).isoformat(),
                    attempts=attempts,
                    last_error_code="scheduled_run_failed",
                )
            except Exception:
                logger.exception("Could not save scheduled automation retry state")
            logger.exception(
                "Scheduled test automation failed: automation_id=%s scheduled_for=%s attempts=%s",
                automation.get("id"), scheduled_for, attempts,
            )
            continue

        if result.get("error") == "disabled":
            continue
        if result.get("error"):
            logger.error(
                "Scheduled automation no longer exists: automation_id=%s",
                automation.get("id"),
            )
            continue
        # Advance the schedule only after the idempotent run is recorded. If
        # this cursor write fails, the same key is retried next poll and the
        # execution ledger prevents a duplicate test run.
        try:
            next_run = _utc_now() + timedelta(
                seconds=int(automation["schedule_interval_seconds"])
            )
            updated = await asyncio.to_thread(
                advance_scheduled_automation,
                str(automation["id"]),
                next_run_at=next_run.isoformat(),
                attempts=0,
                last_error_code=None,
            )
        except Exception:
            logger.exception("Could not advance completed automation schedule: automation_id=%s", automation.get("id"))
            continue
        if updated and result.get("execution") and not result.get("duplicate"):
            logger.info(
                "Scheduled automation execution recorded: automation_id=%s execution_id=%s status=%s",
                automation.get("id"), result["execution"].get("id"), result.get("status"),
            )
            try:
                await asyncio.to_thread(
                    publish_business_event,
                    str(automation["business_id"]),
                    "automation.execution_recorded",
                    "automation_execution",
                    str(result["execution"]["id"]),
                    {
                        "automation_id": str(automation["id"]),
                        "execution_id": str(result["execution"]["id"]),
                        "status": str(result["status"]),
                    },
                )
            except Exception:
                logger.exception("Could not publish scheduled automation event")
        processed += 1
    return processed


async def scheduler_loop() -> None:
    while True:
        try:
            await process_due_schedules()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Automation scheduler poll failed")
        await asyncio.sleep(POLL_SECONDS)

