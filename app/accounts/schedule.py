"""The Operations Schedule (docs/CATALOG_MERCHANDISING_PLAN.md §5): one calendar of what is coming.

It is a view, never a second place to edit: every entry links to the task or setup page that owns it.

Entry types: giveaway (starts, ends, draw), sale (starts, ends), section (goes live, ends, refresh due), launch
(planned go-live of a listing), deadline (open work items), recurring (next run of a member's recurring order) and
booking (consultations and sessions: everyone for admins and the CEO's assistant, otherwise the ones you host).
Workers see the shop calendar plus their own deadlines and the open work in their departments; recurring orders only
for Sourcing. Administrators see everything and can filter by person and department.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.commerce.db import db, rows

MAX_DAYS = 62
TYPES = ("giveaway", "sale", "section", "launch", "deadline", "recurring", "booking")
ACTIVE = ("open", "claimed", "waiting", "blocked")


def parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _within(value: Any, start: datetime, end: datetime) -> bool:
    moment = parse(value)
    return bool(moment and start <= moment < end)


def _entry(kind: str, key: str, title: str, at: Any, *, status: str, href: str, detail: str = "",
           work_item_id: str | None = None, department: str | None = None, worker_id: str | None = None) -> dict:
    return {"id": f"{kind}:{key}", "type": kind, "title": title[:160], "at": parse(at).isoformat() if parse(at) else at,
            "status": status, "href": href, "detail": detail[:240], "work_item_id": work_item_id,
            "department": department, "worker_id": worker_id}


def build_schedule(*, start: datetime, end: datetime, admin: bool, user_id: str, departments: list[str],
                   types: set[str] | None = None, department: str | None = None, worker_id: str | None = None,
                   now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    if end <= start:
        raise ValueError("The end must be after the start.")
    if end - start > timedelta(days=MAX_DAYS):
        raise ValueError(f"Ask for at most {MAX_DAYS} days at a time.")
    wanted = set(types or TYPES) & set(TYPES)
    start_iso, end_iso = start.isoformat(), end.isoformat()
    out: list[dict] = []
    shop_view = department in (None, "", "store_team", "member_support")

    if "giveaway" in wanted and shop_view:
        for g in rows(db().table("commerce_giveaways").select("id,title,starts_at,ends_at,status,drawn_at,wrapped_up_at")
                      .in_("status", ["draft", "open", "drawn"]).lte("starts_at", end_iso).gte("ends_at", (start - timedelta(days=8)).isoformat())
                      .limit(200).execute()):
            href = "/?page=shop&tab=giveaways"
            planned = g["status"] == "draft"
            if _within(g["starts_at"], start, end):
                out.append(_entry("giveaway", f"{g['id']}:start", f"Giveaway starts: {g['title']}", g["starts_at"],
                                  status="planned" if planned else ("done" if parse(g["starts_at"]) <= now else "scheduled"),
                                  href=href, detail="Draft: not open yet" if planned else ""))
            if _within(g["ends_at"], start, end):
                drawn = g["status"] == "drawn"
                ended = parse(g["ends_at"]) <= now
                out.append(_entry("giveaway", f"{g['id']}:draw", f"Draw winners: {g['title']}", g["ends_at"],
                                  status="done" if drawn else ("overdue" if ended else "scheduled"), href=href,
                                  detail="Winners drawn" if drawn else "The draw task opens when it ends"))
    if "sale" in wanted and shop_view:
        for s in rows(db().table("commerce_flash_sales").select("id,title,starts_at,ends_at,status,code")
                      .in_("status", ["scheduled"]).lte("starts_at", end_iso).gte("ends_at", start_iso).limit(200).execute()):
            label = f"Code {s['code']}" if s.get("code") else "Flash sale"
            if _within(s["starts_at"], start, end):
                out.append(_entry("sale", f"{s['id']}:start", f"{label} starts: {s['title']}", s["starts_at"],
                                  status="done" if parse(s["starts_at"]) <= now else "scheduled",
                                  href="/?page=shop&tab=sales"))
            if _within(s["ends_at"], start, end):
                out.append(_entry("sale", f"{s['id']}:end", f"{label} ends: {s['title']}", s["ends_at"],
                                  status="done" if parse(s["ends_at"]) <= now else "scheduled",
                                  href="/?page=shop&tab=sales"))
    if "section" in wanted and department in (None, "", "store_team"):
        for sec in rows(db().table("merch_sections").select("id,title,starts_at,ends_at,status")
                        .eq("status", "published").lte("starts_at", end_iso).limit(300).execute()):
            href = f"/operations?view=products&tab=sections&section={sec['id']}"
            if _within(sec["starts_at"], start, end):
                out.append(_entry("section", f"{sec['id']}:start", f"Section goes live: {sec['title']}", sec["starts_at"],
                                  status="done" if parse(sec["starts_at"]) <= now else "scheduled", href=href))
            ends = parse(sec.get("ends_at"))
            if ends and start <= ends < end:
                out.append(_entry("section", f"{sec['id']}:end", f"Section ends: {sec['title']}", sec["ends_at"],
                                  status="done" if ends <= now else "scheduled", href=href))
            if ends and start <= ends - timedelta(days=2) < end and ends > now:
                out.append(_entry("section", f"{sec['id']}:refresh", f"Refresh due: {sec['title']}",
                                  (ends - timedelta(days=2)).isoformat(), status="scheduled", href=href,
                                  detail="Swap products or set new dates"))
    if "launch" in wanted and department in (None, "", "store_team"):
        for listing in rows(db().table("store_listings").select("id,title,kind,status,planned_live_at")
                            .in_("status", ["draft", "in_review", "changes_requested"]).gte("planned_live_at", start_iso)
                            .lt("planned_live_at", end_iso).limit(200).execute()):
            late = (parse(listing["planned_live_at"]) or now) <= now
            out.append(_entry("launch", listing["id"], f"Launch: {listing.get('title') or 'new listing'}",
                              listing["planned_live_at"], status="overdue" if late else "scheduled",
                              href=f"/operations?view=products&listing={listing['id']}",
                              detail="Waiting for review" if listing["status"] == "in_review" else "Being prepared"))
    if "deadline" in wanted:
        query = (db().table("operations_work_items").select("id,summary,department,status,due_at,assigned_worker_id,work_type")
                 .in_("status", list(ACTIVE)).gte("due_at", start_iso).lt("due_at", end_iso))
        if department:
            query = query.eq("department", department)
        for item in rows(query.limit(1000).execute()):
            if not admin and not (item.get("assigned_worker_id") == user_id
                                  or (item.get("department") in departments and not item.get("assigned_worker_id"))):
                continue
            if admin and worker_id and item.get("assigned_worker_id") != worker_id:
                continue
            due = parse(item["due_at"])
            out.append(_entry("deadline", item["id"], item.get("summary") or "Work item", item["due_at"],
                              status="overdue" if due and due <= now else ("waiting" if item["status"] == "waiting" else "scheduled"),
                              href=f"/operations?workItem={item['id']}", work_item_id=item["id"],
                              department=item.get("department"), worker_id=item.get("assigned_worker_id")))
    if "recurring" in wanted and (admin or "sourcing" in departments) and department in (None, "", "sourcing"):
        for schedule in rows(db().table("member_request_schedules").select("id,originating_request_id,next_due_at,status,cadence")
                             .eq("status", "active").gte("next_due_at", start_iso).lt("next_due_at", end_iso).limit(500).execute()):
            out.append(_entry("recurring", schedule["id"], "Recurring order comes due", schedule["next_due_at"],
                              status="scheduled", href="/operations?view=queue",
                              detail=f"{str(schedule.get('cadence') or '').replace('_', ' ')} · a new sourcing request opens by itself",
                              department="sourcing"))
    if "booking" in wanted and department in (None, "", "member_support"):
        sees_all = admin
        if not admin:
            role = rows(db().table("fayfort_workers").select("staff_role").eq("user_id", user_id).limit(1).execute())
            sees_all = bool(role) and role[0].get("staff_role") == "assistant"
        query = (db().table("bookings").select("id,kind,status,starts_at,host_id,topic,member_id")
                 .in_("status", ["held", "confirmed", "completed", "no_show"]).gte("starts_at", start_iso).lt("starts_at", end_iso))
        if not sees_all:
            query = query.eq("host_id", user_id)
        elif admin and worker_id:
            query = query.eq("host_id", worker_id)
        labels = {"consultation": "Consultation", "session": "Session", "tour": "Tour"}
        for booking in rows(query.limit(1000).execute()):
            held = booking["status"] == "held"
            out.append(_entry("booking", booking["id"], f"{labels.get(booking['kind'], 'Booking')}"
                              + (f": {booking['topic']}" if booking.get("topic") else ""), booking["starts_at"],
                              status="planned" if held else ("done" if booking["status"] in ("completed", "no_show") else "scheduled"),
                              href=f"/operations?view=bookings&booking={booking['id']}",
                              detail="Waiting for payment" if held else "", worker_id=booking.get("host_id")))
    out.sort(key=lambda e: (str(e.get("at") or ""), e["type"]))
    return out
