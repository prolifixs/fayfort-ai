"""LANDED owners (owner request, 2026-10-25).

LANDED was sold with Baserow tables (password-protected views) as its live directory. Those close on
30 November 2026 and the directory lives on FayFort. A LANDED owner sees, free, the ADDRESSES of every market
and service provider in the 25 October 2026 snapshot (public.landed_snapshot). Supplier contacts, and records added
after the snapshot, stay behind contact credits like for everyone else.

Who is an owner: public.landed_owners, filled from Shopify orders of the LANDED product (a one-off sync, then the
order webhooks). A member is linked automatically when their confirmed email matches the purchase email, or by
claiming with their order number and purchase email.

Buyers are told by email (notice now, reminder before the close), sent through the email outbox.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

from app.commerce import shopify
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

PRODUCT_HANDLE = "landed"
BASEROW_CLOSES = "30 November 2026"
SNAPSHOT_DATE = "25 October 2026"
# What an owner sees free, per record type: the address only (owner decision, 2026-10-25).
ADDRESS_FIELDS: dict[str, tuple[str, ...]] = {
    "market": ("address_en", "address_cn"),
    "service_provider": ("address_en", "address_cn"),
}
SIGNUP_PATH = "/member/signup?from=landed"
CLAIM_PATH = "/member/chat?panel=tools&tool=directory"
DAILY_SEND_LIMIT = 95  # Resend's free plan allows about 100 emails a day

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CACHE_SECONDS = 300
_owner_cache: dict[str, tuple[float, dict | None]] = {}
_snapshot_cache: dict[str, tuple[float, set[str]]] = {}
_product_cache: dict[str, str | None] = {}


class LandedError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_email(value: Any) -> str | None:
    email = str(value or "").strip().lower()
    return email if _EMAIL.match(email) and len(email) <= 320 else None


def clean_order_name(value: Any) -> str:
    text = re.sub(r"\s+", "", str(value or "")).lstrip("#")
    return f"#{text}" if text else ""


# ---- Shopify ------------------------------------------------------------------------------------------------------
def product_gid() -> str | None:
    """The LANDED product's id in Shopify (looked up once by handle); None if it can't be found."""
    if PRODUCT_HANDLE not in _product_cache:
        found = None
        try:
            data = shopify.admin_graphql("query P($h: String!) { productByHandle(handle: $h) { id } }",
                                         {"h": PRODUCT_HANDLE})
            found = ((data or {}).get("productByHandle") or {}).get("id")
        except Exception:
            logger.warning("LANDED product could not be looked up by handle", exc_info=True)
        _product_cache[PRODUCT_HANDLE] = found
    return _product_cache[PRODUCT_HANDLE]


def is_landed_line(line: dict, landed_gid: str | None) -> bool:
    if landed_gid and line.get("product_id") and shopify.gid("Product", line["product_id"]) == landed_gid:
        return True
    return str(line.get("title") or "").strip().upper().startswith("LANDED")


def record_from_order(order: dict, *, source: str = "shopify_webhook") -> str:
    """Save (or update) a LANDED buyer from a Shopify order. Returns created / updated / refunded / ignored."""
    landed_gid = product_gid()
    if not any(is_landed_line(line, landed_gid) for line in (order.get("line_items") or [])):
        return "ignored"
    email = clean_email(order.get("email") or order.get("contact_email")
                        or ((order.get("customer") or {}).get("email")))
    financial = str(order.get("financial_status") or "").lower()
    if not email or financial not in ("paid", "partially_refunded", "refunded", "voided", "partially_paid"):
        return "ignored"
    refunded = financial in ("refunded", "voided") or bool(order.get("cancelled_at"))
    order_id = shopify.gid("Order", order.get("admin_graphql_api_id") or order.get("id"))
    values = {"email": email, "order_name": str(order.get("name") or "")[:60] or None,
              "purchased_at": order.get("processed_at") or order.get("created_at"),
              "status": "refunded" if refunded else "active", "updated_at": now_iso()}
    previous = one(db().table("landed_owners").select("id,status").eq("shopify_order_id", order_id)
                   .maybe_single().execute())
    if previous:
        db().table("landed_owners").update(values).eq("id", previous["id"]).execute()
        _owner_cache.clear()
        return "refunded" if refunded else "updated"
    if refunded:
        return "ignored"
    db().table("landed_owners").insert({**values, "shopify_order_id": order_id, "source": source}).execute()
    _owner_cache.clear()
    return "created"


def sync_from_shopify(since: str = "2025-01-01T00:00:00Z") -> dict:
    """One-off (and safe to repeat): every Shopify order since a date; LANDED ones become owners."""
    counts = {"orders_scanned": 0, "created": 0, "updated": 0, "refunded": 0, "ignored": 0}
    earliest = None
    for order in shopify.iter_orders(since):
        counts["orders_scanned"] += 1
        created = str(order.get("created_at") or "")
        if created and (earliest is None or created < earliest):
            earliest = created
        counts[record_from_order(order, source="shopify")] += 1
    return {**counts, "earliest_order": earliest, "product_found": bool(product_gid())}


# ---- owners -------------------------------------------------------------------------------------------------------
def _member_email(member_id: str) -> str | None:
    try:
        user = getattr(db().auth.admin.get_user_by_id(member_id), "user", None)
    except Exception:
        logger.warning("Could not read a member's email for LANDED", exc_info=True)
        return None
    if not user or getattr(user, "email_confirmed_at", None) is None:
        return None
    return clean_email(getattr(user, "email", None))


def owner_for(member_id: str, *, fresh: bool = False) -> dict | None:
    """The member's LANDED ownership, linking it by confirmed email the first time. Cached for 5 minutes."""
    hit = _owner_cache.get(member_id)
    if hit and not fresh and time.monotonic() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    found = one(db().table("landed_owners").select("id,order_name,purchased_at,linked_by")
                .eq("member_id", member_id).eq("status", "active").limit(1).execute())
    if not found:
        email = _member_email(member_id)
        if email:
            match = one(db().table("landed_owners").select("id,order_name,purchased_at,member_id")
                        .eq("email", email).eq("status", "active").is_("member_id", "null").limit(1).execute())
            if match:
                db().table("landed_owners").update({"member_id": member_id, "linked_at": now_iso(), "linked_by": "email",
                                                    "updated_at": now_iso()}).eq("email", email) \
                    .is_("member_id", "null").execute()
                found = {**match, "linked_by": "email"}
    _owner_cache[member_id] = (time.monotonic(), found)
    return found


def claim(member_id: str, order_name: str, email: str) -> dict:
    """Link a purchase made with another email: the order number and purchase email must both match."""
    name, address = clean_order_name(order_name), clean_email(email)
    if not name or not address:
        raise LandedError("Enter your order number (like #1001) and the email you bought LANDED with.", 422)
    match = one(db().table("landed_owners").select("id,member_id,status,order_name,purchased_at")
                .eq("order_name", name).eq("email", address).limit(1).execute())
    if not match or match.get("status") != "active":
        raise LandedError("We couldn't find a LANDED order with that number and email. Check both, or write to "
                          "support@fayfort.com.", 404)
    if match.get("member_id") and str(match["member_id"]) != member_id:
        raise LandedError("That order is already linked to another FayFort account. Write to support@fayfort.com "
                          "and we'll sort it out.", 409)
    if not match.get("member_id"):
        db().table("landed_owners").update({"member_id": member_id, "linked_at": now_iso(), "linked_by": "claim",
                                            "updated_at": now_iso()}).eq("id", match["id"]).execute()
    _owner_cache.pop(member_id, None)
    return status(member_id)


def status(member_id: str) -> dict:
    owner = owner_for(member_id, fresh=True)
    return {"owner": bool(owner), "order_name": (owner or {}).get("order_name"),
            "snapshot_date": SNAPSHOT_DATE, "baserow_closes": BASEROW_CLOSES,
            "includes": "The address of every market and service provider in the LANDED directory. "
                        "Supplier contacts and entries added later use contact credits."}


def snapshot_keys(record_type: str) -> set[str]:
    hit = _snapshot_cache.get(record_type)
    if hit and time.monotonic() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    keys = {str(r["source_key"]) for r in rows(db().table("landed_snapshot").select("source_key")
                                                 .eq("record_type", record_type).limit(10000).execute())}
    _snapshot_cache[record_type] = (time.monotonic(), keys)
    return keys


def free_addresses(member_id: str, record_type: str, records: list[dict]) -> set[str]:
    """Ids of the records whose address this member sees free as a LANDED owner."""
    if record_type not in ADDRESS_FIELDS or not records or not owner_for(member_id):
        return set()
    keys = snapshot_keys(record_type)
    return {str(r["id"]) for r in records if str(r.get("source_key") or "") in keys}


# ---- buyer emails -------------------------------------------------------------------------------------------------
def render_notice(kind: str, *, order_name: str | None, app_url: str):
    from app.mailer.render import RenderedEmail, _paragraph, shell

    signup = app_url.rstrip("/") + SIGNUP_PATH
    order = f" (order {order_name})" if order_name else ""
    if kind == "reminder":
        subject = "Reminder: your LANDED directory moves to FayFort on 30 November"
        heading = "Your LANDED directory moves on 30 November"
        parts = [
            f"A reminder that the Baserow tables that came with LANDED stop working on {BASEROW_CLOSES}.",
            "The same directory is on FayFort now, kept up to date there. Create a free FayFort account with the email "
            "you bought LANDED with and every address from your directory is unlocked for you, at no cost.",
            f"Bought with a different email? After signing up, open Tools, then Supplier directory, and claim your access "
            f"with your order number{order}.",
        ]
    else:
        subject = "Your LANDED directory is moving to FayFort"
        heading = "Your LANDED directory is moving to FayFort"
        parts = [
            "Thank you for buying LANDED. The live directory that came with your book is moving from the Baserow tables "
            "to FayFort, our own website.",
            "FayFort has the same markets, service providers, hotels and restaurants you have in Baserow today, and it's "
            "where corrections and new entries are published from now on.",
            f"The Baserow tables and their passwords stop working on {BASEROW_CLOSES}.",
            "What to do: create a free FayFort account with the email you bought LANDED with. Every address from your "
            "LANDED directory is unlocked for you automatically, at no cost.",
            f"Bought with a different email? After signing up, open Tools, then Supplier directory, and claim your access "
            f"with your order number{order}.",
        ]
    button = "Create my FayFort account"
    footer = f"You're getting this because you bought LANDED{order}. Questions? Just reply to this email."
    html_body = shell(heading=heading, intro_html="".join(_paragraph(p) for p in parts), button_label=button,
                      button_url=signup, footer_note=footer, unsubscribe_url=None)
    text = f"{heading}\n\n" + "\n\n".join(parts) + f"\n\n{button}: {signup}\n\n{footer}"
    return RenderedEmail(subject=subject, html=html_body, text=text)


def _recipients(kind: str) -> list[dict]:
    query = db().table("landed_owners").select("id,email,order_name,member_id,notice_sent_at,reminder_sent_at") \
        .eq("status", "active").order("purchased_at")
    found = rows(query.limit(5000).execute())
    if kind == "reminder":
        linked = {r["email"] for r in found if r.get("member_id")}
        found = [r for r in found if r.get("notice_sent_at") and not r.get("reminder_sent_at") and r["email"] not in linked]
    else:
        found = [r for r in found if not r.get("notice_sent_at")]
    by_email: dict[str, dict] = {}
    for row in found:
        entry = by_email.setdefault(row["email"], {"email": row["email"], "order_name": row.get("order_name"), "ids": []})
        entry["ids"].append(row["id"])
    return list(by_email.values())


def send_notices(kind: str, *, app_url: str, dry_run: bool = True, limit: int = DAILY_SEND_LIMIT) -> dict:
    """Queue the notice or reminder for buyers who haven't had it. Dry run returns the count only."""
    if kind not in ("notice", "reminder"):
        raise LandedError("Unknown email.", 422)
    people = _recipients(kind)
    batch = people[:max(0, min(limit, DAILY_SEND_LIMIT))]
    if dry_run:
        return {"kind": kind, "dry_run": True, "waiting": len(people), "would_send": len(batch)}
    column = "reminder_sent_at" if kind == "reminder" else "notice_sent_at"
    for person in batch:
        rendered = render_notice(kind, order_name=person.get("order_name"), app_url=app_url)
        db().table("email_outbox").insert({
            "category": "notifications", "template": f"landed_{kind}", "to_email": person["email"],
            "payload": {"subject": rendered.subject, "html": rendered.html, "text": rendered.text},
        }).execute()
        db().table("landed_owners").update({column: now_iso(), "updated_at": now_iso()}).in_("id", person["ids"]).execute()
    return {"kind": kind, "dry_run": False, "queued": len(batch), "still_waiting": len(people) - len(batch)}


def summary() -> dict:
    found = rows(db().table("landed_owners").select("email,status,member_id,notice_sent_at,reminder_sent_at,purchased_at")
                 .limit(5000).execute())
    active = [r for r in found if r.get("status") == "active"]
    emails = {r["email"] for r in active}
    linked = {r["email"] for r in active if r.get("member_id")}
    return {"buyers": len(emails), "orders": len(active), "signed_up": len(linked),
            "notice_sent": len({r["email"] for r in active if r.get("notice_sent_at")}),
            "reminder_sent": len({r["email"] for r in active if r.get("reminder_sent_at")}),
            "refunded_orders": len(found) - len(active),
            "snapshot": {t: len(snapshot_keys(t)) for t in ADDRESS_FIELDS},
            "baserow_closes": BASEROW_CLOSES, "daily_limit": DAILY_SEND_LIMIT}
