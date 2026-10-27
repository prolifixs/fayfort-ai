"""Withdrawing and declining unpaid invoices (docs/OPERATIONS_FIXES_PLAN.md, phase B).

Staff withdraw an invoice they sent (wrong amount, the member changed their mind): the Shopify payment link stops
working, the member is told, and staff can send a new one. Members decline a deposit, order or tour invoice they
don't want to pay, with a reason: the link stops working and whoever handles the request is notified, with the work
back in the queue.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

DECLINABLE = ("deposit", "order", "tour")
LABEL = {"deposit": "deposit", "order": "invoice", "tour": "tour quote", "consultation": "consultation invoice",
         "contact_credits": "contact credits invoice"}
LIVE_WORK = ("open", "claimed", "waiting", "blocked")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _live_item(invoice: dict) -> dict | None:
    if not invoice.get("request_id"):
        return None
    return one(db().table("operations_work_items").select("*").eq("member_request_id", str(invoice["request_id"]))
               .in_("status", list(LIVE_WORK)).order("created_at", desc=True).limit(1).execute())


def _notify(recipients: set[str], invoice: dict, item: dict | None, title: str, body: str) -> None:
    href = f"/operations?workItem={item['id']}" if item else "/operations"
    try:
        if recipients:
            db().table("operations_worker_notifications").upsert([
                {"worker_id": r, "work_item_id": item.get("id") if item else None, "notification_type": "quote_declined",
                 "title": title[:160], "body": body[:500], "href": href, "dedupe_key": f"declined:{invoice['id']}:{r}"}
                for r in recipients], on_conflict="dedupe_key", ignore_duplicates=True).execute()
        db().rpc("notify_platform_admins", {"p_notification_type": "quote_declined", "p_work_item_id": item.get("id") if item else None,
                                            "p_title": title[:160], "p_body": body[:500], "p_href": href,
                                            "p_dedupe": f"declined:{invoice['id']}"}).execute()
    except Exception:
        logger.exception("Could not notify the team about a declined invoice")


def _close(invoice: dict, error: str) -> None:
    if invoice.get("status") != "sent":
        raise ValueError("Only an unpaid invoice can be withdrawn or declined.")
    db().table("commerce_invoices").update({"status": "cancelled", "error": error[:500]}) \
        .eq("id", str(invoice["id"])).eq("status", "sent").execute()
    if invoice.get("shopify_draft_order_id"):
        from app.accounts import operations_flow
        operations_flow.withdraw_draft_orders(str(invoice.get("request_id") or ""), [str(invoice["shopify_draft_order_id"])])


def _side_effects(invoice: dict, *, declined: bool, reason: str) -> None:
    """Consultations, tours and booking holds follow their invoice."""
    kind = invoice.get("kind")
    if kind == "consultation":
        consultation = one(db().table("member_consultations").select("id,status,booking_id").eq("invoice_id", str(invoice["id"]))
                           .limit(1).execute())
        if consultation and consultation.get("status") == "awaiting_payment":
            db().table("member_consultations").update({"status": "cancelled", "updated_at": now_iso()}) \
                .eq("id", consultation["id"]).execute()
            if consultation.get("booking_id"):
                from app.bookings import engine
                booking = engine.get(str(consultation["booking_id"]))
                if booking.get("status") == "held":
                    engine.discard(booking, "The consultation invoice was withdrawn.")
    elif kind == "tour":
        tour = one(db().table("member_tour_bookings").select("id,status,conversation_id").eq("invoice_id", str(invoice["id"]))
                   .limit(1).execute())
        if tour and tour.get("status") == "quoted":
            db().table("member_tour_bookings").update({"status": "requested", "invoice_id": None, "quote_amount": None,
                                                       "updated_at": now_iso()}).eq("id", tour["id"]).execute()
            if tour.get("conversation_id"):
                text = (f"You declined the tour quote. {('Your reason: ' + reason) if reason else ''} Our team will reply here."
                        if declined else "We withdrew the tour quote. A new one will follow here.")
                db().table("member_messages").insert({"conversation_id": tour["conversation_id"], "sender_type": "assistant",
                                                      "content": text.strip()}).execute()


def withdraw(invoice_id: str, *, actor_id: str, reason: str) -> dict:
    """Staff withdraw an unpaid invoice."""
    invoice = one(db().table("commerce_invoices").select("*").eq("id", invoice_id).limit(1).execute())
    if not invoice:
        raise LookupError("Invoice not found.")
    _close(invoice, f"Withdrawn by FayFort: {reason.strip() or 'no reason given'}")
    _side_effects(invoice, declined=False, reason=reason)
    if invoice.get("member_id"):
        from app.commerce import service as commerce
        what = LABEL.get(invoice.get("kind"), "invoice")
        commerce.queue_email(str(invoice["member_id"]), category="notifications", template="commerce_invoice_withdrawn",
                             title=f"We withdrew your {what}",
                             body=f"{invoice.get('title') or 'Your invoice'}: the payment link no longer works."
                                  + (f" Reason: {reason.strip()}." if reason.strip() else "") + " We'll send a new one if needed.",
                             href="/member/orders")
    item = _live_item(invoice)
    if item:
        from app.accounts import operations_flow
        operations_flow.add_event(item, "status_changed", f"Invoice withdrawn: {reason.strip() or 'no reason given'}",
                                  actor_user_id=actor_id, actor_type="worker")
    return {**invoice, "status": "cancelled"}


def decline(member_id: str, invoice_id: str, reason: str) -> dict:
    """A member declines an unpaid deposit, order or tour invoice."""
    invoice = one(db().table("commerce_invoices").select("*").eq("id", invoice_id).eq("member_id", member_id).limit(1).execute())
    if not invoice:
        raise LookupError("Invoice not found.")
    if invoice.get("kind") not in DECLINABLE:
        raise ValueError("This invoice can't be declined here.")
    reason = reason.strip()
    _close(invoice, f"Declined by the member: {reason or 'no reason given'}")
    _side_effects(invoice, declined=True, reason=reason)
    item = _live_item(invoice)
    recipients: set[str] = set()
    what = LABEL.get(invoice.get("kind"), "invoice")
    if item:
        from app.accounts import operations_flow
        db().table("operations_work_items").update({
            "status": "open" if item.get("status") == "waiting" else item.get("status"), "waiting_on": None,
            "waiting_reason": None, "updated_at": now_iso(),
            "next_action": f"The member declined the {what}{(': ' + reason) if reason else ''}. Talk to them in the chat, "
                           "then send a new one or close the request.",
        }).eq("id", str(item["id"])).execute()
        operations_flow.add_event(item, "status_changed", f"The member declined the {what}.")
        if item.get("assigned_worker_id"):
            recipients.add(str(item["assigned_worker_id"]))
    _notify(recipients, invoice, item, f"A member declined a {what}",
            f"{invoice.get('title') or 'Invoice'}" + (f": {reason}" if reason else ""))
    return {**invoice, "status": "cancelled"}
