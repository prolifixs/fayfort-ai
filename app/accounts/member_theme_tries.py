"""Theme try-ons (owner rules, 2026-10-19): a try lasts 15 seconds, and every member gets 3 tries an hour.

The server keeps the count, so reloading, another tab or another browser can't reset it, and the full-app preview
design is only handed out while a try is running.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.database.client import supabase

TRY_SECONDS = 15
TRIES_PER_HOUR = 3
WINDOW = timedelta(hours=1)
# A reload near the end of a try still gets the design for the seconds that are left.
GRACE = timedelta(seconds=3)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def recent_tries(member_id: str, now: datetime | None = None) -> list[dict]:
    now = now or _now()
    return (supabase.table("member_theme_tries").select("theme_id,started_at").eq("member_id", member_id)
            .gte("started_at", (now - WINDOW).isoformat()).order("started_at").limit(50).execute().data or [])


def _status(rows: list[dict], now: datetime) -> dict:
    left = max(0, TRIES_PER_HOUR - len(rows))
    oldest = _parse(rows[0]["started_at"]) if rows else now
    return {"limit": TRIES_PER_HOUR, "left": left, "next_at": (oldest + WINDOW).isoformat() if left == 0 else None,
            "seconds": TRY_SECONDS}


def tries_status(member_id: str, now: datetime | None = None) -> dict:
    """{"limit", "left", "next_at", "seconds"}: next_at is when the oldest of the hour's tries frees up, once none are left."""
    now = now or _now()
    return _status(recent_tries(member_id, now), now)


def start_try(member_id: str, theme_id: str, now: datetime | None = None) -> dict:
    """Record a try. Raises PermissionError(next free time) when the hour's tries are used."""
    now = now or _now()
    rows = recent_tries(member_id, now)
    if len(rows) >= TRIES_PER_HOUR:
        raise PermissionError(_status(rows, now)["next_at"] or "")
    supabase.table("member_theme_tries").insert({"member_id": member_id, "theme_id": theme_id, "started_at": now.isoformat()}).execute()
    return {"theme_id": theme_id, "until": (now + timedelta(seconds=TRY_SECONDS)).isoformat(),
            "tries": _status([*rows, {"started_at": now.isoformat()}], now)}


def try_running(member_id: str, theme_id: str, now: datetime | None = None) -> bool:
    now = now or _now()
    rows = (supabase.table("member_theme_tries").select("started_at").eq("member_id", member_id).eq("theme_id", theme_id)
            .gte("started_at", (now - timedelta(seconds=TRY_SECONDS) - GRACE).isoformat()).limit(1).execute().data or [])
    return bool(rows)
