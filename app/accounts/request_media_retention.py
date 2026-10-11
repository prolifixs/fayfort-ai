from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database.client import supabase

logger = logging.getLogger(__name__)
BUCKET = "member-request-evidence"
RETENTION_DAYS = 90
SOURCE_IMAGE_RETENTION_DAYS = 30
SOURCE_IMAGE_BUCKET = "member-request-source-images"
POLL_SECONDS = 24 * 60 * 60


def _remove_storage_object(storage_path: str) -> None:
    supabase.storage.from_(BUCKET).remove([storage_path])


def purge_expired_request_evidence(*, now: datetime | None = None, limit: int = 500) -> dict[str, int]:
    """Remove private evidence after 90 days in a terminal request state.

    Storage objects are removed before their metadata so failures remain retryable.
    Timeline events and requests are retained.
    """
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=RETENTION_DAYS)
    terminal_events = (supabase.table("member_request_events")
        .select("id,request_id")
        .in_("stage", ["delivered", "cancelled"])
        .lt("created_at", cutoff.isoformat())
        .order("created_at")
        .limit(limit)
        .execute().data or [])
    event_ids = [str(row["id"]) for row in terminal_events]
    media_rows = (supabase.table("member_request_media")
        .select("id,storage_path")
        .in_("event_id", event_ids)
        .limit(limit)
        .execute().data or []) if event_ids else []
    deleted = failed = 0
    for row in media_rows:
        try:
            _remove_storage_object(row["storage_path"])
            supabase.table("member_request_media").delete().eq("id", row["id"]).execute()
            deleted += 1
        except Exception:
            failed += 1
            logger.exception("Expired request evidence purge failed: media_id=%s", row.get("id"))

    source_cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=SOURCE_IMAGE_RETENTION_DAYS)
    source_terminal_events = (supabase.table("member_request_events")
        .select("request_id")
        .in_("stage", ["delivered", "cancelled"])
        .lt("created_at", source_cutoff.isoformat())
        .order("created_at")
        .limit(limit)
        .execute().data or [])
    source_request_ids = list({str(row["request_id"]) for row in source_terminal_events})
    source_rows = (supabase.table("member_request_source_media")
        .select("id,storage_path")
        .in_("request_id", source_request_ids)
        .limit(limit)
        .execute().data or []) if source_request_ids else []
    for row in source_rows:
        try:
            supabase.storage.from_(SOURCE_IMAGE_BUCKET).remove([row["storage_path"]])
            supabase.table("member_request_source_media").delete().eq("id", row["id"]).execute()
            deleted += 1
        except Exception:
            failed += 1
            logger.exception("Expired request source screenshot purge failed: media_id=%s", row.get("id"))
    eligible = len(media_rows) + len(source_rows)
    return {"eligible": eligible, "deleted": deleted, "failed": failed}


async def request_media_retention_loop() -> None:
    """Run one retryable retention sweep per day; do not block API startup."""
    while True:
        try:
            result: dict[str, Any] = await asyncio.to_thread(purge_expired_request_evidence)
            if result["eligible"]:
                logger.info("Expired request evidence retention sweep: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Expired request evidence retention sweep failed")
        await asyncio.sleep(POLL_SECONDS)
