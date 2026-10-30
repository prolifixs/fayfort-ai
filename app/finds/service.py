"""FayFort Finds (docs/FINDS_PLAN.md): trending products and rare finds, researched by the Store team, checked in China
and released to paid members in weekly drops.

Life of a find:
  scouted         a Store team worker started it (Products → New find): lane, what they saw and where, in their own words
  checked         found in China (in person, with a supplier or online): cost, minimum order, lead time, sample
  not_obtainable  couldn't be got; kept so nobody checks it twice (its listing is cancelled)
  in_review       the listing (photos, title, price breaks) was sent to an administrator
  scheduled       published into a drop; its product stays hidden from the regular catalog
  released        the drop opened (Pro at early_at, Standard at release_at); a week later it joins the catalog for all
  retired         taken down

Who sees what (owner decisions 2026-10-26, inside Standard and Pro, rare finds for every paid member):
  Free      a drop a week late (when it joins the catalog), three featured finds, no research
  Standard  every find on release day with the research card, price breaks, 25 watches with alerts
  Pro       48 hours early, plus landed estimates and margins, unlimited watches and 2 niche research requests a month
A Pro member's first paid month gets Standard access (perks grow with loyalty, docs/MEMBERSHIP_PLAN.md).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from app.commerce.db import db, one, rows
from app.finds import shipping

logger = logging.getLogger(__name__)

CHINA = ZoneInfo("Asia/Shanghai")
RELEASE_WEEKDAY = 0            # Monday
RELEASE_TIME = time(9, 0)      # 09:00 China time
EARLY_HOURS = 48
CATALOG_DAYS = 7
DROP_TARGET = 10
LANES = ("trending", "rare")
STAGES = ("rising", "peaking", "steady")
COMPETITION = ("low", "medium", "high")
CHINA_CHECKS = ("in_person", "supplier", "online")
PLATFORMS = ("tiktok_shop", "tiktok", "instagram", "amazon", "google_trends", "markets", "members", "other")
PLATFORM_LABEL = {"tiktok_shop": "TikTok Shop", "tiktok": "TikTok", "instagram": "Instagram", "amazon": "Amazon",
                  "google_trends": "Google searches", "markets": "the wholesale markets", "members": "FayFort members",
                  "other": "online shops"}
CHECK_LABEL = {"in_person": "Checked in person", "supplier": "Checked with a supplier", "online": "Found online in China"}
STAGE_LABEL = {"rising": "Rising", "peaking": "Peaking", "steady": "Steady seller"}
LIVE = ("scheduled", "released")
OPEN = ("scouted", "checked", "in_review")
FEATURED_FOR_FREE = 3
NICHE_REQUESTS_PER_MONTH = 2
STAFF_FIELDS = ("lane", "stage", "competition", "signal_platforms", "signal_regions", "why", "scout_note", "china_check",
                "china_place", "unit_cost_min", "unit_cost_max", "cost_currency", "supplier_moq", "sample_available",
                "china_note", "sell_price_min", "sell_price_max", "price_breaks", "unit_weight_kg")

ACCESS: dict[str, dict[str, Any]] = {
    "free": {"level": "free", "early": False, "research": False, "breaks": False, "maths": False, "watch_limit": 5,
             "alerts": False, "niche_requests": 0, "archive_weeks": 4},
    "standard": {"level": "standard", "early": False, "research": True, "breaks": True, "maths": False, "watch_limit": 25,
                 "alerts": True, "niche_requests": 0, "archive_weeks": None},
    "pro": {"level": "pro", "early": True, "research": True, "breaks": True, "maths": True, "watch_limit": None,
            "alerts": True, "niche_requests": NICHE_REQUESTS_PER_MONTH, "archive_weeks": None},
}

# How FayFort finds them, shown on the Finds page and fayfort.com/go/finds (owner request: show the effort).
PROCESS = [
    {"title": "We scout every week",
     "body": "Our team goes through TikTok Shop sales data, social feeds, Amazon best-seller moves, what FayFort members "
             "ask for, and walks the wholesale markets in Guangzhou and Yiwu."},
    {"title": "We check it in China",
     "body": "We only keep what we can actually get. We find it in person or with a supplier, confirm the cost, the "
             "minimum order and the lead time, and ask for a sample when it's new to us. Most products don't make it."},
    {"title": "We price it for resellers",
     "body": "You see our price per unit at each quantity and, on Pro, what it costs to land in your country and the "
             "margin at the usual selling price."},
    {"title": "We release it on Monday",
     "body": "Every Monday a new drop goes live, Pro members two days early. Watch what you like and we'll tell you when "
             "the price, the stock or the next drop changes."},
]


class FindError(ValueError):
    """Something the team or the member can fix (shown as is)."""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _money(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(Decimal(str(value)))
    except (InvalidOperation, ValueError):
        raise FindError("Prices and costs must be numbers.") from None
    if number < 0:
        raise FindError("Prices and costs can't be negative.")
    return round(number, 2)


# ---------------------------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------------------------
def get(find_id: str) -> dict:
    found = one(db().table("finds").select("*").eq("id", str(find_id)).limit(1).execute())
    if not found:
        raise LookupError("Find not found.")
    return found


def for_listing(listing_id: str | None) -> dict | None:
    if not listing_id:
        return None
    return one(db().table("finds").select("*").eq("listing_id", str(listing_id)).limit(1).execute())


def for_product(product_id: str | None) -> dict | None:
    if not product_id:
        return None
    return one(db().table("finds").select("*").eq("product_id", str(product_id)).limit(1).execute())


def _save(find: dict, values: dict) -> dict:
    values = {**values, "updated_at": now_utc().isoformat()}
    db().table("finds").update(values).eq("id", str(find["id"])).execute()
    return {**find, **values}


def clean_breaks(value: Any) -> list[dict]:
    """Price per unit by quantity: [{min_qty, price}], up to 6 steps, quantities rising."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise FindError("Price breaks must be a list.")
    out: dict[int, float] = {}
    for step in value[:6]:
        try:
            quantity = int(step["min_qty"])
        except (KeyError, TypeError, ValueError):
            raise FindError("Each price break needs a quantity.") from None
        price = _money(step.get("price"))
        if quantity < 1 or quantity > 1_000_000:
            raise FindError("Price break quantities run from 1 to 1,000,000.")
        if not price or price <= 0:
            raise FindError("Each price break needs a price above zero.")
        out[quantity] = price
    return [{"min_qty": q, "price": out[q]} for q in sorted(out)]


def clean_changes(changes: dict) -> dict:
    values: dict[str, Any] = {}
    for key, value in changes.items():
        if key not in STAFF_FIELDS:
            continue
        if key == "lane":
            if value not in LANES:
                raise FindError("Choose Trending or Rare find.")
        elif key == "stage":
            value = value or None
            if value is not None and value not in STAGES:
                raise FindError("Choose Rising, Peaking or Steady seller.")
        elif key == "competition":
            value = value or None
            if value is not None and value not in COMPETITION:
                raise FindError("Choose low, medium or high competition.")
        elif key == "china_check":
            value = value or None
            if value is not None and value not in CHINA_CHECKS:
                raise FindError("Choose how it was checked in China.")
        elif key == "signal_platforms":
            value = [p for p in dict.fromkeys(value or []) if p in PLATFORMS][:10]
        elif key == "signal_regions":
            value = [str(r).strip()[:40] for r in dict.fromkeys(value or []) if str(r).strip()][:10]
        elif key in ("why", "scout_note", "china_note", "china_place"):
            limit = {"why": 600, "china_place": 120}.get(key, 2000)
            value = (str(value or "").strip()[:limit]) or None
        elif key in ("unit_cost_min", "unit_cost_max", "sell_price_min", "sell_price_max"):
            value = _money(value)
            if key.startswith("sell") and value is not None and value <= 0:
                value = None
        elif key == "cost_currency":
            value = str(value or "CNY").strip().upper()
            if len(value) != 3 or not value.isalpha():
                raise FindError("Use a 3-letter currency such as CNY or USD.")
        elif key == "supplier_moq":
            value = int(value) if value not in (None, "") else None
            if value is not None and not 1 <= value <= 1_000_000:
                raise FindError("The minimum order runs from 1 to 1,000,000.")
        elif key == "sample_available":
            value = None if value is None else bool(value)
        elif key == "price_breaks":
            value = clean_breaks(value)
        elif key == "unit_weight_kg":
            value = float(value) if value not in (None, "") else None
            if value is not None and not 0 < value <= 10_000:
                raise FindError("Enter the weight of one unit in kilos (for example 0.35).")
        values[key] = value
    for low, high in (("unit_cost_min", "unit_cost_max"), ("sell_price_min", "sell_price_max")):
        if values.get(low) is not None and values.get(high) is not None and values[high] < values[low]:
            raise FindError("The higher figure must be at least the lower one.")
    return values


def research_missing(find: dict) -> list[str]:
    """What the research still needs before the listing can go to review."""
    missing = []
    if not find.get("signal_platforms"):
        missing.append("where it's moving (platforms)")
    if not str(find.get("why") or "").strip():
        missing.append("why it's a find (for members)")
    if find.get("lane") == "trending" and not find.get("stage"):
        missing.append("its trend stage")
    if find.get("lane") == "rare" and not find.get("competition"):
        missing.append("how much competition there is")
    if find.get("status") == "scouted" or not find.get("china_check"):
        missing.append("the China check")
    if not find.get("price_breaks"):
        missing.append("at least one price break")
    if not find.get("unit_weight_kg"):
        missing.append("the weight of one unit")
    return missing


# ---------------------------------------------------------------------------------------------
# Team actions
# ---------------------------------------------------------------------------------------------
def open_find(lane: str, actor_id: str, actor_role: str) -> tuple[dict, dict, dict | None]:
    """Products → New find: a sourcing listing (photos, title, category) plus the research record."""
    if lane not in LANES:
        raise FindError("Choose Trending or Rare find.")
    from app.commerce import store_team
    listing, item = store_team.open_listing(
        kind="sourcing_item", actor_id=actor_id, actor_role=actor_role,
        note="A FayFort Find: add what you saw (Finds tab), check it in China, add photos and price breaks, then send it "
             "for review.")
    find = one(db().table("finds").insert({
        "listing_id": str(listing["id"]), "lane": lane, "scouted_by": actor_id, "status": "scouted",
        "scouted_at": now_utc().isoformat(), "signal_platforms": [], "signal_regions": [], "price_breaks": [],
        "last_alert": {}, "cost_currency": "CNY"}).execute())
    if not find:
        raise RuntimeError("The find could not be saved.")
    if item:
        try:
            db().table("operations_work_items").update({
                "work_type": "list_find", "summary": f"Find ({lane}): untitled"[:240],
                "metadata": {**(item.get("metadata") or {}), "find_id": str(find["id"]), "find_lane": lane},
            }).eq("id", item["id"]).execute()
        except Exception:
            logger.exception("Could not label the find's work item")
    return find, listing, item


def update(find: dict, changes: dict, actor_id: str) -> dict:
    if find["status"] in ("not_obtainable", "retired"):
        raise FindError("This find is closed.")
    values = clean_changes(changes)
    if not values:
        return find
    before = dict(find)
    find = _save(find, values)
    if find["status"] in LIVE and "price_breaks" in values:
        _alert_price(before, find)
    return find


def mark_checked(find: dict, actor_id: str) -> dict:
    if find["status"] not in ("scouted", "checked"):
        raise FindError("This find was already checked.")
    missing = []
    if not find.get("china_check"):
        missing.append("how it was checked")
    if find.get("unit_cost_min") is None:
        missing.append("the unit cost")
    if not find.get("supplier_moq"):
        missing.append("the supplier's minimum order")
    if missing:
        raise FindError("Add " + ", ".join(missing) + " first.")
    return _save(find, {"status": "checked", "checked_by": actor_id, "checked_at": now_utc().isoformat()})


def mark_not_obtainable(find: dict, actor_id: str, reason: str) -> dict:
    if find["status"] not in OPEN:
        raise FindError("Only a find still being prepared can be closed this way.")
    note = (reason or "").strip()
    find = _save(find, {"status": "not_obtainable", "checked_by": actor_id, "checked_at": now_utc().isoformat(),
                        "china_note": ((find.get("china_note") or "") + f"\nNot obtainable: {note}").strip()[:2000]})
    from app.commerce import store_team
    try:
        listing = store_team.get_listing(str(find["listing_id"]))
        if listing["status"] in store_team.OPEN:
            store_team.cancel(listing, actor_id, f"Not obtainable in China: {note}" if note else "Not obtainable in China.")
    except LookupError:
        pass
    return find


# ---- hooks from the Store team listing flow (app/commerce/store_team.py) ---------------------
def listing_missing(listing: dict) -> list[str]:
    find = for_listing(str(listing.get("id") or ""))
    if not find or find["status"] in LIVE:
        return []
    return research_missing(find)


def on_submit(listing: dict) -> None:
    find = for_listing(str(listing["id"]))
    if find and find["status"] in ("checked", "scouted"):
        _save(find, {"status": "in_review"})


def on_send_back(listing: dict) -> None:
    find = for_listing(str(listing["id"]))
    if find and find["status"] == "in_review":
        _save(find, {"status": "checked"})


def on_cancel(listing: dict) -> None:
    find = for_listing(str(listing["id"]))
    if find and find["status"] in ("scouted", "checked", "in_review"):
        _save(find, {"status": "retired"})


def publish_active(listing: dict) -> bool | None:
    """Whether the published product shows in the regular catalog. None: not a find (the usual True)."""
    find = for_listing(str(listing["id"])) if listing.get("id") else None
    if not find and listing.get("product_id"):
        find = for_product(str(listing["product_id"]))
    if not find:
        return None
    drop = _drop(find.get("drop_id"))
    return bool(find["status"] == "released" and drop and parse(drop["catalog_at"]) <= now_utc())


def on_publish(listing: dict, product_id: str, admin_id: str) -> dict | None:
    find = for_listing(str(listing["id"])) or for_product(product_id)
    if not find:
        return None
    values: dict[str, Any] = {"product_id": str(product_id)}
    if find["status"] not in LIVE:
        values.update({"approved_by": admin_id, "approved_at": now_utc().isoformat(), "status": "scheduled"})
        if not find.get("drop_id"):
            values["drop_id"] = place_in_drop()["id"]
    return _save(find, values)


# ---------------------------------------------------------------------------------------------
# Drops
# ---------------------------------------------------------------------------------------------
def next_release(after: datetime) -> datetime:
    """The first Monday 09:00 China time after `after`."""
    local = after.astimezone(CHINA)
    day = local.date()
    while True:
        candidate = datetime.combine(day, RELEASE_TIME, CHINA)
        if day.weekday() == RELEASE_WEEKDAY and candidate > local:
            return candidate.astimezone(timezone.utc)
        day += timedelta(days=1)


def drop_title(release_at: datetime) -> str:
    local = release_at.astimezone(CHINA)
    return f"Finds of {local.day} {local.strftime('%b %Y')}"


def ensure_drop(release_at: datetime, actor_id: str | None = None, target: int = DROP_TARGET) -> dict:
    found = one(db().table("find_drops").select("*").eq("release_at", release_at.isoformat()).limit(1).execute())
    if found:
        return found
    values = {"title": drop_title(release_at), "early_at": (release_at - timedelta(hours=EARLY_HOURS)).isoformat(),
              "release_at": release_at.isoformat(), "catalog_at": (release_at + timedelta(days=CATALOG_DAYS)).isoformat(),
              "target_count": target, "created_by": actor_id, "notified": {}}
    try:
        created = one(db().table("find_drops").insert(values).execute())
    except Exception:
        created = one(db().table("find_drops").select("*").eq("release_at", release_at.isoformat()).limit(1).execute())
    if not created:
        raise RuntimeError("The drop could not be saved.")
    return created


def _drop(drop_id: Any) -> dict | None:
    if not drop_id:
        return None
    return one(db().table("find_drops").select("*").eq("id", str(drop_id)).limit(1).execute())


def drop_counts(drop_ids: Iterable[str]) -> dict[str, int]:
    ids = [str(i) for i in drop_ids]
    if not ids:
        return {}
    counts: dict[str, int] = {}
    for row in rows(db().table("finds").select("drop_id,status").in_("drop_id", ids).limit(5000).execute()):
        if row.get("status") in LIVE:
            counts[str(row["drop_id"])] = counts.get(str(row["drop_id"]), 0) + 1
    return counts


def place_in_drop(now: datetime | None = None) -> dict:
    """The next drop that still has room and doesn't open (for Pro) within 12 hours; a new week when all are full."""
    now = now or now_utc()
    upcoming = rows(db().table("find_drops").select("*").gt("early_at", (now + timedelta(hours=12)).isoformat())
                    .order("release_at").limit(8).execute())
    counts = drop_counts(d["id"] for d in upcoming)
    for drop in upcoming:
        if counts.get(str(drop["id"]), 0) < int(drop.get("target_count") or DROP_TARGET):
            return drop
    after = parse(upcoming[-1]["release_at"]) if upcoming else now + timedelta(hours=EARLY_HOURS + 12)
    return ensure_drop(next_release(after))


def move_to_drop(find: dict, drop_id: str) -> dict:
    drop = _drop(drop_id)
    if not drop:
        raise LookupError("Drop not found.")
    if find["status"] != "scheduled":
        raise FindError("Only a find waiting for its drop can be moved.")
    if parse(drop["early_at"]) <= now_utc():
        raise FindError("That drop is already open. Choose a later one.")
    return _save(find, {"drop_id": str(drop["id"])})


def drop_stats(drop: dict) -> dict[str, int]:
    """The effort behind a drop: products scouted in its week, checked in China, and the ones that made it."""
    release = parse(drop["release_at"])
    start = (release - timedelta(days=7)).isoformat()
    found = rows(db().table("finds").select("status,china_check,drop_id,scouted_at")
                 .gt("scouted_at", start).lte("scouted_at", release.isoformat()).limit(5000).execute())
    in_drop = rows(db().table("finds").select("id,status").eq("drop_id", str(drop["id"])).limit(500).execute())
    made_it = sum(1 for f in in_drop if f.get("status") in LIVE)
    scouted = max(len(found), made_it)
    checked = max(sum(1 for f in found if f.get("china_check") or f.get("status") == "not_obtainable"), made_it)
    return {"scouted": scouted, "checked": checked, "made_it": made_it}


def drop_view(drop: dict, count: int | None = None) -> dict:
    view = {k: drop.get(k) for k in ("id", "title", "early_at", "release_at", "catalog_at", "target_count", "note")}
    now = now_utc()
    view["state"] = ("catalog" if parse(drop["catalog_at"]) <= now else "released" if parse(drop["release_at"]) <= now
                     else "early" if parse(drop["early_at"]) <= now else "planned")
    if count is not None:
        view["count"] = count
    return view


def staff_drops(limit: int = 12) -> list[dict]:
    since = (now_utc() - timedelta(days=21)).isoformat()
    found = rows(db().table("find_drops").select("*").gte("release_at", since).order("release_at").limit(limit).execute())
    counts = drop_counts(d["id"] for d in found)
    return [drop_view(d, counts.get(str(d["id"]), 0)) for d in found]


def create_drop(release_day: date, actor_id: str, target: int = DROP_TARGET) -> dict:
    release_at = datetime.combine(release_day, RELEASE_TIME, CHINA).astimezone(timezone.utc)
    if release_at - timedelta(hours=EARLY_HOURS) <= now_utc():
        raise FindError("Choose a release day at least two days ahead (Pro sees it 48 hours early).")
    drop = ensure_drop(release_at, actor_id, target)
    return drop_view(drop, drop_counts([drop["id"]]).get(str(drop["id"]), 0))


# ---------------------------------------------------------------------------------------------
# Staff views
# ---------------------------------------------------------------------------------------------
def staff_view(find: dict, listing: dict | None = None, product: dict | None = None, drop: dict | None = None) -> dict:
    view = dict(find)
    view["missing"] = research_missing(find) if find["status"] in OPEN else []
    if listing:
        media = listing.get("media") or []
        view["listing"] = {"id": listing["id"], "title": listing.get("title"), "status": listing.get("status"),
                           "cover": media[0] if media else None, "missing": None}
    if product:
        view["product"] = {"id": product["id"], "name": product.get("name"), "media_url": product.get("media_url"),
                           "active": product.get("active")}
    if drop:
        view["drop"] = drop_view(drop)
    return view


def staff_list(status: str = "open") -> list[dict]:
    query = db().table("finds").select("*")
    if status == "open":
        query = query.in_("status", list(OPEN))
    elif status == "live":
        query = query.in_("status", list(LIVE))
    elif status != "all":
        query = query.eq("status", status)
    found = rows(query.order("updated_at", desc=True).limit(300).execute())
    listing_ids = [str(f["listing_id"]) for f in found if f.get("listing_id")]
    product_ids = [str(f["product_id"]) for f in found if f.get("product_id")]
    drop_ids = list({str(f["drop_id"]) for f in found if f.get("drop_id")})
    listings = {str(l["id"]): l for l in rows(db().table("store_listings").select("id,title,status,media")
                                              .in_("id", listing_ids).execute())} if listing_ids else {}
    products = {str(p["id"]): p for p in rows(db().table("directory_products").select("id,name,media_url,active")
                                              .in_("id", product_ids).execute())} if product_ids else {}
    drops = {str(d["id"]): d for d in rows(db().table("find_drops").select("*").in_("id", drop_ids).execute())} if drop_ids else {}
    return [staff_view(f, listings.get(str(f.get("listing_id"))), products.get(str(f.get("product_id"))),
                       drops.get(str(f.get("drop_id")))) for f in found]


def staff_detail(find: dict) -> dict:
    listing = one(db().table("store_listings").select("id,title,status,media").eq("id", str(find["listing_id"]))
                  .limit(1).execute()) if find.get("listing_id") else None
    product = one(db().table("directory_products").select("id,name,media_url,active").eq("id", str(find["product_id"]))
                  .limit(1).execute()) if find.get("product_id") else None
    return staff_view(find, listing, product, _drop(find.get("drop_id")))


def shipping_rates() -> list[dict]:
    return rows(db().table("find_shipping_rates").select("zone,label,air_per_kg,handling_per_unit,updated_at")
                .order("zone").execute())


def save_shipping_rates(rates: list[dict], admin_id: str) -> list[dict]:
    known = {r["zone"] for r in shipping_rates()}
    for rate in rates:
        if rate.get("zone") not in known:
            raise FindError("Unknown shipping zone.")
        air = _money(rate.get("air_per_kg"))
        handling = _money(rate.get("handling_per_unit")) or 0
        db().table("find_shipping_rates").update({"air_per_kg": air, "handling_per_unit": handling, "updated_by": admin_id,
                                                  "updated_at": now_utc().isoformat()}).eq("zone", rate["zone"]).execute()
    return shipping_rates()


# ---------------------------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------------------------
def access_for(member_id: str) -> dict:
    from app.membership import plans
    tier = plans.member_tier(member_id)
    if tier == "pro" and plans.in_first_month(member_id):
        tier = "standard"
    return dict(ACCESS.get(tier, ACCESS["free"]))


def opens_at(drop: dict, access: dict) -> datetime:
    key = "early_at" if access["early"] else "release_at" if access["research"] else "catalog_at"
    return parse(drop[key])


def _visible_drops(access: dict, now: datetime) -> list[dict]:
    key = "early_at" if access["early"] else "release_at" if access["research"] else "catalog_at"
    found = rows(db().table("find_drops").select("*").lte(key, now.isoformat()).order("release_at", desc=True)
                 .limit(60).execute())
    if access.get("archive_weeks"):
        oldest = now - timedelta(weeks=int(access["archive_weeks"]) + 1)
        found = [d for d in found if parse(d["release_at"]) >= oldest]
    return found


def _upcoming_drop(now: datetime) -> dict | None:
    return one(db().table("find_drops").select("*").gt("release_at", now.isoformat()).order("release_at").limit(1).execute())


def _products(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    fields = "id,name,description,category_ref,price_min,price_max,currency,min_order,lead_time_min_days,lead_time_max_days,media_url,media_type,availability_status,active"
    return {str(p["id"]): p for p in rows(db().table("directory_products").select(fields).in_("id", ids).execute())}


def _watching(member_id: str) -> set[str]:
    return {str(w["find_id"]) for w in rows(db().table("member_find_watches").select("find_id").eq("member_id", member_id)
                                            .limit(2000).execute())}


def _rate(country: str | None) -> tuple[str | None, dict | None]:
    zone = shipping.zone_for(country)
    if not zone:
        return None, None
    return zone, one(db().table("find_shipping_rates").select("*").eq("zone", zone).limit(1).execute())


def card(find: dict, product: dict, access: dict, *, drop: dict | None, watching: bool, locked: bool,
         media: list[dict] | None = None, rate: dict | None = None, detail: bool = False) -> dict:
    """What a member sees of a find. Research and pricing follow the plan; a locked card shows only the teaser."""
    view: dict[str, Any] = {
        "id": find["id"], "product_id": product["id"], "lane": find["lane"], "name": product.get("name"),
        "media_url": product.get("media_url"), "media_type": product.get("media_type"),
        "stage": STAGE_LABEL.get(find.get("stage") or "") if find["lane"] == "trending" else None,
        "competition": find.get("competition") if find["lane"] == "rare" else None,
        "released_at": find.get("released_at"), "drop_id": find.get("drop_id"), "watching": watching, "locked": locked,
    }
    if locked:
        return view
    view.update({
        "category_ref": product.get("category_ref"), "currency": product.get("currency") or "USD",
        "price_from": float(product["price_min"]) if product.get("price_min") is not None else None,
        "min_order": product.get("min_order"),
        "lead_time": [product.get("lead_time_min_days"), product.get("lead_time_max_days")],
        "check": CHECK_LABEL.get(find.get("china_check") or ""),
        "trail": {"scouted_at": find.get("scouted_at"), "checked_at": find.get("checked_at"),
                  "approved_at": find.get("approved_at"), "released_at": find.get("released_at")},
    })
    if access["research"]:
        view["research"] = {
            "why": find.get("why"), "platforms": [PLATFORM_LABEL.get(p, p) for p in find.get("signal_platforms") or []],
            "regions": find.get("signal_regions") or [], "china_check": CHECK_LABEL.get(find.get("china_check") or ""),
            "china_place": find.get("china_place"), "sample_available": find.get("sample_available"),
        }
    if access["breaks"]:
        view["price_breaks"] = find.get("price_breaks") or []
    if access["maths"]:
        view["typical_price"] = [find.get("sell_price_min"), find.get("sell_price_max")]
        if detail:
            estimates = shipping.landed(find.get("price_breaks") or [], find.get("unit_weight_kg"), rate)
            typical = None
            if find.get("sell_price_min"):
                typical = (float(find["sell_price_min"]) + float(find.get("sell_price_max") or find["sell_price_min"])) / 2
            for estimate in estimates:
                if typical:
                    estimate["margin_per_unit"] = round(typical - estimate["landed_per_unit"], 2)
            view["landed"] = estimates
    if detail:
        view["description"] = product.get("description") or ""
        view["media"] = media or ([{"media_type": product.get("media_type") or "image", "url": product["media_url"]}]
                                  if product.get("media_url") else [])
        view["drop"] = drop_view(drop) if drop else None
    return view


def member_finds(member_id: str, *, drop_id: str | None = None, lane: str | None = None) -> dict:
    now = now_utc()
    access = access_for(member_id)
    drops = _visible_drops(access, now)
    chosen = next((d for d in drops if str(d["id"]) == str(drop_id)), None) if drop_id else (drops[0] if drops else None)
    watching = _watching(member_id)
    finds_out: list[dict] = []
    if chosen:
        found = rows(db().table("finds").select("*").eq("drop_id", str(chosen["id"])).in_("status", list(LIVE))
                     .order("approved_at").limit(100).execute())
        if lane in LANES:
            found = [f for f in found if f["lane"] == lane]
        products = _products([str(f["product_id"]) for f in found if f.get("product_id")])
        found = [f for f in found if str(f.get("product_id")) in products]
        found.sort(key=lambda f: (f["lane"] != "trending", str(f.get("approved_at") or "")))
        for index, find in enumerate(found):
            locked = not access["research"] and index >= FEATURED_FOR_FREE
            finds_out.append(card(find, products[str(find["product_id"])], access, drop=chosen,
                                  watching=str(find["id"]) in watching, locked=locked))
    upcoming = _upcoming_drop(now)
    return {
        "access": access, "process": PROCESS, "drop": drop_view(chosen) if chosen else None,
        "stats": drop_stats(chosen) if chosen else None, "finds": finds_out,
        "drops": [{"id": d["id"], "title": d["title"], "release_at": d["release_at"]} for d in drops],
        "next_drop": ({"title": upcoming["title"], "release_at": upcoming["release_at"], "early_at": upcoming["early_at"],
                       "opens_for_you": opens_at(upcoming, access).isoformat()} if upcoming else None),
        "watching_count": len(watching), "countries": shipping.COUNTRIES,
        "drop_alerts": drop_alerts_on(member_id, access),
    }


def visible_find(member_id: str, find: dict, access: dict | None = None) -> tuple[bool, dict | None, dict]:
    access = access or access_for(member_id)
    drop = _drop(find.get("drop_id"))
    if find["status"] not in LIVE or not drop:
        return False, drop, access
    return opens_at(drop, access) <= now_utc(), drop, access


def member_detail(member_id: str, find_id: str, country: str | None = None) -> dict:
    find = get(find_id)
    seen, drop, access = visible_find(member_id, find)
    if not seen:
        raise LookupError("This find isn't open for you yet.")
    product = _products([str(find["product_id"])]).get(str(find["product_id"]))
    if not product:
        raise LookupError("This find isn't available.")
    media = rows(db().table("commerce_media").select("position,media_type,url,alt").eq("product_id", str(product["id"]))
                 .order("position").limit(10).execute())
    zone, rate = _rate(country) if access["maths"] else (None, None)
    view = card(find, product, access, drop=drop, watching=str(find["id"]) in _watching(member_id), locked=False,
                media=[{k: m.get(k) for k in ("media_type", "url", "alt")} for m in media], rate=rate, detail=True)
    if access["maths"]:
        view["country"] = (country or "").upper() or None
        view["zone"] = (rate or {}).get("label") if rate else None
        if country and not view.get("landed"):
            view["landed_note"] = ("We don't have a shipping rate for that region yet; ask us in the chat."
                                   if rate and rate.get("air_per_kg") is None else None)
    return {"find": view, "access": access}


def visible_product(member_id: str, product_id: str) -> dict | None:
    """A find's product before it joins the catalog, for members whose drop is open (the product page uses it)."""
    find = for_product(product_id)
    if not find:
        return None
    seen, _drop_row, _access = visible_find(member_id, find)
    if not seen:
        return None
    return one(db().table("directory_products").select("*").eq("id", str(product_id)).limit(1).execute())


def watch(member_id: str, find_id: str) -> dict:
    find = get(find_id)
    seen, _drop_row, access = visible_find(member_id, find)
    if not seen:
        raise LookupError("This find isn't open for you yet.")
    watching = _watching(member_id)
    if str(find["id"]) in watching:
        return {"watching": True, "count": len(watching)}
    limit = access.get("watch_limit")
    if limit is not None and len(watching) >= limit:
        raise FindError(f"Your plan watches up to {limit} finds. Stop watching one, or upgrade to watch more.")
    db().table("member_find_watches").upsert({"member_id": member_id, "find_id": str(find["id"])},
                                             on_conflict="member_id,find_id", ignore_duplicates=True).execute()
    return {"watching": True, "count": len(watching) + 1}


def unwatch(member_id: str, find_id: str) -> dict:
    db().table("member_find_watches").delete().eq("member_id", member_id).eq("find_id", str(find_id)).execute()
    return {"watching": False, "count": len(_watching(member_id))}


def watched(member_id: str) -> list[dict]:
    access = access_for(member_id)
    ids = list(_watching(member_id))
    if not ids:
        return []
    found = rows(db().table("finds").select("*").in_("id", ids).execute())
    products = _products([str(f["product_id"]) for f in found if f.get("product_id")])
    drops = {str(d["id"]): d for d in rows(db().table("find_drops").select("*")
                                           .in_("id", list({str(f["drop_id"]) for f in found if f.get("drop_id")})).execute())}
    return [card(f, products[str(f["product_id"])], access, drop=drops.get(str(f.get("drop_id"))), watching=True, locked=False)
            for f in found if str(f.get("product_id")) in products]


def niche_request(member_id: str, text: str) -> dict:
    """Pro: ask the team to research a niche. Opens Store team work; the answer comes in the member's chat."""
    access = access_for(member_id)
    if not access.get("niche_requests"):
        raise FindError("Niche research requests are a Pro perk.")
    text = (text or "").strip()
    if len(text) < 10:
        raise FindError("Tell us a little more: the product type, who buys it and where you sell.")
    start = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    mine = [i for i in rows(db().table("operations_work_items").select("id,metadata,created_at")
                            .eq("work_type", "research_niche").gte("created_at", start).limit(1000).execute())
            if str((i.get("metadata") or {}).get("member_id")) == member_id]
    if len(mine) >= access["niche_requests"]:
        raise FindError(f"You've used your {access['niche_requests']} niche requests this month. More open on the 1st.")
    from uuid import uuid4
    from app.accounts import operations_flow as flow
    item = flow.ensure_item(source_kind="find_niche_request", source_id=str(uuid4()), department="store_team",
                            work_type="research_niche", summary=f"Research a niche for a Pro member: {text}"[:240],
                            next_action="Scout this niche, add any finds to the next drop and reply to the member in their chat.",
                            metadata={"member_id": member_id, "request": text[:1000]},
                            due_at=(now_utc() + timedelta(days=7)).isoformat())
    return {"requested": True, "left": access["niche_requests"] - len(mine) - 1, "work_item_id": (item or {}).get("id")}


# ---------------------------------------------------------------------------------------------
# Alerts and the weekly release
# ---------------------------------------------------------------------------------------------
def _email(member_id: str, title: str, body: str, href: str = "/member/finds") -> None:
    from app.commerce import service as commerce
    commerce.queue_email(member_id, category="notifications", template="commerce_finds", title=title, body=body, href=href)


def _alert_watchers(find: dict, key: str, title: str, body: str) -> int:
    sent = dict(find.get("last_alert") or {})
    if key in sent:
        return 0
    count = 0
    for watch_row in rows(db().table("member_find_watches").select("member_id").eq("find_id", str(find["id"])).limit(5000).execute()):
        member_id = str(watch_row["member_id"])
        try:
            if access_for(member_id)["alerts"]:
                _email(member_id, title, body, f"/member/finds?find={find['id']}")
                count += 1
        except Exception:
            logger.exception("Could not alert a member watching a find")
    sent[key] = now_utc().isoformat()
    _save(find, {"last_alert": sent})
    return count


def _alert_price(before: dict, after: dict) -> None:
    old = shipping.unit_price_for(before.get("price_breaks") or [], 1_000_000)
    new = shipping.unit_price_for(after.get("price_breaks") or [], 1_000_000)
    if old and new and new < old:
        name = (_products([str(after["product_id"])]).get(str(after["product_id"])) or {}).get("name") or "A find you watch"
        _alert_watchers(after, f"price:{new}", f"Price drop: {name}"[:150],
                        f"{name} now starts at {new:.2f} USD per unit in quantity (was {old:.2f}).")


def availability_changed(product_id: str, status: str) -> None:
    """Called when a find's product comes back (available): watchers hear about it."""
    find = for_product(product_id)
    if find and find["status"] in LIVE and status == "available":
        name = (_products([product_id]).get(product_id) or {}).get("name") or "A find you watch"
        _alert_watchers(find, f"available:{now_utc().date().isoformat()}", f"Ready to order: {name}"[:150],
                        f"{name} is quick to source again. Order before the next drop.")


def _members(tiers: tuple[str, ...]) -> list[str]:
    return [str(r["user_id"]) for r in rows(db().table("member_profiles").select("user_id,member_tier")
                                             .in_("member_tier", list(tiers)).limit(5000).execute())]


def drop_alerts_on(member_id: str, access: dict | None = None) -> bool:
    """Whether the member gets an email when a drop opens for them. Members choose with the bell on Home; until they
    do, paid plans get it and Free does not."""
    try:
        profile = one(db().table("member_profiles").select("finds_drop_alerts").eq("user_id", member_id).limit(1).execute())
    except Exception:
        logger.exception("Could not read the member's drop alert choice")
        profile = None
    choice = (profile or {}).get("finds_drop_alerts")
    if choice is None:
        return bool((access or access_for(member_id))["research"])
    return bool(choice)


def set_drop_alerts(member_id: str, on: bool) -> bool:
    db().table("member_profiles").update({"finds_drop_alerts": bool(on)}).eq("user_id", member_id).execute()
    return bool(on)


def _alerts_off() -> set[str]:
    try:
        return {str(r["user_id"]) for r in rows(db().table("member_profiles").select("user_id")
                                                .eq("finds_drop_alerts", False).limit(5000).execute())}
    except Exception:
        logger.exception("Could not read drop alert choices")
        return set()


def _alerts_chosen_on() -> list[str]:
    try:
        return [str(r["user_id"]) for r in rows(db().table("member_profiles").select("user_id")
                                                .eq("finds_drop_alerts", True).limit(5000).execute())]
    except Exception:
        logger.exception("Could not read drop alert choices")
        return []


def _fill_drop_task(drop: dict, count: int, now: datetime) -> None:
    from app.accounts import operations_flow as flow
    target = int(drop.get("target_count") or DROP_TARGET)
    key = f"{drop['id']}"
    if count >= target or parse(drop["early_at"]) <= now:
        flow.close_item("find_drop", key, reason=f"The drop has {count} of {target} finds.")
        return
    if parse(drop["early_at"]) - now <= timedelta(days=3):
        flow.ensure_item(source_kind="find_drop", source_id=key, department="store_team", work_type="fill_finds_drop",
                         summary=f"Fill the drop \"{drop['title']}\": {count} of {target} finds"[:240],
                         next_action="Scout, check and send finds for review so the drop is full before it opens for Pro.",
                         priority="high", metadata={"drop_id": str(drop["id"])}, due_at=drop["early_at"])


def sweep(now: datetime | None = None) -> dict[str, int]:
    """Every few minutes: keep the next drops planned, open drops (Pro, then Standard), move week-old drops into the
    catalog, and open a "Fill the drop" task when one is short three days before it opens."""
    now = now or now_utc()
    counts = {"opened": 0, "emails": 0, "catalog": 0}
    first = next_release(now + timedelta(hours=EARLY_HOURS))
    ensure_drop(first)
    ensure_drop(next_release(first))
    window = rows(db().table("find_drops").select("*").gte("catalog_at", (now - timedelta(days=2)).isoformat())
                  .order("release_at").limit(20).execute())
    live_counts = drop_counts(d["id"] for d in window)
    for drop in window:
        notified = dict(drop.get("notified") or {})
        count = live_counts.get(str(drop["id"]), 0)
        _fill_drop_task(drop, count, now)
        changed = False
        if parse(drop["early_at"]) <= now and "early" not in notified:
            db().table("finds").update({"status": "released", "released_at": drop["early_at"], "updated_at": now.isoformat()}) \
                .eq("drop_id", str(drop["id"])).eq("status", "scheduled").execute()
            counts["opened"] += 1
            if count:
                off = _alerts_off()
                for member_id in _members(("pro",)):
                    if member_id not in off and access_for(member_id)["early"]:
                        _email(member_id, f"Your early look: {drop['title']}"[:150],
                               f"{count} new finds are open for Pro members, two days before everyone else.")
                        counts["emails"] += 1
            notified["early"] = now.isoformat()
            changed = True
        if parse(drop["release_at"]) <= now and "release" not in notified:
            if count:
                off = _alerts_off()
                for member_id in _members(("standard", "pro")):
                    if member_id not in off and not access_for(member_id)["early"]:
                        _email(member_id, f"New this Monday: {drop['title']}"[:150],
                               f"{count} new finds, each checked in China, with prices for buying in quantity.")
                        counts["emails"] += 1
            notified["release"] = now.isoformat()
            changed = True
        if parse(drop["catalog_at"]) <= now and "catalog" not in notified:
            ids = [str(f["product_id"]) for f in rows(db().table("finds").select("product_id,status")
                                                     .eq("drop_id", str(drop["id"])).eq("status", "released").execute())
                   if f.get("product_id")]
            if count:
                # Free members who turned the bell on hear when the drop opens for them.
                for member_id in _alerts_chosen_on():
                    try:
                        if not access_for(member_id)["research"]:
                            _email(member_id, f"Now open for you: {drop['title']}"[:150],
                                   f"{count} finds from {drop['title']} are open on FayFort, each checked in China.")
                            counts["emails"] += 1
                    except Exception:
                        logger.exception("Could not send a drop alert")
            if ids:
                db().table("directory_products").update({"active": True}).in_("id", ids).execute()
                counts["catalog"] += len(ids)
                try:
                    from app.commerce import service as commerce
                    commerce.clear_cache()
                except Exception:
                    pass
            notified["catalog"] = now.isoformat()
            changed = True
        if changed:
            db().table("find_drops").update({"notified": notified, "updated_at": now.isoformat()}).eq("id", str(drop["id"])).execute()
    return counts


async def finds_loop(interval_seconds: int = 300) -> None:
    await asyncio.sleep(60)
    while True:
        try:
            counts = await asyncio.to_thread(sweep)
            if any(counts.values()):
                logger.info("Finds sweep: %s", counts)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Finds sweep failed; will retry")
        await asyncio.sleep(interval_seconds)


# ---------------------------------------------------------------------------------------------
# fayfort.com
# ---------------------------------------------------------------------------------------------
def public_teaser() -> dict:
    """fayfort.com/go/finds: the process, the last drop's effort and three finds that are already in the catalog
    (photo, name and lane only; the research stays for members)."""
    now = now_utc()
    released = one(db().table("find_drops").select("*").lte("release_at", now.isoformat()).order("release_at", desc=True)
                   .limit(1).execute())
    catalog = one(db().table("find_drops").select("*").lte("catalog_at", now.isoformat()).order("release_at", desc=True)
                  .limit(1).execute())
    upcoming = _upcoming_drop(now)
    items: list[dict] = []
    if catalog:
        found = rows(db().table("finds").select("id,lane,product_id,status").eq("drop_id", str(catalog["id"]))
                     .eq("status", "released").limit(30).execute())
        products = _products([str(f["product_id"]) for f in found if f.get("product_id")])
        for find in sorted(found, key=lambda f: f["lane"] == "trending", reverse=True):
            product = products.get(str(find.get("product_id")))
            if product and product.get("media_url") and product.get("active"):
                items.append({"name": product["name"], "lane": find["lane"], "image_url": product["media_url"]})
            if len(items) >= 3:
                break
    return {"process": PROCESS, "last_drop": ({"title": released["title"], "release_at": released["release_at"],
                                               "stats": drop_stats(released)} if released else None),
            "next_release_at": upcoming["release_at"] if upcoming else None, "items": items}
