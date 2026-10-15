"""Single access point to the database for the commerce package, so tests can swap it in one place."""
from __future__ import annotations

from typing import Any

client: Any = None


def db() -> Any:
    global client
    if client is None:
        from app.database.client import supabase
        client = supabase
    return client


def rows(response: Any) -> list[dict]:
    data = getattr(response, "data", None) if response is not None else None
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def one(response: Any) -> dict | None:
    found = rows(response)
    return found[0] if found else None


def audit(actor_id: str | None, action: str, detail: dict) -> None:
    import logging
    try:
        db().table("commerce_admin_audit").insert({"actor_id": actor_id, "action": action, "detail": detail}).execute()
    except Exception:
        logging.getLogger(__name__).exception("Could not record commerce audit entry")
