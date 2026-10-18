"""Campaigns (docs/CATALOG_MERCHANDISING_PLAN.md §6): the Store team prepares every giveaway and flash sale before
it starts, giveaways open and close by themselves on their dates, a store product given as a prize is held back from
what members see as available, and a giveaway's results are saved when it wraps up.

Giveaway stages: Plan → Prepare (a "Prepare a campaign" task due a day before the start) → Live (starts_at) →
Draw (the existing "Draw winners" task at ends_at) → Deliver (codes, or "Arrange the prize") → Wrap up (7 days after
the draw, once every prize task is closed: results saved, prize hold released).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.accounts import operations_flow as flow
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

WRAP_UP_AFTER = timedelta(days=7)
KIND_LABEL = {"giveaway": "giveaway", "sale": "flash sale"}


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


def prep_due(starts_at: Any, at: datetime | None = None) -> str:
    """A day before the start; if that has passed, two hours from now (but never after the start)."""
    at = at or now()
    starts = parse(starts_at) or at + timedelta(days=1)
    due = starts - timedelta(days=1)
    if due <= at:
        due = min(at + timedelta(hours=2), starts) if starts > at else at + timedelta(hours=2)
    return due.isoformat()


def ensure_campaign(kind: str, record: dict) -> dict | None:
    """Open the "Prepare a campaign" task for a new giveaway or flash sale (once)."""
    if kind not in KIND_LABEL or not record or not record.get("id"):
        return None
    starts = parse(record.get("starts_at"))
    if starts and starts < now() - timedelta(hours=1):
        return None  # already running: nothing left to prepare
    try:
        db().table("merch_campaign_preps").upsert({"kind": kind, "source_id": str(record["id"])},
                                                  on_conflict="kind,source_id", ignore_duplicates=True).execute()
    except Exception:
        logger.exception("Could not record the campaign preparation")
    prize = record.get("prize_product_id")
    steps = ("the prize, the Giveaway section and the announcement" if kind == "giveaway"
             else "the sale products, the Flash sale section and the announcement")
    return flow.ensure_item(
        source_kind=f"campaign_{kind}", source_id=str(record["id"]), department="store_team",
        work_type="prepare_campaign", summary=f"Prepare the {KIND_LABEL[kind]}: {str(record.get('title') or '')[:180]}",
        next_action=f"Get {steps} ready before it starts.", priority="normal", due_at=prep_due(record.get("starts_at")),
        metadata={"campaign_kind": kind, "campaign_id": str(record["id"]), "title": record.get("title"),
                  "starts_at": record.get("starts_at"), "ends_at": record.get("ends_at"),
                  "prize_product_id": str(prize) if prize else None},
    )


def get_prep(kind: str, source_id: str) -> dict:
    found = one(db().table("merch_campaign_preps").select("*").eq("kind", kind).eq("source_id", str(source_id))
                .limit(1).execute())
    return found or {"kind": kind, "source_id": str(source_id)}


def campaign_context(item: dict) -> dict:
    """What the Prepare task shows: the campaign, its products or prize (with stock) and what's ready."""
    meta = item.get("metadata") or {}
    kind, source_id = meta.get("campaign_kind"), str(meta.get("campaign_id") or meta.get("source_id") or "")
    detail: dict[str, Any] = {"prep": get_prep(kind, source_id)}
    product_ids: list[str] = []
    if kind == "giveaway":
        giveaway = one(db().table("commerce_giveaways").select(
            "id,title,description,prize_text,prize_product_id,starts_at,ends_at,winner_count,status,drawn_at")
            .eq("id", source_id).limit(1).execute())
        detail["campaign"] = giveaway
        if giveaway and giveaway.get("prize_product_id"):
            product_ids = [str(giveaway["prize_product_id"])]
        detail["entries"] = len(rows(db().table("commerce_giveaway_entries").select("member_id")
                                     .eq("giveaway_id", source_id).execute()))
    else:
        sale = one(db().table("commerce_flash_sales").select(
            "id,title,discount_type,value,product_ids,code,starts_at,ends_at,status").eq("id", source_id).limit(1).execute())
        detail["campaign"] = sale
        product_ids = [str(p) for p in (sale or {}).get("product_ids") or []]
    if product_ids:
        detail["products"] = rows(db().table("directory_products").select(
            "id,name,media_url,media_type,in_stock,total_inventory,price_min,currency,active")
            .in_("id", product_ids).execute())
    return detail


def update_prep(item: dict, *, prize_ready: bool | None, section_ready: bool | None, announcement: str | None,
                actor_id: str, actor_type: str) -> dict:
    meta = item.get("metadata") or {}
    kind, source_id = meta.get("campaign_kind"), str(meta.get("campaign_id") or "")
    prep = get_prep(kind, source_id)
    stamp = now().isoformat()
    values: dict[str, Any] = {"updated_at": stamp}
    if prize_ready is not None:
        values["prize_ready_at"] = stamp if prize_ready else None
    if section_ready is not None:
        values["section_ready_at"] = stamp if section_ready else None
    if announcement is not None:
        values["announcement"] = announcement.strip()[:2000] or None
        values["announcement_at"] = stamp if announcement.strip() else None
    merged = {**prep, **values}
    ready = bool(merged.get("prize_ready_at") and merged.get("section_ready_at") and merged.get("announcement"))
    values["ready_at"] = stamp if ready else None
    values["ready_by"] = actor_id if ready else None
    db().table("merch_campaign_preps").upsert({"kind": kind, "source_id": source_id, **values},
                                              on_conflict="kind,source_id").execute()
    flow.add_event(item, "status_changed", "Campaign preparation updated." + (" Everything is ready." if ready else ""),
                   actor_user_id=actor_id, actor_type=actor_type)
    if ready:
        flow.close_item(f"campaign_{kind}", source_id, reason="Ready before it starts.")
    return {**merged, **values, "ready": ready}


# ---------------------------------------------------------------------------------------------
# Prize hold
# ---------------------------------------------------------------------------------------------
def held_units(member_id: str | None = None) -> dict[str, int]:
    """product id -> units held back for giveaway winners (live or drawn, not yet wrapped up). A member who won
    sees no hold for their own giveaway, so they can still check out with their code."""
    try:
        giveaways = rows(db().table("commerce_giveaways").select("id,prize_product_id,winner_count,status,wrapped_up_at")
                         .in_("status", ["open", "drawn"]).limit(200).execute())
    except Exception:
        logger.exception("Could not load giveaway prize holds")
        return {}
    giveaways = [g for g in giveaways if g.get("prize_product_id") and not g.get("wrapped_up_at")]
    if not giveaways:
        return {}
    won: set[str] = set()
    if member_id:
        won = {str(r["giveaway_id"]) for r in rows(db().table("commerce_giveaway_winners").select("giveaway_id")
                                                   .eq("member_id", member_id).execute())}
    held: dict[str, int] = {}
    for giveaway in giveaways:
        if str(giveaway["id"]) in won:
            continue
        key = str(giveaway["prize_product_id"])
        held[key] = held.get(key, 0) + int(giveaway.get("winner_count") or 1)
    return held


# ---------------------------------------------------------------------------------------------
# Background
# ---------------------------------------------------------------------------------------------
def giveaway_results(giveaway: dict) -> dict:
    gid = str(giveaway["id"])
    starts, ends = giveaway.get("starts_at"), giveaway.get("ends_at")
    entries = len(rows(db().table("commerce_giveaway_entries").select("member_id").eq("giveaway_id", gid).execute()))
    winners = rows(db().table("commerce_giveaway_winners").select("member_id,prize_code,prize_error").eq("giveaway_id", gid).execute())
    new_members = len(rows(db().table("member_profiles").select("user_id").gte("created_at", starts)
                           .lt("created_at", ends).limit(10000).execute()))
    orders = rows(db().table("commerce_orders").select("total,currency,cancelled_at").gte("placed_at", starts)
                  .lt("placed_at", ends).limit(10000).execute())
    paid = [o for o in orders if not o.get("cancelled_at")]
    total = round(sum(float(o.get("total") or 0) for o in paid), 2)
    return {"entries": entries, "winners": len(winners), "codes_sent": sum(1 for w in winners if w.get("prize_code")),
            "new_members": new_members, "orders": len(paid), "order_total": total,
            "currency": (paid[0].get("currency") if paid else None), "wrapped_up_at": now().isoformat()}


def sync_campaigns(at: datetime | None = None) -> dict:
    at = at or now()
    opened = wrapped = closed = 0
    for giveaway in rows(db().table("commerce_giveaways").select("id,title,starts_at,ends_at,status,prize_product_id")
                         .eq("status", "open").gt("starts_at", (at - timedelta(hours=1)).isoformat()).limit(100).execute()):
        if not flow.find_item("campaign_giveaway", str(giveaway["id"])) and ensure_campaign("giveaway", giveaway):
            opened += 1
    for sale in rows(db().table("commerce_flash_sales").select("id,title,starts_at,ends_at,status,product_ids")
                     .eq("status", "scheduled").gt("starts_at", (at - timedelta(hours=1)).isoformat()).limit(100).execute()):
        if not flow.find_item("campaign_sale", str(sale["id"])) and ensure_campaign("sale", sale):
            opened += 1
    # A cancelled or failed campaign needs no preparation.
    for kind, table, dead in (("giveaway", "commerce_giveaways", ["cancelled"]), ("sale", "commerce_flash_sales", ["cancelled", "failed"])):
        for item in rows(db().table("operations_work_items").select("*").eq("metadata->>source_kind", f"campaign_{kind}")
                         .in_("status", list(flow.ACTIVE)).execute()):
            record = one(db().table(table).select("id,status").eq("id", str(item["metadata"]["source_id"])).limit(1).execute())
            if not record or record.get("status") in dead:
                flow.close_item(f"campaign_{kind}", str(item["metadata"]["source_id"]), status="cancelled",
                                reason=f"The {KIND_LABEL[kind]} was cancelled.")
                closed += 1
    for giveaway in rows(db().table("commerce_giveaways").select("*").eq("status", "drawn").is_("wrapped_up_at", "null")
                         .limit(100).execute()):
        drawn = parse(giveaway.get("drawn_at"))
        if not drawn or at - drawn < WRAP_UP_AFTER:
            continue
        pending = [i for i in rows(db().table("operations_work_items").select("id,status,metadata").eq("work_type", "giveaway_prize")
                                   .in_("status", list(flow.ACTIVE)).execute())
                   if str((i.get("metadata") or {}).get("giveaway_id")) == str(giveaway["id"])]
        if pending:
            continue
        results = giveaway_results(giveaway)
        db().table("commerce_giveaways").update({"results": results, "wrapped_up_at": results["wrapped_up_at"]}) \
            .eq("id", str(giveaway["id"])).execute()
        wrapped += 1
    return {"opened": opened, "wrapped_up": wrapped, "closed": closed}
