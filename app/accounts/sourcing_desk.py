"""The Sourcing and Fulfillment desks (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R4).

- money_states: where a sourcing request is with money (deposit asked, option chosen, invoice sent), for the strip.
- trends / start_pool: what members keep sharing ("37 want this") and turning one into a group buy.
- deposits_due: requests whose member's plan needs a deposit and none has been asked for yet.
- catalog_search: is it already in the store or the sourcing catalog?
- shop_orders: paid shop orders still to pack, with their work items.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

LIVE_INVOICE = ("draft", "sent")
DONE_STAGES = ("purchase_confirmed", "item_in_warehouse", "in_transit", "out_for_delivery", "delivered", "cancelled")
TREND_FIELDS = ("id,canonical_url,platform,title,image_url,site_name,status,pool_target,pool_price,pool_currency,"
                "pool_deadline,share_count,want_count,last_shared_at,linked_product_id")


def _rows(result) -> list[dict]:
    return list((result.data if result is not None else None) or [])


def money_states(client, request_ids: Iterable[str]) -> dict[str, str]:
    """For each sourcing request: "invoice" (order invoice sent, unpaid), "chosen" (the member picked an option, no
    invoice yet) or "deposit" (deposit invoice sent, unpaid). Requests with none of these are left out."""
    ids = list(dict.fromkeys(str(value) for value in request_ids if value))
    if not ids:
        return {}
    states: dict[str, str] = {}
    invoices = _rows(client.table("commerce_invoices").select("request_id,kind,status").in_("request_id", ids)
                     .limit(2000).execute())
    order_live = {str(row["request_id"]) for row in invoices
                  if (row.get("kind") or "order") == "order" and row.get("status") in LIVE_INVOICE}
    order_any = {str(row["request_id"]) for row in invoices
                 if (row.get("kind") or "order") == "order" and row.get("status") in ("draft", "sent", "paid")}
    deposit_live = {str(row["request_id"]) for row in invoices
                    if row.get("kind") == "deposit" and row.get("status") in LIVE_INVOICE}
    chosen = {str(row["request_id"]) for row in _rows(
        client.table("operations_sourcing_member_options").select("request_id,status").in_("request_id", ids)
        .eq("status", "selected").limit(2000).execute())}
    for request_id in ids:
        if request_id in order_live:
            states[request_id] = "invoice"
        elif request_id in chosen and request_id not in order_any:
            states[request_id] = "chosen"
        elif request_id in deposit_live:
            states[request_id] = "deposit"
    return states


def trends(client, limit: int = 12) -> list[dict]:
    """Shared links members want, most wanted first, with pool progress."""
    found = _rows(client.table("commerce_trend_items").select(TREND_FIELDS).in_("status", ["open", "pooling", "sourcing"])
                  .order("last_shared_at", desc=True).limit(300).execute())
    found.sort(key=lambda row: -(int(row.get("want_count") or 0) * 2 + int(row.get("share_count") or 0)))
    out = []
    for row in found[:limit]:
        wants, target = int(row.get("want_count") or 0), row.get("pool_target")
        out.append({
            "id": str(row["id"]), "title": row.get("title") or row.get("site_name") or row.get("canonical_url"),
            "url": row.get("canonical_url"), "platform": row.get("platform"), "image_url": row.get("image_url"),
            "status": row.get("status"), "want_count": wants, "share_count": int(row.get("share_count") or 0),
            "pool": ({"target": target, "price": float(row["pool_price"]) if row.get("pool_price") else None,
                      "currency": row.get("pool_currency"), "deadline": row.get("pool_deadline"),
                      "progress": min(1.0, wants / target) if target else None}
                     if row.get("status") in ("pooling", "sourcing") and target else None),
            "ready": bool(row.get("status") == "pooling" and target and wants >= int(target)),
            "in_store": bool(row.get("linked_product_id")),
        })
    return out


def start_pool(client, trend_id: str, *, target: int, price: float, currency: str, deadline: str | None,
               note: str | None, actor_id: str) -> dict:
    """Turn a shared link into a group buy: members who want it see the group price and join."""
    found = _rows(client.table("commerce_trend_items").select("id,status").eq("id", trend_id).limit(1).execute())
    if not found:
        raise LookupError("That trend is no longer there.")
    if found[0].get("status") not in ("open", "pooling"):
        raise ValueError("Only an open trend can become a group buy.")
    values = {"status": "pooling", "pool_target": target, "pool_price": round(float(price), 2), "pool_currency": currency,
              "pool_deadline": deadline, "pool_note": note, "updated_at": datetime.now(timezone.utc).isoformat()}
    client.table("commerce_trend_items").update(values).eq("id", trend_id).execute()
    from app.commerce.db import audit
    audit(actor_id, "trend_pool_started", {"trend_id": trend_id, "target": target, "price": values["pool_price"],
                                           "currency": currency, "from": "operations"})
    return {"id": trend_id, **values}


def deposits_due(client, deposit_terms, limit: int = 30) -> list[dict]:
    """Live sourcing requests whose member owes a deposit by their plan and hasn't been asked for one yet."""
    items = _rows(client.table("operations_work_items").select("id,member_request_id,summary,assigned_worker_id,due_at")
                  .eq("department", "sourcing").in_("status", ["open", "claimed", "waiting", "blocked"])
                  .limit(500).execute())
    by_request = {str(item["member_request_id"]): item for item in items if item.get("member_request_id")}
    if not by_request:
        return []
    ids = list(by_request)
    invoiced = {str(row["request_id"]) for row in _rows(
        client.table("commerce_invoices").select("request_id,status").in_("request_id", ids)
        .in_("status", ["draft", "sent", "paid"]).limit(2000).execute())}
    requests = _rows(client.table("member_purchase_requests").select(
        "id,member_id,request_title,expected_total,expected_currency,created_at").in_("id", ids).limit(500).execute())
    from app.accounts.desks import latest_request_stages
    stages = latest_request_stages(client, ids)
    terms_cache: dict[str, dict] = {}
    due = []
    for request in sorted(requests, key=lambda row: str(row.get("created_at") or "")):
        request_id = str(request["id"])
        if request_id in invoiced or stages.get(request_id) in DONE_STAGES:
            continue
        member = str(request["member_id"])
        if member not in terms_cache:
            try:
                terms_cache[member] = deposit_terms(member)
            except Exception:
                terms_cache[member] = {"tier": None, "rate": None, "reason": "unknown"}
        terms = terms_cache[member]
        if terms.get("rate") == 0:
            continue  # Pro in good standing: no deposit
        expected = float(request["expected_total"]) if request.get("expected_total") else None
        item = by_request[request_id]
        due.append({"request_id": request_id, "work_item_id": str(item["id"]), "title": request.get("request_title"),
                    "stage": stages.get(request_id) or "submitted", "tier": terms.get("tier"), "rate": terms.get("rate"),
                    "expected_total": expected, "currency": request.get("expected_currency"),
                    "suggested_deposit": round(expected * terms["rate"], 2) if expected and terms.get("rate") else None,
                    "claimed": bool(item.get("assigned_worker_id"))})
        if len(due) >= limit:
            break
    return due


def catalog_search(client, query: str, limit: int = 12) -> list[dict]:
    """Products in the store and the sourcing catalog whose name has every search word."""
    words = [word for word in (query or "").replace("%", " ").replace("_", " ").split() if len(word) > 1][:5]
    if not words:
        return []
    request = (client.table("directory_products").select(
        "id,name,source,price_min,price_max,currency,min_order,lead_time_min_days,lead_time_max_days,in_stock,media_url,"
        "online_store_url").eq("active", True))
    for word in words:
        request = request.ilike("name", f"%{word}%")
    found = _rows(request.limit(limit).execute())
    return [{**row, "where": "Store" if row.get("source") == "shopify" else "Sourcing catalog"} for row in found]


def shop_orders(client, limit: int = 30) -> dict:
    """Paid shop orders still to pack (oldest first) with their Fulfillment work items, and what shipped this week."""
    orders = _rows(client.table("commerce_orders").select(
        "id,shopify_order_id,order_name,financial_status,fulfillment_status,cancelled_at,total,currency,line_items,"
        "tracking,placed_at").order("placed_at", desc=True).limit(300).execute())
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    to_pack = [order for order in orders if not order.get("cancelled_at") and order.get("financial_status") == "paid"
               and order.get("fulfillment_status") in (None, "", "unfulfilled", "partial")]
    shipped_week = sum(1 for order in orders if order.get("fulfillment_status") == "fulfilled"
                       and str(order.get("placed_at") or "") >= week_ago)
    items = {}
    shopify_ids = [str(order["shopify_order_id"]) for order in to_pack if order.get("shopify_order_id")]
    if shopify_ids:
        for item in _rows(client.table("operations_work_items").select("id,status,assigned_worker_id,metadata")
                          .eq("work_type", "store_order").limit(500).execute()):
            source = str((item.get("metadata") or {}).get("source_id") or "")
            if source in shopify_ids:
                items[source] = item
    rows = []
    for order in sorted(to_pack, key=lambda row: str(row.get("placed_at") or ""))[:limit]:
        item = items.get(str(order.get("shopify_order_id") or ""))
        lines = order.get("line_items") or []
        rows.append({"id": order["id"], "order_name": order.get("order_name"), "total": order.get("total"),
                     "currency": order.get("currency"), "placed_at": order.get("placed_at"),
                     "fulfillment_status": order.get("fulfillment_status") or "unfulfilled",
                     "units": sum(int(line.get("quantity") or 1) for line in lines if isinstance(line, dict)),
                     "work_item_id": str(item["id"]) if item else None,
                     "claimed": bool(item and item.get("assigned_worker_id"))})
    return {"to_pack": rows, "to_pack_count": len(to_pack), "shipped_this_week": shipped_week}
