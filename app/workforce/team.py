"""Worker photos, working hours and customer ratings (docs/WORKFORCE_AND_REVENUE_PLAN.md).

Workers (Operations header and their Account page):
    POST/DELETE /workers/me/photo, GET /workers/me/shift, POST /workers/me/shift/clock-in | break | clock-out,
    GET /workers/me/shifts, POST /workers/me/shifts/{id}/correction, GET /workers/me/ratings
Admins (Control Center -> Workforce):
    GET /platform/workforce/timesheets, GET /platform/workforce/shifts.csv, PUT /platform/workforce/shifts/{id},
    POST /platform/workforce/corrections/{id}, DELETE /platform/workers/{id}/photo, GET /platform/workers/{id}/ratings
Members (chat and Orders & requests):
    GET /members/worker-ratings, POST /members/worker-ratings, POST /members/worker-ratings/{prompt_id}/dismiss

Times are stored in UTC and grouped into days in China time, where the team works (Mon-Sat 9:30-18:30).
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Literal
from urllib.parse import urljoin
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.commerce.db import db, one, rows
from app.directory.identity import trusted_fayfort_staff, trusted_platform_admin

logger = logging.getLogger(__name__)

CHINA = ZoneInfo("Asia/Shanghai")
PHOTO_BUCKET = "member-profile-photos"
MAX_PHOTO = 5 * 1024 * 1024
IMAGE_TYPES = {
    "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": ("webp", lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"),
}
STALE_MINUTES = 30          # no heartbeat for this long ends a shift
MAX_SHIFT_HOURS = 16
SUPPORT_DAYS = range(0, 6)  # Monday-Saturday
SUPPORT_START = time(9, 30)
SUPPORT_END = time(18, 30)
RATING_MIN_COUNT = 5        # an average shows once a worker has this many ratings
RATING_EDIT_DAYS = 7


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


def iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


# ---------------------------------------------------------------------------------------------
# People: names and photos
# ---------------------------------------------------------------------------------------------
def signed_photo(path: str | None) -> str | None:
    if not path:
        return None
    try:
        result = db().storage.from_(PHOTO_BUCKET).create_signed_url(path, 3600)
        url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if url and url.startswith("/"):
            from app.config.settings import settings
            url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", url.lstrip("/"))
        return url
    except Exception:
        logger.info("Worker photo link could not be made", exc_info=True)
        return None


def _auth_name(user_id: str) -> str | None:
    try:
        user = getattr(db().auth.admin.get_user_by_id(user_id), "user", None)
    except Exception:
        return None
    metadata = getattr(user, "user_metadata", None) or {}
    name = metadata.get("display_name") or metadata.get("full_name") or metadata.get("name")
    if name and str(name).strip():
        return str(name).strip()
    email = getattr(user, "email", None) or ""
    return email.split("@")[0] if email else None


def people(user_ids: list[str]) -> dict[str, dict]:
    """{id: {name, first_name, photo_url}} for staff shown to colleagues or members."""
    ids = list(dict.fromkeys(str(i) for i in user_ids if i))
    if not ids:
        return {}
    profiles = {str(r["user_id"]): r for r in rows(db().table("member_profiles").select("user_id,display_name,member_photo_path")
                                                    .in_("user_id", ids).execute())}
    found = {}
    for user_id in ids:
        profile = profiles.get(user_id, {})
        name = (profile.get("display_name") or "").strip() or _auth_name(user_id) or "FayFort team"
        found[user_id] = {"name": name, "first_name": name.split(" ")[0][:40],
                          "photo_url": signed_photo(profile.get("member_photo_path"))}
    return found


# ---------------------------------------------------------------------------------------------
# Shifts
# ---------------------------------------------------------------------------------------------
def worked_seconds(shift: dict, now: datetime | None = None) -> int:
    now = now or now_utc()
    start = parse(shift["started_at"])
    end = parse(shift.get("ended_at")) or now
    breaks = int(shift.get("break_seconds") or 0)
    on_break = parse(shift.get("on_break_since"))
    if on_break and not shift.get("ended_at"):
        breaks += max(0, int((now - on_break).total_seconds()))
    return max(0, int((end - start).total_seconds()) - breaks)


def day_seconds(shift: dict, now: datetime | None = None) -> dict[str, int]:
    """Worked seconds per China-time day. Breaks are spread across the days in proportion."""
    now = now or now_utc()
    start = parse(shift["started_at"])
    end = parse(shift.get("ended_at")) or now
    span = max(1, (end - start).total_seconds())
    ratio = worked_seconds(shift, now) / span
    result: dict[str, int] = {}
    cursor = start.astimezone(CHINA)
    stop = end.astimezone(CHINA)
    while cursor < stop:
        next_midnight = datetime.combine(cursor.date() + timedelta(days=1), time(0), CHINA)
        piece_end = min(next_midnight, stop)
        result[cursor.date().isoformat()] = result.get(cursor.date().isoformat(), 0) + int(
            (piece_end - cursor).total_seconds() * ratio)
        cursor = piece_end
    return result


def shift_view(shift: dict, now: datetime | None = None) -> dict:
    return {
        "id": shift["id"], "worker_id": str(shift["worker_id"]), "started_at": iso(parse(shift["started_at"])),
        "ended_at": iso(parse(shift.get("ended_at"))), "on_break": bool(shift.get("on_break_since")) and not shift.get("ended_at"),
        "on_break_since": iso(parse(shift.get("on_break_since"))), "break_seconds": int(shift.get("break_seconds") or 0),
        "worked_seconds": worked_seconds(shift, now), "ended_by": shift.get("ended_by"), "note": shift.get("note"),
        "flag": shift.get("flag"),
    }


def open_shift(worker_id: str) -> dict | None:
    return one(db().table("worker_shifts").select("*").eq("worker_id", worker_id).is_("ended_at", "null").limit(1).execute())


def end_stale_shifts(now: datetime | None = None) -> dict[str, int]:
    """Sweep: a shift ends at the last heartbeat once the worker has been gone 30 minutes, and never runs past
    16 hours. Both are flagged for an admin to check."""
    now = now or now_utc()
    open_shifts = rows(db().table("worker_shifts").select("*").is_("ended_at", "null").limit(500).execute())
    if not open_shifts:
        return {"auto_ended": 0, "capped": 0}
    seen = {str(r["worker_id"]): parse(r.get("last_seen_at")) for r in rows(
        db().table("operations_worker_presence").select("worker_id,last_seen_at")
        .in_("worker_id", [str(s["worker_id"]) for s in open_shifts]).execute())}
    counts = {"auto_ended": 0, "capped": 0}
    for shift in open_shifts:
        start = parse(shift["started_at"])
        last = seen.get(str(shift["worker_id"]))
        end, flag = None, None
        if start and now - start > timedelta(hours=MAX_SHIFT_HOURS):
            end, flag = start + timedelta(hours=MAX_SHIFT_HOURS), "capped"
        elif now - max(start, last or start) > timedelta(minutes=STALE_MINUTES):
            end, flag = max(start, last or start), "auto_ended"
        if not end:
            continue
        values = {"ended_at": iso(end), "ended_by": "auto", "flag": flag, "updated_at": iso(now)}
        on_break = parse(shift.get("on_break_since"))
        if on_break:
            values.update({"on_break_since": None,
                           "break_seconds": int(shift.get("break_seconds") or 0) + max(0, int((end - on_break).total_seconds()))})
        db().table("worker_shifts").update(values).eq("id", shift["id"]).is_("ended_at", "null").execute()
        counts["auto_ended" if flag == "auto_ended" else "capped"] += 1
    return counts


def coverage(shifts: list[dict], start_day: date, days: int, now: datetime | None = None) -> list[dict]:
    """For each support day (Mon-Sat) and hour, the share of that hour with at least one person on shift,
    averaged across the period. 0 means nobody covered it."""
    now = now or now_utc()
    intervals = [(parse(s["started_at"]), parse(s.get("ended_at")) or now) for s in shifts]
    totals: dict[tuple[int, int], list[float]] = {}
    for offset in range(days):
        day = start_day + timedelta(days=offset)
        if day.weekday() not in SUPPORT_DAYS:
            continue
        window_start = datetime.combine(day, SUPPORT_START, CHINA)
        window_end = datetime.combine(day, SUPPORT_END, CHINA)
        if window_start > now:
            continue
        for hour in range(SUPPORT_START.hour, SUPPORT_END.hour + 1):
            slot_start = max(window_start, datetime.combine(day, time(hour), CHINA))
            slot_end = min(window_end, datetime.combine(day, time(hour), CHINA) + timedelta(hours=1), now)
            if slot_end <= slot_start:
                continue
            pieces = sorted((max(a, slot_start), min(b, slot_end)) for a, b in intervals if a < slot_end and b > slot_start)
            covered, cursor = 0.0, slot_start
            for a, b in pieces:
                if b <= cursor:
                    continue
                covered += (b - max(a, cursor)).total_seconds()
                cursor = max(cursor, b)
            totals.setdefault((day.weekday(), hour), []).append(covered / (slot_end - slot_start).total_seconds())
    return [{"weekday": weekday, "hour": hour, "covered": round(sum(values) / len(values), 3)}
            for (weekday, hour), values in sorted(totals.items())]


# ---------------------------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------------------------
DEFAULT_RESET_TASKS = 20


def reset_every() -> int:
    """Completed tasks after which a worker's current rating goes back to a perfect 5.0 (0 = never)."""
    try:
        found = one(db().table("workforce_settings").select("value").eq("key", "rating_reset_tasks").limit(1).execute())
        value = int((found or {}).get("value", DEFAULT_RESET_TASKS))
        return max(0, min(500, value))
    except Exception:
        return DEFAULT_RESET_TASKS


def completed_tasks(worker_ids: list[str]) -> dict[str, list[datetime]]:
    found = rows(db().table("operations_work_items").select("assigned_worker_id,completed_at").eq("status", "completed")
                 .in_("assigned_worker_id", worker_ids).limit(50000).execute()) if worker_ids else []
    by_worker: dict[str, list[datetime]] = {}
    for item in found:
        when = parse(item.get("completed_at"))
        if when:
            by_worker.setdefault(str(item["assigned_worker_id"]), []).append(when)
    return {worker_id: sorted(times) for worker_id, times in by_worker.items()}


def rating_summary(ratings: list[dict], completed: list[datetime] | None = None, every: int | None = None,
                   now: datetime | None = None) -> dict:
    """All-time and 90-day averages (admins), plus the current score the worker sees: the average of the ratings
    since their last fresh start, or a perfect 5.0 when there are none yet."""
    now = now or now_utc()
    completed = completed or []
    every = DEFAULT_RESET_TASKS if every is None else every
    stars = [int(r["stars"]) for r in ratings]
    recent = [int(r["stars"]) for r in ratings if (parse(r["created_at"]) or now) > now - timedelta(days=90)]
    months: dict[str, list[int]] = {}
    for r in ratings:
        created = (parse(r["created_at"]) or now).astimezone(CHINA)
        months.setdefault(created.strftime("%Y-%m"), []).append(int(r["stars"]))
    resets = len(completed) // every if every else 0
    reset_at = completed[resets * every - 1] if resets else None
    current = [int(r["stars"]) for r in ratings if not reset_at or (parse(r["created_at"]) or now) > reset_at]
    enough = len(stars) >= RATING_MIN_COUNT
    return {
        "count": len(stars),
        "average": round(sum(stars) / len(stars), 2) if enough else None,
        "average_90_days": round(sum(recent) / len(recent), 2) if enough and recent else None,
        "is_new": not enough,
        "current": round(sum(current) / len(current), 2) if current else 5.0,
        "current_count": len(current),
        "fresh_start": {"every": every, "completed_tasks": len(completed), "resets": resets,
                        "last_reset_at": iso(reset_at),
                        "tasks_to_go": (every - len(completed) % every) if every else None},
        "distribution": {str(n): stars.count(n) for n in range(5, 0, -1)},
        "monthly": [{"month": month, "average": round(sum(v) / len(v), 2), "count": len(v)}
                    for month, v in sorted(months.items())[-12:]],
    }


def ratings_for(worker_ids: list[str]) -> dict[str, dict]:
    if not worker_ids:
        return {}
    found = rows(db().table("worker_ratings").select("worker_id,stars,created_at").in_("worker_id", worker_ids)
                 .limit(20000).execute())
    by_worker: dict[str, list[dict]] = {}
    for rating in found:
        by_worker.setdefault(str(rating["worker_id"]), []).append(rating)
    tasks, every = completed_tasks(worker_ids), reset_every()
    return {worker_id: rating_summary(by_worker.get(worker_id, []), tasks.get(worker_id, []), every)
            for worker_id in worker_ids}


# ---------------------------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------------------------
class ClockOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str | None = Field(default=None, max_length=500)


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    started_at: datetime
    ended_at: datetime
    reason: str = Field(min_length=3, max_length=500)


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]


class WorkforceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating_reset_tasks: int = Field(ge=0, le=500)


class RatingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt_id: UUID
    stars: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=600)


def _check_times(started: datetime, ended: datetime) -> tuple[datetime, datetime]:
    started, ended = parse(started), parse(ended)
    if ended < started:
        raise HTTPException(status_code=422, detail="The end has to be after the start.")
    if ended - started > timedelta(hours=MAX_SHIFT_HOURS):
        raise HTTPException(status_code=422, detail=f"A shift can't be longer than {MAX_SHIFT_HOURS} hours.")
    if ended > now_utc() + timedelta(minutes=5):
        raise HTTPException(status_code=422, detail="A shift can't end in the future.")
    return started, ended


def _week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def create_team_router(require_verified_member: Callable[[str | None], str]) -> APIRouter:
    router = APIRouter(tags=["workforce team"])

    def staff(authorization: str | None) -> dict:
        found = trusted_fayfort_staff(authorization)
        if not found:
            raise HTTPException(status_code=403, detail="A FayFort staff account is required.")
        return found

    def admin(authorization: str | None) -> str:
        found = trusted_platform_admin(authorization)
        if not found:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return found["user_id"]

    def fail(message: str) -> HTTPException:
        logger.exception(message)
        return HTTPException(status_code=503, detail=message)

    def notify_admins(kind: str, title: str, body: str, href: str, dedupe: str) -> None:
        try:
            db().rpc("notify_platform_admins", {"p_notification_type": kind, "p_work_item_id": None, "p_title": title,
                                                "p_body": body, "p_href": href, "p_dedupe": dedupe}).execute()
        except Exception:
            logger.warning("Administrators could not be notified", exc_info=True)

    def workforce_audit(actor: str, action: str, target: str, detail: dict) -> None:
        try:
            db().table("workforce_audit").insert({"actor_id": actor, "action": action, "target_id": target, "detail": detail}).execute()
        except Exception:
            logger.warning("Workforce audit entry could not be written", exc_info=True)

    # ---- photos ------------------------------------------------------------------------------
    async def _read_image(request: Request) -> tuple[bytes, str, str]:
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        image_type = IMAGE_TYPES.get(content_type)
        if not image_type:
            raise HTTPException(status_code=415, detail="Choose a JPEG, PNG or WebP photo.")
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_PHOTO:
                raise HTTPException(status_code=413, detail="Photos must be 5 MB or smaller.")
        if not content:
            raise HTTPException(status_code=422, detail="Choose a photo to upload.")
        if not image_type[1](content):
            raise HTTPException(status_code=415, detail="That file isn't the image type it says it is.")
        return bytes(content), content_type, image_type[0]

    def _set_photo(user_id: str, path: str | None) -> str | None:
        current = one(db().table("member_profiles").select("member_photo_path").eq("user_id", user_id).limit(1).execute())
        if current is None:
            raise HTTPException(status_code=404, detail="This account has no profile yet.")
        db().table("member_profiles").update({"member_photo_path": path}).eq("user_id", user_id).execute()
        old = current.get("member_photo_path")
        if old and old != path:
            try:
                db().storage.from_(PHOTO_BUCKET).remove([old])
            except Exception:
                logger.info("Old worker photo could not be removed", exc_info=True)
        return signed_photo(path)

    @router.post("/workers/me/photo", status_code=201)
    async def upload_photo(request: Request, authorization: str | None = Header(default=None)):
        me = staff(authorization)
        content, content_type, ext = await _read_image(request)
        path = f"{me['user_id']}/{uuid4()}.{ext}"
        try:
            db().storage.from_(PHOTO_BUCKET).upload(path, content, {"content-type": content_type, "upsert": "false"})
            return {"photo_url": _set_photo(me["user_id"], path)}
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("Your photo could not be saved.") from exc

    @router.delete("/workers/me/photo")
    def remove_photo(authorization: str | None = Header(default=None)):
        me = staff(authorization)
        try:
            _set_photo(me["user_id"], None)
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("Your photo could not be removed.") from exc
        return {"photo_url": None}

    @router.delete("/platform/workers/{worker_id}/photo")
    def admin_remove_photo(worker_id: UUID, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        try:
            _set_photo(str(worker_id), None)
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("The photo could not be removed.") from exc
        workforce_audit(actor, "worker.photo_removed", str(worker_id), {})
        return {"photo_url": None}

    # ---- my shift ----------------------------------------------------------------------------
    def my_state(worker_id: str) -> dict:
        now = now_utc()
        today = now.astimezone(CHINA).date()
        week = _week_start(today)
        since = datetime.combine(week, time(0), CHINA)
        recent = rows(db().table("worker_shifts").select("*").eq("worker_id", worker_id)
                      .gte("started_at", iso(since - timedelta(hours=MAX_SHIFT_HOURS))).limit(200).execute())
        current = next((s for s in recent if not s.get("ended_at")), None) or open_shift(worker_id)
        totals: dict[str, int] = {}
        for shift in recent:
            for day, seconds in day_seconds(shift, now).items():
                totals[day] = totals.get(day, 0) + seconds
        return {
            "shift": shift_view(current, now) if current else None,
            "today_seconds": totals.get(today.isoformat(), 0),
            "week_seconds": sum(seconds for day, seconds in totals.items() if day >= week.isoformat()),
            "server_time": iso(now),
        }

    @router.get("/workers/me/shift")
    def get_my_shift(authorization: str | None = Header(default=None)):
        me = staff(authorization)
        try:
            return my_state(me["user_id"])
        except Exception as exc:
            raise fail("Your shift could not be loaded.") from exc

    @router.post("/workers/me/shift/clock-in")
    def clock_in(authorization: str | None = Header(default=None)):
        me = staff(authorization)
        try:
            if not open_shift(me["user_id"]):
                db().table("worker_shifts").insert({"worker_id": me["user_id"], "started_at": iso(now_utc())}).execute()
                # Clocking in counts as being here: refresh the heartbeat so the 30-minute rule starts now.
                db().table("operations_worker_presence").upsert({"worker_id": me["user_id"], "last_seen_at": iso(now_utc())},
                                                               on_conflict="worker_id").execute()
            return my_state(me["user_id"])
        except Exception as exc:
            raise fail("You couldn't be clocked in. Try again.") from exc

    @router.post("/workers/me/shift/break")
    def toggle_break(authorization: str | None = Header(default=None)):
        me = staff(authorization)
        try:
            current = open_shift(me["user_id"])
            if not current:
                raise HTTPException(status_code=409, detail="Clock in first.")
            now = now_utc()
            on_break = parse(current.get("on_break_since"))
            values = ({"on_break_since": None, "break_seconds": int(current.get("break_seconds") or 0)
                       + max(0, int((now - on_break).total_seconds()))} if on_break else {"on_break_since": iso(now)})
            db().table("worker_shifts").update({**values, "updated_at": iso(now)}).eq("id", current["id"]).execute()
            return my_state(me["user_id"])
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("Your break couldn't be saved.") from exc

    @router.post("/workers/me/shift/clock-out")
    def clock_out(payload: ClockOut | None = None, authorization: str | None = Header(default=None)):
        me = staff(authorization)
        try:
            current = open_shift(me["user_id"])
            if not current:
                raise HTTPException(status_code=409, detail="You aren't clocked in.")
            now = now_utc()
            values = {"ended_at": iso(now), "ended_by": "worker", "updated_at": iso(now),
                      "note": ((payload.note if payload else None) or "").strip() or None}
            on_break = parse(current.get("on_break_since"))
            if on_break:
                values.update({"on_break_since": None, "break_seconds": int(current.get("break_seconds") or 0)
                               + max(0, int((now - on_break).total_seconds()))})
            db().table("worker_shifts").update(values).eq("id", current["id"]).execute()
            return my_state(me["user_id"])
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("You couldn't be clocked out. Try again.") from exc

    @router.get("/workers/me/shifts")
    def my_shifts(weeks: int = Query(default=2, ge=1, le=12), authorization: str | None = Header(default=None)):
        me = staff(authorization)
        since = now_utc() - timedelta(weeks=weeks)
        try:
            found = rows(db().table("worker_shifts").select("*").eq("worker_id", me["user_id"]).gte("started_at", iso(since))
                         .order("started_at", desc=True).limit(300).execute())
            pending = rows(db().table("worker_shift_corrections").select("shift_id,status,created_at")
                           .eq("worker_id", me["user_id"]).eq("status", "pending").limit(50).execute())
        except Exception as exc:
            raise fail("Your hours could not be loaded.") from exc
        waiting = {str(c["shift_id"]) for c in pending}
        return {"shifts": [{**shift_view(s), "correction_pending": str(s["id"]) in waiting} for s in found]}

    @router.post("/workers/me/shifts/{shift_id}/correction", status_code=201)
    def request_correction(shift_id: UUID, payload: Correction, authorization: str | None = Header(default=None)):
        me = staff(authorization)
        started, ended = _check_times(payload.started_at, payload.ended_at)
        try:
            shift = one(db().table("worker_shifts").select("*").eq("id", str(shift_id)).eq("worker_id", me["user_id"])
                        .limit(1).execute())
            if not shift:
                raise HTTPException(status_code=404, detail="Shift not found.")
            if not shift.get("ended_at"):
                raise HTTPException(status_code=409, detail="Clock out first, then ask for a correction.")
            db().table("worker_shift_corrections").insert({
                "shift_id": shift["id"], "worker_id": me["user_id"], "requested_by": me["user_id"],
                "previous_started_at": shift["started_at"], "previous_ended_at": shift["ended_at"],
                "proposed_started_at": iso(started), "proposed_ended_at": iso(ended), "reason": payload.reason.strip(),
                "status": "pending",
            }).execute()
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("Your correction couldn't be sent.") from exc
        name = people([me["user_id"]]).get(me["user_id"], {}).get("first_name", "A worker")
        notify_admins("review_needed", f"{name} asked to correct a shift", payload.reason.strip()[:200],
                      "/?page=workforce#timesheets", f"shift-correction:{shift_id}:{iso(started)}")
        return {"requested": True}

    # ---- admin timesheets -------------------------------------------------------------------
    def timesheet(start: date, days: int) -> dict:
        now = now_utc()
        since = datetime.combine(start, time(0), CHINA)
        until = since + timedelta(days=days)
        shifts = [s for s in rows(db().table("worker_shifts").select("*")
                                  .gte("started_at", iso(since - timedelta(hours=MAX_SHIFT_HOURS)))
                                  .lt("started_at", iso(until)).order("started_at").limit(5000).execute())
                  if (parse(s.get("ended_at")) or now) > since]
        open_now = rows(db().table("worker_shifts").select("*").is_("ended_at", "null").limit(200).execute())
        workers = rows(db().table("fayfort_workers").select("user_id,status").limit(500).execute())
        ids = list(dict.fromkeys([str(w["user_id"]) for w in workers if w.get("status") == "active"]
                                 + [str(s["worker_id"]) for s in shifts + open_now]))
        who = people(ids)
        day_keys = [(start + timedelta(days=i)).isoformat() for i in range(days)]
        table = []
        for worker_id in ids:
            mine = [s for s in shifts if str(s["worker_id"]) == worker_id]
            per_day = {key: 0 for key in day_keys}
            for shift in mine:
                for day, seconds in day_seconds(shift, now).items():
                    if day in per_day:
                        per_day[day] += seconds
            current = next((s for s in open_now if str(s["worker_id"]) == worker_id), None)
            table.append({"user_id": worker_id, **who.get(worker_id, {}), "days": per_day,
                          "total_seconds": sum(per_day.values()), "on_shift": bool(current),
                          "on_break": bool(current and current.get("on_break_since")),
                          "shifts": [shift_view(s, now) for s in mine]})
        table.sort(key=lambda row: (-row["total_seconds"], row.get("name") or ""))
        pending = rows(db().table("worker_shift_corrections").select("*").eq("status", "pending")
                       .order("created_at").limit(100).execute())
        return {
            "start": start.isoformat(), "days": day_keys, "workers": table,
            "on_shift_now": [{"user_id": str(s["worker_id"]), **who.get(str(s["worker_id"]), {}), **shift_view(s, now)}
                             for s in open_now],
            "corrections": [{**c, **{"worker": who.get(str(c["worker_id"]), {})}} for c in pending],
            "coverage": coverage(shifts, start, days, now),
            "support_hours": {"days": "Mon-Sat", "start": SUPPORT_START.strftime("%H:%M"), "end": SUPPORT_END.strftime("%H:%M"),
                              "time_zone": "China time"},
        }

    def _start(start: date | None, days: int) -> date:
        return start or _week_start(now_utc().astimezone(CHINA).date())

    @router.get("/platform/workforce/timesheets")
    def timesheets(start: date | None = None, days: int = Query(default=7, ge=1, le=62),
                   authorization: str | None = Header(default=None)):
        admin(authorization)
        try:
            return timesheet(_start(start, days), days)
        except Exception as exc:
            raise fail("Timesheets could not be loaded.") from exc

    @router.get("/platform/workforce/shifts.csv")
    def shifts_csv(start: date | None = None, days: int = Query(default=7, ge=1, le=366),
                   authorization: str | None = Header(default=None)):
        admin(authorization)
        try:
            sheet = timesheet(_start(start, days), days)
        except Exception as exc:
            raise fail("The export could not be made.") from exc
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["Worker", "Started (China time)", "Ended (China time)", "Break minutes", "Worked hours", "Ended by",
                         "Flag", "Note"])
        for worker in sheet["workers"]:
            for shift in worker["shifts"]:
                fmt = lambda v: parse(v).astimezone(CHINA).strftime("%Y-%m-%d %H:%M") if v else ""  # noqa: E731
                writer.writerow([worker.get("name"), fmt(shift["started_at"]), fmt(shift["ended_at"]),
                                 round(shift["break_seconds"] / 60), round(shift["worked_seconds"] / 3600, 2),
                                 shift.get("ended_by") or "on shift", shift.get("flag") or "", shift.get("note") or ""])
        return Response(out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="fayfort-shifts-{sheet["start"]}.csv"'})

    @router.put("/platform/workforce/shifts/{shift_id}")
    def correct_shift(shift_id: UUID, payload: Correction, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        started, ended = _check_times(payload.started_at, payload.ended_at)
        try:
            shift = one(db().table("worker_shifts").select("*").eq("id", str(shift_id)).limit(1).execute())
            if not shift:
                raise HTTPException(status_code=404, detail="Shift not found.")
            db().table("worker_shift_corrections").insert({
                "shift_id": shift["id"], "worker_id": shift["worker_id"], "requested_by": actor,
                "previous_started_at": shift["started_at"], "previous_ended_at": shift.get("ended_at"),
                "proposed_started_at": iso(started), "proposed_ended_at": iso(ended), "reason": payload.reason.strip(),
                "status": "approved", "decided_by": actor, "decided_at": iso(now_utc()),
            }).execute()
            db().table("worker_shifts").update({"started_at": iso(started), "ended_at": iso(ended),
                                                "ended_by": shift.get("ended_by") or "admin", "on_break_since": None,
                                                "flag": "edited", "updated_at": iso(now_utc())}).eq("id", shift["id"]).execute()
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("The shift could not be corrected.") from exc
        workforce_audit(actor, "shift.corrected", str(shift["worker_id"]), {"shift_id": str(shift_id), "reason": payload.reason[:200]})
        return {"corrected": True}

    @router.post("/platform/workforce/corrections/{correction_id}")
    def decide_correction(correction_id: UUID, payload: Decision, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        try:
            request = one(db().table("worker_shift_corrections").select("*").eq("id", str(correction_id))
                          .eq("status", "pending").limit(1).execute())
            if not request:
                raise HTTPException(status_code=404, detail="That request was already handled.")
            status = "approved" if payload.decision == "approve" else "rejected"
            db().table("worker_shift_corrections").update({"status": status, "decided_by": actor,
                                                           "decided_at": iso(now_utc())}).eq("id", request["id"]).execute()
            if status == "approved":
                db().table("worker_shifts").update({"started_at": request["proposed_started_at"],
                                                    "ended_at": request["proposed_ended_at"], "flag": "edited",
                                                    "updated_at": iso(now_utc())}).eq("id", request["shift_id"]).execute()
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("The request could not be saved.") from exc
        workforce_audit(actor, f"shift.correction_{status}", str(request["worker_id"]), {"correction_id": str(correction_id)})
        return {"status": status}

    # ---- ratings: admin and own -------------------------------------------------------------
    def rating_detail(worker_id: str, *, limit: int = 100) -> dict:
        found = rows(db().table("worker_ratings").select("id,prompt_id,stars,comment,source,created_at")
                     .eq("worker_id", worker_id).order("created_at", desc=True).limit(5000).execute())
        prompts = {str(p["id"]): p for p in rows(db().table("worker_rating_prompts").select("id,title")
                                                  .in_("id", [r["prompt_id"] for r in found[:limit]]).execute())} if found else {}
        every = reset_every()
        return {"summary": rating_summary(found, completed_tasks([worker_id]).get(worker_id, []), every), "ratings": [
            {"id": r["id"], "stars": r["stars"], "comment": r.get("comment"), "source": r["source"], "created_at": r["created_at"],
             "about": prompts.get(str(r["prompt_id"]), {}).get("title")} for r in found[:limit]]}

    @router.get("/platform/workforce/settings")
    def get_settings(authorization: str | None = Header(default=None)):
        admin(authorization)
        return {"rating_reset_tasks": reset_every()}

    @router.put("/platform/workforce/settings")
    def put_settings(payload: WorkforceSettings, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        try:
            db().table("workforce_settings").upsert({"key": "rating_reset_tasks", "value": payload.rating_reset_tasks,
                                                     "updated_by": actor, "updated_at": iso(now_utc())},
                                                    on_conflict="key").execute()
        except Exception as exc:
            raise fail("The setting could not be saved.") from exc
        workforce_audit(actor, "settings.rating_reset_tasks", actor, {"value": payload.rating_reset_tasks})
        return {"rating_reset_tasks": payload.rating_reset_tasks}

    @router.get("/platform/workers/{worker_id}/ratings")
    def worker_ratings(worker_id: UUID, authorization: str | None = Header(default=None)):
        admin(authorization)
        try:
            return rating_detail(str(worker_id))
        except Exception as exc:
            raise fail("Ratings could not be loaded.") from exc

    @router.get("/workers/me/ratings")
    def my_ratings(authorization: str | None = Header(default=None)):
        me = staff(authorization)
        try:
            return rating_detail(me["user_id"])
        except Exception as exc:
            raise fail("Your ratings could not be loaded.") from exc

    # ---- ratings: members -------------------------------------------------------------------
    @router.get("/members/worker-ratings")
    def member_prompts(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        now = now_utc()
        try:
            prompts = rows(db().table("worker_rating_prompts").select("*").eq("member_id", member_id)
                           .is_("dismissed_at", "null").order("available_after", desc=True).limit(30).execute())
            prompts = [p for p in prompts if (parse(p["available_after"]) or now) <= now
                       and (not p.get("rated_at") or (parse(p["rated_at"]) or now) > now - timedelta(days=RATING_EDIT_DAYS))]
            mine = {str(r["prompt_id"]): r for r in rows(db().table("worker_ratings").select("prompt_id,stars,comment")
                                                         .in_("prompt_id", [p["id"] for p in prompts]).execute())} if prompts else {}
            who = people([str(p["worker_id"]) for p in prompts])
        except Exception as exc:
            raise fail("Ratings could not be loaded.") from exc
        return {"prompts": [{
            "id": p["id"], "title": p["title"], "kind": "chat" if p.get("conversation_id") else "request",
            "conversation_id": p.get("conversation_id"), "request_id": p.get("request_id"),
            "worker": {"first_name": who.get(str(p["worker_id"]), {}).get("first_name", "FayFort team"),
                       "photo_url": who.get(str(p["worker_id"]), {}).get("photo_url")},
            "rating": {"stars": mine[str(p["id"])]["stars"], "comment": mine[str(p["id"])].get("comment")}
            if str(p["id"]) in mine else None,
        } for p in prompts]}

    @router.post("/members/worker-ratings", status_code=201)
    def rate_worker(payload: RatingInput, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        now = now_utc()
        try:
            prompt = one(db().table("worker_rating_prompts").select("*").eq("id", str(payload.prompt_id))
                         .eq("member_id", member_id).limit(1).execute())
            if not prompt or (parse(prompt["available_after"]) or now) > now:
                raise HTTPException(status_code=404, detail="There's nothing to rate here yet.")
            if prompt.get("rated_at") and (parse(prompt["rated_at"]) or now) < now - timedelta(days=RATING_EDIT_DAYS):
                raise HTTPException(status_code=409, detail="Ratings can be changed for 7 days.")
            comment = (payload.comment or "").strip() or None
            values = {"prompt_id": prompt["id"], "worker_id": prompt["worker_id"], "member_id": member_id,
                      "stars": payload.stars, "comment": comment, "source": "chat" if prompt.get("conversation_id") else "request",
                      "updated_at": iso(now)}
            db().table("worker_ratings").upsert(values, on_conflict="prompt_id").execute()
            if not prompt.get("rated_at"):
                db().table("worker_rating_prompts").update({"rated_at": iso(now)}).eq("id", prompt["id"]).execute()
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("Your rating couldn't be saved. Please try again.") from exc
        if payload.stars <= 2:
            name = people([str(prompt["worker_id"])]).get(str(prompt["worker_id"]), {}).get("first_name", "A worker")
            notify_admins("review_needed", f"{name} got a {payload.stars}-star rating",
                          (comment or prompt["title"])[:200], f"/?page=workforce&worker={prompt['worker_id']}",
                          f"low-rating:{prompt['id']}:{payload.stars}")
        return {"rated": True}

    @router.post("/members/worker-ratings/{prompt_id}/dismiss")
    def dismiss_prompt(prompt_id: UUID, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            updated = rows(db().table("worker_rating_prompts").update({"dismissed_at": iso(now_utc())})
                           .eq("id", str(prompt_id)).eq("member_id", member_id).execute())
        except Exception as exc:
            raise fail("That couldn't be saved.") from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Not found.")
        return {"dismissed": str(prompt_id)}

    return router
