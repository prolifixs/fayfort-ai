"""Background commerce upkeep on the API host (COMMERCE_SYNC_ENABLED=true): a full catalog reconcile
every COMMERCE_RECONCILE_INTERVAL_SECONDS (webhooks cover the moments in between), and pruning of
intent events older than 90 days."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.commerce import catalog, shopify
from app.commerce.db import db
from app.config.settings import settings

logger = logging.getLogger(__name__)
INTENT_RETENTION_DAYS = 90


def prune_intent_events() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=INTENT_RETENTION_DAYS)).isoformat()
    db().table("commerce_intent_events").delete().lt("created_at", cutoff).execute()


async def commerce_loop() -> None:
    interval = max(int(settings.COMMERCE_RECONCILE_INTERVAL_SECONDS), 900)
    await asyncio.sleep(30)
    while True:
        try:
            if shopify.admin_configured():
                result = await asyncio.to_thread(catalog.reconcile, "reconcile")
                logger.info("Shopify catalog reconciled: %s", result)
            await asyncio.to_thread(prune_intent_events)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Commerce upkeep failed; will retry next interval")
        await asyncio.sleep(interval)
