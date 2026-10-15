"""Consultations, contact credits and what happens when their Shopify invoices are paid."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from app.commerce import service as commerce
from app.commerce.db import db, one, rows
from app.membership import plans

logger = logging.getLogger(__name__)

CONSULTATION_FIELDS = "id,topic,plan,price,currency,included,status,invoice_id,conversation_id,created_at,updated_at"
BOOKED_REPLY = ("Your consultation is booked. A FayFort specialist will reply in this chat to agree a time "
                "and go through your questions.")


class MembershipError(Exception):
    """A request the member can fix (shown as-is)."""


# ---------------------------------------------------------------------------------------------
# Consultations
# ---------------------------------------------------------------------------------------------
def list_consultations(member_id: str) -> list[dict]:
    found = rows(db().table("member_consultations").select(CONSULTATION_FIELDS).eq("member_id", member_id)
                 .order("created_at", desc=True).limit(50).execute())
    invoice_ids = [str(c["invoice_id"]) for c in found if c.get("invoice_id")]
    urls = {str(i["id"]): i.get("invoice_url") for i in rows(db().table("commerce_invoices").select("id,invoice_url")
                                                            .in_("id", invoice_ids).execute())} if invoice_ids else {}
    return [{**c, "invoice_url": urls.get(str(c.get("invoice_id")))} for c in found]


def book_consultation(member_id: str, topic: str) -> dict:
    """Pro's included consultation starts straight away; otherwise the member gets a Shopify invoice and the
    consultation starts when it is paid. One unpaid booking at a time."""
    waiting = [c for c in list_consultations(member_id) if c["status"] == "awaiting_payment"]
    if waiting:
        return {**waiting[0], "existing": True}
    quote = plans.consultation_quote(member_id)
    record = one(db().table("member_consultations").insert({
        "member_id": member_id, "topic": topic.strip()[:1000], "plan": quote["tier"], "price": quote["price"],
        "currency": quote["currency"], "included": quote["included"],
        "status": "awaiting_payment" if quote["price"] > 0 else "requested"}).execute())
    if not record:
        raise RuntimeError("Consultation insert returned no row")
    if quote["price"] <= 0:
        return start_consultation(record)
    try:
        invoice = commerce.send_invoice(member_id=member_id, title="FayFort consultation", amount=quote["price"],
                                        currency=quote["currency"], kind="consultation", requires_shipping=False,
                                        details={"consultation_id": str(record["id"]), "plan": quote["tier"]})
    except Exception:
        db().table("member_consultations").update({"status": "cancelled"}).eq("id", record["id"]).execute()
        raise
    db().table("member_consultations").update({"invoice_id": invoice["id"]}).eq("id", record["id"]).execute()
    return {**record, "invoice_id": invoice["id"], "invoice_url": invoice.get("invoice_url")}


def start_consultation(consultation: dict) -> dict:
    """Open a chat for the consultation and put it in front of the team (Operations, member support)."""
    if consultation.get("conversation_id"):
        return consultation
    member_id = str(consultation["member_id"])
    topic = str(consultation["topic"])
    conversation = one(db().table("member_conversations").insert({
        "member_id": member_id, "title": ("Consultation: " + topic)[:120]}).execute())
    if not conversation:
        raise RuntimeError("Consultation chat insert returned no row")
    db().table("member_messages").insert([
        {"conversation_id": conversation["id"], "sender_type": "member", "content": topic[:8000]},
        {"conversation_id": conversation["id"], "sender_type": "assistant", "content": BOOKED_REPLY},
    ]).execute()
    work = db().rpc("request_member_conversation_support", {"p_member_id": member_id,
                                                            "p_conversation_id": str(conversation["id"])}).execute()
    item = work.data[0] if isinstance(work.data, list) and work.data else work.data
    if isinstance(item, dict) and item.get("id"):
        paid = "included in Pro" if consultation.get("included") else f"paid {consultation.get('price')} {consultation.get('currency')}"
        db().table("operations_work_items").update({
            "work_type": "consultation", "priority": "high",
            "summary": ("Consultation: " + topic)[:240],
            "next_action": f"Consultation booked ({paid}). Reply in the chat to agree a time with the member.",
        }).eq("id", item["id"]).execute()
    values = {"status": "requested", "conversation_id": conversation["id"], "updated_at": plans.now_utc().isoformat()}
    db().table("member_consultations").update(values).eq("id", consultation["id"]).execute()
    from app.membership import ranks
    ranks.safe_recompute(member_id)
    commerce.queue_email(member_id, category="notifications", template="commerce_consultation_booked",
                         title="Your consultation is booked",
                         body="A FayFort specialist will reply in your consultation chat to agree a time.",
                         href=f"/member/chat?conversation={conversation['id']}")
    return {**consultation, **values}


# ---------------------------------------------------------------------------------------------
# Contact credits
# ---------------------------------------------------------------------------------------------
def buy_contact_credits(member_id: str, pack: str) -> dict:
    """Send (or re-use, within a day) an invoice for a contact credit pack."""
    offer = plans.CONTACT_PACKS.get(pack)
    if not offer:
        raise MembershipError("Choose a contact pack.")
    since = (plans.now_utc() - timedelta(days=1)).isoformat()
    open_invoices = rows(db().table("commerce_invoices").select("id,invoice_url,amount,currency,details,status")
                         .eq("member_id", member_id).eq("kind", "contact_credits").eq("status", "sent")
                         .gte("created_at", since).limit(20).execute())
    for invoice in open_invoices:
        if (invoice.get("details") or {}).get("pack") == pack and invoice.get("invoice_url"):
            return {**invoice, "existing": True}
    credits = offer["credits"]
    title = "FayFort supplier contact" if credits == 1 else f"FayFort supplier contacts ({credits})"
    return commerce.send_invoice(member_id=member_id, title=title, amount=offer["price"], currency=plans.CURRENCY,
                                 kind="contact_credits", requires_shipping=False,
                                 details={"pack": pack, "credits": credits})


# ---------------------------------------------------------------------------------------------
# Paid invoices (called from the Shopify order webhook)
# ---------------------------------------------------------------------------------------------
def invoice_paid(invoice: dict) -> None:
    kind = invoice.get("kind")
    details = invoice.get("details") or {}
    member_id = str(invoice.get("member_id") or "")
    try:
        if kind == "contact_credits" and member_id:
            credits = int(details.get("credits") or 0)
            already = rows(db().table("member_contact_credits").select("id").eq("invoice_id", invoice["id"])
                           .eq("reason", "purchase").limit(1).execute())
            if credits > 0 and not already:
                try:
                    db().table("member_contact_credits").insert({"member_id": member_id, "delta": credits,
                                                                 "reason": "purchase", "invoice_id": invoice["id"]}).execute()
                except Exception as exc:  # already credited (unique per invoice)
                    if "duplicate" not in str(exc).casefold() and "unique" not in str(exc).casefold():
                        raise
        elif kind == "consultation":
            consultation = one(db().table("member_consultations").select("*").eq("invoice_id", invoice["id"])
                               .maybe_single().execute())
            if consultation and consultation.get("status") == "awaiting_payment":
                start_consultation(consultation)
    except Exception:
        logger.exception("Could not finish paid %s invoice %s", kind, invoice.get("id"))
