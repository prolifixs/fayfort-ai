"""Ad rules (docs/ADS_PLAN.md): free members see ads, paid members don't; staff manage placements and custom ads.

Settings, placements and active custom ads are cached in the process for a minute so pages don't hit the database
for every ad; staff changes clear the cache.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app.commerce.db import db, one, rows
from app.membership import plans

AD_FREE_TIERS = {"standard", "pro"}
CACHE_SECONDS = 60
GOOGLE_CERT_AUTHORITY = "f08c47fec0942fa0"  # Google's TAG ID, the same for every AdSense publisher

_cache: dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def clear_cache() -> None:
    with _lock:
        _cache["at"], _cache["value"] = 0.0, None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def settings_row() -> dict:
    return one(db().table("ad_settings").select("*").eq("id", 1).limit(1).execute()) or {
        "enabled": False, "google_enabled": False, "google_client": None, "google_test_mode": False, "max_per_screen": 3}


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_running(creative: dict, now: datetime | None = None) -> bool:
    now = now or now_utc()
    if creative.get("status") != "active":
        return False
    starts, ends = _parse(creative.get("starts_at")), _parse(creative.get("ends_at"))
    return (starts is None or starts <= now) and (ends is None or ends > now)


def _load() -> dict:
    with _lock:
        if _cache["value"] is not None and time.monotonic() - _cache["at"] < CACHE_SECONDS:
            return _cache["value"]
    value = {
        "settings": settings_row(),
        "placements": rows(db().table("ad_placements").select("*").order("priority").execute()),
        "creatives": rows(db().table("ad_creatives").select("*").eq("status", "active").execute()),
    }
    with _lock:
        _cache["at"], _cache["value"] = time.monotonic(), value
    return value


PUBLIC_CREATIVE_FIELDS = ("id", "advertiser", "headline", "body", "cta_label", "target_url", "image_url", "tone", "weight")


def member_ads(member_id: str, now: datetime | None = None) -> dict:
    """What the member dashboard should show. Paid plans get {"show": false} and never load the Google script."""
    tier = plans.member_tier(member_id)
    if tier in AD_FREE_TIERS:
        return {"show": False, "reason": "paid_plan"}
    data = _load()
    config = data["settings"]
    if not config.get("enabled"):
        return {"show": False, "reason": "ads_off"}
    google_ready = bool(config.get("google_enabled") and config.get("google_client"))
    now = now or now_utc()
    running = [c for c in data["creatives"] if is_running(c, now)]
    placements = []
    for placement in data["placements"]:
        if not placement.get("enabled"):
            continue
        source = placement.get("source") or "google_then_custom"
        google = None
        if source in ("google", "google_then_custom") and google_ready and placement.get("google_slot_id"):
            google = {"slot": placement["google_slot_id"], "format": placement.get("google_format") or "auto",
                      "layout_key": placement.get("google_layout_key")}
        creatives = []
        if source in ("custom", "google_then_custom"):
            creatives = [{field: c.get(field) for field in PUBLIC_CREATIVE_FIELDS}
                         for c in running if placement["key"] in (c.get("placements") or [])]
        if not google and not creatives:
            continue
        placements.append({"key": placement["key"], "shape": placement.get("shape") or "banner",
                           "priority": placement.get("priority") or 50, "google": google, "creatives": creatives})
    if not placements:
        return {"show": False, "reason": "nothing_to_show"}
    return {
        "show": True,
        "max_per_screen": int(config.get("max_per_screen") or 3),
        "google": {"client": config["google_client"], "test": bool(config.get("google_test_mode"))} if google_ready else None,
        "placements": placements,
    }


def record_events(events: list[dict]) -> int:
    if not events:
        return 0
    result = db().rpc("record_ad_events", {"p_events": events}).execute()
    return int(getattr(result, "data", 0) or 0)


def ads_txt() -> str | None:
    client = settings_row().get("google_client")
    if not client:
        return None
    return f"google.com, {client.removeprefix('ca-')}, DIRECT, {GOOGLE_CERT_AUTHORITY}\n"


def stats(days: int = 30, now: datetime | None = None) -> dict:
    since = ((now or now_utc()) - timedelta(days=days)).date().isoformat()
    found = rows(db().table("ad_daily_stats").select("*").gte("day", since).execute())
    by_placement: dict[str, dict] = {}
    by_creative: dict[str, dict] = {}
    for row in found:
        for key, bucket in ((row.get("placement_key"), by_placement), (row.get("creative_id"), by_creative)):
            if not key:
                continue
            entry = bucket.setdefault(str(key), {"impressions": 0, "clicks": 0, "google_impressions": 0, "custom_impressions": 0})
            entry["impressions"] += int(row.get("impressions") or 0)
            entry["clicks"] += int(row.get("clicks") or 0)
            entry[f"{row.get('source')}_impressions"] = entry.get(f"{row.get('source')}_impressions", 0) + int(row.get("impressions") or 0)
    return {"days": days, "placements": by_placement, "creatives": by_creative}
