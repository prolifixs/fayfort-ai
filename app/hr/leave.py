"""HR H6 (docs/HR_AND_HIRING_PLAN.md section 3.5): time off.

A team member asks for leave in My HR (type, dates, a half day for a one-day request, a note). The request is a
`staff_time_off` row with status "requested"; it blocks nothing until it is approved. The person's manager approves it,
or HR (the HR flag, the CEO, platform admins) when there is no manager. Approved leave blocks the person's bookable
time through the booking engine. Leave days count only working days (People -> Settings) that aren't public holidays.
Yearly allowances per leave type are set in People -> Settings and pro-rated from the person's start date.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.commerce.db import audit, db, one, rows
from app.hr import service
from app.hr.service import HrError

logger = logging.getLogger(__name__)

CHINA = ZoneInfo("Asia/Shanghai")
OPEN = ("requested", "approved")
FIELDS = ("id,worker_id,leave_type,status,start_date,end_date,half_day,days,note,approver_id,decided_at,decision_note,"
          "starts_at,ends_at,created_at")
MAX_DAYS = 60


def today() -> date:
    return service.now_utc().astimezone(CHINA).date()


# ---- Settings ----------------------------------------------------------------------------------------------------
def leave_types(active_only: bool = False) -> list[dict]:
    found = rows(db().table("hr_leave_types").select("*").order("position").limit(50).execute())
    return [t for t in found if t.get("active", True) or not active_only]


def work_days() -> list[int]:
    found = one(db().table("hr_settings").select("work_days").eq("id", 1).limit(1).execute()) or {}
    days = found.get("work_days")
    return sorted(int(d) for d in days) if days else [0, 1, 2, 3, 4, 5]


def holidays(start: date | None = None, end: date | None = None) -> list[dict]:
    query = db().table("hr_public_holidays").select("day,name,region").order("day").limit(500)
    if start:
        query = query.gte("day", start.isoformat())
    if end:
        query = query.lte("day", end.isoformat())
    return rows(query.execute())


def settings_view() -> dict:
    return {"leave_types": leave_types(), "work_days": work_days(),
            "holidays": holidays(date(today().year - 1, 1, 1), date(today().year + 2, 12, 31))}


def save_settings(fields: dict, actor_id: str) -> dict:
    if "work_days" in fields and fields["work_days"] is not None:
        days = sorted({int(d) for d in fields["work_days"] if 0 <= int(d) <= 6})
        if not days:
            raise HrError("Choose at least one working day.", 422)
        db().table("hr_settings").upsert({"id": 1, "work_days": days, "updated_by": actor_id, "updated_at": service.now_iso()},
                                         on_conflict="id").execute()
    for item in fields.get("leave_types") or []:
        key = str(item.get("key") or "")
        if not one(db().table("hr_leave_types").select("key").eq("key", key).limit(1).execute()):
            raise HrError("Unknown leave type.", 422)
        values: dict[str, Any] = {}
        if "yearly_days" in item:
            value = item["yearly_days"]
            if value not in (None, ""):
                value = round(float(value) * 2) / 2
                if not 0 <= value <= 365:
                    raise HrError("Allowances are 0 to 365 days.", 422)
            values["yearly_days"] = None if value in (None, "") else value
        for flag in ("active", "needs_approval"):
            if flag in item and item[flag] is not None:
                values[flag] = bool(item[flag])
        if "name" in item and service.clean(item["name"], 60):
            values["name"] = service.clean(item["name"], 60)
        if values:
            db().table("hr_leave_types").update(values).eq("key", key).execute()
    if "holidays" in fields and fields["holidays"] is not None:
        cleaned = {}
        for item in fields["holidays"][:200]:
            try:
                day = date.fromisoformat(str(item.get("day"))[:10])
            except ValueError:
                raise HrError("A holiday date isn't valid.", 422)
            name = service.clean(item.get("name"), 80)
            if not name:
                raise HrError(f"Name the holiday on {day.isoformat()}.", 422)
            region = (service.clean(item.get("region"), 40) or "china").lower()
            cleaned[(day.isoformat(), region)] = {"day": day.isoformat(), "name": name, "region": region}
        db().table("hr_public_holidays").delete().gte("day", "1900-01-01").execute()
        if cleaned:
            db().table("hr_public_holidays").insert(list(cleaned.values())).execute()
    audit(actor_id, "hr.leave.settings", {"fields": sorted(k for k in fields if fields[k] is not None)})
    return settings_view()


# ---- Counting days -----------------------------------------------------------------------------------------------
def count_days(start: date, end: date, half_day: str | None = None, *, days_off: set[str] | None = None,
               working: list[int] | None = None) -> float:
    working = working if working is not None else work_days()
    days_off = days_off if days_off is not None else {h["day"] for h in holidays(start, end)}
    total, day = 0.0, start
    while day <= end:
        if day.weekday() in working and day.isoformat() not in days_off:
            total += 1
        day += timedelta(days=1)
    if half_day and start == end and total:
        total = 0.5
    return total


def span(start: date, end: date, half_day: str | None) -> tuple[datetime, datetime]:
    """The time blocked in the booking engine, in China time (where the team works)."""
    begin = datetime.combine(start, datetime.min.time(), CHINA)
    finish = datetime.combine(end + timedelta(days=1), datetime.min.time(), CHINA)
    if half_day == "morning":
        finish = datetime.combine(start, datetime.min.time(), CHINA) + timedelta(hours=13)
    elif half_day == "afternoon":
        begin = datetime.combine(start, datetime.min.time(), CHINA) + timedelta(hours=13)
    return begin, finish


# ---- Balances ----------------------------------------------------------------------------------------------------
def _start_date(worker_id: str) -> date | None:
    rec = one(db().table("hr_employment").select("start_date").eq("worker_id", worker_id).limit(1).execute()) or {}
    return date.fromisoformat(str(rec["start_date"])[:10]) if rec.get("start_date") else None


def allowance(yearly: float, start: date | None, year: int) -> float:
    """Pro-rated to the half day for people who started during the year."""
    if start and start.year == year:
        months_left = 12 - start.month + (1 if start.day <= 15 else 0)
        return round(yearly * months_left / 12 * 2) / 2
    if start and start.year > year:
        return 0.0
    return float(yearly)


def balances(worker_id: str, year: int | None = None) -> list[dict]:
    year = year or today().year
    start = _start_date(worker_id)
    requests = rows(db().table("staff_time_off").select("leave_type,status,days,start_date").eq("worker_id", worker_id)
                    .in_("status", list(OPEN)).gte("start_date", f"{year}-01-01").lte("start_date", f"{year}-12-31")
                    .limit(500).execute())
    out = []
    for kind in leave_types(active_only=True):
        mine = [r for r in requests if r.get("leave_type") == kind["key"]]
        used = sum(float(r.get("days") or 0) for r in mine if r["status"] == "approved")
        pending = sum(float(r.get("days") or 0) for r in mine if r["status"] == "requested")
        total = allowance(float(kind["yearly_days"]), start, year) if kind.get("yearly_days") is not None else None
        out.append({"key": kind["key"], "name": kind["name"], "allowance": total, "used": used, "pending": pending,
                    "left": (total - used - pending) if total is not None else None})
    return out


# ---- Requests ----------------------------------------------------------------------------------------------------
def approvers_for(worker_id: str) -> list[str]:
    """The person's manager; with none, HR staff and the CEO (platform admins are told separately)."""
    rec = one(db().table("hr_employment").select("manager_id").eq("worker_id", worker_id).limit(1).execute()) or {}
    if rec.get("manager_id") and str(rec["manager_id"]) != str(worker_id):
        return [str(rec["manager_id"])]
    return [str(w["user_id"]) for w in rows(db().table("fayfort_workers").select("user_id,hr_access,staff_role,status")
                                             .eq("status", "active").limit(500).execute())
            if (w.get("hr_access") is True or w.get("staff_role") == "ceo") and str(w["user_id"]) != str(worker_id)]


def can_decide(row: dict, actor: dict) -> bool:
    if str(row["worker_id"]) == str(actor["user_id"]):
        return False
    if actor.get("role") == "platform_admin" or service.worker_can_hire(actor["user_id"]):
        return True
    rec = one(db().table("hr_employment").select("manager_id").eq("worker_id", row["worker_id"]).limit(1).execute()) or {}
    return str(rec.get("manager_id") or "") == str(actor["user_id"])


def _get(time_off_id: str) -> dict:
    row = one(db().table("staff_time_off").select(FIELDS).eq("id", time_off_id).limit(1).execute())
    if not row or not row.get("leave_type"):
        raise HrError("That leave request doesn't exist.", 404)
    return row


def _clashes(worker_id: str, begin: datetime, finish: datetime, ignore: str | None = None) -> list[dict]:
    found = rows(db().table("staff_time_off").select("id,start_date,end_date,status").eq("worker_id", worker_id)
                 .in_("status", list(OPEN)).lt("starts_at", finish.isoformat()).gt("ends_at", begin.isoformat())
                 .limit(50).execute())
    return [r for r in found if str(r["id"]) != str(ignore or "")]


def request(worker_id: str, fields: dict, actor_id: str, *, approved_by_hr: bool = False) -> dict:
    kind = one(db().table("hr_leave_types").select("*").eq("key", str(fields.get("leave_type") or "")).limit(1).execute())
    if not kind or not kind.get("active", True):
        raise HrError("Choose a type of leave.", 422)
    try:
        start = date.fromisoformat(str(fields.get("start_date"))[:10])
        end = date.fromisoformat(str(fields.get("end_date") or fields.get("start_date"))[:10])
    except ValueError:
        raise HrError("Choose the dates.", 422)
    if end < start:
        raise HrError("The last day can't be before the first day.", 422)
    if (end - start).days + 1 > MAX_DAYS:
        raise HrError(f"Ask for at most {MAX_DAYS} days at a time.", 422)
    if not approved_by_hr and start < today() and kind["key"] != "sick":
        raise HrError("Leave can't start in the past. Sick leave can be recorded afterwards.", 422)
    half = fields.get("half_day") or None
    if half and half not in ("morning", "afternoon"):
        raise HrError("Choose morning or afternoon.", 422)
    if half and start != end:
        raise HrError("A half day is for a one-day request.", 422)
    days = count_days(start, end, half)
    if days <= 0:
        raise HrError("Those dates are all days off already (weekends or public holidays).", 422)
    begin, finish = span(start, end, half)
    if _clashes(worker_id, begin, finish):
        raise HrError("You already have leave asked for or approved on some of those days.", 409)
    auto = approved_by_hr or not kind.get("needs_approval", True)
    row = one(db().table("staff_time_off").insert({
        "worker_id": worker_id, "leave_type": kind["key"], "status": "approved" if auto else "requested",
        "start_date": start.isoformat(), "end_date": end.isoformat(), "half_day": half, "days": days,
        "starts_at": begin.isoformat(), "ends_at": finish.isoformat(), "reason": kind["name"][:200],
        "note": service.clean(fields.get("note"), 500), "created_by": actor_id,
        "approver_id": actor_id if approved_by_hr else None, "decided_at": service.now_iso() if auto else None,
        "updated_at": service.now_iso()}).execute())
    if not row:
        raise HrError("The request couldn't be saved.", 503)
    if not auto:
        name = _name(worker_id)
        _notify(approvers_for(worker_id), f"{name} asked for {kind['name'].lower()}",
                f"{_dates(start, end, half)} ({_days_text(days)}). Approve or decline in My account, My HR.",
                f"leave:{row['id']}:asked")
    audit(actor_id, "hr.leave.requested" if not approved_by_hr else "hr.leave.recorded",
          {"worker_id": worker_id, "time_off_id": row["id"], "days": days})
    return row


def decide(time_off_id: str, decision: str, note: str | None, actor: dict) -> dict:
    row = _get(time_off_id)
    if row["status"] != "requested":
        raise HrError("This request was already answered.", 409)
    if not can_decide(row, actor):
        raise HrError("Only the person's manager or HR can answer this.", 403)
    if decision not in ("approve", "decline"):
        raise HrError("Approve or decline.", 422)
    status = "approved" if decision == "approve" else "declined"
    db().table("staff_time_off").update({"status": status, "approver_id": actor["user_id"], "decided_at": service.now_iso(),
                                         "decision_note": service.clean(note, 500), "updated_at": service.now_iso()}) \
        .eq("id", time_off_id).execute()
    kind = one(db().table("hr_leave_types").select("name").eq("key", row["leave_type"]).limit(1).execute()) or {}
    start, end = date.fromisoformat(row["start_date"]), date.fromisoformat(row["end_date"])
    _notify([str(row["worker_id"])], f"Your {(kind.get('name') or 'leave').lower()} was {status}",
            f"{_dates(start, end, row.get('half_day'))}." + (f" Note: {service.clean(note, 300)}" if note else ""),
            f"leave:{time_off_id}:{status}")
    audit(actor["user_id"], f"hr.leave.{status}", {"time_off_id": time_off_id, "worker_id": row["worker_id"]})
    return {**_get(time_off_id), "clashing_bookings": clashing_bookings(row) if status == "approved" else 0}


def cancel(time_off_id: str, actor: dict, *, as_hr: bool = False) -> dict:
    row = _get(time_off_id)
    own = str(row["worker_id"]) == str(actor["user_id"])
    if not own and not as_hr:
        raise HrError("That leave request doesn't exist.", 404)
    if row["status"] not in OPEN:
        raise HrError("This request is already closed.", 409)
    if own and not as_hr and row["status"] == "approved" and date.fromisoformat(row["start_date"]) <= today():
        raise HrError("Leave that has started can only be changed by HR.", 409)
    db().table("staff_time_off").update({"status": "cancelled", "updated_at": service.now_iso()}).eq("id", time_off_id).execute()
    if own and row["status"] == "approved":
        _notify(approvers_for(str(row["worker_id"])), f"{_name(str(row['worker_id']))} cancelled approved leave",
                _dates(date.fromisoformat(row["start_date"]), date.fromisoformat(row["end_date"]), row.get("half_day")),
                f"leave:{time_off_id}:cancelled")
    audit(actor["user_id"], "hr.leave.cancelled", {"time_off_id": time_off_id})
    return _get(time_off_id)


def clashing_bookings(row: dict) -> int:
    return len(rows(db().table("bookings").select("id").eq("host_id", row["worker_id"]).in_("status", ["held", "confirmed"])
                    .lt("starts_at", row["ends_at"]).gt("blocked_until", row["starts_at"]).limit(100).execute()))


# ---- Views -------------------------------------------------------------------------------------------------------
def _view(row: dict, names: dict, types: dict) -> dict:
    return {**{k: row.get(k) for k in ("id", "worker_id", "leave_type", "status", "start_date", "end_date", "half_day",
                                         "days", "note", "decided_at", "decision_note", "created_at")},
            "type_name": types.get(row.get("leave_type"), row.get("leave_type")),
            "name": names.get(str(row["worker_id"]), {}).get("name", "FayFort team"),
            "approver_name": names.get(str(row.get("approver_id")), {}).get("name") if row.get("approver_id") else None}


def _names(ids: list[str]) -> dict:
    from app.workforce.team import people
    return people(list(dict.fromkeys(i for i in ids if i)))


def mine(worker_id: str) -> dict:
    types = {t["key"]: t["name"] for t in leave_types()}
    own = rows(db().table("staff_time_off").select(FIELDS).eq("worker_id", worker_id).gte("end_date", f"{today().year - 1}-01-01")
               .order("start_date", desc=True).limit(100).execute())
    own = [r for r in own if r.get("leave_type")]
    team_ids = [str(r["worker_id"]) for r in rows(db().table("hr_employment").select("worker_id").eq("manager_id", worker_id)
                                                   .limit(200).execute())]
    to_answer = rows(db().table("staff_time_off").select(FIELDS).in_("worker_id", team_ids).eq("status", "requested")
                     .order("start_date").limit(100).execute()) if team_ids else []
    names = _names([worker_id] + [str(r["worker_id"]) for r in to_answer] + [str(r.get("approver_id") or "") for r in own])
    return {"types": [{"key": t["key"], "name": t["name"]} for t in leave_types(active_only=True)],
            "balances": balances(worker_id), "requests": [_view(r, names, types) for r in own],
            "to_answer": [{**_view(r, names, types), "clashing_bookings": clashing_bookings(r)} for r in to_answer],
            "work_days": work_days()}


def calendar(month: str | None = None) -> dict:
    """Everyone's leave in a month (China dates), plus every request waiting for an answer."""
    try:
        first = date.fromisoformat(f"{month}-01") if month else today().replace(day=1)
    except ValueError:
        raise HrError("Choose a month.", 422)
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    types = {t["key"]: t["name"] for t in leave_types()}
    in_month = rows(db().table("staff_time_off").select(FIELDS).in_("status", list(OPEN)).lte("start_date", last.isoformat())
                    .gte("end_date", first.isoformat()).limit(1000).execute())
    waiting = rows(db().table("staff_time_off").select(FIELDS).eq("status", "requested").order("start_date").limit(200).execute())
    found = [r for r in in_month + waiting if r.get("leave_type")]
    names = _names([str(r["worker_id"]) for r in found] + [str(r.get("approver_id") or "") for r in found])
    return {"month": first.isoformat()[:7], "first": first.isoformat(), "last": last.isoformat(),
            "leave": [_view(r, names, types) for r in in_month if r.get("leave_type")],
            "waiting": [{**_view(r, names, types), "clashing_bookings": clashing_bookings(r)} for r in waiting if r.get("leave_type")],
            "holidays": holidays(first, last), "work_days": work_days()}


def away_until(worker_ids: list[str]) -> dict[str, str]:
    """Who is on approved leave today, and their last day."""
    day = today().isoformat()
    found = rows(db().table("staff_time_off").select("worker_id,start_date,end_date,leave_type,status").in_("worker_id", worker_ids)
                 .eq("status", "approved").lte("start_date", day).gte("end_date", day).limit(500).execute()) if worker_ids else []
    return {str(r["worker_id"]): r["end_date"] for r in found if r.get("leave_type")}


# ---- Small helpers -----------------------------------------------------------------------------------------------
def _name(worker_id: str) -> str:
    return _names([worker_id]).get(worker_id, {}).get("name", "Someone")


def _dates(start: date, end: date, half: str | None) -> str:
    text = lambda d: f"{d:%a} {d.day} {d:%b}"  # noqa: E731
    if start == end:
        return text(start) + (f", {half}" if half else "")
    return f"{text(start)} to {text(end)}"


def _days_text(days: float) -> str:
    return f"{days:g} day" + ("" if days == 1 else "s")


def _notify(worker_ids: list[str], title: str, body: str, key: str) -> None:
    try:
        if worker_ids:
            db().table("operations_worker_notifications").upsert([
                {"worker_id": w, "notification_type": "time_off", "title": title[:160], "body": body[:500], "href": "/operations",
                 "dedupe_key": f"{key}:{w}"} for w in worker_ids], on_conflict="dedupe_key", ignore_duplicates=True).execute()
    except Exception:
        logger.exception("Could not send a time-off notice")
