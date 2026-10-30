"""HR H7 (docs/HR_AND_HIRING_PLAN.md sections 3.8 and 3.9): reviews and finishing employment.

Reviews: a probation review is opened a week before the probation end date, and regular reviews every few months
(People -> Settings, 6 by default) counted from the last one or the start date. The person writes a short self-review in
My HR; their manager (or HR when they have none) completes it with three scores from 1 to 4 (speed, care, accuracy), a
note and, for probation, a decision: pass, extend (1 to 3 months) or end. Customer ratings, hours worked and finished
work from the last 90 days are shown next to it.

Finishing employment: HR starts it from the person's record with the last day and an internal reason. The checklist
shows their open work and future bookings; "Release their work" hands open work back to the desks. The account is
deactivated after the last day (checked with the HR sweep), the record stays read-only and the timeline says so.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from app.commerce.db import audit, db, one, rows
from app.hr import service
from app.hr.service import HrError

logger = logging.getLogger(__name__)

SCORES = {"speed": "Speed", "care": "Care", "accuracy": "Accuracy"}
OPEN_AHEAD = timedelta(days=7)
REASONS = {"resigned": "Resigned", "contract_ended": "Contract ended", "probation_ended": "Probation not passed",
           "dismissed": "Dismissed", "other": "Other"}
STEPS = {"work_released": "Open work handed back to the desks", "bookings_handled": "Future bookings moved or cancelled",
         "equipment_returned": "Equipment returned (laptop, phone, keys)", "access_removed": "Other accounts closed (shared logins, chats)"}


def today() -> date:
    from app.hr import leave
    return leave.today()


def _event(worker_id: str, kind: str, actor: str | None, detail: dict | None = None) -> None:
    from app.hr import people
    people.event(worker_id, kind, actor, detail)


def review_every() -> int:
    found = one(db().table("hr_settings").select("review_every_months").eq("id", 1).limit(1).execute()) or {}
    value = found.get("review_every_months")
    return 6 if value is None else int(value)


def reviewer_for(worker_id: str) -> list[str]:
    from app.hr import leave
    return leave.approvers_for(worker_id)


def _notify(worker_ids: list[str], title: str, body: str, key: str) -> None:
    try:
        if worker_ids:
            db().table("operations_worker_notifications").upsert([
                {"worker_id": w, "notification_type": "hr_review", "title": title[:160], "body": body[:500], "href": "/operations",
                 "dedupe_key": f"{key}:{w}"} for w in worker_ids], on_conflict="dedupe_key", ignore_duplicates=True).execute()
    except Exception:
        logger.exception("Could not send a review notice")


def _name(worker_id: str) -> str:
    from app.workforce.team import people
    return people([worker_id]).get(worker_id, {}).get("name", "Someone")


# ---- Opening reviews ---------------------------------------------------------------------------------------------
def open_due(now_day: date | None = None) -> int:
    """Opens probation and regular reviews that fall within the next week. Safe to run again."""
    day = now_day or today()
    every = review_every()
    records = rows(db().table("hr_employment").select("*").neq("status", "finished").limit(1000).execute())
    active = {str(w["user_id"]) for w in rows(db().table("fayfort_workers").select("user_id").eq("status", "active").limit(1000).execute())}
    leaving = {str(o["worker_id"]) for o in rows(db().table("hr_offboarding").select("worker_id,cancelled_at").limit(1000).execute())
               if not o.get("cancelled_at")}
    opened = 0
    for rec in records:
        worker = str(rec["worker_id"])
        if worker not in active or worker in leaving:
            continue
        mine = rows(db().table("hr_reviews").select("kind,due_on,status").eq("worker_id", worker).limit(200).execute())
        due: tuple[str, date] | None = None
        if rec.get("probation_end") and not rec.get("probation_passed_at"):
            end = date.fromisoformat(str(rec["probation_end"])[:10])
            if not any(r["kind"] == "probation" and r["due_on"] == end.isoformat() for r in mine):
                due = ("probation", end)
        elif every and rec.get("start_date"):
            regular = sorted(date.fromisoformat(r["due_on"]) for r in mine if r["status"] != "cancelled")
            base = regular[-1] if regular else date.fromisoformat(str(rec["start_date"])[:10])
            due = ("regular", service.add_months(base, every))
        if not due or due[1] - OPEN_AHEAD > day:
            continue
        if any(r["kind"] == due[0] and r["due_on"] == due[1].isoformat() for r in mine):
            continue
        reviewers = reviewer_for(worker)
        db().table("hr_reviews").insert({"worker_id": worker, "kind": due[0], "due_on": due[1].isoformat(), "status": "open",
                                         "reviewer_id": reviewers[0] if len(reviewers) == 1 else None, "scores": {}}).execute()
        label = "probation review" if due[0] == "probation" else "review"
        _notify(reviewers, f"{_name(worker)}'s {label} is due {due[1].day} {due[1]:%b}",
                "Open it in People, Records, or in My account, My HR.", f"review:{worker}:{due[0]}:{due[1]}:reviewer")
        _notify([worker], f"Your {label} is coming up", "Write a short self-review in My account, My HR before it's due.",
                f"review:{worker}:{due[0]}:{due[1]}:self")
        opened += 1
    return opened


# ---- Context and views -------------------------------------------------------------------------------------------
def context(worker_id: str) -> dict:
    """Customer ratings, hours worked, finished work and leave in the last 90 days."""
    from app.workforce import team
    since = datetime.now(timezone.utc) - timedelta(days=90)
    ratings = team.ratings_for([worker_id]).get(worker_id, {})
    shifts = rows(db().table("worker_shifts").select("*").eq("worker_id", worker_id).gte("started_at", since.isoformat())
                  .limit(2000).execute())
    finished = [d for d in team.completed_tasks([worker_id]).get(worker_id, []) if d >= since]
    leave_days = sum(float(r.get("days") or 0) for r in rows(db().table("staff_time_off").select("days,status,leave_type,start_date")
                     .eq("worker_id", worker_id).eq("status", "approved").gte("start_date", since.date().isoformat()).limit(500).execute())
                     if r.get("leave_type"))
    return {"rating": ratings.get("average_90_days") or ratings.get("average"), "rating_count": ratings.get("count", 0),
            "hours": round(sum(team.worked_seconds(s) for s in shifts) / 3600, 1), "shifts": len(shifts),
            "finished_work": len(finished), "leave_days": leave_days}


def view(review: dict, *, for_self: bool = False) -> dict:
    out = {k: review.get(k) for k in ("id", "worker_id", "kind", "due_on", "status", "self_review", "self_submitted_at",
                                       "scores", "manager_note", "decision", "completed_at")}
    if for_self and review.get("status") != "completed":
        out.update({"scores": {}, "manager_note": None, "decision": None})
    return out


def for_worker(worker_id: str) -> list[dict]:
    return [view(r) for r in rows(db().table("hr_reviews").select("*").eq("worker_id", worker_id).neq("status", "cancelled")
                                  .order("due_on", desc=True).limit(50).execute())]


def to_review(actor: dict) -> list[dict]:
    """Open reviews this person completes: their team's, or everyone's for HR."""
    from app.workforce.team import people
    reviews = rows(db().table("hr_reviews").select("*").eq("status", "open").order("due_on").limit(500).execute())
    if not (actor.get("role") == "platform_admin" or service.worker_can_hire(actor["user_id"])):
        team = {str(r["worker_id"]) for r in rows(db().table("hr_employment").select("worker_id").eq("manager_id", actor["user_id"])
                                                 .limit(200).execute())}
        reviews = [r for r in reviews if str(r["worker_id"]) in team]
    reviews = [r for r in reviews if str(r["worker_id"]) != str(actor["user_id"])]
    names = people([str(r["worker_id"]) for r in reviews])
    return [{**view(r), "name": names.get(str(r["worker_id"]), {}).get("name", "FayFort team"),
             "context": context(str(r["worker_id"]))} for r in reviews]


def _get(review_id: str) -> dict:
    review = one(db().table("hr_reviews").select("*").eq("id", review_id).limit(1).execute())
    if not review:
        raise HrError("That review doesn't exist.", 404)
    return review


def can_complete(review: dict, actor: dict) -> bool:
    if str(review["worker_id"]) == str(actor["user_id"]):
        return False
    if actor.get("role") == "platform_admin" or service.worker_can_hire(actor["user_id"]):
        return True
    rec = one(db().table("hr_employment").select("manager_id").eq("worker_id", review["worker_id"]).limit(1).execute()) or {}
    return str(rec.get("manager_id") or "") == str(actor["user_id"])


# ---- Self-review and completing ----------------------------------------------------------------------------------
def self_review(review_id: str, worker_id: str, text: str) -> dict:
    review = _get(review_id)
    if str(review["worker_id"]) != str(worker_id):
        raise HrError("That review doesn't exist.", 404)
    if review["status"] != "open":
        raise HrError("This review is already finished.", 409)
    words = (text or "").strip()[:3000]
    if len(words) < 10:
        raise HrError("Write a few sentences about how it's going.", 422)
    db().table("hr_reviews").update({"self_review": words, "self_submitted_at": service.now_iso()}).eq("id", review_id).execute()
    return view(_get(review_id), for_self=True)


def complete(review_id: str, scores: dict, note: str | None, decision: str | None, extend_months: int | None, actor: dict) -> dict:
    from app.hr import people
    review = _get(review_id)
    if review["status"] != "open":
        raise HrError("This review is already finished.", 409)
    if not can_complete(review, actor):
        raise HrError("Only the person's manager or HR can complete this review.", 403)
    cleaned = {}
    for key, label in SCORES.items():
        value = scores.get(key)
        if value not in (1, 2, 3, 4):
            raise HrError(f"Score {label.lower()} from 1 to 4.", 422)
        cleaned[key] = value
    note = (note or "").strip()[:3000] or None
    if not note:
        raise HrError("Write a short note for the review.", 422)
    if review["kind"] == "probation":
        if decision not in ("pass", "extend", "end"):
            raise HrError("Choose pass, extend or end.", 422)
        if decision == "extend" and extend_months not in (1, 2, 3):
            raise HrError("Extend by 1, 2 or 3 months.", 422)
    else:
        decision = None
    db().table("hr_reviews").update({"status": "completed", "scores": cleaned, "manager_note": note, "decision": decision,
                                     "completed_at": service.now_iso(), "completed_by": actor["user_id"]}).eq("id", review_id).execute()
    worker = str(review["worker_id"])
    _event(worker, "review_completed", actor["user_id"], {"kind": review["kind"], "decision": decision or ""})
    if decision == "pass":
        people.probation(worker, "pass", None, note, actor["user_id"])
    elif decision == "extend":
        people.probation(worker, "extend", extend_months, note, actor["user_id"])
    _notify([worker], "Your review is finished", "Read it in My account, My HR.", f"review:{review_id}:done")
    audit(actor["user_id"], "hr.review.completed", {"review_id": review_id, "decision": decision})
    result = view(_get(review_id))
    if decision == "end":
        result["next"] = "offboarding"
    return result


def mine(worker_id: str) -> list[dict]:
    return [view(r, for_self=True) for r in rows(db().table("hr_reviews").select("*").eq("worker_id", worker_id)
                                                  .neq("status", "cancelled").order("due_on", desc=True).limit(20).execute())]


# ---- Finishing employment ----------------------------------------------------------------------------------------
def offboarding(worker_id: str) -> dict | None:
    found = one(db().table("hr_offboarding").select("*").eq("worker_id", worker_id).limit(1).execute())
    if not found or found.get("cancelled_at"):
        return None
    open_work = rows(db().table("operations_work_items").select("id").eq("assigned_worker_id", worker_id)
                     .in_("status", ["claimed", "waiting", "open"]).limit(500).execute())
    bookings = rows(db().table("bookings").select("id,starts_at").eq("host_id", worker_id).in_("status", ["held", "confirmed"])
                    .gt("starts_at", service.now_iso()).limit(500).execute())
    return {**found, "reason_label": REASONS.get(found["reason_kind"], found["reason_kind"]),
            "open_work": len(open_work), "future_bookings": len(bookings),
            "steps_list": [{"key": k, "label": v, "done": bool((found.get("steps") or {}).get(k))} for k, v in STEPS.items()]}


def start_offboarding(worker_id: str, fields: dict, actor_id: str) -> dict:
    worker = one(db().table("fayfort_workers").select("user_id,status").eq("user_id", worker_id).limit(1).execute())
    if not worker or worker.get("status") == "inactive":
        raise HrError("This person isn't active on the team.", 409)
    if worker_id == actor_id:
        raise HrError("You can't finish your own employment here.", 409)
    if offboarding(worker_id):
        raise HrError("Finishing employment has already started.", 409)
    try:
        last = date.fromisoformat(str(fields.get("last_day"))[:10])
    except ValueError:
        raise HrError("Choose the last day.", 422)
    if last < today() - timedelta(days=30):
        raise HrError("The last day can't be more than 30 days ago.", 422)
    kind = fields.get("reason_kind")
    if kind not in REASONS:
        raise HrError("Choose a reason.", 422)
    db().table("hr_offboarding").upsert({"worker_id": worker_id, "last_day": last.isoformat(), "reason_kind": kind,
                                         "reason": service.clean(fields.get("reason"), 1000), "steps": {}, "exit_note": None,
                                         "started_by": actor_id, "started_at": service.now_iso(), "completed_at": None,
                                         "deactivated_at": None, "cancelled_at": None}, on_conflict="worker_id").execute()
    db().table("hr_reviews").update({"status": "cancelled"}).eq("worker_id", worker_id).eq("status", "open").execute()
    _event(worker_id, "offboarding_started", actor_id, {"last_day": last.isoformat(), "reason": REASONS[kind]})
    audit(actor_id, "hr.offboarding.started", {"worker_id": worker_id})
    return offboarding(worker_id) or {}


def update_offboarding(worker_id: str, fields: dict, actor_id: str) -> dict:
    current = offboarding(worker_id)
    if not current:
        raise HrError("Finishing employment hasn't started.", 404)
    if current.get("deactivated_at"):
        raise HrError("This person has already left.", 409)
    values: dict = {}
    if "steps" in fields and fields["steps"] is not None:
        steps = dict(current.get("steps") or {})
        for key, done in fields["steps"].items():
            if key in STEPS:
                steps[key] = service.now_iso() if done else None
        values["steps"] = {k: v for k, v in steps.items() if v}
    if "exit_note" in fields:
        values["exit_note"] = (fields.get("exit_note") or "").strip()[:3000] or None
    if fields.get("last_day"):
        try:
            values["last_day"] = date.fromisoformat(str(fields["last_day"])[:10]).isoformat()
        except ValueError:
            raise HrError("Choose the last day.", 422)
    if values:
        db().table("hr_offboarding").update(values).eq("worker_id", worker_id).execute()
    return offboarding(worker_id) or {}


def release_work(worker_id: str, actor_id: str) -> dict:
    current = offboarding(worker_id)
    if not current:
        raise HrError("Finishing employment hasn't started.", 404)
    released = db().rpc("release_workforce_assignments", {"p_worker_id": worker_id, "p_actor_id": actor_id,
                                                          "p_reason": "Leaving FayFort: work handed back to the desk."}).execute()
    steps = {**(current.get("steps") or {}), "work_released": service.now_iso()}
    db().table("hr_offboarding").update({"steps": steps}).eq("worker_id", worker_id).execute()
    audit(actor_id, "hr.offboarding.released", {"worker_id": worker_id, "released": getattr(released, "data", None)})
    return offboarding(worker_id) or {}


def cancel_offboarding(worker_id: str, actor_id: str) -> None:
    current = offboarding(worker_id)
    if not current:
        raise HrError("Finishing employment hasn't started.", 404)
    if current.get("deactivated_at"):
        raise HrError("This person has already left. Reactivate them from the Team tab instead.", 409)
    db().table("hr_offboarding").update({"cancelled_at": service.now_iso()}).eq("worker_id", worker_id).execute()
    _event(worker_id, "offboarding_cancelled", actor_id)
    audit(actor_id, "hr.offboarding.cancelled", {"worker_id": worker_id})


def deactivate(worker_id: str, actor_id: str | None, reason: str) -> None:
    """The same steps as deactivating from the Team tab: status first, work handed back, sign-in blocked."""
    now = service.now_iso()
    db().table("fayfort_workers").update({"status": "inactive", "deactivated_at": now, "deactivated_by": actor_id,
                                          "updated_at": now, "handoff_availability": "offline",
                                          "handoff_available_until": None, "handoff_availability_updated_at": now}) \
        .eq("user_id", worker_id).execute()
    try:
        db().rpc("release_workforce_assignments", {"p_worker_id": worker_id, "p_actor_id": actor_id,
                                                   "p_reason": f"Left FayFort: {reason}"}).execute()
    except Exception:
        logger.exception("Could not release a leaver's work")
    try:
        db().auth.admin.update_user_by_id(worker_id, {"ban_duration": "876000h"})
    except Exception:
        logger.exception("Could not block a leaver's sign-in")
    try:
        from app.workforce.audit import record_workforce_audit
        record_workforce_audit(actor_id, worker_id, "deactivated", None, {"reason": reason, "by": "hr_offboarding"})
    except Exception:
        logger.exception("Could not record the workforce audit for a leaver")


def finish_due(now_day: date | None = None) -> int:
    """After the last day: deactivate the account, finish the record and say so on the timeline."""
    day = now_day or today()
    due = [o for o in rows(db().table("hr_offboarding").select("*").lt("last_day", day.isoformat()).limit(200).execute())
           if not o.get("cancelled_at") and not o.get("deactivated_at")]
    for item in due:
        worker = str(item["worker_id"])
        reason = REASONS.get(item["reason_kind"], "left")
        deactivate(worker, item.get("started_by"), reason)
        db().table("hr_offboarding").update({"deactivated_at": service.now_iso(), "completed_at": service.now_iso()}) \
            .eq("worker_id", worker).execute()
        db().table("hr_employment").update({"status": "finished", "updated_at": service.now_iso()}).eq("worker_id", worker).execute()
        _event(worker, "finished", None, {"last_day": item["last_day"], "reason": reason})
    return len(due)


def sweep() -> dict[str, int]:
    return {"reviews_opened": open_due(), "left": finish_due()}
