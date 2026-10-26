"""The booking engine (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md section 4).

Availability: weekly hours per person (`staff_availability`, in their own time zone) minus blocked time
(`staff_time_off`) minus live bookings (held or confirmed, including the gap after each). The database refuses two
live bookings that overlap for one host, so a slot can't be taken twice even when two people press Book together.

Life of a booking:
  held       a member picked a time; the invoice is out; the time is kept for `hold_hours` (24 h). One hold per
             member per kind.
  confirmed  the invoice was paid (Shopify webhook). Reminders go 24 h and 1 h before.
  completed / no_show   marked by the host or the team afterwards; a "how did it go?" email follows a completed one.
  cancelled  by the member (free up to `cancel_cutoff_hours` before, with a refund), by staff (refund or not, with a
             reason) or by the system (hold expired: the unpaid invoice is withdrawn).
Refunds are marked "due" here and done in Shopify by the team, then marked "done".
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.commerce import service as commerce
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

CHINA = ZoneInfo("Asia/Shanghai")
LIVE = ("held", "confirmed")
STEP_MINUTES = 30
DEFAULTS: dict[str, Any] = {
    "consultation_minutes": 60, "session_minutes": 30, "buffer_minutes": 15, "min_notice_hours": 24,
    "horizon_days": 60, "hold_hours": 24, "cancel_cutoff_hours": 24, "max_member_moves": 2, "session_price": 25.0,
}
FIELDS = ("id,host_id,kind,member_id,starts_at,ends_at,blocked_until,status,hold_expires_at,source_table,source_id,"
          "invoice_id,topic,brief,host_note,call_link,google_event_id,member_time_zone,reschedule_count,cancel_reason,"
          "cancelled_by,refund,reminders,work_item_id,created_at,updated_at")
KIND_LABEL = {"consultation": "Consultation", "session": "Session", "tour": "Tour"}


class BookingError(ValueError):
    """Something the member or staff can fix (shown as is)."""


class SlotTaken(BookingError):
    pass


# ---------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        found = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return found if found.tzinfo else found.replace(tzinfo=timezone.utc)


def zone(name: str | None, default: ZoneInfo = CHINA) -> ZoneInfo:
    try:
        return ZoneInfo(name) if name else default
    except (ZoneInfoNotFoundError, ValueError):
        return default


def valid_zone(name: str | None) -> str | None:
    if not name:
        return None
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError):
        return None


def when_text(starts: datetime, member_zone: str | None = None) -> str:
    """"Mon 2 Nov, 14:00 (Africa/Lagos) · 21:00 China time" or just China time."""
    china = starts.astimezone(CHINA)
    china_text = f"{china:%a} {china.day} {china:%b}, {china:%H:%M} China time"
    tz = valid_zone(member_zone)
    if not tz or tz == "Asia/Shanghai":
        return china_text
    local = starts.astimezone(ZoneInfo(tz))
    return f"{local:%a} {local.day} {local:%b}, {local:%H:%M} ({tz.replace('_', ' ')}) · {china:%H:%M} China time"


def settings_row() -> dict[str, Any]:
    try:
        found = one(db().table("booking_settings").select("*").eq("id", 1).limit(1).execute()) or {}
    except Exception:
        logger.warning("Booking settings could not be read; using defaults", exc_info=True)
        found = {}
    merged = {**DEFAULTS, **{k: v for k, v in found.items() if k in DEFAULTS and v is not None}}
    merged["session_price"] = float(merged["session_price"])
    return merged


def minutes_for(kind: str, rules: dict[str, Any]) -> int:
    return int(rules["session_minutes"] if kind == "session" else rules["consultation_minutes"])


def active_ceo() -> dict | None:
    return one(db().table("fayfort_workers").select("user_id,status,staff_role,job_title").eq("staff_role", "ceo")
               .eq("status", "active").limit(1).execute())


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


# ---------------------------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------------------------
def availability(host_id: str) -> list[dict]:
    return rows(db().table("staff_availability").select("id,weekday,start_time,end_time,time_zone,kinds")
                .eq("worker_id", host_id).order("weekday").execute())


def time_off(host_id: str, start: datetime | None = None, end: datetime | None = None) -> list[dict]:
    query = db().table("staff_time_off").select("id,starts_at,ends_at,reason").eq("worker_id", host_id)
    if start:
        query = query.gt("ends_at", start.isoformat())
    if end:
        query = query.lt("starts_at", end.isoformat())
    return rows(query.order("starts_at").limit(500).execute())


def live_bookings(host_id: str, start: datetime, end: datetime) -> list[dict]:
    return rows(db().table("bookings").select("id,starts_at,blocked_until,status").eq("host_id", host_id)
                .in_("status", list(LIVE)).lt("starts_at", end.isoformat()).gt("blocked_until", start.isoformat())
                .limit(2000).execute())


def _clock(value: Any) -> time:
    text = str(value)
    parts = [int(p) for p in text.split(":")[:2]]
    return time(parts[0], parts[1] if len(parts) > 1 else 0)


def free_slots(host_id: str, kind: str, start: datetime, end: datetime, *, now: datetime | None = None,
               rules: dict[str, Any] | None = None, ignore_booking: str | None = None,
               busy: Iterable[tuple[datetime, datetime]] = ()) -> list[dict]:
    """Bookable times for a host between start and end (UTC), following the rules. `busy` adds outside busy times
    (Google Calendar, later)."""
    rules = rules or settings_row()
    now = now or now_utc()
    length = timedelta(minutes=minutes_for(kind, rules))
    gap = timedelta(minutes=int(rules["buffer_minutes"]))
    earliest = max(start, now + timedelta(hours=int(rules["min_notice_hours"])))
    latest = min(end, now + timedelta(days=int(rules["horizon_days"])))
    if earliest >= latest:
        return []
    weekly = [r for r in availability(host_id) if kind in (r.get("kinds") or [])]
    if not weekly:
        return []
    blocked: list[tuple[datetime, datetime]] = []
    for off in time_off(host_id, earliest - timedelta(days=1), latest + timedelta(days=1)):
        blocked.append((parse(off["starts_at"]), parse(off["ends_at"])))
    for booking in live_bookings(host_id, earliest - timedelta(days=1), latest + timedelta(days=1)):
        if ignore_booking and str(booking["id"]) == str(ignore_booking):
            continue
        blocked.append((parse(booking["starts_at"]), parse(booking["blocked_until"])))
    blocked.extend(busy)
    found: dict[datetime, dict] = {}
    for rule in weekly:
        tz = zone(rule.get("time_zone"))
        first = earliest.astimezone(tz).date() - timedelta(days=1)
        last = latest.astimezone(tz).date() + timedelta(days=1)
        day = first
        while day <= last:
            if day.weekday() == int(rule["weekday"]):
                window_start = datetime.combine(day, _clock(rule["start_time"]), tz).astimezone(timezone.utc)
                window_end = datetime.combine(day, _clock(rule["end_time"]), tz).astimezone(timezone.utc)
                cursor = window_start
                while cursor + length <= window_end:
                    if cursor >= earliest and cursor + length <= latest:
                        claim_end = cursor + length + gap
                        if not any(overlaps(cursor, claim_end, b_start, b_end) for b_start, b_end in blocked):
                            found[cursor] = {"starts_at": cursor.isoformat(), "ends_at": (cursor + length).isoformat()}
                    cursor += timedelta(minutes=STEP_MINUTES)
            day += timedelta(days=1)
    return [found[key] for key in sorted(found)]


def is_free(host_id: str, kind: str, starts: datetime, *, rules: dict[str, Any] | None = None,
            ignore_booking: str | None = None, staff_override: bool = False) -> bool:
    """A member may only take a listed slot. Staff may also book outside weekly hours (not over another booking or
    blocked time)."""
    rules = rules or settings_row()
    length = timedelta(minutes=minutes_for(kind, rules))
    if not staff_override:
        listed = free_slots(host_id, kind, starts - timedelta(minutes=1), starts + length + timedelta(minutes=1),
                            rules=rules, ignore_booking=ignore_booking)
        return any(parse(slot["starts_at"]) == starts for slot in listed)
    end = starts + length + timedelta(minutes=int(rules["buffer_minutes"]))
    for off in time_off(host_id, starts - timedelta(days=1), end + timedelta(days=1)):
        if overlaps(starts, end, parse(off["starts_at"]), parse(off["ends_at"])):
            return False
    for booking in live_bookings(host_id, starts - timedelta(days=1), end + timedelta(days=1)):
        if str(booking["id"]) != str(ignore_booking or "") and overlaps(starts, end, parse(booking["starts_at"]), parse(booking["blocked_until"])):
            return False
    return True


def save_availability(host_id: str, actor_id: str, weekly: list[dict], time_zone: str) -> list[dict]:
    """Replace a person's weekly hours."""
    tz = valid_zone(time_zone)
    if not tz:
        raise BookingError("Choose a valid time zone.")
    clean = []
    for rule in weekly:
        start, end = _clock(rule["start_time"]), _clock(rule["end_time"])
        if end <= start:
            raise BookingError("Each block must end after it starts.")
        kinds = [k for k in dict.fromkeys(rule.get("kinds") or ["consultation", "session"]) if k in KIND_LABEL]
        if not kinds:
            raise BookingError("Each block needs at least one kind of booking.")
        clean.append({"worker_id": host_id, "weekday": int(rule["weekday"]), "start_time": start.strftime("%H:%M"),
                      "end_time": end.strftime("%H:%M"), "time_zone": tz, "kinds": kinds, "created_by": actor_id})
    by_day: dict[int, list[tuple[time, time]]] = {}
    for rule in clean:
        spans = by_day.setdefault(rule["weekday"], [])
        start, end = _clock(rule["start_time"]), _clock(rule["end_time"])
        if any(start < s_end and s_start < end for s_start, s_end in spans):
            raise BookingError("Two blocks on the same day overlap. Merge them into one.")
        spans.append((start, end))
    db().table("staff_availability").delete().eq("worker_id", host_id).execute()
    if clean:
        db().table("staff_availability").insert(clean).execute()
    return availability(host_id)


def add_time_off(host_id: str, actor_id: str, starts: datetime, ends: datetime, reason: str | None) -> dict:
    if ends <= starts:
        raise BookingError("Blocked time must end after it starts.")
    if ends - starts > timedelta(days=120):
        raise BookingError("Block at most 120 days at a time.")
    found = one(db().table("staff_time_off").insert({
        "worker_id": host_id, "starts_at": starts.isoformat(), "ends_at": ends.isoformat(),
        "reason": (reason or "").strip()[:200] or None, "created_by": actor_id}).execute())
    clashes = rows(db().table("bookings").select("id,starts_at").eq("host_id", host_id).in_("status", list(LIVE))
                   .lt("starts_at", ends.isoformat()).gt("blocked_until", starts.isoformat()).execute())
    return {**(found or {}), "clashing_bookings": len(clashes)}


# ---------------------------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------------------------
def get(booking_id: str) -> dict:
    found = one(db().table("bookings").select(FIELDS).eq("id", str(booking_id)).limit(1).execute())
    if not found:
        raise LookupError("Booking not found.")
    return found


def for_source(source_table: str, source_id: str) -> dict | None:
    found = rows(db().table("bookings").select(FIELDS).eq("source_table", source_table).eq("source_id", str(source_id))
                 .order("created_at", desc=True).limit(5).execute())
    live = [b for b in found if b.get("status") in LIVE]
    return (live or found or [None])[0]


def _update(booking: dict, values: dict) -> dict:
    values = {**values, "updated_at": now_utc().isoformat()}
    db().table("bookings").update(values).eq("id", str(booking["id"])).execute()
    return {**booking, **values}


def _taken(exc: Exception) -> bool:
    text = str(exc)
    return "bookings_no_double_booking" in text or "23P01" in text or "exclusion" in text.casefold()


def hold(*, host_id: str, kind: str, member_id: str, starts: datetime, topic: str | None = None,
         member_time_zone: str | None = None, source_table: str | None = None, source_id: str | None = None,
         staff_override: bool = False) -> dict:
    rules = settings_row()
    if not staff_override:
        waiting = rows(db().table("bookings").select("id").eq("member_id", member_id).eq("kind", kind)
                       .eq("status", "held").limit(1).execute())
        if waiting:
            raise BookingError("You already have a time on hold waiting for payment. Pay or cancel it first.")
    if not is_free(host_id, kind, starts, rules=rules, staff_override=staff_override):
        raise SlotTaken("That time isn't available any more. Pick another one.")
    length = timedelta(minutes=minutes_for(kind, rules))
    values = {
        "host_id": host_id, "kind": kind, "member_id": member_id, "starts_at": starts.isoformat(),
        "ends_at": (starts + length).isoformat(),
        "blocked_until": (starts + length + timedelta(minutes=int(rules["buffer_minutes"]))).isoformat(),
        "status": "held", "hold_expires_at": (now_utc() + timedelta(hours=int(rules["hold_hours"]))).isoformat(),
        "topic": (topic or "").strip()[:1000] or None, "member_time_zone": valid_zone(member_time_zone),
        "source_table": source_table, "source_id": source_id,
    }
    try:
        found = one(db().table("bookings").insert(values).execute())
    except Exception as exc:
        if _taken(exc):
            raise SlotTaken("That time was just taken. Pick another one.") from exc
        raise
    if not found:
        raise RuntimeError("Booking insert returned no row")
    return found


def discard(booking: dict, reason: str) -> dict:
    """Drop a hold that never got going (the invoice couldn't be sent). No email."""
    return _update(booking, {"status": "cancelled", "cancelled_by": "system", "cancel_reason": reason[:500],
                             "hold_expires_at": None})


def attach(booking: dict, values: dict) -> dict:
    """Invoice id, work item or call link set after the hold."""
    return _update(booking, values)


def confirm(booking: dict) -> dict:
    """The invoice was paid. Safe to call twice."""
    if booking.get("status") == "confirmed":
        return booking
    if booking.get("status") != "held":
        raise BookingError("Only a held booking can be confirmed.")
    booking = _update(booking, {"status": "confirmed", "hold_expires_at": None})
    _email(booking, "confirmed", "Your booking is confirmed",
           f"{KIND_LABEL.get(booking['kind'], 'Booking')} on {when_text(parse(booking['starts_at']), booking.get('member_time_zone'))}. "
           + ("Your call link is in your booking." if booking.get("call_link") else "We'll send the call link before it starts."))
    _sync_calendar(booking)
    return booking


def paid_after_expiry(booking: dict) -> dict:
    """The invoice was paid after the hold ran out. Keep the time if it's still free, otherwise flag a new time or a
    refund for the team."""
    starts = parse(booking["starts_at"])
    try:
        if starts and starts > now_utc() and is_free(str(booking["host_id"]), booking["kind"], starts, staff_override=True,
                                                    ignore_booking=str(booking["id"])):
            restored = _update(booking, {"status": "held", "hold_expires_at": (now_utc() + timedelta(hours=1)).isoformat(),
                                         "cancel_reason": None, "cancelled_by": None})
            return confirm(restored)
    except Exception as exc:
        if not _taken(exc):
            raise
    flagged = _update(booking, {"refund": "due", "cancel_reason": "Paid after the hold expired and the time was taken. "
                                                                  "Offer a new time or refund."})
    _email(flagged, "paid_late", "We received your payment",
           "The time you picked was taken before your payment arrived. Our team will offer you a new time or a refund.")
    return flagged


def can_member_change(booking: dict, rules: dict[str, Any] | None = None, *, now: datetime | None = None) -> tuple[bool, str]:
    rules = rules or settings_row()
    now = now or now_utc()
    starts = parse(booking["starts_at"])
    if booking.get("status") not in LIVE:
        return False, "This booking can't be changed any more."
    if booking.get("status") == "confirmed" and starts - now < timedelta(hours=int(rules["cancel_cutoff_hours"])):
        return False, (f"It's less than {rules['cancel_cutoff_hours']} hours before the start, so it can't be moved or "
                       "refunded now. Message us in the chat if something came up.")
    return True, ""


def move(booking: dict, starts: datetime, *, by: str, reason: str | None = None) -> dict:
    rules = settings_row()
    staff = by == "staff"
    if not staff:
        allowed, why = can_member_change(booking, rules)
        if not allowed:
            raise BookingError(why)
        if int(booking.get("reschedule_count") or 0) >= int(rules["max_member_moves"]):
            raise BookingError(f"A booking can be moved {rules['max_member_moves']} times. Message us in the chat to change it again.")
    elif booking.get("status") not in LIVE:
        raise BookingError("Only a held or confirmed booking can be moved.")
    if starts <= now_utc():
        raise BookingError("Pick a time in the future.")
    if not is_free(str(booking["host_id"]), booking["kind"], starts, rules=rules, ignore_booking=str(booking["id"]),
                   staff_override=staff):
        raise SlotTaken("That time isn't available. Pick another one.")
    length = parse(booking["ends_at"]) - parse(booking["starts_at"])
    gap = parse(booking["blocked_until"]) - parse(booking["ends_at"])
    old = parse(booking["starts_at"])
    try:
        moved = _update(booking, {"starts_at": starts.isoformat(), "ends_at": (starts + length).isoformat(),
                                  "blocked_until": (starts + length + gap).isoformat(),
                                  "reschedule_count": int(booking.get("reschedule_count") or 0) + (0 if staff else 1),
                                  "reminders": {}})
    except Exception as exc:
        if _taken(exc):
            raise SlotTaken("That time was just taken. Pick another one.") from exc
        raise
    note = f" ({reason.strip()})" if reason and reason.strip() else ""
    _email(moved, "moved", "Your booking has a new time",
           f"Moved from {when_text(old, moved.get('member_time_zone'))} to "
           f"{when_text(starts, moved.get('member_time_zone'))}{note}.")
    _sync_calendar(moved)
    return moved


def cancel(booking: dict, *, by: str, reason: str | None = None, refund: bool | None = None) -> dict:
    """by: member, staff or system. A member cancelling a paid booking before the cut-off gets a refund (due)."""
    if booking.get("status") not in LIVE:
        raise BookingError("This booking is already finished.")
    paid = booking.get("status") == "confirmed"
    if by == "member":
        allowed, why = can_member_change(booking)
        if not allowed:
            raise BookingError(why)
        refund_state = "due" if paid else None
    elif by == "staff":
        refund_state = ("due" if refund else "none") if paid else None
    else:
        refund_state = None
    cancelled = _update(booking, {"status": "cancelled", "cancel_reason": (reason or "").strip()[:500] or None,
                                  "cancelled_by": by, "refund": refund_state, "hold_expires_at": None})
    if not paid:
        _withdraw_invoice(cancelled)
    _source_cancelled(cancelled)
    if by == "system":
        _email(cancelled, "expired", "Your held time was released",
               "The payment didn't arrive within the hold, so the time is free again. You can pick a new time any time.")
    else:
        body = f"{KIND_LABEL.get(booking['kind'], 'Booking')} on {when_text(parse(booking['starts_at']), booking.get('member_time_zone'))} is cancelled."
        if refund_state == "due":
            body += " Your refund is on its way; it can take a few days to show on your card."
        _email(cancelled, "cancelled", "Your booking is cancelled", body)
    _sync_calendar(cancelled)
    return cancelled


def finish(booking: dict, status: str) -> dict:
    if status not in ("completed", "no_show"):
        raise BookingError("Choose done or no-show.")
    if booking.get("status") != "confirmed":
        raise BookingError("Only a confirmed booking can be marked done or no-show.")
    if parse(booking["starts_at"]) > now_utc():
        raise BookingError("Mark it after it has started.")
    return _update(booking, {"status": status})


def mark_refunded(booking: dict) -> dict:
    if booking.get("refund") != "due":
        raise BookingError("There's no refund due on this booking.")
    return _update(booking, {"refund": "done"})


def update_details(booking: dict, values: dict) -> dict:
    allowed = {k: v for k, v in values.items() if k in ("call_link", "brief", "host_note")}
    link = allowed.get("call_link")
    if link is not None:
        link = link.strip()
        if link and (not link.startswith("https://") or len(link) > 500 or " " in link):
            raise BookingError("The call link must start with https://")
        allowed["call_link"] = link or None
    for key in ("brief", "host_note"):
        if key in allowed and allowed[key] is not None:
            allowed[key] = allowed[key].strip()[:2000] or None
    updated = _update(booking, allowed)
    if link and booking.get("status") == "confirmed" and link != booking.get("call_link"):
        _email(updated, "link", "Your call link is ready",
               f"{KIND_LABEL.get(booking['kind'], 'Booking')} on {when_text(parse(booking['starts_at']), booking.get('member_time_zone'))}. "
               "Open your booking to join.")
    return updated


def _withdraw_invoice(booking: dict) -> None:
    if not booking.get("invoice_id"):
        return
    try:
        invoice = one(db().table("commerce_invoices").select("id,status,shopify_draft_order_id")
                      .eq("id", str(booking["invoice_id"])).limit(1).execute())
        if not invoice or invoice.get("status") != "sent":
            return
        db().table("commerce_invoices").update({"status": "cancelled", "error": "The booking hold ended."}) \
            .eq("id", invoice["id"]).eq("status", "sent").execute()
        if invoice.get("shopify_draft_order_id"):
            from app.commerce import shopify
            try:
                shopify.delete_draft_order(str(invoice["shopify_draft_order_id"]))
            except Exception:
                logger.warning("Could not delete the Shopify draft order for an ended hold", exc_info=True)
    except Exception:
        logger.exception("Could not withdraw a booking invoice")


def _source_cancelled(booking: dict) -> None:
    if booking.get("source_table") == "member_consultations" and booking.get("source_id"):
        try:
            db().table("member_consultations").update({"status": "cancelled", "updated_at": now_utc().isoformat()}) \
                .eq("id", str(booking["source_id"])).in_("status", ["awaiting_payment", "requested", "scheduled"]).execute()
        except Exception:
            logger.exception("Could not cancel the consultation behind a booking")
    if booking.get("work_item_id"):
        try:
            db().table("operations_work_items").update({
                "next_action": f"Booking cancelled ({booking.get('cancelled_by')})."
                + (" Refund it in Shopify, then mark it refunded in Bookings." if booking.get("refund") == "due" else ""),
                "updated_at": now_utc().isoformat()}).eq("id", str(booking["work_item_id"])).execute()
        except Exception:
            logger.exception("Could not update the booking work item")


def _email(booking: dict, key: str, title: str, body: str) -> None:
    if not booking.get("member_id"):
        return
    commerce.queue_email(str(booking["member_id"]), category="notifications", template=f"commerce_booking_{key}",
                         title=title, body=body, href="/member/chat?panel=tools&tool=consultation")


def _sync_calendar(booking: dict) -> None:
    """Google Calendar (batch 6) plugs in here; nothing to do until a calendar is connected."""
    return None


# ---------------------------------------------------------------------------------------------
# Sweep: expired holds, reminders, follow-ups
# ---------------------------------------------------------------------------------------------
def sweep(now: datetime | None = None) -> dict[str, int]:
    now = now or now_utc()
    counts = {"expired": 0, "reminded": 0, "followed_up": 0}
    for booking in rows(db().table("bookings").select(FIELDS).eq("status", "held")
                        .lt("hold_expires_at", now.isoformat()).limit(200).execute()):
        try:
            cancel(booking, by="system", reason="The payment didn't arrive within the hold.")
            counts["expired"] += 1
        except Exception:
            logger.exception("Could not release an expired hold")
    upcoming = rows(db().table("bookings").select(FIELDS).eq("status", "confirmed").gt("starts_at", now.isoformat())
                    .lt("starts_at", (now + timedelta(hours=24, minutes=5)).isoformat()).limit(500).execute())
    for booking in upcoming:
        starts = parse(booking["starts_at"])
        sent = dict(booking.get("reminders") or {})
        key = "1h" if starts - now <= timedelta(hours=1, minutes=5) else "24h"
        if sent.get(key) or (key == "24h" and sent.get("1h")):
            continue
        link = " Your call link is in your booking." if booking.get("call_link") else ""
        _email(booking, f"reminder_{key}", "Starting in 1 hour" if key == "1h" else "Your booking is tomorrow",
               f"{KIND_LABEL.get(booking['kind'], 'Booking')} on {when_text(starts, booking.get('member_time_zone'))}.{link}")
        sent[key] = now.isoformat()
        _update(booking, {"reminders": sent})
        counts["reminded"] += 1
    for booking in rows(db().table("bookings").select(FIELDS).eq("status", "completed")
                        .gt("ends_at", (now - timedelta(days=3)).isoformat()).limit(200).execute()):
        sent = dict(booking.get("reminders") or {})
        if sent.get("followup"):
            continue
        _email(booking, "followup", "How did it go?",
               "Thanks for your time with FayFort. Tell us how it went: your rating helps us improve.")
        sent["followup"] = now.isoformat()
        _update(booking, {"reminders": sent})
        counts["followed_up"] += 1
    return counts


async def bookings_loop(interval_seconds: int = 300) -> None:
    await asyncio.sleep(45)
    while True:
        try:
            counts = await asyncio.to_thread(sweep)
            if any(counts.values()):
                logger.info("Bookings sweep: %s", counts)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Bookings sweep failed; will retry")
        await asyncio.sleep(interval_seconds)


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]
