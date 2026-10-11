from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.database.client import supabase

logger = logging.getLogger(__name__)
RETENTION_DAYS = 30
SWEEP_INTERVAL_SECONDS = 24 * 60 * 60


def prune_expired_member_conversations(*, now: datetime | None = None) -> int:
    """Delete only inactive ordinary chats; linked/held requests fail closed."""
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        raise ValueError("Retention clock must be timezone-aware")
    cutoff = (reference.astimezone(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    result = supabase.rpc("prune_expired_member_conversations", {"p_before": cutoff}).execute()
    value = result.data if result is not None else 0
    if isinstance(value, list):
        value = value[0] if value else 0
    try:
        return int(value or 0)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Member chat retention RPC returned an invalid deletion count") from exc


async def member_chat_retention_loop() -> None:
    while True:
        try:
            deleted = prune_expired_member_conversations()
            logger.info("Member chat retention sweep completed: deleted=%s", deleted)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Member chat retention sweep failed closed: %s", type(exc).__name__)
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
