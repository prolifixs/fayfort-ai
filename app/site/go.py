"""fayfort.com/go: the link-in-bio pages (owner request, 2026-10-20).

GET /public/site/go   everything the /go pages show, read-only and with no member data:
  giveaway     the live giveaway (title, prize, end time, entry count, prize photo) or null
  picks        8 pictured products mixed across categories (name, price or rough price, photo, category)
  categories   Shop by category tiles
  consultation prices by plan
  tour         cities and what a guide can help with
Cached for 5 minutes on the server and in the browser.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.commerce import ranking
from app.commerce import service as commerce
from app.commerce.db import db, rows

logger = logging.getLogger(__name__)

CACHE_SECONDS = 300
_cache: dict[str, tuple[float, dict]] = {}


def _live_giveaway(now: datetime) -> dict | None:
    found = rows(db().table("commerce_giveaways").select("id,title,description,prize_text,prize_product_id,starts_at,ends_at,status")
                 .eq("status", "open").order("ends_at").limit(10).execute())
    live = [g for g in found if ranking.parse_time(g["starts_at"]) <= now < ranking.parse_time(g["ends_at"])]
    if not live:
        return None
    giveaway = live[0]
    image = None
    if giveaway.get("prize_product_id"):
        product = rows(db().table("directory_products").select("media_url,media_type")
                       .eq("id", str(giveaway["prize_product_id"])).limit(1).execute())
        if product and product[0].get("media_type") != "video":
            image = product[0].get("media_url")
    entries = len(rows(db().table("commerce_giveaway_entries").select("giveaway_id").eq("giveaway_id", str(giveaway["id"]))
                       .limit(100000).execute()))
    return {"title": giveaway["title"], "prize_text": giveaway.get("prize_text"), "description": giveaway.get("description") or "",
            "ends_at": giveaway["ends_at"], "entries": entries, "image_url": image}


def _picks(limit: int = 8) -> tuple[list[dict], list[dict], int]:
    products = commerce.load_products()
    cards = [c for c in commerce.cards(products) if commerce.has_picture(c) and c.get("media_type") != "video"]
    created = {str(p["id"]): str(p.get("created_at") or "") for p in products}
    tops = commerce.top_categories()
    groups: dict[str, list[dict]] = {}
    for card in sorted(cards, key=lambda c: created.get(c["id"], ""), reverse=True):
        groups.setdefault(tops.get(str(card.get("category_ref") or ""), ""), []).append(card)
    ordered = sorted(groups.values(), key=lambda items: -len(items))
    picks: list[dict] = []
    round_ = 0
    while len(picks) < limit and any(len(items) > round_ for items in ordered):
        for items in ordered:
            if round_ < len(items) and len(picks) < limit:
                picks.append(items[round_])
        round_ += 1
    public = [{"name": c["name"], "price": c.get("price"), "price_max": c.get("price_max"), "currency": c.get("currency"),
               "price_guide": bool(c.get("price_guide")), "image_url": c["media_url"],
               "category": c.get("category_label") or "", "sourced": c.get("source") != "shopify"} for c in picks]
    return public, commerce.category_tiles(cards, tops, limit=8), len(products)


def go_payload() -> dict[str, Any]:
    hit = _cache.get("go")
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    from app.membership import plans, tours
    now = datetime.now(timezone.utc)
    body: dict[str, Any] = {"giveaway": None, "picks": [], "categories": [], "product_count": 0}
    try:
        body["giveaway"] = _live_giveaway(now)
    except Exception:
        logger.warning("Go page: giveaway could not be loaded", exc_info=True)
    try:
        body["picks"], body["categories"], body["product_count"] = _picks()
    except Exception:
        logger.warning("Go page: products could not be loaded", exc_info=True)
    body["consultation"] = {"currency": plans.CURRENCY, "free": plans.CONSULTATION_PRICE["free"],
                            "standard": plans.CONSULTATION_PRICE["standard"], "pro_included": plans.PRO_INCLUDED_CONSULTATIONS,
                            "pro_after": plans.CONSULTATION_PRICE["pro"], "pro": plans.CONSULTATION_PRICE["pro"]}
    body["tour"] = {"cities": [label for key, label in tours.CITIES.items() if key != "other"], "needs": list(tours.NEEDS.values())}
    _cache["go"] = (time.monotonic(), body)
    return body


def create_go_router() -> APIRouter:
    router = APIRouter(tags=["site"])

    @router.get("/public/site/go")
    def go():
        return JSONResponse(go_payload(), headers={"Cache-Control": "public, max-age=300"})

    return router
