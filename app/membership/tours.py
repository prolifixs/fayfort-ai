"""Tour guide bookings (owner request, 2026-10-20): a FayFort team member meets the member in China as a guide.

First version, kept simple:
  requested  the member sends arrival city, date, days, people and what they need; a chat opens with the team
  quoted     staff send a price as a Shopify invoice (every tour is quoted, there is no fixed day rate)
  confirmed  the invoice is paid; staff name the guide
  completed / cancelled

Pending completion (shared with consultations): picking a date from a live calendar and team availability. Until
then the arrival date is a request that the team confirms in the chat.

Member:  GET  /members/tours                  POST /members/tours
Staff:   GET  /operations/tours?status=...    POST /operations/tours/{id}/quote | /guide | /status
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.commerce import service as commerce
from app.commerce.db import db, one, rows
from app.membership import plans

logger = logging.getLogger(__name__)

CITIES = {"guangzhou": "Guangzhou", "yiwu": "Yiwu", "shenzhen": "Shenzhen", "shanghai": "Shanghai", "other": "Other"}
NEEDS = {
    "canton_fair": "Canton Fair",
    "markets": "Wholesale markets",
    "factories": "Factory visits",
    "interpreting": "Interpreting",
    "airport_pickup": "Airport pickup",
}
FIELDS = ("id,member_id,city,city_other,arrival_date,days,people,needs,hotel_area,whatsapp,notes,status,quote_amount,"
          "currency,invoice_id,conversation_id,work_item_id,guide_name,cancel_reason,created_at,updated_at")
OPEN = ("requested", "quoted", "confirmed")
RECEIVED_REPLY = ("Thanks, we've got your tour guide request. Our team will check the dates and send you a quote in "
                  "this chat. Once it's paid, we confirm your guide here.")


class TourError(ValueError):
    """Something the member or staff can fix (shown as is)."""


class TourRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: Literal["guangzhou", "yiwu", "shenzhen", "shanghai", "other"]
    city_other: str | None = Field(default=None, max_length=80)
    arrival_date: date
    days: int = Field(ge=1, le=30)
    people: int = Field(ge=1, le=50)
    needs: list[Literal["canton_fair", "markets", "factories", "interpreting", "airport_pickup"]] = Field(default_factory=list, max_length=5)
    hotel_area: str | None = Field(default=None, max_length=200)
    whatsapp: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("city_other", "hotel_area", "whatsapp", "notes")
    @classmethod
    def trimmed(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None

    @model_validator(mode="after")
    def check(self):
        today = plans.now_utc().date()
        if self.arrival_date < today:
            raise ValueError("The arrival date can't be in the past.")
        if self.arrival_date > today + timedelta(days=550):
            raise ValueError("Choose an arrival date within the next 18 months.")
        if self.city == "other" and not self.city_other:
            raise ValueError("Tell us which city.")
        self.needs = list(dict.fromkeys(self.needs))
        return self


class QuoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(gt=0, le=100000, max_digits=12, decimal_places=2)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    note: str = Field(default="", max_length=1000)


class GuideInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    guide_name: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=1000)


class StatusInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "cancelled"]
    reason: str = Field(default="", max_length=500)


def city_label(booking: dict) -> str:
    return booking.get("city_other") if booking.get("city") == "other" and booking.get("city_other") else CITIES.get(booking.get("city"), "China")


def summary(booking: dict) -> str:
    arrival = date.fromisoformat(str(booking["arrival_date"])[:10])
    days = int(booking["days"])
    people = int(booking["people"])
    return (f"{city_label(booking)}, from {arrival.day} {arrival.strftime('%b %Y')} for {days} day{'s' if days != 1 else ''}, "
            f"{people} {'people' if people != 1 else 'person'}")


def describe(booking: dict) -> str:
    lines = [f"Tour guide request: {summary(booking)}."]
    if booking.get("needs"):
        lines.append("Needs: " + ", ".join(NEEDS.get(n, n) for n in booking["needs"]) + ".")
    if booking.get("hotel_area"):
        lines.append(f"Staying around: {booking['hotel_area']}.")
    if booking.get("whatsapp"):
        lines.append(f"WhatsApp: {booking['whatsapp']}.")
    if booking.get("notes"):
        lines.append(f"Notes: {booking['notes']}")
    return "\n".join(lines)


def _say(conversation_id: str | None, text: str) -> None:
    if not conversation_id:
        return
    try:
        db().table("member_messages").insert({"conversation_id": conversation_id, "sender_type": "assistant",
                                              "content": text[:8000]}).execute()
    except Exception:
        logger.exception("Could not post a tour booking message")


def _work(booking: dict, values: dict) -> None:
    if not booking.get("work_item_id"):
        return
    try:
        db().table("operations_work_items").update({**values, "updated_at": plans.now_utc().isoformat()}) \
            .eq("id", str(booking["work_item_id"])).execute()
    except Exception:
        logger.exception("Could not update the tour booking work item")


def _update(booking: dict, values: dict) -> dict:
    values = {**values, "updated_at": plans.now_utc().isoformat()}
    db().table("member_tour_bookings").update(values).eq("id", str(booking["id"])).execute()
    return {**booking, **values}


def get(booking_id: str) -> dict:
    found = one(db().table("member_tour_bookings").select(FIELDS).eq("id", str(booking_id)).limit(1).execute())
    if not found:
        raise LookupError("Tour booking not found.")
    return found


def list_for_member(member_id: str) -> list[dict]:
    found = rows(db().table("member_tour_bookings").select(FIELDS).eq("member_id", member_id)
                 .order("created_at", desc=True).limit(50).execute())
    return _with_invoices(found)


def _with_invoices(found: list[dict]) -> list[dict]:
    ids = [str(b["invoice_id"]) for b in found if b.get("invoice_id")]
    invoices = {str(i["id"]): i for i in rows(db().table("commerce_invoices").select("id,invoice_url,status")
                                              .in_("id", ids).execute())} if ids else {}
    return [{**b, "city_label": city_label(b), "summary": summary(b),
             "invoice_url": (invoices.get(str(b.get("invoice_id"))) or {}).get("invoice_url") if b.get("status") == "quoted" else None}
            for b in found]


def request_tour(member_id: str, payload: TourRequest) -> dict:
    """Save the request, open a chat for it and put it in front of member support in Operations."""
    waiting = [b for b in list_for_member(member_id) if b["status"] == "requested"]
    if len(waiting) >= 3:
        raise TourError("You already have 3 tour requests waiting for a quote. We'll reply in their chats soon.")
    values = payload.model_dump()
    values["arrival_date"] = payload.arrival_date.isoformat()
    booking = one(db().table("member_tour_bookings").insert({"member_id": member_id, "status": "requested", "currency": "USD", **values}).execute())
    if not booking:
        raise RuntimeError("Tour booking insert returned no row")
    conversation = one(db().table("member_conversations").insert({
        "member_id": member_id, "title": f"Tour guide: {city_label(booking)}"[:120]}).execute())
    work_item_id = None
    if conversation:
        db().table("member_messages").insert([
            {"conversation_id": conversation["id"], "sender_type": "member", "content": describe(booking)[:8000]},
            {"conversation_id": conversation["id"], "sender_type": "assistant", "content": RECEIVED_REPLY},
        ]).execute()
        try:
            work = db().rpc("request_member_conversation_support", {"p_member_id": member_id,
                                                                    "p_conversation_id": str(conversation["id"])}).execute()
            item = work.data[0] if isinstance(work.data, list) and work.data else work.data
            if isinstance(item, dict) and item.get("id"):
                work_item_id = str(item["id"])
                db().table("operations_work_items").update({
                    "work_type": "tour_booking", "priority": "high",
                    "summary": f"Tour guide: {summary(booking)}"[:240],
                    "next_action": "Check the dates with the team, then send a quote from Tour bookings.",
                }).eq("id", work_item_id).execute()
        except Exception:
            logger.exception("Could not put the tour booking in front of member support")
    booking = _update(booking, {"conversation_id": conversation["id"] if conversation else None, "work_item_id": work_item_id})
    try:
        db().rpc("notify_platform_admins", {
            "p_notification_type": "tour_booking", "p_work_item_id": work_item_id,
            "p_title": f"New tour guide request: {city_label(booking)}"[:160], "p_body": summary(booking)[:500],
            "p_href": f"/operations?workItem={work_item_id}" if work_item_id else "/operations",
            "p_dedupe": f"tour:{booking['id']}"}).execute()
    except Exception:
        logger.exception("Could not notify administrators about a tour booking")
    commerce.queue_email(member_id, category="notifications", template="tour_requested", title="We've got your tour guide request",
                         body=f"{summary(booking)}. We'll send you a quote in your tour chat.",
                         href=f"/member/chat?conversation={booking.get('conversation_id')}" if booking.get("conversation_id") else "/member/chat?panel=tools")
    return _with_invoices([booking])[0]


def send_quote(booking: dict, actor_id: str, payload: QuoteInput) -> dict:
    if booking["status"] not in ("requested", "quoted"):
        raise TourError("Only a requested or quoted tour can get a new quote.")
    if booking.get("invoice_id") and booking["status"] == "quoted":
        invoice = one(db().table("commerce_invoices").select("id,status").eq("id", str(booking["invoice_id"])).limit(1).execute())
        if invoice and invoice.get("status") == "sent":
            db().table("commerce_invoices").update({"status": "cancelled", "error": "Replaced by a new tour quote."}) \
                .eq("id", invoice["id"]).eq("status", "sent").execute()
    amount = float(payload.amount)
    invoice = commerce.send_invoice(member_id=str(booking["member_id"]), title=f"FayFort tour guide: {city_label(booking)}",
                                    amount=amount, currency=payload.currency, kind="tour", requires_shipping=False,
                                    actor_id=actor_id, details={"tour_booking_id": str(booking["id"])})
    booking = _update(booking, {"status": "quoted", "quote_amount": amount, "currency": payload.currency,
                                "invoice_id": invoice["id"]})
    text = f"Your tour guide quote is {amount:,.2f} {payload.currency} for {summary(booking)}."
    if payload.note.strip():
        text += f"\n{payload.note.strip()}"
    text += "\nPay with the invoice link we emailed you, or from Tools → Tour guide. Your guide is confirmed once it's paid."
    _say(booking.get("conversation_id"), text)
    _work(booking, {"status": "waiting", "waiting_on": "customer", "waiting_reason": "Waiting for the member to pay the tour quote.",
                    "next_action": "Waiting for payment. When it's paid, name the guide in Tour bookings."})
    return _with_invoices([booking])[0]


def invoice_paid(invoice: dict) -> None:
    """Called from the Shopify order webhook when a tour invoice is paid. Safe to call twice."""
    booking = one(db().table("member_tour_bookings").select(FIELDS).eq("invoice_id", str(invoice["id"])).limit(1).execute())
    if not booking or booking.get("status") != "quoted":
        return
    booking = _update(booking, {"status": "confirmed"})
    _say(booking.get("conversation_id"), "Payment received, thank you. Your tour is confirmed. We'll tell you here who your guide is.")
    _work(booking, {"status": "open", "waiting_on": None, "waiting_reason": None, "priority": "high",
                    "next_action": "Paid. Name the guide in Tour bookings and agree the meeting point in the chat."})
    commerce.queue_email(str(booking["member_id"]), category="notifications", template="tour_confirmed",
                         title="Your tour is confirmed", body=f"{summary(booking)}. We'll tell you who your guide is in your tour chat.",
                         href=f"/member/chat?conversation={booking.get('conversation_id')}" if booking.get("conversation_id") else "/member/chat?panel=tools")


def assign_guide(booking: dict, actor_id: str, payload: GuideInput) -> dict:
    if booking["status"] != "confirmed":
        raise TourError("Name the guide once the tour is paid and confirmed.")
    name = payload.guide_name.strip()
    booking = _update(booking, {"guide_name": name, "guide_worker_id": actor_id if name else None})
    text = f"Your guide is {name}. They'll meet you in {city_label(booking)} and keep in touch here."
    if payload.note.strip():
        text += f"\n{payload.note.strip()}"
    _say(booking.get("conversation_id"), text)
    _work(booking, {"next_action": f"Guide: {name}. Mark the tour done after it ends."})
    return _with_invoices([booking])[0]


def set_status(booking: dict, payload: StatusInput) -> dict:
    if booking["status"] in ("completed", "cancelled"):
        raise TourError("This tour is already finished.")
    if payload.status == "completed" and booking["status"] != "confirmed":
        raise TourError("Only a confirmed tour can be marked done.")
    if payload.status == "cancelled" and booking.get("invoice_id") and booking["status"] == "quoted":
        db().table("commerce_invoices").update({"status": "cancelled", "error": "The tour was cancelled."}) \
            .eq("id", str(booking["invoice_id"])).eq("status", "sent").execute()
    booking = _update(booking, {"status": payload.status, "cancel_reason": payload.reason.strip() or None})
    if payload.status == "cancelled":
        _say(booking.get("conversation_id"), "This tour request was cancelled." + (f" {payload.reason.strip()}" if payload.reason.strip() else ""))
    else:
        _say(booking.get("conversation_id"), "Thanks for touring with FayFort. We hope the trip went well.")
    if booking.get("work_item_id"):
        try:
            from app.accounts import operations_flow
            item = one(db().table("operations_work_items").select("*").eq("id", str(booking["work_item_id"])).limit(1).execute())
            if item and item.get("status") not in ("resolved", "closed"):
                db().table("operations_work_items").update({"status": "resolved", "waiting_on": None, "waiting_reason": None,
                                                            "next_action": f"Tour {payload.status}.",
                                                            "updated_at": plans.now_utc().isoformat()}).eq("id", item["id"]).execute()
                operations_flow.add_event(item, "status_changed", f"Tour {payload.status}.", next_status="resolved")
        except Exception:
            logger.exception("Could not close the tour work item")
    return _with_invoices([booking])[0]


def list_for_staff(status: str | None = None) -> list[dict]:
    query = db().table("member_tour_bookings").select(FIELDS)
    query = query.in_("status", list(OPEN)) if status in (None, "", "open") else query.eq("status", status)
    found = rows(query.order("arrival_date").limit(200).execute())
    members = {str(m["user_id"]): m for m in rows(db().table("member_profiles").select("user_id,display_name,username")
                                                  .in_("user_id", list({str(b["member_id"]) for b in found})).execute())} if found else {}
    return [{**b, "member_name": (members.get(str(b["member_id"])) or {}).get("display_name") or "Member"} for b in _with_invoices(found)]


# ---------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------
def _fail(exc: Exception, default: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (TourError, ValueError)):
        return HTTPException(status_code=409, detail=str(exc))
    logger.exception(default)
    return HTTPException(status_code=503, detail=default)


def create_tours_router(require_verified_member: Callable[[str | None], str],
                        trusted_fayfort_staff: Callable[[str | None], dict | None]) -> APIRouter:
    router = APIRouter(tags=["tours"])

    def staff(authorization: str | None) -> dict:
        found = trusted_fayfort_staff(authorization)
        if not found:
            raise HTTPException(status_code=403, detail="FayFort staff access is required.")
        return found

    @router.get("/members/tours")
    def member_tours(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return {"tours": list_for_member(member_id), "cities": CITIES, "needs": NEEDS,
                    "pending": "Choosing a date from a live calendar is coming. For now our team confirms your dates in the chat."}
        except Exception as exc:
            raise _fail(exc, "Your tour bookings could not be loaded.") from exc

    @router.post("/members/tours", status_code=201)
    def member_request(payload: TourRequest, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return {"tour": request_tour(member_id, payload)}
        except Exception as exc:
            raise _fail(exc, "Your tour request could not be sent. Try again.") from exc

    @router.get("/operations/tours")
    def staff_tours(status: Literal["open", "requested", "quoted", "confirmed", "completed", "cancelled"] = "open",
                    authorization: str | None = Header(default=None)):
        staff(authorization)
        try:
            return {"tours": list_for_staff(status), "needs": NEEDS}
        except Exception as exc:
            raise _fail(exc, "Tour bookings could not be loaded.") from exc

    @router.post("/operations/tours/{booking_id}/quote")
    def quote(booking_id: UUID, payload: QuoteInput, authorization: str | None = Header(default=None)):
        actor = staff(authorization)
        try:
            return {"tour": send_quote(get(str(booking_id)), actor["user_id"], payload)}
        except Exception as exc:
            raise _fail(exc, "The quote could not be sent.") from exc

    @router.post("/operations/tours/{booking_id}/guide")
    def guide(booking_id: UUID, payload: GuideInput, authorization: str | None = Header(default=None)):
        actor = staff(authorization)
        try:
            return {"tour": assign_guide(get(str(booking_id)), actor["user_id"], payload)}
        except Exception as exc:
            raise _fail(exc, "The guide could not be saved.") from exc

    @router.post("/operations/tours/{booking_id}/status")
    def status(booking_id: UUID, payload: StatusInput, authorization: str | None = Header(default=None)):
        staff(authorization)
        try:
            return {"tour": set_status(get(str(booking_id)), payload)}
        except Exception as exc:
            raise _fail(exc, "The tour could not be updated.") from exc

    return router
