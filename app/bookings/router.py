"""Bookings API (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md sections 4 to 6).

Who can do what:
  administrators   everything, including the rules
  the assistant    every booking, and the CEO's calendar (weekly hours and blocked time)
  everyone else    their own calendar and the bookings they host (the CEO: her own, plus notes after a call)

Staff:   GET  /operations/bookings/me                 roles, calendars I can manage, the rules
         GET  /operations/bookings?view=today|upcoming|needs_action|past|range&from=&to=&host_id=&kind=
         GET  /operations/bookings/{id}
         POST /operations/bookings/{id}/move | cancel | finish | refunded
         PUT  /operations/bookings/{id}/details       call link, brief (assistant), host note
         GET  /operations/bookings/slots?host_id=&kind=&from=&to=
         GET|PUT /operations/availability/{host_id}   POST|DELETE /operations/availability/{host_id}/time-off[/{id}]
Admins:  GET|PUT /platform/bookings/settings
Members: GET  /members/bookings/slots?kind=consultation&from=YYYY-MM-DD&days=14
         GET  /members/bookings                         POST /members/bookings/{id}/move | cancel
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.bookings import engine
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

Kind = Literal["consultation", "session", "tour"]
MEMBER_FIELDS = ("id", "kind", "starts_at", "ends_at", "status", "hold_expires_at", "topic", "member_time_zone",
                 "reschedule_count", "refund", "cancel_reason")


class MoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starts_at: datetime
    reason: str = Field(default="", max_length=300)


class CancelInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=500)
    refund: bool | None = None


class FinishInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "no_show"]


class DetailsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_link: str | None = Field(default=None, max_length=500)
    brief: str | None = Field(default=None, max_length=2000)
    host_note: str | None = Field(default=None, max_length=2000)


class WeeklyBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weekday: int = Field(ge=0, le=6)
    start_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")
    kinds: list[Kind] = Field(default_factory=lambda: ["consultation", "session"], min_length=1, max_length=3)

    @field_validator("end_time")
    @classmethod
    def midnight(cls, value: str) -> str:
        return "23:59" if value == "24:00" else value


class AvailabilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time_zone: str = Field(default="Asia/Shanghai", max_length=60)
    weekly: list[WeeklyBlock] = Field(default_factory=list, max_length=42)


class TimeOffInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(default="", max_length=200)


class SettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consultation_minutes: int | None = Field(default=None, ge=15, le=240)
    session_minutes: int | None = Field(default=None, ge=15, le=240)
    buffer_minutes: int | None = Field(default=None, ge=0, le=120)
    min_notice_hours: int | None = Field(default=None, ge=0, le=336)
    horizon_days: int | None = Field(default=None, ge=1, le=365)
    hold_hours: int | None = Field(default=None, ge=1, le=168)
    cancel_cutoff_hours: int | None = Field(default=None, ge=0, le=336)
    max_member_moves: int | None = Field(default=None, ge=0, le=10)
    session_price: float | None = Field(default=None, ge=0, le=10000)


class MemberCancelInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=500)


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------------------------
# Who is asking
# ---------------------------------------------------------------------------------------------
def staff_role_of(user_id: str) -> str | None:
    found = one(db().table("fayfort_workers").select("staff_role,status").eq("user_id", user_id).limit(1).execute())
    return (found or {}).get("staff_role") or ("staff" if found else None)


def actor_for(staff: dict) -> dict:
    admin = staff.get("role") == "platform_admin"
    role = "admin" if admin else (staff_role_of(staff["user_id"]) or "staff")
    ceo = engine.consultation_host()
    return {"user_id": staff["user_id"], "admin": admin, "staff_role": role,
            "ceo_id": str(ceo["user_id"]) if ceo else None, "sees_all": admin or role == "assistant"}


def can_manage_host(actor: dict, host_id: str) -> bool:
    return actor["admin"] or actor["user_id"] == str(host_id) or (
        actor["staff_role"] == "assistant" and actor["ceo_id"] is not None and actor["ceo_id"] == str(host_id))


def can_see(actor: dict, booking: dict) -> bool:
    return actor["sees_all"] or str(booking.get("host_id")) == actor["user_id"]


def managed_hosts(actor: dict) -> list[str]:
    if actor["admin"]:
        found = [str(r["user_id"]) for r in rows(db().table("fayfort_workers").select("user_id").eq("status", "active")
                                                 .limit(500).execute())]
        if actor["ceo_id"] and actor["ceo_id"] not in found:
            found.insert(0, actor["ceo_id"])
        return found
    found = [actor["user_id"]]
    if actor["staff_role"] == "assistant" and actor["ceo_id"] and actor["ceo_id"] not in found:
        found.insert(0, actor["ceo_id"])
    return found


# ---------------------------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------------------------
def _people(ids: list[str]) -> dict[str, dict]:
    try:
        from app.workforce import team
        return team.people(ids)
    except Exception:
        logger.warning("Host names could not be loaded", exc_info=True)
        return {}


def _roles(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    return {str(r["user_id"]): r for r in rows(db().table("fayfort_workers").select("user_id,staff_role,job_title")
                                               .in_("user_id", ids).execute())}


def needs_for(booking: dict, now: datetime | None = None) -> list[str]:
    now = now or engine.now_utc()
    found = []
    starts = engine.parse(booking["starts_at"])
    if booking.get("refund") == "due":
        found.append("refund")
    if booking.get("status") == "held":
        expires = engine.parse(booking.get("hold_expires_at"))
        if expires and expires - now <= timedelta(hours=6):
            found.append("hold_expiring")
    if booking.get("status") == "confirmed" and booking.get("kind") in ("consultation", "session") and starts > now:
        if not booking.get("call_link") and starts - now <= timedelta(days=7):
            found.append("call_link")
        if booking.get("kind") == "consultation" and not booking.get("brief") and starts - now <= timedelta(days=3):
            found.append("brief")
    if booking.get("status") == "confirmed" and engine.parse(booking["ends_at"]) < now - timedelta(hours=2):
        found.append("mark_done")
    return found


def present(found: list[dict]) -> list[dict]:
    if not found:
        return []
    host_ids = list({str(b["host_id"]) for b in found})
    member_ids = list({str(b["member_id"]) for b in found if b.get("member_id")})
    hosts, roles = _people(host_ids), _roles(host_ids)
    members = {str(m["user_id"]): m for m in rows(db().table("member_profiles").select("user_id,display_name,username")
                                                  .in_("user_id", member_ids).execute())} if member_ids else {}
    consultation_ids = [str(b["source_id"]) for b in found if b.get("source_table") == "member_consultations" and b.get("source_id")]
    chats = {str(c["id"]): c for c in rows(db().table("member_consultations").select("id,conversation_id,plan,price,currency")
                                           .in_("id", consultation_ids).execute())} if consultation_ids else {}
    invoice_ids = [str(b["invoice_id"]) for b in found if b.get("invoice_id")]
    invoices = {str(i["id"]): i for i in rows(db().table("commerce_invoices").select("id,status,amount,currency,invoice_url")
                                              .in_("id", invoice_ids).execute())} if invoice_ids else {}
    now = engine.now_utc()
    result = []
    for booking in found:
        member = members.get(str(booking.get("member_id"))) or {}
        consultation = chats.get(str(booking.get("source_id"))) or {}
        invoice = invoices.get(str(booking.get("invoice_id"))) or {}
        host = hosts.get(str(booking["host_id"])) or {}
        result.append({
            **{k: booking.get(k) for k in ("id", "kind", "status", "starts_at", "ends_at", "hold_expires_at", "topic",
                                            "brief", "host_note", "call_link", "member_time_zone", "reschedule_count",
                                            "cancel_reason", "cancelled_by", "refund", "work_item_id", "host_id",
                                            "member_id", "created_at")},
            "host": {"user_id": str(booking["host_id"]), "name": host.get("name") or "FayFort team",
                     "photo_url": host.get("photo_url"),
                     "staff_role": (roles.get(str(booking["host_id"])) or {}).get("staff_role") or "staff"},
            "member_name": member.get("display_name") or (f"@{member['username']}" if member.get("username") else "Member"),
            "conversation_id": consultation.get("conversation_id"),
            "payment": {"status": invoice.get("status"), "amount": invoice.get("amount"), "currency": invoice.get("currency")}
            if invoice else None,
            "when_china": engine.when_text(engine.parse(booking["starts_at"])),
            "needs": needs_for(booking, now),
        })
    return result


def china_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, datetime.min.time(), engine.CHINA).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def list_for(actor: dict, view: str, *, start: datetime | None = None, end: datetime | None = None,
             host_id: str | None = None, kind: str | None = None) -> list[dict]:
    now = engine.now_utc()
    query = db().table("bookings").select(engine.FIELDS)
    if not actor["sees_all"]:
        query = query.eq("host_id", actor["user_id"])
    elif host_id:
        query = query.eq("host_id", host_id)
    if kind:
        query = query.eq("kind", kind)
    if view == "today":
        day_start, day_end = china_day_bounds(now.astimezone(engine.CHINA).date())
        query = query.gte("starts_at", day_start.isoformat()).lt("starts_at", day_end.isoformat()).neq("status", "cancelled")
        found = rows(query.order("starts_at").limit(200).execute())
    elif view == "upcoming":
        found = rows(query.in_("status", list(engine.LIVE)).gte("ends_at", now.isoformat()).order("starts_at").limit(300).execute())
    elif view == "past":
        found = rows(query.lt("starts_at", now.isoformat()).gte("starts_at", (now - timedelta(days=90)).isoformat())
                     .order("starts_at", desc=True).limit(300).execute())
    elif view == "range":
        start = start or now - timedelta(days=7)
        end = end or start + timedelta(days=7)
        if end - start > timedelta(days=62):
            raise engine.BookingError("Show at most two months at a time.")
        found = rows(query.lt("starts_at", end.isoformat()).gt("ends_at", start.isoformat()).order("starts_at").limit(1000).execute())
    else:  # needs_action
        live = rows(query.in_("status", ["held", "confirmed"]).order("starts_at").limit(500).execute())
        due_query = db().table("bookings").select(engine.FIELDS).eq("refund", "due")
        if not actor["sees_all"]:
            due_query = due_query.eq("host_id", actor["user_id"])
        refunds = rows(due_query.limit(200).execute())
        seen: dict[str, dict] = {str(b["id"]): b for b in live + refunds}
        found = [b for b in seen.values() if needs_for(b, now)]
        found.sort(key=lambda b: b["starts_at"])
    return present(found)


def member_view(booking: dict) -> dict:
    view = {k: booking.get(k) for k in MEMBER_FIELDS}
    view["call_link"] = booking.get("call_link") if booking.get("status") == "confirmed" else None
    allowed, why = engine.can_member_change(booking)
    view["can_change"] = allowed
    view["change_note"] = why or None
    return view


def host_card(user_id: str) -> dict:
    person = _people([user_id]).get(user_id) or {}
    role = _roles([user_id]).get(user_id) or {}
    return {"name": person.get("name") or "FayFort", "first_name": person.get("first_name"),
            "photo_url": person.get("photo_url"), "job_title": role.get("job_title") or (
                "CEO" if role.get("staff_role") == "ceo" else None)}


def _fail(exc: Exception, default: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc) or "You can't change this calendar.")
    if isinstance(exc, (engine.BookingError, ValueError)):
        return HTTPException(status_code=409, detail=str(exc))
    logger.exception(default)
    return HTTPException(status_code=503, detail=default)


def create_bookings_router(require_verified_member, trusted_fayfort_staff, trusted_platform_admin) -> APIRouter:
    router = APIRouter(tags=["bookings"])

    def staff_actor(authorization: str | None) -> dict:
        staff = trusted_fayfort_staff(authorization)
        if not staff:
            raise HTTPException(status_code=403, detail="FayFort staff access is required.")
        return actor_for(staff)

    def seen_booking(actor: dict, booking_id: UUID) -> dict:
        booking = engine.get(str(booking_id))
        if not can_see(actor, booking):
            raise LookupError("Booking not found.")
        return booking

    # ---- staff ----------------------------------------------------------------------------------
    @router.get("/operations/bookings/me")
    def me(authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            ids = managed_hosts(actor)
            people, roles = _people(ids), _roles(ids)
            hosts = [{"user_id": i, "name": (people.get(i) or {}).get("name") or "FayFort team",
                      "photo_url": (people.get(i) or {}).get("photo_url"),
                      "staff_role": "ceo" if i == actor["ceo_id"] else (roles.get(i) or {}).get("staff_role") or "staff",
                      "job_title": (roles.get(i) or {}).get("job_title"), "is_self": i == actor["user_id"]} for i in ids]
            hosts.sort(key=lambda h: (h["staff_role"] != "ceo", not h["is_self"], h["name"]))
            return {"user_id": actor["user_id"], "staff_role": actor["staff_role"], "sees_all": actor["sees_all"],
                    "admin": actor["admin"], "ceo_id": actor["ceo_id"], "hosts": hosts, "settings": engine.settings_row()}
        except Exception as exc:
            raise _fail(exc, "Your bookings could not be loaded.") from exc

    @router.get("/operations/bookings")
    def staff_list(view: Literal["today", "upcoming", "needs_action", "past", "range"] = "upcoming",
                   start: datetime | None = Query(default=None, alias="from"), end: datetime | None = Query(default=None, alias="to"),
                   host_id: UUID | None = None, kind: Kind | None = None, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            return {"bookings": list_for(actor, view, start=aware(start) if start else None, end=aware(end) if end else None,
                                         host_id=str(host_id) if host_id else None, kind=kind),
                    "generated_at": engine.now_utc().isoformat()}
        except Exception as exc:
            raise _fail(exc, "Bookings could not be loaded.") from exc

    @router.get("/operations/bookings/slots")
    def staff_slots(host_id: UUID, kind: Kind = "consultation", start: datetime = Query(alias="from"),
                    end: datetime = Query(alias="to"), ignore: UUID | None = None,
                    authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        if not (actor["sees_all"] or can_manage_host(actor, str(host_id))):
            raise HTTPException(status_code=403, detail="You can't see this calendar.")
        start, end = aware(start), aware(end)
        if end - start > timedelta(days=62) or end <= start:
            raise HTTPException(status_code=422, detail="Choose up to two months.")
        try:
            rules = dict(engine.settings_row())
            rules["min_notice_hours"] = 0  # staff can fit someone in sooner than members can
            return {"slots": engine.free_slots(str(host_id), kind, start, end, rules=rules,
                                               ignore_booking=str(ignore) if ignore else None)}
        except Exception as exc:
            raise _fail(exc, "Free times could not be loaded.") from exc

    @router.get("/operations/bookings/{booking_id}")
    def staff_get(booking_id: UUID, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            return {"booking": present([seen_booking(actor, booking_id)])[0]}
        except Exception as exc:
            raise _fail(exc, "The booking could not be loaded.") from exc

    def manage(actor: dict, booking: dict) -> None:
        if not (actor["sees_all"] or can_manage_host(actor, str(booking["host_id"]))):
            raise PermissionError("You can't change this booking.")

    @router.post("/operations/bookings/{booking_id}/move")
    def staff_move(booking_id: UUID, payload: MoveInput, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            booking = seen_booking(actor, booking_id)
            manage(actor, booking)
            return {"booking": present([engine.move(booking, aware(payload.starts_at), by="staff", reason=payload.reason)])[0]}
        except Exception as exc:
            raise _fail(exc, "The booking could not be moved.") from exc

    @router.post("/operations/bookings/{booking_id}/cancel")
    def staff_cancel(booking_id: UUID, payload: CancelInput, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            booking = seen_booking(actor, booking_id)
            manage(actor, booking)
            if booking.get("status") == "confirmed" and payload.refund is None:
                raise engine.BookingError("Choose whether to refund this paid booking.")
            if not payload.reason.strip():
                raise engine.BookingError("Add a short reason; the member sees it in the email.")
            return {"booking": present([engine.cancel(booking, by="staff", reason=payload.reason, refund=payload.refund)])[0]}
        except Exception as exc:
            raise _fail(exc, "The booking could not be cancelled.") from exc

    @router.post("/operations/bookings/{booking_id}/finish")
    def staff_finish(booking_id: UUID, payload: FinishInput, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            booking = seen_booking(actor, booking_id)
            manage(actor, booking)
            return {"booking": present([engine.finish(booking, payload.status)])[0]}
        except Exception as exc:
            raise _fail(exc, "The booking could not be updated.") from exc

    @router.post("/operations/bookings/{booking_id}/refunded")
    def staff_refunded(booking_id: UUID, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            booking = seen_booking(actor, booking_id)
            if not actor["sees_all"]:
                raise PermissionError("Only the assistant or an administrator can mark refunds.")
            return {"booking": present([engine.mark_refunded(booking)])[0]}
        except Exception as exc:
            raise _fail(exc, "The refund could not be recorded.") from exc

    @router.put("/operations/bookings/{booking_id}/details")
    def staff_details(booking_id: UUID, payload: DetailsInput, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            booking = seen_booking(actor, booking_id)
            values = payload.model_dump(exclude_unset=True)
            is_host = str(booking["host_id"]) == actor["user_id"]
            if ("call_link" in values or "brief" in values) and not (actor["sees_all"] or can_manage_host(actor, str(booking["host_id"]))):
                raise PermissionError("You can't change this booking.")
            if "host_note" in values and not (is_host or actor["sees_all"]):
                raise PermissionError("Only the host can write the note after the call.")
            return {"booking": present([engine.update_details(booking, values)])[0]}
        except Exception as exc:
            raise _fail(exc, "The booking could not be saved.") from exc

    @router.get("/operations/availability/{host_id}")
    def get_availability(host_id: UUID, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        if not (actor["sees_all"] or can_manage_host(actor, str(host_id))):
            raise HTTPException(status_code=403, detail="You can't see this calendar.")
        try:
            weekly = engine.availability(str(host_id))
            now = engine.now_utc()
            normal = {**engine.NORMAL_HOURS, "in_use": not weekly}
            return {"host": {"user_id": str(host_id), **host_card(str(host_id))},
                    "can_edit": can_manage_host(actor, str(host_id)),
                    "time_zone": (weekly[0].get("time_zone") if weekly else None) or "Asia/Shanghai",
                    "weekly": [{**r, "start_time": str(r["start_time"])[:5], "end_time": str(r["end_time"])[:5]} for r in weekly],
                    "time_off": engine.time_off(str(host_id), now - timedelta(days=1), now + timedelta(days=365)),
                    "normal_hours": normal}
        except Exception as exc:
            raise _fail(exc, "The calendar could not be loaded.") from exc

    @router.put("/operations/availability/{host_id}")
    def put_availability(host_id: UUID, payload: AvailabilityInput, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            if not can_manage_host(actor, str(host_id)):
                raise PermissionError("You can't change this calendar.")
            if actor["ceo_id"] == str(host_id):
                engine.consultation_host(ensure=True)
            weekly = engine.save_availability(str(host_id), actor["user_id"], [b.model_dump() for b in payload.weekly],
                                              payload.time_zone)
            return {"weekly": [{**r, "start_time": str(r["start_time"])[:5], "end_time": str(r["end_time"])[:5]} for r in weekly]}
        except Exception as exc:
            raise _fail(exc, "The weekly hours could not be saved.") from exc

    @router.post("/operations/availability/{host_id}/time-off", status_code=201)
    def post_time_off(host_id: UUID, payload: TimeOffInput, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            if not can_manage_host(actor, str(host_id)):
                raise PermissionError("You can't change this calendar.")
            if actor["ceo_id"] == str(host_id):
                engine.consultation_host(ensure=True)
            return {"time_off": engine.add_time_off(str(host_id), actor["user_id"], aware(payload.starts_at),
                                                    aware(payload.ends_at), payload.reason)}
        except Exception as exc:
            raise _fail(exc, "The blocked time could not be saved.") from exc

    @router.delete("/operations/availability/{host_id}/time-off/{time_off_id}")
    def delete_time_off(host_id: UUID, time_off_id: UUID, authorization: str | None = Header(default=None)):
        actor = staff_actor(authorization)
        try:
            if not can_manage_host(actor, str(host_id)):
                raise PermissionError("You can't change this calendar.")
            db().table("staff_time_off").delete().eq("id", str(time_off_id)).eq("worker_id", str(host_id)).execute()
            return {"deleted": True}
        except Exception as exc:
            raise _fail(exc, "The blocked time could not be removed.") from exc

    # ---- administrators ----------------------------------------------------------------------
    @router.get("/platform/bookings/settings")
    def get_settings(authorization: str | None = Header(default=None)):
        if not trusted_platform_admin(authorization):
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return {"settings": engine.settings_row()}

    @router.put("/platform/bookings/settings")
    def put_settings(payload: SettingsInput, authorization: str | None = Header(default=None)):
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        values = {k: v for k, v in payload.model_dump().items() if v is not None}
        try:
            if values:
                db().table("booking_settings").update({**values, "updated_by": admin["user_id"],
                                                       "updated_at": engine.now_utc().isoformat()}).eq("id", 1).execute()
            return {"settings": engine.settings_row()}
        except Exception as exc:
            raise _fail(exc, "The booking rules could not be saved.") from exc

    # ---- members -------------------------------------------------------------------------------
    @router.get("/members/bookings/slots")
    def member_slots(kind: Literal["consultation"] = "consultation", start: date | None = Query(default=None, alias="from"),
                     days: int = Query(default=14, ge=1, le=62), authorization: str | None = Header(default=None)):
        require_verified_member(authorization)
        try:
            ceo = engine.consultation_host()
            rules = engine.settings_row()
            summary = {"minutes": engine.minutes_for(kind, rules), "cancel_cutoff_hours": rules["cancel_cutoff_hours"],
                       "hold_hours": rules["hold_hours"], "horizon_days": rules["horizon_days"]}
            if not ceo:
                return {"available": False, "slots": [], "host": None, "rules": summary,
                        "message": "Booking times open soon. Until then, book and we'll agree a time in the chat."}
            first = start or engine.now_utc().date()
            begin = datetime.combine(first, datetime.min.time(), timezone.utc) - timedelta(hours=14)
            slots = engine.free_slots(str(ceo["user_id"]), kind, begin, begin + timedelta(days=days, hours=28), rules=rules)
            return {"available": True, "slots": slots, "host": host_card(str(ceo["user_id"])), "rules": summary,
                    "message": None if slots else "No free times in these days. Try later dates."}
        except Exception as exc:
            raise _fail(exc, "Free times could not be loaded.") from exc

    public_cache: dict[str, Any] = {"at": None, "body": None}

    @router.get("/public/bookings/slots")
    def public_slots():
        """fayfort.com /go/consultation: the next free consultation times, times only (no names). Cached a minute."""
        now = engine.now_utc()
        if public_cache["at"] and now - public_cache["at"] < timedelta(seconds=60):
            return public_cache["body"]
        try:
            host = engine.consultation_host()
            rules = engine.settings_row()
            body: dict[str, Any] = {"available": bool(host), "minutes": engine.minutes_for("consultation", rules),
                                    "cancel_cutoff_hours": rules["cancel_cutoff_hours"], "slots": []}
            if host:
                slots = engine.free_slots(str(host["user_id"]), "consultation", now, now + timedelta(days=21), rules=rules)
                body["slots"] = [{"starts_at": slot["starts_at"]} for slot in slots[:60]]
            public_cache.update(at=now, body=body)
            return body
        except Exception as exc:
            raise _fail(exc, "Free times could not be loaded.") from exc

    @router.get("/members/bookings")
    def member_list(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            found = rows(db().table("bookings").select(engine.FIELDS).eq("member_id", member_id)
                         .gte("starts_at", (engine.now_utc() - timedelta(days=60)).isoformat())
                         .order("starts_at").limit(100).execute())
            hosts = _people(list({str(b["host_id"]) for b in found}))
            return {"bookings": [{**member_view(b), "host_name": (hosts.get(str(b["host_id"])) or {}).get("name")}
                                 for b in found if b.get("status") != "cancelled" or b.get("refund")],
                    "rules": {k: engine.settings_row()[k] for k in ("cancel_cutoff_hours", "max_member_moves")}}
        except Exception as exc:
            raise _fail(exc, "Your bookings could not be loaded.") from exc

    def own(member_id: str, booking_id: UUID) -> dict:
        booking = engine.get(str(booking_id))
        if str(booking.get("member_id")) != member_id:
            raise LookupError("Booking not found.")
        return booking

    @router.post("/members/bookings/{booking_id}/move")
    def member_move(booking_id: UUID, payload: MoveInput, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return {"booking": member_view(engine.move(own(member_id, booking_id), aware(payload.starts_at), by="member"))}
        except Exception as exc:
            raise _fail(exc, "Your booking could not be moved.") from exc

    @router.post("/members/bookings/{booking_id}/cancel")
    def member_cancel(booking_id: UUID, payload: MemberCancelInput, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return {"booking": member_view(engine.cancel(own(member_id, booking_id), by="member", reason=payload.reason))}
        except Exception as exc:
            raise _fail(exc, "Your booking could not be cancelled.") from exc

    return router
