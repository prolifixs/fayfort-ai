"""Commerce building blocks shared by the member and staff APIs: product cards, sales, Heat, rails,
Find It, pools, invoices, orders and giveaways."""
from __future__ import annotations

import hashlib
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app.commerce import links, ranking, shopify
from app.commerce.db import db, one, rows
from app.config.settings import settings

logger = logging.getLogger(__name__)

PRODUCT_FIELDS = ("id,name,category_ref,description,availability_status,media_url,media_type,media_source,source,"
                  "shopify_product_id,shopify_handle,vendor,product_type,tags,price_min,price_max,compare_at_max,"
                  "currency,in_stock,total_inventory,restocked_at,online_store_url,active,created_at")
TREND_FIELDS = ("id,canonical_url,platform,title,description,image_url,author_name,site_name,preview_status,"
                "linked_product_id,status,pool_target,pool_price,pool_currency,pool_deadline,pool_note,share_count,"
                "want_count,first_shared_at,last_shared_at")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.isoformat()


# ---------------------------------------------------------------------------------------------
# Reference data (cached briefly; the 968 categories rarely change)
# ---------------------------------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, seconds: float, load):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < seconds:
        return hit[1]
    value = load()
    _cache[key] = (time.monotonic(), value)
    return value


def clear_cache() -> None:
    _cache.clear()


def categories() -> list[dict]:
    return _cached("categories", 600, lambda: rows(db().table("directory_categories")
                   .select("source_ref,category,group_name,product_type,priority").limit(5000).execute()))


def category_groups() -> dict[str, str]:
    return {str(c["source_ref"]): str(c.get("group_name") or "") for c in categories()}


def active_sales(now: datetime | None = None) -> dict[str, dict]:
    """product id -> the automatic (no code) sale running now. Codes don't change the shown price."""
    now = now or now_utc()

    def load():
        found = rows(db().table("commerce_flash_sales").select(
            "id,title,discount_type,value,product_ids,starts_at,ends_at,code,status")
            .eq("status", "scheduled").gte("ends_at", iso(now)).limit(500).execute())
        return found
    sales = _cached("sales", 30, load)
    by_product: dict[str, dict] = {}
    for sale in sales:
        if sale.get("code") or ranking.parse_time(sale["starts_at"]) > now or ranking.parse_time(sale["ends_at"]) <= now:
            continue
        for product_id in sale.get("product_ids") or []:
            current = by_product.get(str(product_id))
            if not current or float(sale["value"]) > float(current["value"]):
                by_product[str(product_id)] = sale
    return by_product


def heat_map(now: datetime | None = None) -> dict[str, float]:
    now = now or now_utc()

    def load():
        since = iso(now - timedelta(days=ranking.HEAT_WINDOW_DAYS))
        events = rows(db().table("commerce_intent_events").select("member_id,product_id,event_type,created_at")
                      .gte("created_at", since).order("created_at", desc=True).limit(20000).execute())
        return ranking.heat_scores(events, now=now)
    return _cached("heat", 120, load)


def load_products(*, ids: list[str] | None = None, limit: int = 2000) -> list[dict]:
    query = db().table("directory_products").select(PRODUCT_FIELDS).eq("active", True)
    if ids is not None:
        if not ids:
            return []
        query = query.in_("id", ids)
    return rows(query.limit(limit).execute())


def media_for(product_ids: list[str]) -> dict[str, list[dict]]:
    if not product_ids:
        return {}
    found = rows(db().table("commerce_media").select("product_id,position,media_type,url,preview_url,alt")
                 .in_("product_id", product_ids).order("position").execute())
    grouped: dict[str, list[dict]] = {}
    for item in sorted(found, key=lambda r: (str(r["product_id"]), int(r.get("position") or 0))):
        grouped.setdefault(str(item["product_id"]), []).append(
            {k: item.get(k) for k in ("media_type", "url", "preview_url", "alt")})
    return grouped


def card(product: dict, *, sales: dict[str, dict], heat: dict[str, float], groups: dict[str, str],
         saved: set[str] | None = None) -> dict:
    """The one product card shape used by the chat, rails, browse, cart suggestions and Find It."""
    product_id = str(product["id"])
    sale = sales.get(product_id)
    price = product.get("price_min")
    price = float(price) if price is not None else None
    sale_price = ranking.sale_price(price, sale)
    compare = product.get("compare_at_max")
    return {
        "id": product_id,
        "name": product.get("name"),
        "description": (product.get("description") or "")[:280],
        "category_ref": product.get("category_ref"),
        "group_name": groups.get(str(product.get("category_ref") or "")) or None,
        "source": product.get("source") or "fayfort",
        "availability_status": product.get("availability_status"),
        "in_stock": product.get("in_stock"),
        "media_url": product.get("media_url"),
        "media_type": product.get("media_type"),
        "media_source": product.get("media_source"),
        "price": price,
        "price_max": float(product["price_max"]) if product.get("price_max") is not None else None,
        "compare_at_price": float(compare) if compare is not None and price is not None and float(compare) > price else None,
        "currency": product.get("currency") or settings.COMMERCE_CURRENCY,
        "sale": ({"id": sale["id"], "title": sale["title"], "ends_at": sale["ends_at"], "sale_price": sale_price,
                  "discount_type": sale["discount_type"], "value": float(sale["value"])} if sale else None),
        "low_stock": bool(product.get("in_stock") and isinstance(product.get("total_inventory"), int)
                          and 0 < product["total_inventory"] <= 5),
        "heat": round(heat.get(product_id, 0.0), 2),
        "saved": product_id in saved if saved is not None else None,
        "buyable": product.get("source") == "shopify" and bool(product.get("in_stock")),
    }


def cards(products: list[dict], *, saved: set[str] | None = None) -> list[dict]:
    sales, heat, groups = active_sales(), heat_map(), category_groups()
    return [card(p, sales=sales, heat=heat, groups=groups, saved=saved) for p in products]


def saved_ids(member_id: str) -> set[str]:
    return {str(r["product_id"]) for r in rows(db().table("member_saved_products").select("product_id")
                                              .eq("member_id", member_id).execute())}


# ---------------------------------------------------------------------------------------------
# Intent
# ---------------------------------------------------------------------------------------------
def record_events(member_id: str, session_id: str, events: list[dict]) -> int:
    clean = []
    for event in events[:20]:
        clean.append({"member_id": member_id, "session_id": session_id[:64],
                      "event_type": event["event_type"], "product_id": event.get("product_id"),
                      "trend_item_id": event.get("trend_item_id"),
                      "category_ref": (event.get("category_ref") or None),
                      "query": (str(event["query"])[:200] if event.get("query") else None),
                      "price": event.get("price")})
    if clean:
        db().table("commerce_intent_events").insert(clean).execute()
    return len(clean)


def member_intent(member_id: str, now: datetime | None = None) -> ranking.Intent:
    now = now or now_utc()
    since = iso(now - timedelta(minutes=ranking.INTENT_WINDOW_MINUTES))
    events = rows(db().table("commerce_intent_events")
                  .select("event_type,product_id,category_ref,query,price,created_at")
                  .eq("member_id", member_id).gte("created_at", since).order("created_at", desc=True)
                  .limit(200).execute())
    product_ids = list({str(e["product_id"]) for e in events if e.get("product_id")})
    products = {str(p["id"]): p for p in load_products(ids=product_ids)} if product_ids else {}
    return ranking.build_intent(events, products=products, category_groups=category_groups(), now=now)


def ranked(products: list[dict], intent: ranking.Intent, *, query_terms: list[str] | None = None,
           saved: set[str] | None = None, diversify: bool = True) -> list[dict]:
    sales, heat, groups = active_sales(), heat_map(), category_groups()
    scored = []
    for product in products:
        item = card(product, sales=sales, heat=heat, groups=groups, saved=saved)
        enriched = {**product, "group_name": item["group_name"], "sale": item["sale"],
                    "sale_price": (item["sale"] or {}).get("sale_price")}
        item["score"] = round(ranking.score(enriched, intent, heat=heat.get(item["id"], 0.0), query_terms=query_terms), 4)
        if query_terms:
            item["relevance"] = round(ranking.relevance(enriched, intent, query_terms), 4)
        scored.append(item)
    scored.sort(key=lambda c: -c["score"])
    return ranking.diversify(scored) if diversify else scored


# ---------------------------------------------------------------------------------------------
# Trend items (Find It) and pools
# ---------------------------------------------------------------------------------------------
def trend_card(item: dict, *, member_wants: set[str] | None = None, linked: dict[str, dict] | None = None) -> dict:
    target = item.get("pool_target")
    wants = int(item.get("want_count") or 0)
    linked_card = (linked or {}).get(str(item.get("linked_product_id") or ""))
    return {
        "id": str(item["id"]),
        "url": item["canonical_url"],
        "platform": item["platform"],
        "title": item.get("title") or item.get("site_name") or item["canonical_url"],
        "description": item.get("description"),
        "image_url": item.get("image_url"),
        "author_name": item.get("author_name"),
        "site_name": item.get("site_name"),
        "status": item.get("status"),
        "share_count": int(item.get("share_count") or 0),
        "want_count": wants,
        "pool": ({"target": target, "price": float(item["pool_price"]) if item.get("pool_price") else None,
                  "currency": item.get("pool_currency"), "deadline": item.get("pool_deadline"),
                  "note": item.get("pool_note"), "progress": min(1.0, wants / target) if target else None}
                 if item.get("status") in ("pooling", "sourcing") and target else None),
        "member_wants": str(item["id"]) in member_wants if member_wants is not None else None,
        "linked_product": linked_card,
    }


def _expand_short_link(url: str) -> str:
    host = (links.urlsplit(url).hostname or "").lower()
    if host in ("vm.tiktok.com", "vt.tiktok.com") or host.endswith("tiktok.com") and "/t/" in url:
        fetched = links.safe_get(url)
        if fetched:
            return fetched[0]
    return url


def upsert_trend_item(url: str, *, fetch=links.fetch_preview) -> dict | None:
    canonical = links.canonical_url(_expand_short_link(url))
    if not canonical:
        return None
    existing = one(db().table("commerce_trend_items").select(TREND_FIELDS).eq("canonical_url", canonical)
                   .maybe_single().execute())
    if existing and existing.get("preview_status") in ("ok", "partial"):
        return existing
    preview = fetch(canonical)
    values = {**preview.as_row(), "preview_fetched_at": iso(now_utc())}
    if existing:
        updated = one(db().table("commerce_trend_items").update(values).eq("id", existing["id"]).execute())
        return {**existing, **(updated or values)}
    created = one(db().table("commerce_trend_items").upsert(values, on_conflict="canonical_url").execute())
    return created or one(db().table("commerce_trend_items").select(TREND_FIELDS).eq("canonical_url", canonical)
                          .maybe_single().execute())


def refresh_trend_counts(trend_item_id: str) -> dict:
    shares = rows(db().table("commerce_trend_shares").select("member_id").eq("trend_item_id", trend_item_id).execute())
    wants = rows(db().table("commerce_pool_members").select("member_id").eq("trend_item_id", trend_item_id).execute())
    values = {"share_count": len(shares), "want_count": len(wants), "last_shared_at": iso(now_utc()),
              "updated_at": iso(now_utc())}
    db().table("commerce_trend_items").update(values).eq("id", trend_item_id).execute()
    return values


def record_share(trend_item_id: str, member_id: str) -> None:
    db().table("commerce_trend_shares").upsert({"trend_item_id": trend_item_id, "member_id": member_id},
                                               on_conflict="trend_item_id,member_id", ignore_duplicates=True).execute()
    refresh_trend_counts(trend_item_id)


def find_it(member_id: str, text: str, *, session_id: str, fetch=links.fetch_preview) -> dict:
    """Resolve words or a pasted link into Exact match, Closest alternatives and Source it."""
    url = links.find_url(text)
    words = text.replace(url, " ") if url else text
    trend = None
    if url:
        trend = upsert_trend_item(url, fetch=fetch)
        if trend:
            record_share(str(trend["id"]), member_id)
            trend = one(db().table("commerce_trend_items").select(TREND_FIELDS).eq("id", trend["id"])
                        .maybe_single().execute()) or trend
    query_terms = ranking.terms(words)
    if trend:
        query_terms = list(dict.fromkeys(query_terms + ranking.terms(trend.get("title"))
                                         + ranking.terms(trend.get("description"))))[:14]
    record_events(member_id, session_id, [{
        "event_type": "paste_link" if trend else "search",
        "trend_item_id": str(trend["id"]) if trend else None,
        "query": (" ".join(query_terms) or None)}])
    intent = member_intent(member_id)
    saved = saved_ids(member_id)
    products = load_products()
    exact: dict | None = None
    exact_id = str(trend.get("linked_product_id")) if trend and trend.get("linked_product_id") else None
    if not exact_id and url:
        canonical = links.canonical_url(url)
        for product in products:
            if product.get("online_store_url") and links.canonical_url(product["online_store_url"]) == canonical:
                exact_id = str(product["id"])
                break
    candidates = ranked(products, intent, query_terms=query_terms or None, saved=saved, diversify=False) \
        if (query_terms or exact_id) else []
    if exact_id:
        exact = next((c for c in candidates if c["id"] == exact_id), None) or \
            next(iter(cards(load_products(ids=[exact_id]), saved=saved)), None)
    elif candidates and query_terms and candidates[0].get("relevance", 0) >= 1.0 and not trend:
        exact = candidates[0]
    alternatives = [c for c in candidates if (not exact or c["id"] != exact["id"]) and c.get("relevance", 0) >= 0.34]
    # Impulse slot after a link: something that can ship today while the shared item is sourced.
    alternatives.sort(key=lambda c: (not c.get("buyable"), -c["score"]))
    member_wants = {str(r["trend_item_id"]) for r in rows(db().table("commerce_pool_members").select("trend_item_id")
                                                          .eq("member_id", member_id).execute())}
    return {
        "kind": "link" if url else "words",
        "query": " ".join(query_terms),
        "link": trend_card(trend, member_wants=member_wants) if trend else None,
        "exact": exact,
        "alternatives": alternatives[:3],
        "source_it": {"available": True, "trend_item_id": str(trend["id"]) if trend else None,
                      "title_hint": (trend.get("title") if trend else words.strip())[:160] if (trend or words.strip()) else None},
    }


def want_trend_item(member_id: str, trend_item_id: str, *, session_id: str, conversation_id: str | None = None,
                    note: str | None = None) -> dict:
    """Source it: join the item's pool and open (once) a sourcing request that staff work as usual."""
    trend = one(db().table("commerce_trend_items").select(TREND_FIELDS).eq("id", trend_item_id).maybe_single().execute())
    if not trend or trend.get("status") in ("dismissed", "closed"):
        raise LookupError("This item is no longer open for sourcing.")
    member = one(db().table("commerce_pool_members").select("trend_item_id,request_id")
                 .eq("trend_item_id", trend_item_id).eq("member_id", member_id).maybe_single().execute())
    request_id = (member or {}).get("request_id")
    if not request_id:
        title = (trend.get("title") or trend.get("site_name") or "Item from a shared link")[:160]
        params = {"p_member_id": member_id, "p_request_title": title,
                  "p_request_description": (note or trend.get("description") or None),
                  "p_product_id": None, "p_source_type": "url", "p_source_url": trend["canonical_url"],
                  "p_source_image": None}
        rpc = "create_member_purchase_request"
        if conversation_id:
            rpc, params = "create_member_request_from_chat", {"p_conversation_id": conversation_id, **params}
        created = db().rpc(rpc, params).execute()
        value = getattr(created, "data", None)
        request_id = (value[0] if isinstance(value, list) and value else value) or None
    db().table("commerce_pool_members").upsert({"trend_item_id": trend_item_id, "member_id": member_id,
                                                "request_id": str(request_id) if request_id else None},
                                               on_conflict="trend_item_id,member_id").execute()
    counts = refresh_trend_counts(trend_item_id)
    record_events(member_id, session_id, [{"event_type": "want", "trend_item_id": trend_item_id,
                                           "product_id": trend.get("linked_product_id")}])
    return {"trend_item_id": trend_item_id, "request_id": str(request_id) if request_id else None,
            "want_count": counts["want_count"]}


# ---------------------------------------------------------------------------------------------
# Rails (front page) and impulse slots
# ---------------------------------------------------------------------------------------------
def rails(member_id: str, now: datetime | None = None) -> dict:
    now = now or now_utc()
    saved = saved_ids(member_id)
    intent = member_intent(member_id, now)
    products = load_products()
    ranked_all = ranked(products, intent, saved=saved)
    result: list[dict] = []
    if intent.active:
        result.append({"key": "for_you", "title": "Picked for what you're looking for", "items": ranked_all[:10]})
    week = iso(now - timedelta(days=7))
    trends = rows(db().table("commerce_trend_items").select(TREND_FIELDS).in_("status", ["open", "pooling", "sourcing"])
                  .gte("last_shared_at", week).order("share_count", desc=True).limit(30).execute())
    member_wants = {str(r["trend_item_id"]) for r in rows(db().table("commerce_pool_members").select("trend_item_id")
                                                          .eq("member_id", member_id).execute())}
    linked_ids = [str(t["linked_product_id"]) for t in trends if t.get("linked_product_id")]
    linked = {c["id"]: c for c in cards(load_products(ids=linked_ids), saved=saved)} if linked_ids else {}
    social = [t for t in trends if t.get("platform") in ("tiktok", "instagram") or t.get("share_count", 0) >= 2]
    if social:
        result.append({"key": "trending", "title": "Trending on TikTok & Instagram", "kind": "trend",
                       "items": [trend_card(t, member_wants=member_wants, linked=linked) for t in social[:10]]})
    by_id = {c["id"]: c for c in ranked_all}
    ending = [c for c in by_id.values() if c.get("sale")
              and (ranking.parse_time(c["sale"]["ends_at"]) - now) <= timedelta(hours=72)]
    ending.sort(key=lambda c: c["sale"]["ends_at"])
    if ending:
        result.append({"key": "ending_soon", "title": "Ending soon", "items": ending[:10]})
    restocked = [p for p in products if p.get("in_stock") and p.get("restocked_at")
                 and ranking.parse_time(p["restocked_at"]) >= now - timedelta(days=7)]
    if restocked:
        result.append({"key": "back_in_stock", "title": "Back in stock",
                       "items": [by_id[str(p["id"])] for p in restocked if str(p["id"]) in by_id][:10]})
    pools = [t for t in trends if t.get("status") == "pooling" and t.get("pool_target")
             and int(t.get("want_count") or 0) / int(t["pool_target"]) >= 0.5]
    pools.sort(key=lambda t: -int(t.get("want_count") or 0) / int(t["pool_target"]))
    if pools:
        result.append({"key": "almost_sourced", "title": "Almost sourced", "kind": "trend",
                       "items": [trend_card(t, member_wants=member_wants, linked=linked) for t in pools[:10]]})
    limit_price = float(settings.COMMERCE_UNDER_PRICE)
    under = [c for c in ranked_all if c.get("buyable") and ((c.get("sale") or {}).get("sale_price") or c.get("price") or 1e9) <= limit_price]
    if under:
        result.append({"key": "under_price", "title": f"Under {limit_price:g} {settings.COMMERCE_CURRENCY}", "items": under[:10]})
    if not intent.active:
        hot = sorted([c for c in ranked_all if c["heat"] > 0], key=lambda c: -c["heat"])
        if hot:
            result.append({"key": "popular", "title": "Popular on FayFort this week", "items": hot[:10]})
    giveaways = open_giveaways(member_id, now)
    return {"rails": result, "giveaways": giveaways, "intent": intent.summary()}


def pairs_with(product_ids: list[str], *, exclude: set[str], limit: int = 3) -> list[dict]:
    """Impulse after add-to-cart: items members who wanted these also looked at, else the same group's Heat."""
    if not product_ids:
        return []
    since = iso(now_utc() - timedelta(days=30))
    members = {str(r["member_id"]) for r in rows(db().table("commerce_intent_events").select("member_id")
               .in_("product_id", product_ids).gte("created_at", since).limit(2000).execute())}
    counts: dict[str, int] = {}
    if members:
        for event in rows(db().table("commerce_intent_events").select("member_id,product_id")
                          .in_("member_id", list(members)[:500]).gte("created_at", since).limit(10000).execute()):
            pid = str(event.get("product_id") or "")
            if pid and pid not in exclude and pid not in product_ids:
                counts[pid] = counts.get(pid, 0) + 1
    candidates = load_products()
    groups = category_groups()
    own_groups = {groups.get(str(p.get("category_ref") or "")) for p in candidates if str(p["id"]) in product_ids}
    heat = heat_map()
    pool = [p for p in candidates if str(p["id"]) not in exclude and str(p["id"]) not in product_ids
            and p.get("source") == "shopify" and p.get("in_stock")]
    pool.sort(key=lambda p: (-counts.get(str(p["id"]), 0),
                             -(1 if groups.get(str(p.get("category_ref") or "")) in own_groups else 0),
                             -heat.get(str(p["id"]), 0.0)))
    return cards(pool[:limit])


# ---------------------------------------------------------------------------------------------
# Cart
# ---------------------------------------------------------------------------------------------
def cart(member_id: str) -> dict:
    lines = rows(db().table("commerce_cart_lines").select("variant_id,quantity,added_at").eq("member_id", member_id)
                 .order("added_at").execute())
    variant_ids = [str(line["variant_id"]) for line in lines]
    variants = {str(v["id"]): v for v in rows(db().table("commerce_variants").select(
        "id,product_id,shopify_variant_id,title,price,compare_at_price,available,options,image_url")
        .in_("id", variant_ids).execute())} if variant_ids else {}
    product_ids = list({str(v["product_id"]) for v in variants.values()})
    product_cards = {c["id"]: c for c in cards(load_products(ids=product_ids))} if product_ids else {}
    out, subtotal, currency = [], 0.0, settings.COMMERCE_CURRENCY
    for line in lines:
        variant = variants.get(str(line["variant_id"]))
        product = product_cards.get(str(variant["product_id"])) if variant else None
        if not variant or not product:
            continue
        unit = float(variant["price"])
        if product.get("sale"):
            unit = ranking.sale_price(unit, product["sale"]) or unit
        currency = product.get("currency") or currency
        subtotal += unit * int(line["quantity"])
        out.append({"variant_id": str(variant["id"]), "quantity": int(line["quantity"]), "unit_price": round(unit, 2),
                    "variant_title": variant.get("title"), "available": bool(variant.get("available")),
                    "image_url": variant.get("image_url") or product.get("media_url"), "product": product})
    in_cart = {line["product"]["id"] for line in out}
    ending = [c for c in cards(load_products()) if c.get("sale") and c.get("buyable") and c["id"] not in in_cart]
    ending.sort(key=lambda c: c["sale"]["ends_at"])
    return {"lines": out, "subtotal": round(subtotal, 2), "currency": currency,
            "impulse": {"pairs_with": pairs_with(list(in_cart), exclude=in_cart) if in_cart else [],
                        "ending_soon": ending[:1]}}


def member_email(member_id: str) -> str | None:
    try:
        response = db().auth.admin.get_user_by_id(member_id)
        return getattr(getattr(response, "user", None), "email", None)
    except Exception:
        logger.info("Could not look up a member email", exc_info=True)
        return None


# ---------------------------------------------------------------------------------------------
# Emails (through the existing email outbox)
# ---------------------------------------------------------------------------------------------
def queue_email(member_id: str, *, category: str, template: str, title: str, body: str, href: str) -> None:
    try:
        db().table("email_outbox").insert({"category": category, "template": template, "member_id": member_id,
                                           "payload": {"title": title[:150], "body": body[:1000], "href": href}}).execute()
    except Exception:
        logger.exception("Could not queue a commerce email")


# ---------------------------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------------------------
def send_invoice(*, member_id: str, title: str, amount: float, currency: str, quantity: int = 1,
                 request_id: str | None = None, trend_item_id: str | None = None, actor_id: str | None = None) -> dict:
    email = member_email(member_id)
    if not email:
        raise ValueError("This member has no confirmed email for the invoice.")
    record = one(db().table("commerce_invoices").insert({
        "member_id": member_id, "request_id": request_id, "trend_item_id": trend_item_id, "title": title[:255],
        "amount": round(amount, 2), "currency": currency, "quantity": quantity, "created_by": actor_id}).execute())
    if not record:
        raise RuntimeError("Invoice insert returned no row")
    try:
        draft_id, url = shopify.create_invoice(invoice_id=str(record["id"]), email=email, title=title, unit_price=amount,
                                               currency=currency, quantity=quantity,
                                               note=f"FayFort invoice {record['id']}")
    except Exception as exc:
        db().table("commerce_invoices").update({"status": "failed", "error": str(exc)[:500]}).eq("id", record["id"]).execute()
        raise
    values = {"status": "sent", "shopify_draft_order_id": draft_id, "invoice_url": url or None, "sent_at": iso(now_utc())}
    db().table("commerce_invoices").update(values).eq("id", record["id"]).execute()
    return {**record, **values}


# ---------------------------------------------------------------------------------------------
# Orders (Shopify webhooks)
# ---------------------------------------------------------------------------------------------
def _attributes(order: dict) -> dict[str, str]:
    return {str(a.get("name")): str(a.get("value")) for a in order.get("note_attributes") or [] if isinstance(a, dict)}


def record_order(order: dict) -> dict:
    attributes = _attributes(order)
    invoice = None
    if attributes.get("fayfort_invoice_id"):
        invoice = one(db().table("commerce_invoices").select("id,member_id,status")
                      .eq("id", attributes["fayfort_invoice_id"]).maybe_single().execute())
    member_id = attributes.get("fayfort_member_id") or (invoice or {}).get("member_id")
    shopify_order_id = shopify.gid("Order", order.get("admin_graphql_api_id") or order.get("id"))
    tracking = []
    for fulfillment in order.get("fulfillments") or []:
        number = fulfillment.get("tracking_number")
        if number:
            url = fulfillment.get("tracking_url")
            tracking.append({"company": fulfillment.get("tracking_company"), "number": number,
                             "url": url if str(url or "").startswith("https://") else None,
                             "status": fulfillment.get("shipment_status")})
    status_url = order.get("order_status_url")
    values = {
        "shopify_order_id": shopify_order_id,
        "order_name": str(order.get("name") or "")[:60] or None,
        "member_id": member_id,
        "customer_email": (str(order.get("email") or order.get("contact_email") or "")[:320] or None),
        "source": "invoice" if invoice else ("storefront" if attributes.get("fayfort_member_id") else "other"),
        "invoice_id": (invoice or {}).get("id"),
        "financial_status": order.get("financial_status"),
        "fulfillment_status": order.get("fulfillment_status"),
        "cancelled_at": order.get("cancelled_at"),
        "total": order.get("total_price"),
        "currency": order.get("currency"),
        "line_items": [{"title": li.get("title"), "variant_title": li.get("variant_title"),
                        "quantity": li.get("quantity"), "price": li.get("price"),
                        "product_id": shopify.gid("Product", li["product_id"]) if li.get("product_id") else None}
                       for li in (order.get("line_items") or [])][:100],
        "tracking": tracking,
        "status_url": status_url if str(status_url or "").startswith("https://") else None,
        "placed_at": order.get("created_at"),
        "updated_at": iso(now_utc()),
    }
    previous = one(db().table("commerce_orders").select("id,financial_status")
                   .eq("shopify_order_id", shopify_order_id).maybe_single().execute())
    db().table("commerce_orders").upsert(values, on_conflict="shopify_order_id").execute()
    if invoice and order.get("financial_status") in ("paid", "partially_refunded", "refunded") and invoice.get("status") != "paid":
        db().rpc("record_commerce_invoice_paid", {"p_invoice_id": str(invoice["id"]),
                                                  "p_shopify_order_id": shopify_order_id}).execute()
    newly_paid = order.get("financial_status") == "paid" and (previous or {}).get("financial_status") != "paid"
    if member_id and attributes.get("fayfort_member_id") and newly_paid:
        product_gids = [li["product_id"] for li in values["line_items"] if li.get("product_id")]
        product_rows = rows(db().table("directory_products").select("id,price_min")
                            .in_("shopify_product_id", product_gids).execute()) if product_gids else []
        if product_rows:
            record_events(member_id, "shopify", [{"event_type": "checkout", "product_id": str(p["id"]),
                                                  "price": p.get("price_min")} for p in product_rows])
        db().table("commerce_cart_lines").delete().eq("member_id", member_id).execute()
    return values


# ---------------------------------------------------------------------------------------------
# Giveaways
# ---------------------------------------------------------------------------------------------
def open_giveaways(member_id: str, now: datetime | None = None) -> list[dict]:
    now = now or now_utc()
    found = rows(db().table("commerce_giveaways").select(
        "id,title,description,prize_text,prize_product_id,starts_at,ends_at,winner_count,status,drawn_at")
        .in_("status", ["open", "drawn"]).order("ends_at").limit(20).execute())
    entered = {str(r["giveaway_id"]) for r in rows(db().table("commerce_giveaway_entries").select("giveaway_id")
                                                   .eq("member_id", member_id).execute())}
    won = {str(r["giveaway_id"]): r for r in rows(db().table("commerce_giveaway_winners")
                                                  .select("giveaway_id,prize_code").eq("member_id", member_id).execute())}
    out = []
    for item in found:
        starts, ends = ranking.parse_time(item["starts_at"]), ranking.parse_time(item["ends_at"])
        if item["status"] == "open" and not (starts <= now < ends):
            continue
        if item["status"] == "drawn" and ranking.parse_time(item.get("drawn_at")) < now - timedelta(days=14):
            continue
        gid_ = str(item["id"])
        out.append({**{k: item.get(k) for k in ("title", "description", "prize_text", "starts_at", "ends_at",
                                                "winner_count", "status")},
                    "id": gid_, "entered": gid_ in entered, "won": gid_ in won,
                    "prize_code": (won.get(gid_) or {}).get("prize_code")})
    return out


def draw_order(seed: str, member_ids: list[str]) -> list[str]:
    """Deterministic, auditable shuffle: anyone with the stored seed and the entry list can repeat it."""
    return sorted(member_ids, key=lambda member: hashlib.sha256(f"{seed}:{member}".encode()).hexdigest())


def draw_giveaway(giveaway_id: str, actor_id: str) -> dict:
    giveaway = one(db().table("commerce_giveaways").select("*").eq("id", giveaway_id).maybe_single().execute())
    if not giveaway:
        raise LookupError("Giveaway not found.")
    if giveaway["status"] != "open":
        raise ValueError("Only an open giveaway can be drawn.")
    if ranking.parse_time(giveaway["ends_at"]) > now_utc():
        raise ValueError("The giveaway is still running. Draw it after it ends.")
    entries = [str(r["member_id"]) for r in rows(db().table("commerce_giveaway_entries").select("member_id")
                                                 .eq("giveaway_id", giveaway_id).execute())]
    seed = secrets.token_hex(16)
    winners = draw_order(seed, entries)[: int(giveaway["winner_count"])]
    db().table("commerce_giveaways").update({"status": "drawn", "draw_seed": seed, "drawn_at": iso(now_utc()),
                                             "drawn_by": actor_id, "updated_at": iso(now_utc())}).eq("id", giveaway_id).execute()
    product = None
    if giveaway.get("prize_product_id"):
        product = one(db().table("directory_products").select("id,shopify_product_id,source")
                      .eq("id", giveaway["prize_product_id"]).maybe_single().execute())
    results = []
    for rank, member_id in enumerate(winners, start=1):
        code, discount_id, error = None, None, None
        if product and product.get("source") == "shopify" and shopify.admin_configured():
            code = "WIN-" + secrets.token_hex(4).upper()
            try:
                discount_id = shopify.create_discount(
                    title=f"Giveaway prize: {giveaway['title']}"[:255], discount_type="percentage", value=100,
                    product_gids=[product["shopify_product_id"]], starts_at=iso(now_utc()),
                    ends_at=iso(now_utc() + timedelta(days=60)), code=code, usage_limit=1)
            except Exception as exc:
                code, error = None, str(exc)[:500]
        db().table("commerce_giveaway_winners").insert({"giveaway_id": giveaway_id, "member_id": member_id, "rank": rank,
                                                        "prize_code": code, "shopify_discount_id": discount_id,
                                                        "prize_error": error}).execute()
        prize = f" Your prize code is {code}; use it at checkout within 60 days." if code else \
            " The FayFort team will contact you about your prize."
        queue_email(member_id, category="notifications", template="commerce_giveaway_won",
                    title=f"You won: {giveaway['title']}",
                    body=f"Congratulations! You won {giveaway['prize_text']}.{prize}", href="/member/chat")
        results.append({"member_id": member_id, "rank": rank, "prize_code": code, "prize_error": error})
    return {"seed": seed, "entries": len(entries), "winners": results}
