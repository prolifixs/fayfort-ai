"""Database keep-alive: Supabase pauses Free projects after about a week without activity. While real
member traffic is still low, the API touches the database (a read through the REST API, a write to
platform_heartbeats, and an Auth admin call) every DATABASE_KEEPALIVE_INTERVAL_SECONDS."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.config.settings import settings

logger = logging.getLogger(__name__)


def blip() -> dict:
    from app.database.client import supabase
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("directory_categories").select("source_ref").limit(1).execute()
    supabase.table("platform_heartbeats").upsert({"name": "database_keepalive", "last_at": now},
                                                 on_conflict="name").execute()
    try:
        supabase.auth.admin.list_users(page=1, per_page=1)
    except Exception:
        logger.info("Keep-alive Auth call failed; the database read and write still ran", exc_info=True)
    return {"at": now}


async def keepalive_loop() -> None:
    interval = max(int(settings.DATABASE_KEEPALIVE_INTERVAL_SECONDS), 600)
    await asyncio.sleep(15)
    while True:
        try:
            result = await asyncio.to_thread(blip)
            logger.info("Database keep-alive ran at %s", result["at"])
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Database keep-alive failed; will retry")
        await asyncio.sleep(interval)
