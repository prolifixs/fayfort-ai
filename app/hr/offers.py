"""HR and hiring H4 (docs/HR_AND_HIRING_PLAN.md): offers, accepting by link, and the Hire button.

HR writes the offer (title, desks, role, type, location, start date, probation, hours, extra terms). FayFort fills
the offer letter template and emails the candidate. The candidate reads it on their private page and accepts by typing
their full name, or declines. Once accepted, Hire sends the existing staff invitation (a new account, or the person's
existing FayFort account) with the role, desks and job title, and starts their employment record. Pay is never stored
(owner decision 30 Oct 2026): the letter says it is agreed separately.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any

from app.commerce.db import audit, db, one, rows
from app.hr import service
from app.hr.service import DEPARTMENTS, JOB_TYPES, LOCATIONS, HrError
from app.mailer.render import RenderedEmail, _paragraph, shell

logger = logging.getLogger(__name__)

ROLES = {"staff": "Team member", "assistant": "Personal assistant to the CEO"}
DESKS = {k: v for k, v in DEPARTMENTS.items() if k != "leadership"}
DEFAULT_TEMPLATE = """Dear {name},

We are delighted to offer you the role of {job_title} at FAYFORT International Trading.

Your role
- Job title: {job_title}
- Team: {desks}
- Type: {job_type}, {location}
- Start date: {start_date}
- Probation: {probation}
- Working hours: {hours}

Pay and how you are paid are agreed with you separately and are not part of this online offer.

{extra_terms}

On your first day you will receive your FayFort staff account, a welcome tour and a first-week checklist. You will be
asked to read and accept our staff policies, including how we handle customers' data.

This offer is open until {expires}. To accept it, type your full name on your application page.

We look forward to working with you.

The FayFort team"""
PLACEHOLDERS = ("name", "job_title", "desks", "job_type", "location", "start_date", "probation", "hours", "extra_terms",
                "expires")


def today() -> date:
    return service.now_utc().date()


def _long_date(value: date | str) -> str:
    day = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    return f"{day.day} {day:%B %Y}"


# ---- Settings ----------------------------------------------------------------------------------------------------
def settings() -> dict:
    found = one(db().table("hr_settings").select("*").eq("id", 1).limit(1).execute()) or {}
    return {"offer_template": (found.get("offer_template") or "").strip() or DEFAULT_TEMPLATE,
            "is_default_template": not (found.get("offer_template") or "").strip(),
            "probation_months": int(found.get("probation_months") if found.get("probation_months") is not None else 3),
            "offer_days": int(found.get("offer_days") or 7), "placeholders": list(PLACEHOLDERS)}


def save_settings(fields: dict, actor_id: str) -> dict:
    values: dict[str, Any] = {"updated_by": actor_id, "updated_at": service.now_iso()}
    if "offer_template" in fields:
        text = (fields.get("offer_template") or "").strip()
        unknown = sorted(set(re.findall(r"{(\w+)}", text)) - set(PLACEHOLDERS))
        if unknown:
            raise HrError("Unknown placeholders: " + ", ".join("{" + u + "}" for u in unknown), 422)
        values["offer_template"] = "" if text == DEFAULT_TEMPLATE.strip() else text[:8000]
    if fields.get("probation_months") is not None:
        values["probation_months"] = max(0, min(12, int(fields["probation_months"])))
    if fields.get("offer_days") is not None:
        values["offer_days"] = max(1, min(30, int(fields["offer_days"])))
    db().table("hr_settings").upsert({"id": 1, **values}, on_conflict="id").execute()
    audit(actor_id, "hr.settings", {"fields": sorted(k for k in values if k not in ("updated_by", "updated_at"))})
    return settings()


# ---- Writing an offer --------------------------------------------------------------------------------------------
def letter(template: str, values: dict) -> str:
    text = template
    for key in PLACEHOLDERS:
        text = text.replace("{" + key + "}", str(values.get(key) or ""))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def letter_values(name: str, offer: dict) -> dict:
    months = int(offer.get("probation_months") or 0)
    hours = offer.get("hours_per_week")
    return {"name": name or "candidate", "job_title": offer["job_title"],
            "desks": ", ".join(DESKS.get(d, d) for d in offer.get("departments") or []) or "To be agreed",
            "job_type": JOB_TYPES.get(offer["job_type"], offer["job_type"]),
            "location": LOCATIONS.get(offer["location"], offer["location"]),
            "start_date": _long_date(offer["start_date"]),
            "probation": f"{months} month{'s' if months != 1 else ''}" if months else "None",
            "hours": f"{hours} hours a week" if hours else "As agreed with your manager",
            "extra_terms": (offer.get("extra_terms") or "").strip(), "expires": _long_date(offer["expires_on"])}


def clean_offer(fields: dict, job: dict) -> dict:
    title = service.clean(fields.get("job_title") or job["title"], 80)
    if not title or len(title) < 2:
        raise HrError("Give the job title.", 422)
    desks = list(dict.fromkeys(d for d in (fields.get("departments") or []) if d in DESKS))
    if not desks and job.get("department") in DESKS:
        desks = [job["department"]]
    role = fields.get("staff_role") or "staff"
    if role not in ROLES:
        raise HrError("Offers are for team members or the CEO's assistant.", 422)
    job_type = fields.get("job_type") or job.get("job_type") or "full_time"
    location = fields.get("location") or job.get("location") or "guangzhou"
    if job_type not in JOB_TYPES or location not in LOCATIONS:
        raise HrError("Choose the job type and location.", 422)
    try:
        start = date.fromisoformat(str(fields.get("start_date") or ""))
    except ValueError:
        raise HrError("Choose a start date.", 422)
    if start < today():
        raise HrError("The start date can't be in the past.", 422)
    rules = settings()
    months = fields.get("probation_months")
    months = rules["probation_months"] if months is None else int(months)
    if not 0 <= months <= 12:
        raise HrError("Probation is 0 to 12 months.", 422)
    hours = fields.get("hours_per_week")
    if hours is not None and not 1 <= int(hours) <= 60:
        raise HrError("Hours a week are 1 to 60.", 422)
    days = int(fields.get("expires_in_days") or rules["offer_days"])
    return {"job_title": title, "departments": desks, "staff_role": role, "job_type": job_type, "location": location,
            "start_date": start.isoformat(), "probation_months": months, "hours_per_week": int(hours) if hours else None,
            "extra_terms": (fields.get("extra_terms") or "").strip()[:2000] or None,
            "expires_on": (today() + timedelta(days=max(1, min(30, days)))).isoformat()}


def _application(application_id: str) -> dict:
    application = one(db().table("hr_applications").select("*").eq("id", application_id).limit(1).execute())
    if not application:
        raise HrError("That application doesn't exist.", 404)
    return application


def _candidate(application: dict) -> dict:
    return one(db().table("hr_candidates").select("*").eq("id", application["candidate_id"]).limit(1).execute()) or {}


def preview(application_id: str, fields: dict) -> dict:
    application = _application(application_id)
    offer = clean_offer(fields, service.get_job(application["job_id"]))
    return {"letter": letter(settings()["offer_template"], letter_values(_candidate(application).get("full_name") or "", offer)),
            "offer": offer}


def current(application_id: str) -> dict | None:
    return one(db().table("hr_offers").select("*").eq("application_id", application_id).in_("status", ["sent", "accepted"])
               .limit(1).execute())


def send(application_id: str, fields: dict, actor_id: str) -> dict:
    application = _application(application_id)
    if application["stage"] in service.CLOSED + ["hired"]:
        raise HrError("This application is closed.", 409)
    if current(application_id):
        raise HrError("This candidate already has an offer. Withdraw it first to send a new one.", 409)
    candidate = _candidate(application)
    if not candidate.get("email"):
        raise HrError("This candidate's details were deleted.", 409)
    job = service.get_job(application["job_id"])
    offer = clean_offer(fields, job)
    text = (fields.get("letter") or "").strip() or letter(settings()["offer_template"], letter_values(candidate.get("full_name") or "", offer))
    created = one(db().table("hr_offers").insert({**offer, "application_id": application_id, "status": "sent",
                                                  "letter": text[:12000], "created_by": actor_id}).execute())
    if not created:
        raise HrError("The offer couldn't be saved.", 503)
    if application["stage"] != "offer":
        service.move_stage(application_id, "offer", None, actor_id, notify=False)
    service.add_event(application_id, "offer_sent", actor_id, {"expires_on": offer["expires_on"]})
    _email(application, candidate, "sent", created)
    audit(actor_id, "hr.offer.sent", {"application_id": application_id, "offer_id": created["id"]})
    return created


def withdraw(offer_id: str, actor_id: str) -> dict:
    offer = _offer(offer_id)
    if offer["status"] not in ("sent", "accepted"):
        raise HrError("This offer is already closed.", 409)
    application = _application(offer["application_id"])
    if application.get("hired_worker_id"):
        raise HrError("This person is already hired.", 409)
    db().table("hr_offers").update({"status": "withdrawn", "updated_at": service.now_iso()}).eq("id", offer_id).execute()
    service.add_event(offer["application_id"], "offer_withdrawn", actor_id, {})
    _email(application, _candidate(application), "withdrawn", offer)
    audit(actor_id, "hr.offer.withdrawn", {"offer_id": offer_id})
    return _offer(offer_id)


def _offer(offer_id: str) -> dict:
    offer = one(db().table("hr_offers").select("*").eq("id", offer_id).limit(1).execute())
    if not offer:
        raise HrError("That offer doesn't exist.", 404)
    return offer


# ---- The candidate answers ---------------------------------------------------------------------------------------
def _same_name(typed: str, name: str) -> bool:
    squash = lambda value: re.sub(r"\s+", " ", (value or "").strip()).casefold()  # noqa: E731
    return bool(typed.strip()) and squash(typed) == squash(name)


def accept(token: str, signature: str, address: str | None) -> dict:
    application = service.by_token(token)
    offer = current(application["id"])
    if not offer or offer["status"] != "sent":
        raise HrError("There's no open offer to accept.", 409)
    if date.fromisoformat(offer["expires_on"]) < today():
        raise HrError("This offer has expired. Reply to our email if you'd still like to talk.", 409)
    candidate = _candidate(application)
    if not _same_name(signature, candidate.get("full_name") or ""):
        raise HrError(f"Type your full name exactly as on your application: {candidate.get('full_name')}.", 422)
    db().table("hr_offers").update({"status": "accepted", "signature_name": signature.strip()[:120],
                                    "signature_ip": (address or "")[:80] or None, "responded_at": service.now_iso(),
                                    "updated_at": service.now_iso()}).eq("id", offer["id"]).execute()
    service.add_event(application["id"], "offer_accepted", None, {})
    _email(application, candidate, "accepted", offer)
    _tell_hr(f"{candidate.get('full_name') or 'A candidate'} accepted the offer",
             f"{offer['job_title']}, starting {_long_date(offer['start_date'])}. Press Hire in People to send their staff invitation.",
             f"offer:{offer['id']}:accepted")
    return service.status_view(token)


def decline(token: str, reason: str | None) -> dict:
    application = service.by_token(token)
    offer = current(application["id"])
    if not offer or offer["status"] != "sent":
        raise HrError("There's no open offer to decline.", 409)
    db().table("hr_offers").update({"status": "declined", "decline_reason": (reason or "").strip()[:500] or None,
                                    "responded_at": service.now_iso(), "updated_at": service.now_iso()}).eq("id", offer["id"]).execute()
    service.add_event(application["id"], "offer_declined", None, {})
    candidate = _candidate(application)
    _tell_hr(f"{candidate.get('full_name') or 'A candidate'} declined the offer", offer["job_title"], f"offer:{offer['id']}:declined")
    return service.status_view(token)


def public_view(application: dict) -> dict | None:
    offer = current(application["id"]) or one(db().table("hr_offers").select("*").eq("application_id", application["id"])
                                               .order("created_at", desc=True).limit(1).execute())
    if not offer or offer["status"] in ("withdrawn",):
        return None
    return {"status": offer["status"], "job_title": offer["job_title"], "letter": offer["letter"],
            "start_date": offer["start_date"], "expires_on": offer["expires_on"],
            "expired": offer["status"] == "sent" and date.fromisoformat(offer["expires_on"]) < today(),
            "signature_name": offer.get("signature_name"), "responded_at": offer.get("responded_at")}


# ---- Hire --------------------------------------------------------------------------------------------------------
def hire(application_id: str, actor_id: str, invite=None) -> dict:
    """Sends the staff invitation and starts the employment record. `invite` is the onboarding call (tests swap it)."""
    application = _application(application_id)
    if application.get("hired_worker_id"):
        raise HrError("This person is already hired.", 409)
    offer = current(application_id)
    if not offer or offer["status"] != "accepted":
        raise HrError("Hire opens once the candidate has accepted the offer.", 409)
    candidate = _candidate(application)
    if not candidate.get("email"):
        raise HrError("This candidate's details were deleted.", 409)
    if invite is None:
        from app.workforce import onboarding
        def invite(actor: str, email: str) -> dict:  # noqa: E306
            payload = onboarding.StaffInvitation(email=email, staff_role=offer["staff_role"], job_title=offer["job_title"],
                                                 departments=offer.get("departments") or [])
            try:
                return onboarding.invite(actor, payload)
            except onboarding.OnboardingError as exc:
                raise HrError(str(exc), 409) from exc
    result = invite(actor_id, candidate["email"])
    worker_id = str(result["user_id"])
    start = date.fromisoformat(offer["start_date"])
    months = int(offer.get("probation_months") or 0)
    probation_end = _add_months(start, months) if months else None
    db().table("hr_employment").upsert({
        "worker_id": worker_id, "application_id": application_id, "offer_id": offer["id"], "job_title": offer["job_title"],
        "job_type": offer["job_type"], "location": offer["location"], "start_date": start.isoformat(),
        "probation_end": probation_end.isoformat() if probation_end else None, "hours_per_week": offer.get("hours_per_week"),
        "status": "starting", "created_by": actor_id, "updated_at": service.now_iso()}, on_conflict="worker_id").execute()
    db().table("hr_applications").update({"stage": "hired", "hired_worker_id": worker_id, "stage_changed_at": service.now_iso(),
                                          "updated_at": service.now_iso()}).eq("id", application_id).execute()
    service.add_event(application_id, "hired", actor_id, {"invitation": result.get("kind")})
    audit(actor_id, "hr.hired", {"application_id": application_id, "worker_id": worker_id})
    return {"worker_id": worker_id, "invitation": result.get("kind"), "email": candidate["email"]}


def _add_months(day: date, months: int) -> date:
    return service.add_months(day, months)


# ---- Emails, notices and expiry ----------------------------------------------------------------------------------
def offer_email(kind: str, name: str, offer: dict, token: str) -> RenderedEmail:
    first = (name or "there").split(" ")[0]
    texts = {
        "sent": (f"Your offer from FayFort: {offer['job_title']}", f"Congratulations, {first}",
                 [f"We'd love you to join FayFort as {offer['job_title']}, starting {_long_date(offer['start_date'])}.",
                  f"Read your offer and accept it from your private page. It's open until {_long_date(offer['expires_on'])}."],
                 "Read my offer"),
        "accepted": ("Welcome to FayFort", f"Welcome to the team, {first}",
                     [f"Thank you for accepting the offer for {offer['job_title']}. Your FayFort staff invitation will "
                      "arrive by email shortly.", "A copy of your offer stays on your private page."], "See my offer"),
        "withdrawn": (f"Your offer for {offer['job_title']}", f"An update on your offer, {first}",
                      ["We've withdrawn the offer we sent. We'll be in touch to explain the next step."], "See my application"),
    }
    subject, heading, parts, button = texts[kind]
    url = service.status_url(token)
    footer = "You're getting this because you applied for a role at fayfort.com/careers."
    html = shell(heading=heading, intro_html="".join(_paragraph(p) for p in parts), button_label=button, button_url=url,
                 footer_note=footer, unsubscribe_url=None)
    text = f"{heading}\n\n" + "\n\n".join(parts) + f"\n\n{button}: {url}\n\n{footer}"
    return RenderedEmail(subject=subject, html=html, text=text)


def _email(application: dict, candidate: dict, kind: str, offer: dict) -> None:
    if not candidate.get("email"):
        return
    token = service.issue_link(application["id"])
    service.queue_candidate_email(candidate["email"], offer_email(kind, candidate.get("full_name") or "", offer, token),
                                  f"hr_offer_{kind}")
    service.add_event(application["id"], "email_sent", None, {"template": f"hr_offer_{kind}"})


def _tell_hr(title: str, body: str, key: str) -> None:
    """HR staff and administrators hear about answers to offers."""
    try:
        hr = [str(w["user_id"]) for w in rows(db().table("fayfort_workers").select("user_id,hr_access,staff_role,status")
                                               .eq("status", "active").limit(500).execute())
              if w.get("hr_access") is True or w.get("staff_role") == "ceo"]
        if hr:
            db().table("operations_worker_notifications").upsert([
                {"worker_id": w, "notification_type": "hiring", "title": title[:160], "body": body[:500], "href": "/operations",
                 "dedupe_key": f"{key}:{w}"} for w in hr], on_conflict="dedupe_key", ignore_duplicates=True).execute()
        db().rpc("notify_platform_admins", {"p_notification_type": "hiring", "p_work_item_id": None, "p_title": title[:160],
                                            "p_body": body[:500], "p_href": "/operations", "p_dedupe": key}).execute()
    except Exception:
        logger.exception("Could not tell HR about an offer")


def expire(now: datetime | None = None) -> int:
    day = (now or service.now_utc()).date().isoformat()
    due = rows(db().table("hr_offers").select("id,application_id,expires_on").eq("status", "sent").lt("expires_on", day)
               .limit(200).execute())
    for offer in due:
        db().table("hr_offers").update({"status": "expired", "updated_at": service.now_iso()}).eq("id", offer["id"]).execute()
        service.add_event(offer["application_id"], "offer_expired", None, {})
    return len(due)


def for_application(application_id: str) -> list[dict]:
    return rows(db().table("hr_offers").select("*").eq("application_id", application_id).order("created_at", desc=True)
                .limit(20).execute())
