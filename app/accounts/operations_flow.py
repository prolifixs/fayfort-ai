"""Operations flow (docs/OPERATIONS_CENTER_PLAN.md).

Work items for things that happen outside a member request or conversation, so nothing a member does is left
without an owner:

- store_order       a member paid for in-stock items in the shop; staff pack and ship (Fulfillment)
- group_buy         a group-buy pool reached its target; staff confirm the price and invoice everyone (Sourcing)
- giveaway_draw     a giveaway ended; someone draws the winners (Member support)
- giveaway_prize    a winner whose prize can't be claimed with a code; staff arrange it (Member support)
- photo_review      a member asked a person to look at a photo (Member support)
- billing_issue     Stripe is retrying a member's subscription payment (Member support)
- invoice_failed    a Shopify invoice could not be sent (Member support)
- invoice_void      a member cancelled, but Shopify wouldn't delete the unpaid invoice; staff delete it (Member support)

Each one is keyed by metadata.source_kind + metadata.source_id (unique), opens itself when the event happens and
closes itself when the outside event finishes (order fulfilled, pool paid, payment recovered...). A background
sweep picks up the time-based ones (ended giveaways, failing subscriptions, pools that filled up).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)
ACTIVE = ("open", "claimed", "waiting", "blocked")
SWEEP_SECONDS = 600


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------------------------
# Work items and their history
# ---------------------------------------------------------------------------------------------
def find_item(source_kind: str, source_id: str) -> dict | None:
    return one(db().table("operations_work_items").select("*")
               .eq("metadata->>source_kind", source_kind).eq("metadata->>source_id", str(source_id))
               .limit(1).execute())


def add_event(item: dict, event_type: str, reason: str, *, next_status: str | None = None,
              details: dict | None = None, actor_user_id: str | None = None, actor_type: str = "system") -> None:
    """Append an entry to the item's work history (shown in the Operations Center). System entries have no user."""
    try:
        last = one(db().table("operations_work_events").select("sequence_no").eq("work_item_id", item["id"])
                   .order("sequence_no", desc=True).limit(1).execute())
        db().table("operations_work_events").insert({
            "work_item_id": item["id"], "sequence_no": int((last or {}).get("sequence_no") or 0) + 1,
            "event_type": event_type, "actor_type": actor_type if actor_user_id else "system",
            "actor_user_id": str(actor_user_id) if actor_user_id else None,
            "previous_department": item.get("department"), "next_department": item.get("department"),
            "previous_status": item.get("status"), "next_status": next_status or item.get("status"),
            "reason": reason[:1000], "details": details or {},
        }).execute()
    except Exception:
        logger.exception("Could not record an operations history entry")


def ensure_item(*, source_kind: str, source_id: str, department: str, work_type: str, summary: str,
                next_action: str, priority: str = "normal", metadata: dict | None = None,
                due_at: str | None = None) -> dict | None:
    """Open the work item for an outside event once. Returns the existing item when it is already there."""
    existing = find_item(source_kind, source_id)
    if existing:
        return existing
    values = {
        "department": department, "work_type": work_type, "status": "open", "priority": priority,
        "summary": summary.strip()[:240] or work_type, "next_action": next_action.strip()[:500] or "Review this item.",
        "metadata": {**(metadata or {}), "source_kind": source_kind, "source_id": str(source_id)},
        "due_at": due_at,
    }
    try:
        item = one(db().table("operations_work_items").insert(values).execute())
    except Exception as exc:
        if "duplicate" in str(exc).casefold() or "unique" in str(exc).casefold():
            return find_item(source_kind, source_id)
        logger.exception("Could not open a %s work item", work_type)
        return None
    if item:
        add_event(item, "created", f"Opened automatically: {summary[:200]}")
    return item


def close_item(source_kind: str, source_id: str, *, status: str = "completed", reason: str) -> dict | None:
    """Finish the work item for an outside event (when it is still active)."""
    item = find_item(source_kind, source_id)
    if not item or item.get("status") not in ACTIVE:
        return item
    values = {"status": status, "completed_at": now_iso(), "assigned_worker_id": item.get("assigned_worker_id"),
              "claimed_until": None, "waiting_on": None, "waiting_reason": None, "updated_at": now_iso(),
              "version": int(item.get("version") or 1) + 1}
    db().table("operations_work_items").update(values).eq("id", item["id"]).execute()
    add_event(item, "completed" if status == "completed" else "cancelled", reason, next_status=status)
    return {**item, **values}


def note_on_request_item(request_id: str, next_action: str, reason: str, *, reopen: bool = True) -> None:
    """Tell whoever works a sourcing request that something happened (member chose an option, a payment arrived)."""
    item = one(db().table("operations_work_items").select("*").eq("member_request_id", str(request_id))
               .limit(1).execute())
    if not item:
        return
    values: dict[str, Any] = {"next_action": next_action[:500], "updated_at": now_iso(),
                              "version": int(item.get("version") or 1) + 1}
    new_status = item.get("status")
    if reopen and item.get("status") == "waiting":
        new_status = "open"
        values.update({"status": "open", "waiting_on": None, "waiting_reason": None,
                       "assigned_worker_id": None, "claimed_until": None})
    db().table("operations_work_items").update(values).eq("id", item["id"]).execute()
    add_event(item, "status_changed", reason, next_status=new_status)


# ---------------------------------------------------------------------------------------------
# Shop orders (in-stock items bought through the Shopify checkout)
# ---------------------------------------------------------------------------------------------
def shopify_admin_order_url(shopify_order_id: str | None) -> str | None:
    from app.commerce import shopify
    numeric = str(shopify_order_id or "").rsplit("/", 1)[-1]
    try:
        domain = shopify.shop_domain()
    except Exception:
        domain = ""
    return f"https://{domain}/admin/orders/{numeric}" if domain and numeric.isdigit() else None


def sync_store_order(order: dict) -> None:
    """Called after every Shopify order webhook. Paid shop orders become packing work; fulfilled or cancelled
    orders close it."""
    if order.get("source") != "storefront" or not order.get("shopify_order_id"):
        return
    source_id = str(order["shopify_order_id"])
    if order.get("cancelled_at") or order.get("financial_status") in ("refunded", "voided"):
        close_item("shopify_order", source_id, status="cancelled", reason="The order was cancelled or refunded in Shopify.")
        return
    if order.get("fulfillment_status") == "fulfilled":
        close_item("shopify_order", source_id, reason="Shopify marked the order fulfilled.")
        return
    if order.get("financial_status") != "paid":
        return
    lines = order.get("line_items") or []
    count = sum(int(line.get("quantity") or 1) for line in lines) or len(lines)
    name = order.get("order_name") or "Shop order"
    ensure_item(
        source_kind="shopify_order", source_id=source_id, department="fulfillment", work_type="store_order",
        summary=f"Pack and ship {name} · {count} item{'s' if count != 1 else ''}",
        next_action="Pick and pack the items, then mark the order fulfilled in Shopify with the tracking number.",
        priority="high",
        metadata={"order_name": name, "member_id": order.get("member_id"), "line_items": lines[:20],
                  "total": order.get("total"), "currency": order.get("currency"),
                  "admin_url": shopify_admin_order_url(source_id), "status_url": order.get("status_url")},
    )


# ---------------------------------------------------------------------------------------------
# Group buys (Find It pools)
# ---------------------------------------------------------------------------------------------
def sync_group_buy(trend: dict) -> None:
    """A pool that reached its target becomes one Sourcing item; members' own requests wait on it."""
    target = int(trend.get("pool_target") or 0)
    wants = int(trend.get("want_count") or 0)
    if trend.get("status") in ("dismissed", "closed"):
        close_item("trend_pool", str(trend["id"]), status="cancelled", reason="The group buy was closed.")
        return
    if trend.get("status") != "pooling" or not target or wants < target:
        return
    item = ensure_item(
        source_kind="trend_pool", source_id=str(trend["id"]), department="sourcing", work_type="group_buy",
        summary=f"Group buy ready: {(trend.get('title') or 'shared item')[:150]} · {wants} buyers",
        next_action="Confirm the supplier price for the whole group, then send everyone their invoice.",
        priority="high", metadata={"trend_title": trend.get("title"), "pool_target": target},
    )
    if item:
        hold_pool_requests(str(trend["id"]), trend.get("title") or "this group buy")


def hold_pool_requests(trend_id: str, title: str) -> None:
    """Pool buyers' own sourcing requests wait on the group buy so the queue has one item, not one per buyer."""
    members = rows(db().table("commerce_pool_members").select("request_id").eq("trend_item_id", trend_id).execute())
    request_ids = [str(m["request_id"]) for m in members if m.get("request_id")]
    if not request_ids:
        return
    for item in rows(db().table("operations_work_items").select("*").in_("member_request_id", request_ids)
                     .in_("status", ["open", "claimed"]).execute()):
        reason = f"Handled by the group buy for {title[:120]}. Payment of the group invoice moves this request on."
        db().table("operations_work_items").update({
            "status": "waiting", "waiting_on": "internal", "waiting_reason": reason[:1000],
            "assigned_worker_id": None, "claimed_until": None, "updated_at": now_iso(),
            "version": int(item.get("version") or 1) + 1}).eq("id", item["id"]).execute()
        add_event(item, "status_changed", reason, next_status="waiting")


def group_buy_paid_check(trend_id: str) -> None:
    """Close the group buy once every invoice sent for it is paid."""
    invoices = rows(db().table("commerce_invoices").select("status").eq("trend_item_id", trend_id)
                    .in_("status", ["sent", "paid"]).execute())
    if invoices and all(i["status"] == "paid" for i in invoices):
        close_item("trend_pool", trend_id, reason="Every buyer has paid; their requests moved to Fulfillment.")


# ---------------------------------------------------------------------------------------------
# Giveaways
# ---------------------------------------------------------------------------------------------
def sync_giveaways(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    opened = 0
    for giveaway in rows(db().table("commerce_giveaways").select("id,title,ends_at,status")
                         .eq("status", "open").lt("ends_at", now.isoformat()).limit(50).execute()):
        if find_item("giveaway", str(giveaway["id"])):
            continue
        if ensure_item(source_kind="giveaway", source_id=str(giveaway["id"]), department="member_support",
                       work_type="giveaway_draw", summary=f"Draw winners: {giveaway['title'][:180]}",
                       next_action="The giveaway has ended. Draw the winners; they are told by email.",
                       priority="high", metadata={"giveaway_title": giveaway["title"]}):
            opened += 1
    return opened


def after_giveaway_draw(giveaway: dict, winners: list[dict]) -> None:
    close_item("giveaway", str(giveaway["id"]), reason=f"Winners drawn ({len(winners)}).")
    for winner in winners:
        if winner.get("prize_code"):
            continue  # the winner checks out with a 100% code; the shop order becomes packing work
        ensure_item(source_kind="giveaway_winner", source_id=f"{giveaway['id']}:{winner['member_id']}",
                    department="member_support", work_type="giveaway_prize",
                    summary=f"Arrange the prize for a winner of {giveaway.get('title', 'a giveaway')[:150]}",
                    next_action="Contact the winner in their chat, agree delivery, then ship the prize.",
                    priority="high", metadata={"member_id": winner["member_id"], "giveaway_id": str(giveaway["id"]),
                                               "prize_error": winner.get("prize_error")})


# ---------------------------------------------------------------------------------------------
# Photo reviews, billing issues, failed invoices
# ---------------------------------------------------------------------------------------------
def open_photo_review(review: dict) -> None:
    ensure_item(source_kind="photo_review", source_id=str(review["id"]), department="member_support",
                work_type="photo_review", summary="A member asked a person to look at a photo",
                next_action="Look at the photo, then reply in the member's chat with what it is and matching products.",
                priority="normal", metadata={"member_id": review.get("member_id"),
                                             "conversation_id": review.get("conversation_id")})


def sync_billing_issues() -> None:
    past_due = rows(db().table("member_subscriptions").select("member_id,plan,status").eq("status", "past_due")
                    .limit(200).execute())
    due_ids = {str(r["member_id"]) for r in past_due}
    for row in past_due:
        ensure_item(source_kind="subscription_past_due", source_id=str(row["member_id"]),
                    department="member_support", work_type="billing_issue",
                    summary=f"Subscription payment failing ({row.get('plan') or 'plan'})",
                    next_action="Stripe is retrying the card. Message the member to update their card in Plans & billing.",
                    metadata={"member_id": row["member_id"], "plan": row.get("plan")})
    for item in rows(db().table("operations_work_items").select("*").eq("work_type", "billing_issue")
                     .in_("status", list(ACTIVE)).execute()):
        source = str((item.get("metadata") or {}).get("source_id") or "")
        if source and source not in due_ids:
            close_item("subscription_past_due", source, reason="The subscription payment went through.")


def invoice_failed(invoice: dict, error: str) -> None:
    ensure_item(source_kind="invoice", source_id=str(invoice["id"]), department="member_support",
                work_type="invoice_failed", summary=f"Invoice not sent: {str(invoice.get('title') or '')[:180]}",
                next_action="Check the Shopify connection and the member's email, then send the invoice again.",
                priority="high", metadata={"member_id": invoice.get("member_id"), "request_id": invoice.get("request_id"),
                                           "error": error[:300]})


def withdraw_draft_orders(request_id: str, draft_order_ids: list[str]) -> None:
    """After a member cancels: delete the unpaid Shopify invoices so the payment links stop working. If Shopify
    refuses, staff get a work item to delete it by hand (the link could otherwise still be paid)."""
    from app.commerce import shopify
    for draft_id in draft_order_ids:
        try:
            shopify.delete_draft_order(draft_id)
        except Exception as exc:
            logger.warning("Could not delete Shopify draft order %s: %s", draft_id, exc)
            numeric = str(draft_id).rsplit("/", 1)[-1]
            try:
                domain = shopify.shop_domain()
            except Exception:
                domain = ""
            ensure_item(source_kind="invoice_void", source_id=str(draft_id), department="member_support",
                        work_type="invoice_void", summary="Delete a cancelled invoice in Shopify",
                        next_action="The member cancelled. Open the draft order in Shopify and delete it so the link can't be paid.",
                        priority="high",
                        metadata={"request_id": request_id, "error": str(exc)[:300],
                                  "admin_url": f"https://{domain}/admin/draft_orders/{numeric}" if domain and numeric.isdigit() else None})


# ---------------------------------------------------------------------------------------------
# Background sweep
# ---------------------------------------------------------------------------------------------
def _store_team_steps():
    """Store team work that comes from time passing (docs/CATALOG_MERCHANDISING_PLAN.md)."""
    from app.commerce import campaigns, merch_sections, store_team
    return (("map_products", store_team.sync_unmapped_products), ("retire", store_team.sync_retire_candidates),
            ("trend_listings", store_team.sync_trend_listings), ("sections", merch_sections.sync_section_refresh),
            ("campaigns", campaigns.sync_campaigns))


def sweep() -> dict:
    """One pass: group buys, ended giveaways, billing issues and the Store team's timed work. (Recurring orders run
    on pg_cron in the database.)"""
    summary: dict[str, Any] = {}
    for name, step in (("giveaways", sync_giveaways),
                       ("billing", sync_billing_issues), ("group_buys", sweep_group_buys), *_store_team_steps()):
        try:
            summary[name] = step()
        except Exception:
            logger.exception("Operations sweep step %s failed", name)
            summary[name] = "failed"
    return summary


def sweep_group_buys() -> int:
    from app.commerce.service import TREND_FIELDS
    trends = rows(db().table("commerce_trend_items").select(TREND_FIELDS).eq("status", "pooling").limit(200).execute())
    for trend in trends:
        sync_group_buy(trend)
    return len(trends)


async def operations_sweep_loop() -> None:
    await asyncio.sleep(45)
    while True:
        try:
            result = await asyncio.to_thread(sweep)
            logger.info("Operations sweep: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Operations sweep failed; will retry")
        await asyncio.sleep(SWEEP_SECONDS)


# ---------------------------------------------------------------------------------------------
# Operations Center routes for the flow (registered by create_operations_router)
# ---------------------------------------------------------------------------------------------
def source_context(item: dict) -> dict:
    """What a worker needs to see for an item that came from outside a request or conversation."""
    meta = item.get("metadata") or {}
    kind, source_id = meta.get("source_kind"), str(meta.get("source_id") or "")
    detail: dict[str, Any] = {}
    if kind in STORE_TEAM_KINDS:
        return {"source_type": kind, "flow": {"kind": kind, "metadata": meta, **store_team_context(item)}}
    if kind == "shopify_order":
        detail["order"] = one(db().table("commerce_orders").select(
            "id,order_name,member_id,financial_status,fulfillment_status,cancelled_at,total,currency,line_items,"
            "tracking,status_url,placed_at").eq("shopify_order_id", source_id).limit(1).execute())
    elif kind == "trend_pool":
        from app.commerce.service import TREND_FIELDS
        detail["trend"] = one(db().table("commerce_trend_items").select(TREND_FIELDS).eq("id", source_id).limit(1).execute())
        detail["buyers"] = len(rows(db().table("commerce_pool_members").select("member_id")
                                    .eq("trend_item_id", source_id).execute()))
        detail["invoices"] = rows(db().table("commerce_invoices").select("id,member_id,status,amount,currency,sent_at,paid_at")
                                  .eq("trend_item_id", source_id).execute())
    elif kind == "giveaway":
        detail["giveaway"] = one(db().table("commerce_giveaways").select(
            "id,title,prize_text,ends_at,winner_count,status,drawn_at").eq("id", source_id).limit(1).execute())
        detail["entries"] = len(rows(db().table("commerce_giveaway_entries").select("member_id")
                                     .eq("giveaway_id", source_id).execute()))
    elif kind == "giveaway_winner":
        detail["giveaway"] = one(db().table("commerce_giveaways").select("id,title,prize_text")
                                 .eq("id", str(meta.get("giveaway_id"))).limit(1).execute())
    elif kind == "photo_review":
        detail["review"] = one(db().table("member_chat_reviews").select(
            "id,conversation_id,status,assigned_worker_id,created_at").eq("id", source_id).limit(1).execute())
    elif kind == "subscription_past_due":
        detail["subscription"] = one(db().table("member_subscriptions").select(
            "plan,status,current_period_end").eq("member_id", source_id).limit(1).execute())
    elif kind == "invoice":
        detail["invoice"] = one(db().table("commerce_invoices").select(
            "id,title,status,error,amount,currency,request_id,created_at").eq("id", source_id).limit(1).execute())
    member_id = meta.get("member_id")
    if member_id:
        profile = one(db().table("member_profiles").select("display_name").eq("user_id", str(member_id)).limit(1).execute())
        detail["member_name"] = (profile or {}).get("display_name") or "Member"
        if kind != "photo_review":  # the photo review has its own chat view
            chat = member_chat(str(member_id))
            detail["chat"] = {"conversation_id": chat["id"] if chat else None,
                              "messages": chat_messages(chat["id"]) if chat else []}
    return {"source_type": kind, "flow": {"kind": kind, "metadata": meta, **detail}}


STORE_TEAM_KINDS = ("store_listing", "unmapped_product", "retire_product", "merch_section",
                    "campaign_giveaway", "campaign_sale")


def store_team_context(item: dict) -> dict:
    """Details for Store team work items (docs/CATALOG_MERCHANDISING_PLAN.md)."""
    from app.commerce import campaigns, merch_sections, store_team
    meta = item.get("metadata") or {}
    kind = meta.get("source_kind")
    if kind == "store_listing":
        listing = one(db().table("store_listings").select("*").eq("id", str(meta.get("source_id"))).limit(1).execute())
        return {"listing": store_team.listing_view(listing) if listing else None}
    if kind in ("unmapped_product", "retire_product"):
        product = one(db().table("directory_products").select(
            "id,name,source,shopify_product_id,category_ref,price_min,price_max,currency,in_stock,sold_out_since,"
            "media_url,media_type,active,created_at,retired_at").eq("id", str(meta.get("product_id"))).limit(1).execute())
        if product and product.get("shopify_product_id"):
            try:
                from app.commerce import shopify
                product["shopify_admin_url"] = shopify.admin_product_url(product["shopify_product_id"]) if shopify.shop_domain() else None
            except Exception:
                product["shopify_admin_url"] = None
        return {"product": product}
    if kind == "merch_section":
        section = next((s for s in merch_sections.staff_sections() if str(s["id"]) == str(meta.get("section_id"))), None)
        return {"section": section}
    if kind in ("campaign_giveaway", "campaign_sale"):
        return campaigns.campaign_context(item)
    return {}


# ---------------------------------------------------------------------------------------------
# Messaging a member from work that has no chat of its own (prizes, failed payments, invoices)
# ---------------------------------------------------------------------------------------------
def member_chat(member_id: str, *, create: bool = False) -> dict | None:
    """The member's latest general chat (not one tied to a request or on hold). Created when asked to."""
    chat = one(db().table("member_conversations").select("id,title").eq("member_id", member_id)
               .is_("linked_request_id", "null").eq("retention_hold", False)
               .order("last_activity_at", desc=True).limit(1).execute())
    if chat or not create:
        return chat
    return one(db().table("member_conversations").insert({"member_id": member_id, "title": "FayFort team", "retention_hold": False}).execute())


def chat_messages(conversation_id: str, limit: int = 40) -> list[dict]:
    messages = rows(db().table("member_messages").select("id,sender_type,content,created_at")
                    .eq("conversation_id", conversation_id).order("created_at", desc=True).limit(limit).execute())
    return list(reversed(messages))


def send_member_message(item: dict, actor_id: str, actor_type: str, content: str) -> dict:
    """Post a staff message in the member's chat. The member is notified by the existing worker-reply trigger."""
    member_id = (item.get("metadata") or {}).get("member_id")
    if not member_id:
        raise LookupError("This work item has no member to message.")
    chat = member_chat(str(member_id), create=True)
    if not chat:
        raise RuntimeError("The member's chat could not be opened.")
    message = one(db().table("member_messages").insert({
        "conversation_id": chat["id"], "sender_type": "worker", "actor_user_id": actor_id,
        "content": content.strip()[:4000]}).execute())
    add_event(item, "status_changed", "Messaged the member in their chat.", actor_user_id=actor_id, actor_type=actor_type,
              details={"message_id": (message or {}).get("id")})
    return {"conversation_id": chat["id"], "message": message}


def request_payments(request_id: str) -> dict:
    """Invoices, the member's deposit terms and their chosen option, for the sourcing steps."""
    from app.membership import plans
    request = one(db().table("member_purchase_requests").select("id,member_id,expected_total,expected_currency")
                  .eq("id", request_id).limit(1).execute()) or {}
    invoices = rows(db().table("commerce_invoices").select(
        "id,kind,status,amount,currency,deposit_credit,invoice_url,sent_at,paid_at,error,trend_item_id,ship_to")
        .eq("request_id", request_id).order("created_at").execute())
    # Where to deliver: the address the member chose when paying the order invoice (newest first).
    ship_to = next((row.get("ship_to") for row in reversed(invoices)
                    if row.get("kind") == "order" and row.get("ship_to") and row.get("status") in ("sent", "paid")), None)
    option = one(db().table("operations_sourcing_member_options").select("id,product_name,price_amount,currency,selected_at")
                 .eq("request_id", request_id).eq("status", "selected").limit(1).execute())
    terms = None
    if request.get("member_id"):
        try:
            terms = plans.deposit_terms(str(request["member_id"]))
        except Exception:
            logger.exception("Could not work out deposit terms")
    expected = float(request["expected_total"]) if request.get("expected_total") else None
    return {"invoices": invoices, "selected_option": option, "deposit_terms": terms, "ship_to": ship_to,
            "expected_total": expected, "expected_currency": request.get("expected_currency") or "USD",
            "suggested_deposit": round(expected * terms["rate"], 2) if expected and terms else None}
