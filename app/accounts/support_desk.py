"""The Member support and Disputes desks (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R5).

- support_overview: invoices that failed or sit unpaid, and giveaways running or waiting to be drawn.
- case_file: everything about a dispute in one place: the member, the order, the payments and the chat.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

UNPAID_DAYS = 3


def _rows(result) -> list[dict]:
    return list((result.data if result is not None else None) or [])


def _one(result) -> dict | None:
    data = result.data if result is not None else None
    if isinstance(data, list):
        return data[0] if data else None
    return data


def _names(client, member_ids: list[str]) -> dict[str, str]:
    ids = list(dict.fromkeys(str(value) for value in member_ids if value))
    if not ids:
        return {}
    return {str(row["user_id"]): row.get("display_name") or "Member"
            for row in _rows(client.table("member_profiles").select("user_id,display_name").in_("user_id", ids).execute())}


def _work_items_by_source(client, kind: str, ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    found = {}
    for item in _rows(client.table("operations_work_items").select("id,metadata,status")
                      .in_("status", ["open", "claimed", "waiting", "blocked"]).limit(1000).execute()):
        meta = item.get("metadata") or {}
        if meta.get("source_kind") == kind and str(meta.get("source_id")) in ids:
            found[str(meta["source_id"])] = str(item["id"])
    return found


def support_overview(client, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    invoices = _rows(client.table("commerce_invoices").select(
        "id,member_id,request_id,title,amount,currency,status,kind,error,created_at,sent_at")
        .in_("status", ["failed", "sent"]).order("created_at", desc=True).limit(300).execute())
    stale = (now - timedelta(days=UNPAID_DAYS)).isoformat()
    failed = [row for row in invoices if row.get("status") == "failed"]
    unpaid = [row for row in invoices if row.get("status") == "sent" and str(row.get("sent_at") or row.get("created_at") or "") < stale]
    names = _names(client, [row.get("member_id") for row in failed + unpaid])
    items = _work_items_by_source(client, "invoice", [str(row["id"]) for row in failed])

    def view(row: dict) -> dict:
        return {"id": row["id"], "member_name": names.get(str(row.get("member_id")), "Member"), "title": row.get("title"),
                "amount": row.get("amount"), "currency": row.get("currency"), "status": row.get("status"),
                "kind": row.get("kind") or "order", "error": row.get("error"), "sent_at": row.get("sent_at") or row.get("created_at"),
                "work_item_id": items.get(str(row["id"]))}

    giveaways = _rows(client.table("commerce_giveaways").select("id,title,prize_text,ends_at,winner_count,status")
                      .in_("status", ["open"]).order("ends_at").limit(50).execute())
    ended = [row for row in giveaways if str(row.get("ends_at") or "") <= now.isoformat()]
    running = [row for row in giveaways if row not in ended]
    entries: dict[str, int] = {}
    ids = [str(row["id"]) for row in giveaways]
    if ids:
        for entry in _rows(client.table("commerce_giveaway_entries").select("giveaway_id").in_("giveaway_id", ids).limit(20000).execute()):
            key = str(entry.get("giveaway_id"))
            entries[key] = entries.get(key, 0) + 1
    draw_items = _work_items_by_source(client, "giveaway", [str(row["id"]) for row in ended])

    def giveaway(row: dict) -> dict:
        return {"id": row["id"], "title": row.get("title"), "prize": row.get("prize_text"), "ends_at": row.get("ends_at"),
                "winners": row.get("winner_count"), "entries": entries.get(str(row["id"]), 0),
                "work_item_id": draw_items.get(str(row["id"]))}

    return {"failed_invoices": [view(row) for row in failed[:10]], "unpaid_invoices": [view(row) for row in unpaid[:10]],
            "unpaid_days": UNPAID_DAYS, "giveaways_to_draw": [giveaway(row) for row in ended],
            "giveaways_running": [giveaway(row) for row in running]}


def _chat(client, conversation_id: str | None, limit: int = 30) -> dict | None:
    if not conversation_id:
        return None
    conversation = _one(client.table("member_conversations").select("id,title").eq("id", conversation_id).limit(1).execute())
    if not conversation:
        return None
    messages = _rows(client.table("member_messages").select("id,sender_type,content,created_at")
                     .eq("conversation_id", conversation_id).order("created_at", desc=True).limit(limit).execute())
    return {"id": conversation["id"], "title": conversation.get("title"),
            "messages": sorted(messages, key=lambda row: str(row.get("created_at") or ""))}


def case_file(client, item: dict, *, can_see_chat: bool) -> dict | None:
    """The dispute's case file, or None for items that aren't disputes."""
    from app.accounts.conversation_desk import member_card
    from app.accounts.desks import latest_request_stages
    from app.accounts.operations_flow import shopify_admin_order_url
    meta = item.get("metadata") or {}
    if meta.get("source_kind") == "stripe_dispute":
        dispute = _one(client.table("billing_disputes").select(
            "stripe_dispute_id,amount,currency,reason,status,evidence_due_by,stripe_invoice_id,member_id,created_at")
            .eq("stripe_dispute_id", str(meta.get("source_id") or "")).limit(1).execute()) or {}
        member_id = str(dispute.get("member_id") or meta.get("member_id") or "")
        payments = _rows(client.table("member_subscription_payments").select("plan,amount,currency,paid_at,months,stripe_invoice_id")
                         .eq("member_id", member_id).order("paid_at", desc=True).limit(6).execute()) if member_id else []
        chats = _rows(client.table("member_conversations").select("id").eq("member_id", member_id)
                      .order("last_activity_at", desc=True).limit(1).execute()) if member_id else []
        return {
            "kind": "card_dispute",
            "member": member_card(client, member_id) if member_id else None,
            "order": None,
            "dispute": {"amount": dispute.get("amount"), "currency": str(dispute.get("currency") or "").upper(),
                        "reason": dispute.get("reason"), "status": dispute.get("status"),
                        "evidence_due_by": dispute.get("evidence_due_by"), "opened_at": dispute.get("created_at")},
            "payments": [{"title": f"{str(row.get('plan') or 'membership').capitalize()} plan"
                                   f"{' · ' + str(row['months']) + ' months' if row.get('months') and int(row['months']) > 1 else ''}",
                          "kind": "membership", "amount": row.get("amount"), "currency": str(row.get("currency") or "").upper(),
                          "status": "paid", "paid_at": row.get("paid_at"),
                          "disputed": bool(dispute.get("stripe_invoice_id") and row.get("stripe_invoice_id") == dispute.get("stripe_invoice_id"))}
                         for row in payments],
            "links": [{"label": "Answer it in Stripe", "url": meta.get("stripe_link")}] if meta.get("stripe_link") else [],
            "chat": _chat(client, str(chats[0]["id"])) if chats and can_see_chat else None,
            "chat_locked": bool(chats) and not can_see_chat,
        }
    request_id = item.get("member_request_id")
    if not request_id and item.get("dispute_case_id"):
        case = _one(client.table("operations_dispute_cases").select("member_request_id")
                    .eq("id", str(item["dispute_case_id"])).limit(1).execute())
        request_id = (case or {}).get("member_request_id")
    if not request_id:
        return None
    request = _one(client.table("member_purchase_requests").select(
        "id,member_id,request_title,request_description,eta_at,created_at").eq("id", str(request_id)).limit(1).execute())
    if not request:
        return None
    events = _rows(client.table("member_request_events").select("stage,member_note,created_at,sequence_no")
                   .eq("request_id", str(request_id)).order("sequence_no").limit(50).execute())
    option = _one(client.table("operations_sourcing_member_options").select("product_name,price_amount,currency,product_url,selected_at")
                  .eq("request_id", str(request_id)).eq("status", "selected").limit(1).execute())
    invoices = _rows(client.table("commerce_invoices").select(
        "id,title,kind,amount,currency,status,sent_at,paid_at,shopify_order_id,created_at")
        .eq("request_id", str(request_id)).order("created_at").limit(20).execute())
    chat = _one(client.table("member_conversations").select("id").eq("linked_request_id", str(request_id)).limit(1).execute())
    links = []
    for invoice in invoices:
        if invoice.get("shopify_order_id"):
            url = shopify_admin_order_url(str(invoice["shopify_order_id"]))
            if url:
                links.append({"label": f"Open the {invoice.get('kind') or 'order'} payment in Shopify", "url": url})
    return {
        "kind": "order_dispute",
        "member": member_card(client, str(request["member_id"])),
        "order": {"title": request.get("request_title"), "description": request.get("request_description"),
                  "stage": latest_request_stages(client, [str(request_id)]).get(str(request_id)),
                  "eta_at": request.get("eta_at"), "requested_at": request.get("created_at"),
                  "chosen": option,
                  "timeline": [{"stage": row.get("stage"), "note": row.get("member_note"), "at": row.get("created_at")}
                               for row in sorted(events, key=lambda row: int(row.get("sequence_no") or 0))[-8:]]},
        "dispute": None,
        "payments": [{"title": invoice.get("title"), "kind": invoice.get("kind") or "order", "amount": invoice.get("amount"),
                      "currency": invoice.get("currency"), "status": invoice.get("status"),
                      "paid_at": invoice.get("paid_at"), "sent_at": invoice.get("sent_at")} for invoice in invoices],
        "links": links,
        "chat": _chat(client, str(chat["id"])) if chat and can_see_chat else None,
        "chat_locked": bool(chat) and not can_see_chat,
    }
