"""Append-only workforce audit ledger (public.workforce_audit)."""
from __future__ import annotations

import logging
from typing import Any

from app.database.client import supabase

logger = logging.getLogger(__name__)


def record_workforce_audit(actor_id: str | None, target_id: str | None, action: str,
                           target_email: str | None = None, detail: dict[str, Any] | None = None) -> None:
    """Best-effort: an audit write failure is logged but never undoes the action it describes."""
    try:
        supabase.table("workforce_audit").insert({
            "actor_id": actor_id, "target_id": target_id, "target_email": target_email,
            "action": action, "detail": detail or {},
        }).execute()
    except Exception:
        logger.exception("Could not record workforce audit entry %s", action)
