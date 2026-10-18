"""Store sections (docs/CATALOG_MERCHANDISING_PLAN.md §4): themed tiles on member Browse, AliExpress style.

A worker builds a section (title, hook, style, 3 to 12 products, dates). Members see it while it is live and has at
least ``min_items`` live products; otherwise it hides itself and the Store team gets a "Refresh a store section" task.
Three built-in sections fill themselves: the live flash sale, the live giveaway's prize, and new this week.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.accounts import operations_flow as flow
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

MAX_ITEMS = 12
REFRESH_BEFORE = timedelta(days=2)
SECTION_FIELDS = ("title", "hook", "style", "accent", "category_ref", "starts_at", "ends_at", "priority", "min_items", "status")


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class SectionError(ValueError):
    pass


def product_is_live(product: dict | None) -> bool:
    """Shown in a section: active, and a store product must be in stock (sold-out items drop out by themselves)."""
    if not product or not product.get("active"):
        return False
    if product.get("source") == "shopify" and product.get("in_stock") is False:
        return False
    return True


def state_of(section: dict, live_count: int, at: datetime | None = None) -> str:
    at = at or now()
    if section.get("status") == "draft":
        return "draft"
    if section.get("status") == "archived":
        return "archived"
    starts, ends = parse(section.get("starts_at")), parse(section.get("ends_at"))
    if starts and starts > at:
        return "scheduled"
    if ends and ends <= at:
        return "ended"
    if live_count < int(section.get("min_items") or 3):
        return "hidden"
    return "live"


def _items_by_section(section_ids: list[str]) -> dict[str, list[dict]]:
    if not section_ids:
        return {}
    links = rows(db().table("merch_section_items").select("section_id,product_id,position")
                 .in_("section_id", section_ids).order("position").execute())
    grouped: dict[str, list[dict]] = {}
    for link in sorted(links, key=lambda r: (str(r["section_id"]), int(r.get("position") or 0))):
        grouped.setdefault(str(link["section_id"]), []).append(link)
    return grouped


def _products(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    from app.commerce.service import PRODUCT_FIELDS
    return {str(p["id"]): p for p in rows(db().table("directory_products").select(PRODUCT_FIELDS + ",sold_out_since")
                                           .in_("id", list(dict.fromkeys(ids))).execute())}


def suggested_hook(products: list[dict]) -> str:
    """A hook worked out from the products: the biggest discount, else the lowest price."""
    discounts = []
    prices = []
    for product in products:
        price = product.get("price_min")
        compare = product.get("compare_at_max")
        if price is not None:
            prices.append(float(price))
            if compare and float(compare) > float(price):
                discounts.append(round((1 - float(price) / float(compare)) * 100))
    if discounts and max(discounts) >= 10:
        return f"Up to {max(discounts)}% off"
    if prices:
        low = min(prices)
        return f"From ${low:,.2f}".replace(".00", "")
    return "New picks"


def staff_sections(include_archived: bool = False) -> list[dict]:
    query = db().table("merch_sections").select("*")
    if not include_archived:
        query = query.in_("status", ["draft", "published"])
    sections = rows(query.order("priority").order("starts_at", desc=True).limit(200).execute())
    grouped = _items_by_section([str(s["id"]) for s in sections])
    products = _products([str(link["product_id"]) for links in grouped.values() for link in links])
    at = now()
    for section in sections:
        items = []
        for link in grouped.get(str(section["id"]), []):
            product = products.get(str(link["product_id"]))
            if product:
                items.append({"id": str(product["id"]), "name": product.get("name"), "media_url": product.get("media_url"),
                              "media_type": product.get("media_type"), "source": product.get("source"),
                              "price": product.get("price_min"), "currency": product.get("currency"),
                              "live": product_is_live(product)})
        live = sum(1 for item in items if item["live"])
        section["items"] = items
        section["live_count"] = live
        section["state"] = state_of(section, live, at)
        section["suggested_hook"] = suggested_hook([products[i["id"]] for i in items if i["id"] in products])
    return sections


def save_section(values: dict, product_ids: list[str], actor_id: str, section_id: str | None = None) -> dict:
    clean = {k: v for k, v in values.items() if k in SECTION_FIELDS}
    for key in ("starts_at", "ends_at"):
        if isinstance(clean.get(key), datetime):
            moment = clean[key]
            clean[key] = (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).isoformat()
    ids = list(dict.fromkeys(str(i) for i in product_ids))
    if len(ids) > MAX_ITEMS:
        raise SectionError(f"A section holds at most {MAX_ITEMS} products.")
    min_items = int(clean.get("min_items") or 3)
    if clean.get("status", "published") == "published" and len(ids) < min_items:
        raise SectionError(f"Add at least {min_items} products, or lower the minimum.")
    if ids:
        found = _products(ids)
        missing = [i for i in ids if i not in found]
        if missing:
            raise SectionError("One of the products no longer exists.")
        inactive = [found[i].get("name") for i in ids if not found[i].get("active")]
        if inactive:
            raise SectionError(f"Only live products can go in a section ({inactive[0]} isn't live).")
    starts, ends = parse(clean.get("starts_at")), parse(clean.get("ends_at"))
    if starts and ends and ends <= starts:
        raise SectionError("The section must end after it starts.")
    stamp = now().isoformat()
    if section_id:
        current = one(db().table("merch_sections").select("*").eq("id", str(section_id)).limit(1).execute())
        if not current:
            raise LookupError("Section not found.")
        clean.update({"updated_by": actor_id, "updated_at": stamp, "refresh_round": int(current.get("refresh_round") or 0) + 1})
        db().table("merch_sections").update(clean).eq("id", str(section_id)).execute()
        section = {**current, **clean}
        # Saving the section is the refresh: any open "Refresh a store section" task for it is done.
        for item in rows(db().table("operations_work_items").select("*").eq("metadata->>source_kind", "merch_section")
                         .eq("metadata->>section_id", str(section_id)).in_("status", list(flow.ACTIVE)).execute()):
            flow.close_item("merch_section", str(item["metadata"]["source_id"]), reason="The section was updated.")
    else:
        clean.setdefault("starts_at", stamp)
        clean.setdefault("status", "published")
        clean.setdefault("min_items", min_items)
        section = one(db().table("merch_sections").insert({**clean, "created_by": actor_id, "updated_by": actor_id}).execute())
        if not section:
            raise RuntimeError("The section could not be saved.")
    db().table("merch_section_items").delete().eq("section_id", str(section["id"])).execute()
    if ids:
        db().table("merch_section_items").insert([{"section_id": str(section["id"]), "product_id": pid, "position": index}
                                                   for index, pid in enumerate(ids)]).execute()
    _clear()
    return section


def archive_section(section_id: str, actor_id: str) -> None:
    db().table("merch_sections").update({"status": "archived", "updated_by": actor_id, "updated_at": now().isoformat()}) \
        .eq("id", str(section_id)).execute()
    for item in rows(db().table("operations_work_items").select("*").eq("metadata->>source_kind", "merch_section")
                     .eq("metadata->>section_id", str(section_id)).in_("status", list(flow.ACTIVE)).execute()):
        flow.close_item("merch_section", str(item["metadata"]["source_id"]), status="cancelled", reason="The section was archived.")
    _clear()


def _clear() -> None:
    try:
        from app.commerce import service
        service.clear_cache()
    except Exception:
        pass


# ---------------------------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------------------------
def member_sections(cards_for, at: datetime | None = None, *, limit_items: int = 3) -> list[dict]:
    """Live sections in priority order, each with its first ``limit_items`` cards (the tile) and its total.
    ``cards_for`` turns product rows into member cards (prices, sales, badges, saved)."""
    at = at or now()
    sections = rows(db().table("merch_sections").select("*").eq("status", "published").order("priority")
                    .limit(50).execute())
    sections = [s for s in sections if (parse(s.get("starts_at")) or at) <= at and not ((parse(s.get("ends_at")) or at + timedelta(days=1)) <= at)]
    grouped = _items_by_section([str(s["id"]) for s in sections])
    products = _products([str(link["product_id"]) for links in grouped.values() for link in links])
    out = []
    for section in sections:
        live = [products[str(link["product_id"])] for link in grouped.get(str(section["id"]), [])
                if product_is_live(products.get(str(link["product_id"])))]
        if len(live) < int(section.get("min_items") or 3):
            continue
        out.append(_tile(section, cards_for(live), limit_items))
    return out + built_in_sections(cards_for, at, limit_items=limit_items)


def _tile(section: dict, cards: list[dict], limit_items: int) -> dict:
    return {"id": str(section["id"]), "title": section["title"], "hook": section.get("hook") or "",
            "style": section.get("style") or "deal", "accent": section.get("accent") or "pink",
            "ends_at": section.get("ends_at"), "built_in": section.get("built_in"),
            "total": len(cards), "items": cards[:limit_items] if limit_items else cards}


def built_in_sections(cards_for, at: datetime, *, limit_items: int = 3) -> list[dict]:
    from app.commerce import service
    out = []
    products = service.load_products()
    sales = service.active_sales(at)
    on_sale = [p for p in products if str(p["id"]) in sales and product_is_live(p)]
    if on_sale:
        sale = max((sales[str(p["id"])] for p in on_sale), key=lambda s: float(s.get("value") or 0))
        hook = f"Up to {float(sale['value']):g}% off" if sale.get("discount_type") == "percentage" else "Sale prices"
        out.append(_tile({"id": "flash-sale", "title": "Flash sale", "hook": hook, "style": "deal", "accent": "pink",
                          "ends_at": sale.get("ends_at"), "built_in": "flash_sale"}, cards_for(on_sale), limit_items))
    week = at - timedelta(days=7)
    fresh = [p for p in products if (parse(p.get("created_at")) or week) > week and product_is_live(p)]
    fresh.sort(key=lambda p: str(p.get("created_at") or ""), reverse=True)
    if len(fresh) >= 3:
        out.append(_tile({"id": "new-this-week", "title": "New this week", "hook": f"{len(fresh)} new",
                          "style": "trend", "accent": "navy", "built_in": "new_this_week"}, cards_for(fresh), limit_items))
    return out


def member_section(section_id: str, cards_for, at: datetime | None = None) -> dict | None:
    at = at or now()
    for tile in member_sections(cards_for, at, limit_items=0):
        if tile["id"] == str(section_id):
            return tile
    return None


# ---------------------------------------------------------------------------------------------
# Refresh tasks
# ---------------------------------------------------------------------------------------------
def sync_section_refresh(at: datetime | None = None) -> int:
    at = at or now()
    opened = 0
    sections = staff_sections()
    for section in sections:
        if section.get("status") != "published" or section["state"] in ("scheduled", "ended", "draft", "archived"):
            continue
        ends = parse(section.get("ends_at"))
        reason = None
        if section["state"] == "hidden":
            reason = (f"Only {section['live_count']} of its products are live (it needs {section.get('min_items') or 3}), "
                      "so members can't see it.")
        elif ends and ends - at <= REFRESH_BEFORE:
            reason = f"It ends {ends.strftime('%d %b %H:%M')} UTC."
        if not reason:
            continue
        source_id = f"{section['id']}:{section.get('refresh_round') or 0}"
        if flow.find_item("merch_section", source_id):
            continue
        if flow.ensure_item(source_kind="merch_section", source_id=source_id, department="store_team",
                            work_type="refresh_section", summary=f"Refresh the section: {section['title']}"[:240],
                            next_action=f"{reason} Swap products or set new dates, then save the section.",
                            priority="normal" if section["state"] == "live" else "high",
                            due_at=(ends.isoformat() if ends and ends > at else (at + timedelta(days=1)).isoformat()),
                            metadata={"section_id": str(section["id"]), "section_title": section["title"]}):
            opened += 1
    return opened
