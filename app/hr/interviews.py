"""HR and hiring H3 (docs/HR_AND_HIRING_PLAN.md): interviews and scorecards.

HR proposes an interview (who interviews, how long, within how many days). The candidate picks a time from their
private link among the times every interviewer is free (the booking engine's weekly hours, time off and bookings).
Each interviewer then gets a confirmed booking of kind "interview", so nobody can be double-booked. Reminders go
24 hours and 1 hour before. After the interview each interviewer fills a scorecard; nobody sees the others' decisions
until they have submitted their own.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from app.bookings import engine
from app.commerce.db import audit, db, one, rows
from app.hr import service
from app.hr.service import HrError
from app.mailer.render import RenderedEmail, _paragraph, shell

logger = logging.getLogger(__name__)

LENGTHS = (30, 45, 60, 90)
OPEN = ("proposed", "scheduled")
DEFAULT_SKILLS = ["Communication", "Relevant experience", "Attention to detail", "Fit with the team"]
CANDIDATE_CHANGES = 2
CHANGE_CUTOFF = timedelta(hours=24)


def now_utc() -> datetime:
    return engine.now_utc()


def skills_for(job: dict) -> list[str]:
    return list(job.get("skills") or []) or DEFAULT_SKILLS


# ---- Reading ------------------------------------------------------------------------------------------------------
def get(interview_id: str) -> dict:
    interview = one(db().table("hr_interviews").select("*").eq("id", interview_id).limit(1).execute())
    if not interview:
        raise HrError("That interview doesn't exist.", 404)
    return interview


def interviewers(interview_id: str) -> list[dict]:
    return rows(db().table("hr_interview_interviewers").select("*").eq("interview_id", interview_id).limit(20).execute())


def open_for(application_id: str) -> dict | None:
    return one(db().table("hr_interviews").select("*").eq("application_id", application_id).in_("status", list(OPEN))
               .limit(1).execute())


def slots(interview: dict, now: datetime | None = None) -> list[dict]:
    """Times every interviewer is free, from tomorrow (the booking rules' notice) to the end of the window."""
    now = now or now_utc()
    hosts = [str(r["worker_id"]) for r in interviewers(interview["id"])]
    if not hosts:
        return []
    start = now
    end = now + timedelta(days=int(interview.get("window_days") or 14))
    rules = engine.settings_row()
    common: dict[str, dict] | None = None
    for host in hosts:
        found = {s["starts_at"]: s for s in engine.free_slots(host, "interview", start, end, now=now, rules=rules,
                                                               minutes=int(interview["minutes"]))}
        common = found if common is None else {k: v for k, v in common.items() if k in found}
        if not common:
            return []
    return [common[key] for key in sorted(common or {})]


def view(interview: dict, *, for_candidate: bool = False) -> dict:
    out = {k: interview.get(k) for k in ("id", "status", "minutes", "window_days", "starts_at", "ends_at",
                                         "candidate_time_zone", "call_link", "message", "reschedule_count")}
    if for_candidate:
        out.pop("window_days", None)
        if interview["status"] != "scheduled":
            out["call_link"] = None
        out["can_change"] = can_candidate_change(interview)[0]
        out["slots"] = slots(interview) if interview["status"] == "proposed" else []
    else:
        from app.workforce.team import people
        rows_ = interviewers(interview["id"])
        names = people([str(r["worker_id"]) for r in rows_])
        out["interviewers"] = [{"worker_id": r["worker_id"], "name": names.get(str(r["worker_id"]), {}).get("name", "FayFort team"),
                                "booking_id": r.get("booking_id")} for r in rows_]
    return out


# ---- Proposing ----------------------------------------------------------------------------------------------------
def propose(application_id: str, fields: dict, actor_id: str) -> dict:
    application = one(db().table("hr_applications").select("*").eq("id", application_id).limit(1).execute())
    if not application:
        raise HrError("That application doesn't exist.", 404)
    if application["stage"] in service.CLOSED + ["hired", "offer"]:
        raise HrError("Interviews can be arranged for open applications before the offer.", 409)
    if open_for(application_id):
        raise HrError("This candidate already has an interview arranged. Cancel it first to arrange a new one.", 409)
    minutes = int(fields.get("minutes") or 30)
    if minutes not in LENGTHS:
        raise HrError("Choose 30, 45, 60 or 90 minutes.", 422)
    window = int(fields.get("window_days") or 14)
    if not 3 <= window <= 30:
        raise HrError("Let the candidate choose within 3 to 30 days.", 422)
    ids = list(dict.fromkeys(str(i) for i in (fields.get("interviewer_ids") or [])))
    if not 1 <= len(ids) <= 4:
        raise HrError("Choose one to four interviewers.", 422)
    active = {str(w["user_id"]) for w in rows(db().table("fayfort_workers").select("user_id,status").in_("user_id", ids)
                                               .eq("status", "active").execute())}
    if set(ids) - active:
        raise HrError("Every interviewer must be an active member of the team.", 422)
    link = (fields.get("call_link") or "").strip() or None
    if link and (not link.startswith("https://") or " " in link or len(link) > 500):
        raise HrError("The video link must start with https://", 422)
    interview = one(db().table("hr_interviews").insert({
        "application_id": application_id, "status": "proposed", "minutes": minutes, "window_days": window,
        "call_link": link, "message": service.clean(fields.get("message"), 1000), "created_by": actor_id,
    }).execute())
    if not interview:
        raise HrError("The interview couldn't be saved.", 503)
    db().table("hr_interview_interviewers").insert([{"interview_id": interview["id"], "worker_id": w} for w in ids]).execute()
    if not slots(interview):
        db().table("hr_interviews").delete().eq("id", interview["id"]).execute()
        raise HrError("These interviewers have no common free time in that window. Add days, choose fewer interviewers "
                      "or ask them to open more hours in Bookings.", 409)
    if application["stage"] != "interview":
        service.move_stage(application_id, "interview", None, actor_id, notify=False)
    service.add_event(application_id, "interview_proposed", actor_id, {"minutes": minutes, "interviewers": len(ids)})
    _email_candidate(application, "pick", interview)
    audit(actor_id, "hr.interview.proposed", {"interview_id": interview["id"]})
    return get(interview["id"])


# ---- The candidate picks or changes the time ----------------------------------------------------------------------
def pick(token: str, starts_at: str, time_zone: str | None) -> dict:
    application = service.by_token(token)
    interview = open_for(application["id"])
    if not interview or interview["status"] != "proposed":
        raise HrError("There's no interview time to pick right now.", 409)
    starts = engine.parse(starts_at)
    if not starts or not any(engine.parse(s["starts_at"]) == starts for s in slots(interview)):
        raise HrError("That time isn't available any more. Pick another one.", 409)
    ends = starts + timedelta(minutes=int(interview["minutes"]))
    rules = engine.settings_row()
    blocked_until = ends + timedelta(minutes=int(rules["buffer_minutes"]))
    candidate = one(db().table("hr_candidates").select("full_name").eq("id", application["candidate_id"]).limit(1).execute()) or {}
    job = service.get_job(application["job_id"])
    topic = f"{candidate.get('full_name') or 'Candidate'} · {job['title']}"[:1000]
    made: list[str] = []
    try:
        for row in interviewers(interview["id"]):
            booking = one(db().table("bookings").insert({
                "host_id": row["worker_id"], "kind": "interview", "member_id": None, "starts_at": starts.isoformat(),
                "ends_at": ends.isoformat(), "blocked_until": blocked_until.isoformat(), "status": "confirmed",
                "topic": topic, "call_link": interview.get("call_link"), "member_time_zone": engine.valid_zone(time_zone),
                "source_table": engine.INTERVIEW_SOURCE, "source_id": row["id"],
            }).execute())
            if not booking:
                raise RuntimeError("Interview booking insert returned no row")
            made.append(str(booking["id"]))
            db().table("hr_interview_interviewers").update({"booking_id": booking["id"]}).eq("id", row["id"]).execute()
    except Exception as exc:
        if made:
            db().table("bookings").update({"status": "cancelled", "cancelled_by": "system",
                                           "cancel_reason": "Another interviewer's time was taken."}).in_("id", made).execute()
        if engine._taken(exc):
            raise HrError("That time was just taken. Pick another one.", 409) from exc
        raise
    db().table("hr_interviews").update({
        "status": "scheduled", "starts_at": starts.isoformat(), "ends_at": ends.isoformat(),
        "candidate_time_zone": engine.valid_zone(time_zone), "reminders": {}, "updated_at": service.now_iso()}) \
        .eq("id", interview["id"]).execute()
    interview = get(interview["id"])
    service.add_event(application["id"], "interview_scheduled", None, {"starts_at": interview["starts_at"]})
    _email_candidate(application, "scheduled", interview)
    _tell_interviewers(interview, "Interview booked", f"{topic}, {engine.when_text(starts)}", "scheduled")
    return service.status_view(token)


def can_candidate_change(interview: dict, now: datetime | None = None) -> tuple[bool, str]:
    if interview.get("status") != "scheduled":
        return False, "There's no booked interview to change."
    if int(interview.get("reschedule_count") or 0) >= CANDIDATE_CHANGES:
        return False, "This interview has already been moved twice. Reply to our email if you need to change it again."
    starts = engine.parse(interview.get("starts_at"))
    if starts and starts - (now or now_utc()) < CHANGE_CUTOFF:
        return False, "The interview is less than 24 hours away. Reply to our email if you can't make it."
    return True, ""


def _release(interview: dict, by: str, reason: str) -> None:
    """Cancels every interviewer's booking without going through the engine's cancel hook again."""
    ids = [str(r["booking_id"]) for r in interviewers(interview["id"]) if r.get("booking_id")]
    if ids:
        db().table("bookings").update({"status": "cancelled", "cancelled_by": by, "cancel_reason": reason[:500],
                                       "updated_at": service.now_iso()}).in_("id", ids).in_("status", list(engine.LIVE)).execute()
    db().table("hr_interview_interviewers").update({"booking_id": None}).eq("interview_id", interview["id"]).execute()


def candidate_change(token: str) -> dict:
    application = service.by_token(token)
    interview = open_for(application["id"])
    allowed, why = can_candidate_change(interview or {})
    if not allowed or not interview:
        raise HrError(why, 409)
    _release(interview, "member", "The candidate asked for another time.")
    db().table("hr_interviews").update({"status": "proposed", "starts_at": None, "ends_at": None, "reminders": {},
                                        "reschedule_count": int(interview.get("reschedule_count") or 0) + 1,
                                        "updated_at": service.now_iso()}).eq("id", interview["id"]).execute()
    service.add_event(application["id"], "interview_cancelled", None, {"by": "candidate", "again": True})
    _tell_interviewers(interview, "Interview time released", "The candidate is choosing another time.",
                       f"released:{interview.get('reschedule_count') or 0}")
    return service.status_view(token)


def booking_cancelled(interviewer_row_id: str, by: str) -> None:
    """An interviewer's booking was cancelled from Bookings: everyone's time is released and the candidate picks again."""
    row = one(db().table("hr_interview_interviewers").select("interview_id").eq("id", interviewer_row_id).limit(1).execute())
    if not row:
        return
    interview = get(row["interview_id"])
    if interview["status"] != "scheduled":
        return
    _release(interview, "staff", "An interviewer can't make this time.")
    db().table("hr_interviews").update({"status": "proposed", "starts_at": None, "ends_at": None, "reminders": {},
                                        "updated_at": service.now_iso()}).eq("id", interview["id"]).execute()
    application = one(db().table("hr_applications").select("*").eq("id", interview["application_id"]).limit(1).execute())
    if application:
        service.add_event(application["id"], "interview_cancelled", None, {"by": "interviewer", "again": True})
        _email_candidate(application, "repick", get(interview["id"]))


# ---- HR staff ----------------------------------------------------------------------------------------------------
def cancel(interview_id: str, actor_id: str, notify: bool = True) -> dict:
    interview = get(interview_id)
    if interview["status"] not in OPEN:
        raise HrError("This interview is already finished.", 409)
    _release(interview, "staff", "Cancelled by HR.")
    db().table("hr_interviews").update({"status": "cancelled", "updated_at": service.now_iso()}).eq("id", interview_id).execute()
    application = one(db().table("hr_applications").select("*").eq("id", interview["application_id"]).limit(1).execute())
    if application:
        service.add_event(application["id"], "interview_cancelled", actor_id, {"by": "hr"})
        if notify:
            _email_candidate(application, "cancelled", interview)
    if interview["status"] == "scheduled":
        _tell_interviewers(interview, "Interview cancelled", "HR cancelled this interview.", "cancelled")
    audit(actor_id, "hr.interview.cancelled", {"interview_id": interview_id})
    return get(interview_id)


def set_link(interview_id: str, link: str | None, actor_id: str) -> dict:
    interview = get(interview_id)
    link = (link or "").strip() or None
    if link and (not link.startswith("https://") or " " in link or len(link) > 500):
        raise HrError("The video link must start with https://", 422)
    db().table("hr_interviews").update({"call_link": link, "updated_at": service.now_iso()}).eq("id", interview_id).execute()
    ids = [str(r["booking_id"]) for r in interviewers(interview_id) if r.get("booking_id")]
    if ids:
        db().table("bookings").update({"call_link": link}).in_("id", ids).execute()
    interview = get(interview_id)
    if link and interview["status"] == "scheduled":
        application = one(db().table("hr_applications").select("*").eq("id", interview["application_id"]).limit(1).execute())
        if application:
            _email_candidate(application, "link", interview)
    return interview


def finish(interview_id: str, status: str, actor_id: str) -> dict:
    if status not in ("completed", "no_show"):
        raise HrError("Choose done or no-show.", 422)
    interview = get(interview_id)
    if interview["status"] != "scheduled":
        raise HrError("Only a booked interview can be marked.", 409)
    if engine.parse(interview["starts_at"]) > now_utc():
        raise HrError("Mark it after it has started.", 409)
    _mark(interview, status, actor_id)
    return get(interview_id)


def _mark(interview: dict, status: str, actor_id: str | None) -> None:
    db().table("hr_interviews").update({"status": status, "updated_at": service.now_iso()}).eq("id", interview["id"]).execute()
    ids = [str(r["booking_id"]) for r in interviewers(interview["id"]) if r.get("booking_id")]
    if ids:
        db().table("bookings").update({"status": status}).in_("id", ids).eq("status", "confirmed").execute()
    service.add_event(interview["application_id"], "interview_done", actor_id, {"status": status})
    if status == "completed":
        _tell_interviewers(interview, "Fill in your scorecard", "Rate the candidate while it's fresh. Open it in People.",
                           "scorecard")


def for_application(application_id: str) -> list[dict]:
    found = rows(db().table("hr_interviews").select("*").eq("application_id", application_id)
                 .order("created_at", desc=True).limit(20).execute())
    return [view(i) for i in found]


def by_booking(booking_id: str) -> dict:
    row = one(db().table("hr_interview_interviewers").select("interview_id").eq("booking_id", booking_id).limit(1).execute())
    if not row:
        raise HrError("That booking isn't an interview.", 404)
    interview = get(row["interview_id"])
    return {"interview_id": interview["id"], "application_id": interview["application_id"]}


def is_interviewer(interview_id: str, worker_id: str) -> bool:
    return any(str(r["worker_id"]) == str(worker_id) for r in interviewers(interview_id))


def interviewer_of_application(application_id: str, worker_id: str) -> bool:
    ids = [i["id"] for i in rows(db().table("hr_interviews").select("id").eq("application_id", application_id).limit(20).execute())]
    if not ids:
        return False
    return bool(rows(db().table("hr_interview_interviewers").select("id").in_("interview_id", ids)
                     .eq("worker_id", worker_id).limit(1).execute()))


def my_interviews(worker_id: str) -> list[dict]:
    mine = rows(db().table("hr_interview_interviewers").select("interview_id").eq("worker_id", worker_id).limit(200).execute())
    ids = [str(r["interview_id"]) for r in mine]
    if not ids:
        return []
    found = rows(db().table("hr_interviews").select("*").in_("id", ids).neq("status", "cancelled")
                 .order("starts_at", desc=True).limit(200).execute())
    applications = {str(a["id"]): a for a in rows(db().table("hr_applications").select("id,job_id,candidate_id,stage")
                                                  .in_("id", [str(i["application_id"]) for i in found]).execute())} if found else {}
    candidates = {str(c["id"]): c for c in rows(db().table("hr_candidates").select("id,full_name")
                  .in_("id", [str(a["candidate_id"]) for a in applications.values()]).execute())} if applications else {}
    jobs = {str(j["id"]): j for j in rows(db().table("hr_jobs").select("id,title").limit(500).execute())}
    done = {str(s["interview_id"]) for s in rows(db().table("hr_scorecards").select("interview_id").eq("interviewer_id", worker_id)
                                                 .in_("interview_id", ids).execute())}
    out = []
    for interview in found:
        application = applications.get(str(interview["application_id"])) or {}
        out.append({**view(interview), "application_id": interview["application_id"],
                    "candidate": (candidates.get(str(application.get("candidate_id"))) or {}).get("full_name") or "Candidate",
                    "job_title": (jobs.get(str(application.get("job_id"))) or {}).get("title", ""),
                    "scorecard_done": str(interview["id"]) in done})
    return out


# ---- Scorecards --------------------------------------------------------------------------------------------------
def submit_scorecard(interview_id: str, worker_id: str, ratings: dict[str, int], decision: str, note: str | None) -> dict:
    interview = get(interview_id)
    if not is_interviewer(interview_id, worker_id):
        raise HrError("Only the interviewers fill in this scorecard.", 403)
    if interview["status"] not in ("scheduled", "completed"):
        raise HrError("Scorecards are for interviews that took place.", 409)
    if interview["status"] == "scheduled" and engine.parse(interview["starts_at"]) > now_utc():
        raise HrError("Fill in the scorecard after the interview has started.", 409)
    if decision not in ("yes", "maybe", "no"):
        raise HrError("Choose Yes, Maybe or No.", 422)
    application = one(db().table("hr_applications").select("id,job_id").eq("id", interview["application_id"]).limit(1).execute())
    skills = skills_for(service.get_job(application["job_id"]))
    clean_ratings = {}
    for skill in skills:
        value = ratings.get(skill)
        if value not in (1, 2, 3, 4):
            raise HrError(f"Rate {skill} from 1 to 4.", 422)
        clean_ratings[skill] = value
    db().table("hr_scorecards").upsert({
        "interview_id": interview_id, "application_id": application["id"], "interviewer_id": worker_id,
        "ratings": clean_ratings, "decision": decision, "note": (note or "").strip()[:2000] or None,
        "submitted_at": service.now_iso()}, on_conflict="interview_id,interviewer_id").execute()
    service.add_event(application["id"], "scorecard", worker_id, {"decision": decision})
    if interview["status"] == "scheduled":
        _mark(interview, "completed", worker_id)
    return scorecards_for(application["id"], worker_id, sees_all=False)


def scorecards_for(application_id: str, viewer_id: str, *, sees_all: bool) -> dict:
    """Everyone's scorecards for HR who didn't interview; an interviewer sees others' only after submitting their own."""
    from app.workforce.team import people
    cards = rows(db().table("hr_scorecards").select("*").eq("application_id", application_id).limit(50).execute())
    mine = [c for c in cards if str(c["interviewer_id"]) == str(viewer_id)]
    interviewed = interviewer_of_application(application_id, viewer_id)
    visible = cards if (sees_all and not interviewed) or mine else mine
    names = people([str(c["interviewer_id"]) for c in visible])
    application = one(db().table("hr_applications").select("job_id").eq("id", application_id).limit(1).execute()) or {}
    skills = skills_for(service.get_job(application["job_id"])) if application else DEFAULT_SKILLS
    summary = None
    if visible and len(visible) == len(cards):
        averages = {s: round(sum(c["ratings"].get(s, 0) for c in cards) / len(cards), 1) for s in skills}
        summary = {"averages": averages, "yes": sum(c["decision"] == "yes" for c in cards),
                   "maybe": sum(c["decision"] == "maybe" for c in cards), "no": sum(c["decision"] == "no" for c in cards)}
    return {"skills": skills, "count": len(cards), "hidden": len(cards) - len(visible),
            "mine": {k: mine[0].get(k) for k in ("ratings", "decision", "note")} if mine else None,
            "cards": [{"interviewer": names.get(str(c["interviewer_id"]), {}).get("name", "FayFort team"),
                       "ratings": c["ratings"], "decision": c["decision"], "note": c.get("note"),
                       "submitted_at": c["submitted_at"], "is_mine": str(c["interviewer_id"]) == str(viewer_id)}
                      for c in visible],
            "summary": summary, "can_score": interviewed}


# ---- Emails and notices ------------------------------------------------------------------------------------------
def _when(interview: dict) -> str:
    starts = engine.parse(interview.get("starts_at"))
    return engine.when_text(starts, interview.get("candidate_time_zone")) if starts else ""


def candidate_email(kind: str, name: str, job_title: str, interview: dict, token: str) -> RenderedEmail:
    first = (name or "there").split(" ")[0]
    minutes = interview.get("minutes")
    link = interview.get("call_link")
    texts: dict[str, tuple[str, str, list[str], str]] = {
        "pick": (f"Pick your interview time for {job_title}", f"Let's talk, {first}",
                 [f"We'd like to interview you for {job_title}: a {minutes} minute video call with the team.",
                  "Pick a time that suits you from your private link. Times are shown in your own time zone."]
                 + ([interview["message"]] if interview.get("message") else []), "Pick a time"),
        "scheduled": (f"Your interview for {job_title} is booked", "Your interview is booked",
                      [f"{_when(interview)}, {minutes} minutes on video.",
                       "Join with this link: " + link if link else "We'll email you the video link before it starts.",
                       "If you can't make it, you can pick another time from your private link up to 24 hours before."],
                      "See my application"),
        "repick": (f"Please pick a new interview time for {job_title}", f"Sorry, {first}, we need to move your interview",
                   ["One of our interviewers can't make the time you chose. Please pick another time from your private link."],
                   "Pick a new time"),
        "cancelled": (f"Your interview for {job_title}", f"Your interview is cancelled, {first}",
                      ["We've cancelled the interview we arranged. We'll email you about the next step."], "See my application"),
        "link": (f"Your interview link for {job_title}", "Your video link is ready",
                 [f"{_when(interview)}.", f"Join with this link: {link}"], "See my application"),
        "reminder_24h": (f"Tomorrow: your interview for {job_title}", "Your interview is tomorrow",
                         [f"{_when(interview)}, {minutes} minutes on video."]
                         + (["Join with this link: " + link] if link else []), "See my application"),
        "reminder_1h": (f"In 1 hour: your interview for {job_title}", "Your interview starts in 1 hour",
                        [f"{_when(interview)}."] + (["Join with this link: " + link] if link else []), "See my application"),
    }
    subject, heading, parts, button = texts[kind]
    url = service.status_url(token)
    footer = "You're getting this because you applied for a role at fayfort.com/careers."
    html = shell(heading=heading, intro_html="".join(_paragraph(p) for p in parts), button_label=button,
                 button_url=url, footer_note=footer, unsubscribe_url=None)
    text = f"{heading}\n\n" + "\n\n".join(parts) + f"\n\n{button}: {url}\n\n{footer}"
    return RenderedEmail(subject=subject, html=html, text=text)


def _email_candidate(application: dict, kind: str, interview: dict) -> None:
    candidate = one(db().table("hr_candidates").select("email,full_name").eq("id", application["candidate_id"])
                    .limit(1).execute()) or {}
    if not candidate.get("email"):
        return
    job = service.get_job(application["job_id"])
    token = service.issue_link(application["id"])
    service.queue_candidate_email(candidate["email"], candidate_email(kind, candidate.get("full_name") or "", job["title"],
                                                                      interview, token), f"hr_interview_{kind}")
    service.add_event(application["id"], "email_sent", None, {"template": f"hr_interview_{kind}"})


def _tell_interviewers(interview: dict, title: str, body: str, key: str) -> None:
    try:
        found = interviewers(interview["id"])
        if not found:
            return
        db().table("operations_worker_notifications").upsert([
            {"worker_id": r["worker_id"], "notification_type": "booking", "title": title[:160], "body": (body or title)[:500],
             "href": f"/operations?view=bookings&booking={r['booking_id']}" if r.get("booking_id") else "/operations?view=bookings",
             "dedupe_key": f"interview:{interview['id']}:{key}:{r['worker_id']}"} for r in found
        ], on_conflict="dedupe_key", ignore_duplicates=True).execute()
    except Exception:
        logger.exception("Could not notify the interviewers")


# ---- Sweep: reminders and finishing ------------------------------------------------------------------------------
def sweep(now: datetime | None = None) -> dict[str, int]:
    now = now or now_utc()
    counts = {"reminded": 0, "finished": 0}
    upcoming = rows(db().table("hr_interviews").select("*").eq("status", "scheduled").gt("starts_at", now.isoformat())
                    .lt("starts_at", (now + timedelta(hours=24, minutes=5)).isoformat()).limit(200).execute())
    for interview in upcoming:
        starts = engine.parse(interview["starts_at"])
        sent = dict(interview.get("reminders") or {})
        key = "1h" if starts - now <= timedelta(hours=1, minutes=5) else "24h"
        if sent.get(key) or (key == "24h" and sent.get("1h")):
            continue
        application = one(db().table("hr_applications").select("*").eq("id", interview["application_id"]).limit(1).execute())
        if application:
            _email_candidate(application, f"reminder_{key}", interview)
        _tell_interviewers(interview, "Interview in 1 hour" if key == "1h" else "Interview tomorrow",
                           engine.when_text(starts), f"reminder_{key}")
        sent[key] = now.isoformat()
        db().table("hr_interviews").update({"reminders": sent}).eq("id", interview["id"]).execute()
        counts["reminded"] += 1
    past = rows(db().table("hr_interviews").select("*").eq("status", "scheduled")
                .lt("ends_at", (now - timedelta(hours=1)).isoformat()).limit(200).execute())
    for interview in past:
        _mark(interview, "completed", None)
        counts["finished"] += 1
    return counts


def public_view(application: dict) -> dict | Any:
    interview = open_for(application["id"])
    if not interview:
        latest = one(db().table("hr_interviews").select("*").eq("application_id", application["id"])
                     .order("created_at", desc=True).limit(1).execute())
        return view(latest, for_candidate=True) if latest and latest["status"] in ("completed",) else None
    return view(interview, for_candidate=True)
