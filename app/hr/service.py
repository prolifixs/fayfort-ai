"""HR and hiring H1 (docs/HR_AND_HIRING_PLAN.md): jobs, applications, CVs and the candidate's private status link.

Owner decisions (30 Oct 2026): HR staff hire (the HR flag on a worker, plus the CEO and platform admins), pay stays out
of FayFort, ID documents are never stored, applications are kept 12 months then anonymised, trial tasks are set per
job, and leave allowances live in People -> Settings.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.commerce.db import audit, db, one, rows
from app.mailer.render import RenderedEmail, _paragraph, shell

logger = logging.getLogger(__name__)

BUCKET = "hr-cvs"
MAX_CV_BYTES = 5 * 1024 * 1024
RETAIN_MONTHS = 12
SITE = "https://www.fayfort.com"

DEPARTMENTS = {
    "conversation_intake": "Conversation intake", "sourcing": "Sourcing desk", "fulfillment": "Fulfillment",
    "disputes": "Disputes", "member_support": "Member support", "store_team": "Store team", "leadership": "Leadership",
}
JOB_TYPES = {"full_time": "Full time", "part_time": "Part time", "contract": "Contract", "internship": "Internship"}
LOCATIONS = {"guangzhou": "Guangzhou office", "remote": "Remote", "both": "Guangzhou or remote"}
STAGES = ["applied", "screening", "interview", "trial_task", "offer", "hired"]
CLOSED = ["not_moving_forward", "withdrew"]
STAGE_LABELS = {"applied": "Applied", "screening": "Screening", "interview": "Interview", "trial_task": "Trial task",
                "offer": "Offer", "hired": "Hired", "not_moving_forward": "Not moving forward", "withdrew": "Withdrew"}
CV_TYPES = {
    "application/pdf": ("pdf", lambda data: data.startswith(b"%PDF-")),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("docx", lambda data: data.startswith(b"PK\x03\x04")),
    "application/msword": ("doc", lambda data: data.startswith(b"\xd0\xcf\x11\xe0")),
}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL = re.compile(r"^https?://[^\s]+$", re.I)
CLOSE_REASONS = ["Not enough experience for this role", "Language skills", "Location or working hours",
                 "The role was filled", "No reply from the candidate", "Other"]
PUBLIC_JOB_FIELDS = ("id", "slug", "title", "department", "job_type", "location", "summary", "duties", "requirements",
                     "questions", "trial_task", "trial_paid", "opened_at")


class HrError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def clean(value: Any, limit: int) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit] or None


def clean_list(values: list[str] | None, limit: int = 12, length: int = 240) -> list[str]:
    return [c for c in (clean(v, length) for v in (values or [])) if c][:limit]


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60].strip("-")
    return slug if len(slug) >= 3 else f"role-{slug}".strip("-")


def add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year, month = day.year + month // 12, month % 12 + 1
    for last in (31, 30, 29, 28):
        try:
            return date(year, month, min(day.day, last))
        except ValueError:
            continue
    return day


# ---- Access --------------------------------------------------------------------------------------------------------
def worker_can_hire(user_id: str) -> bool:
    worker = one(db().table("fayfort_workers").select("status,staff_role,hr_access").eq("user_id", user_id)
                 .limit(1).execute())
    return bool(worker and worker.get("status") == "active"
                and (worker.get("hr_access") is True or worker.get("staff_role") == "ceo"))


# ---- Jobs ----------------------------------------------------------------------------------------------------------
def clean_questions(questions: list[dict] | None) -> list[dict]:
    cleaned = []
    for index, question in enumerate((questions or [])[:5]):
        label = clean(question.get("label"), 200)
        kind = question.get("kind") if question.get("kind") in ("short", "yes_no", "choice") else "short"
        if not label:
            continue
        options = clean_list(question.get("options"), 6, 80) if kind == "choice" else []
        if kind == "choice" and len(options) < 2:
            raise HrError(f"Question {index + 1} needs at least two choices.", 422)
        cleaned.append({"id": str(question.get("id") or f"q{index + 1}")[:20], "label": label, "kind": kind,
                        "options": options, "required": question.get("required") is not False})
    return cleaned


def job_values(fields: dict) -> dict:
    values: dict[str, Any] = {}
    if "title" in fields:
        title = clean(fields["title"], 80)
        if not title or len(title) < 2:
            raise HrError("Give the job a title.", 422)
        values["title"] = title
    for key, allowed in (("department", DEPARTMENTS), ("job_type", JOB_TYPES), ("location", LOCATIONS)):
        if key in fields:
            if fields[key] not in allowed:
                raise HrError(f"Choose a {key.replace('_', ' ')}.", 422)
            values[key] = fields[key]
    if "pay_range" in fields:
        values["pay_range"] = clean(fields["pay_range"], 80)
    if "summary" in fields:
        values["summary"] = (str(fields["summary"] or "").strip())[:1200]
    for key in ("duties", "requirements"):
        if key in fields:
            values[key] = clean_list(fields[key])
    if "skills" in fields:
        values["skills"] = clean_list(fields["skills"], 6, 60)
    if "questions" in fields:
        values["questions"] = clean_questions(fields["questions"])
    for key in ("show_pay", "trial_task", "trial_paid"):
        if key in fields and fields[key] is not None:
            values[key] = bool(fields[key])
    return values


def _unique_slug(title: str, job_id: str | None = None) -> str:
    base = slugify(title)
    slug, number = base, 2
    while True:
        found = one(db().table("hr_jobs").select("id").eq("slug", slug).limit(1).execute())
        if not found or str(found["id"]) == str(job_id):
            return slug
        slug, number = f"{base}-{number}", number + 1


def create_job(fields: dict, actor_id: str) -> dict:
    values = job_values({"department": "sourcing", "job_type": "full_time", "location": "guangzhou", **fields})
    if "title" not in values:
        raise HrError("Give the job a title.", 422)
    values.update({"slug": _unique_slug(values["title"]), "status": "draft", "created_by": actor_id})
    job = one(db().table("hr_jobs").insert(values).execute())
    audit(actor_id, "hr.job.created", {"job_id": (job or {}).get("id"), "title": values["title"]})
    return job or {}


def get_job(job_id: str) -> dict:
    job = one(db().table("hr_jobs").select("*").eq("id", job_id).limit(1).execute())
    if not job:
        raise HrError("That job doesn't exist.", 404)
    return job


def update_job(job_id: str, fields: dict, actor_id: str) -> dict:
    job = get_job(job_id)
    values = job_values(fields)
    if not values:
        return job
    values["updated_at"] = now_iso()
    db().table("hr_jobs").update(values).eq("id", job_id).execute()
    audit(actor_id, "hr.job.updated", {"job_id": job_id, "fields": sorted(values)})
    return get_job(job_id)


def missing_for_open(job: dict) -> list[str]:
    missing = []
    if len((job.get("summary") or "").strip()) < 40:
        missing.append("a short description (40 characters or more)")
    if not job.get("duties"):
        missing.append("at least one line under What you'll do")
    if not job.get("requirements"):
        missing.append("at least one line under What we're looking for")
    return missing


def set_job_status(job_id: str, status: str, actor_id: str) -> dict:
    job = get_job(job_id)
    if status not in ("draft", "open", "paused", "closed"):
        raise HrError("Unknown job status.", 422)
    if status == "open":
        missing = missing_for_open(job)
        if missing:
            raise HrError("Before opening this job add " + ", ".join(missing) + ".", 422)
    values: dict[str, Any] = {"status": status, "updated_at": now_iso()}
    if status == "open" and not job.get("opened_at"):
        values["opened_at"] = now_iso()
    db().table("hr_jobs").update(values).eq("id", job_id).execute()
    audit(actor_id, "hr.job.status", {"job_id": job_id, "status": status})
    return get_job(job_id)


def job_counts() -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for row in rows(db().table("hr_applications").select("job_id,stage").limit(10000).execute()):
        by_stage = counts.setdefault(str(row["job_id"]), {})
        by_stage[row["stage"]] = by_stage.get(row["stage"], 0) + 1
    return counts


def list_jobs() -> list[dict]:
    jobs = rows(db().table("hr_jobs").select("*").order("created_at", desc=True).limit(200).execute())
    counts = job_counts()
    for job in jobs:
        job["counts"] = counts.get(str(job["id"]), {})
    return jobs


def public_job(job: dict) -> dict:
    out = {key: job.get(key) for key in PUBLIC_JOB_FIELDS}
    out["pay_range"] = job.get("pay_range") if job.get("show_pay") else None
    out["department_label"] = DEPARTMENTS.get(job.get("department"), "")
    out["job_type_label"] = JOB_TYPES.get(job.get("job_type"), "")
    out["location_label"] = LOCATIONS.get(job.get("location"), "")
    return out


def open_jobs() -> list[dict]:
    jobs = rows(db().table("hr_jobs").select("*").eq("status", "open").order("opened_at", desc=True).limit(50).execute())
    return [public_job(job) for job in jobs]


def open_job(slug: str) -> dict:
    job = one(db().table("hr_jobs").select("*").eq("slug", slug).eq("status", "open").limit(1).execute())
    if not job:
        raise HrError("This role isn't open any more.", 404)
    return job


# ---- Applying ------------------------------------------------------------------------------------------------------
def read_cv(cv_base64: str, cv_type: str) -> tuple[bytes, str]:
    kind = CV_TYPES.get(cv_type)
    if not kind:
        raise HrError("Upload your CV as a PDF or Word file.", 415)
    try:
        content = base64.b64decode(cv_base64, validate=True)
    except (ValueError, TypeError):
        raise HrError("The CV file couldn't be read. Please choose it again.", 422)
    if not content:
        raise HrError("Choose your CV to upload.", 422)
    if len(content) > MAX_CV_BYTES:
        raise HrError("Your CV must be 5 MB or smaller.", 413)
    if not kind[1](content):
        raise HrError("That file isn't the type it says it is. Upload a PDF or Word file.", 415)
    return content, kind[0]


def check_answers(job: dict, answers: list[dict]) -> list[dict]:
    given = {str(a.get("id")): a.get("answer") for a in answers or []}
    out = []
    for question in job.get("questions") or []:
        value = given.get(str(question["id"]))
        if question["kind"] == "yes_no":
            text = "Yes" if value in (True, "yes", "Yes") else "No" if value in (False, "no", "No") else None
        elif question["kind"] == "choice":
            text = value if value in question.get("options", []) else None
        else:
            text = clean(value, 1000)
        if not text and question.get("required", True):
            raise HrError(f"Please answer: {question['label']}", 422)
        out.append({"id": question["id"], "label": question["label"], "answer": text or ""})
    return out


def apply(slug: str, form: dict) -> dict:
    """Saves an application, stores the CV and queues the "we got it" email. Returns the private status token."""
    job = open_job(slug)
    email = (form.get("email") or "").strip().lower()
    if not _EMAIL.match(email) or len(email) > 320:
        raise HrError("Enter a valid email address.", 422)
    name = clean(form.get("full_name"), 120)
    if not name or len(name) < 2:
        raise HrError("Enter your full name.", 422)
    if form.get("keep_details") is not True:
        raise HrError("Please agree to FayFort keeping your details so we can consider you.", 422)
    portfolio = clean(form.get("portfolio_url"), 300)
    if portfolio and not _URL.match(portfolio):
        raise HrError("The portfolio or LinkedIn link should start with https://", 422)
    answers = check_answers(job, form.get("answers") or [])
    content, extension = read_cv(form.get("cv_base64") or "", form.get("cv_type") or "")

    candidate = one(db().table("hr_candidates").select("*").eq("email", email).limit(1).execute())
    retain = add_months(now_utc().date(), RETAIN_MONTHS).isoformat()
    details = {"full_name": name, "phone": clean(form.get("phone"), 40), "location": clean(form.get("location"), 120),
               "languages": clean(form.get("languages"), 200), "keep_details": True, "retain_until": retain,
               "anonymised_at": None, "updated_at": now_iso()}
    if candidate:
        if one(db().table("hr_applications").select("id").eq("job_id", job["id"]).eq("candidate_id", candidate["id"])
               .limit(1).execute()):
            raise HrError("You've already applied for this role. Check the link in your email for its status.", 409)
        db().table("hr_candidates").update(details).eq("id", candidate["id"]).execute()
    else:
        candidate = one(db().table("hr_candidates").insert({"email": email, **details}).execute())
    if not candidate:
        raise HrError("Your application couldn't be saved. Please try again.", 503)

    path = f"cvs/{now_utc():%Y/%m}/{uuid4()}.{extension}"
    db().storage.from_(BUCKET).upload(path, content, {"content-type": form["cv_type"], "upsert": "false"})
    token = secrets.token_urlsafe(32)
    try:
        application = one(db().table("hr_applications").insert({
            "job_id": job["id"], "candidate_id": candidate["id"], "stage": "applied", "answers": answers,
            "cv_path": path, "cv_name": clean(form.get("cv_name"), 160) or f"CV.{extension}", "cv_type": form["cv_type"],
            "portfolio_url": portfolio, "heard_from": clean(form.get("heard_from"), 80), "token_hash": hash_token(token),
        }).execute())
    except Exception:
        try:
            db().storage.from_(BUCKET).remove([path])
        except Exception:
            pass
        raise
    if not application:
        raise HrError("Your application couldn't be saved. Please try again.", 503)
    db().table("hr_status_links").insert({"application_id": application["id"], "token_hash": hash_token(token)}).execute()
    add_event(application["id"], "applied", None, {"job": job["title"]})
    queue_candidate_email(email, received_email(name, job["title"], token))
    add_event(application["id"], "email_sent", None, {"template": "hr_received"})
    return {"token": token, "job_title": job["title"]}


def add_event(application_id: str, kind: str, actor_id: str | None, detail: dict | None = None) -> None:
    db().table("hr_application_events").insert({"application_id": application_id, "kind": kind,
                                                "actor_id": actor_id, "detail": detail or {}}).execute()


# ---- Emails --------------------------------------------------------------------------------------------------------
def status_url(token: str) -> str:
    return f"{SITE}/careers/status/{token}"


def received_email(name: str, job_title: str, token: str) -> RenderedEmail:
    first = name.split(" ")[0]
    url = status_url(token)
    heading = f"Thanks, {first}. We've got your application"
    parts = [f"Thanks for applying for {job_title} at FayFort. Our HR team reads every application and will get "
             "back to you within 7 days.",
             "Use the button to see where your application is at any time. Keep this email: the link is private to you."]
    footer = "You're getting this because you applied for a role at fayfort.com/careers."
    html = shell(heading=heading, intro_html="".join(_paragraph(p) for p in parts), button_label="See my application",
                 button_url=url, footer_note=footer, unsubscribe_url=None)
    text = f"{heading}\n\n" + "\n\n".join(parts) + f"\n\nSee my application: {url}\n\n{footer}"
    return RenderedEmail(subject=f"We've got your application for {job_title}", html=html, text=text)


def queue_candidate_email(to: str, rendered: RenderedEmail, template: str = "hr_received") -> None:
    db().table("email_outbox").insert({
        "category": "notifications", "template": template, "to_email": to,
        "payload": {"subject": rendered.subject, "html": rendered.html, "text": rendered.text},
    }).execute()


STAGE_EMAILS: dict[str, tuple[str, str, list[str]]] = {
    "screening": ("Your application for {job} is being reviewed", "We're reviewing your application",
                  ["Thanks for applying for {job}. Our HR team is now reviewing your application in detail.",
                   "We'll email you about the next step. You can check where you are at any time."]),
    "interview": ("Let's talk: {job} at FayFort", "We'd like to talk, {first}",
                  ["Thanks for your application for {job}. We'd like to invite you to an interview with the team.",
                   "We'll be in touch shortly to arrange a time that suits you."]),
    "trial_task": ("A short task for {job}", "A short task for you, {first}",
                   ["You've done well so far. The next step for {job} is a short trial task, {paid}.",
                    "We'll send you the brief and the due date. You'll upload your work from your private link."]),
    "offer": ("Good news about {job}", "Good news, {first}",
              ["We're preparing an offer for {job}. You'll receive the details by email very soon."]),
    "not_moving_forward": ("Your application for {job}", "Thank you, {first}",
                           ["Thank you for applying for {job} and for the time you gave us. After careful thought we won't "
                            "be moving forward with your application this time.",
                            "We keep your details for 12 months and may contact you about other roles. You can delete them "
                            "sooner from your private link."]),
}


def stage_email(stage: str, name: str, job: dict, token: str) -> RenderedEmail:
    subject, heading, parts = STAGE_EMAILS[stage]
    values = {"job": job["title"], "first": (name or "there").split(" ")[0],
              "paid": "and it's paid" if job.get("trial_paid") else "unpaid"}
    subject, heading = subject.format(**values), heading.format(**values)
    parts = [p.format(**values) for p in parts]
    url = status_url(token)
    footer = "You're getting this because you applied for a role at fayfort.com/careers."
    html = shell(heading=heading, intro_html="".join(_paragraph(p) for p in parts), button_label="See my application",
                 button_url=url, footer_note=footer, unsubscribe_url=None)
    text = f"{heading}\n\n" + "\n\n".join(parts) + f"\n\nSee my application: {url}\n\n{footer}"
    return RenderedEmail(subject=subject, html=html, text=text)


def issue_link(application_id: str) -> str:
    token = secrets.token_urlsafe(32)
    db().table("hr_status_links").insert({"application_id": application_id, "token_hash": hash_token(token)}).execute()
    return token


def notify_stage(application: dict, stage: str, actor_id: str | None) -> bool:
    """Emails the candidate about their new stage with a fresh private link. Returns whether an email was queued."""
    if stage not in STAGE_EMAILS:
        return False
    candidate = one(db().table("hr_candidates").select("email,full_name").eq("id", application["candidate_id"])
                    .limit(1).execute()) or {}
    if not candidate.get("email"):
        return False
    job = get_job(application["job_id"])
    rendered = stage_email(stage, candidate.get("full_name") or "", job, issue_link(application["id"]))
    queue_candidate_email(candidate["email"], rendered, f"hr_stage_{stage}")
    add_event(application["id"], "email_sent", actor_id, {"template": f"hr_stage_{stage}"})
    return True


# ---- The candidate's status link -----------------------------------------------------------------------------------
NEXT_STEPS = {
    "applied": "Our HR team will read your application within 7 days.",
    "screening": "We're reviewing your application. We'll email you about the next step.",
    "interview": "We'd like to talk. We'll email you to arrange an interview.",
    "trial_task": "We'll send you a short task to show how you'd work.",
    "offer": "We're preparing an offer. Watch your email.",
    "hired": "Welcome to FayFort. Your staff invitation will arrive by email.",
    "not_moving_forward": "Thank you for applying. We won't be moving forward this time, and we'll keep your details "
                          "for future roles until the date below.",
    "withdrew": "You withdrew this application.",
}


def by_token(token: str) -> dict:
    if not token or len(token) > 100:
        raise HrError("This link isn't valid.", 404)
    digest = hash_token(token)
    link = one(db().table("hr_status_links").select("application_id").eq("token_hash", digest).limit(1).execute())
    application = one(db().table("hr_applications").select("*").eq("id", link["application_id"]).limit(1).execute()) \
        if link else one(db().table("hr_applications").select("*").eq("token_hash", digest).limit(1).execute())
    if not application:
        raise HrError("This link isn't valid or the application was deleted.", 404)
    return application


def status_view(token: str) -> dict:
    application = by_token(token)
    job = get_job(application["job_id"])
    candidate = one(db().table("hr_candidates").select("full_name,retain_until").eq("id", application["candidate_id"])
                    .limit(1).execute()) or {}
    stage = application["stage"]
    reached = STAGES.index(stage) if stage in STAGES else -1
    steps = [{"key": key, "label": STAGE_LABELS[key],
              "state": "done" if index < reached or stage == "hired" else "current" if index == reached else "todo"}
             for index, key in enumerate(STAGES) if key != "trial_task" or job.get("trial_task")]
    from app.hr import interviews, offers
    interview = interviews.public_view(application) if stage not in CLOSED + ["offer", "hired"] else None
    offer = offers.public_view(application) if stage in ("offer", "hired") else None
    next_step = NEXT_STEPS[stage]
    if offer and offer["status"] == "sent" and not offer["expired"]:
        next_step = "Read your offer above. To accept it, type your full name and press Accept."
    elif offer and offer["status"] == "accepted" and stage != "hired":
        next_step = "Thank you for accepting. Your FayFort staff invitation will arrive by email."
    elif offer and offer["status"] == "declined":
        next_step = "You declined this offer. Thank you for letting us know."
    if interview and interview["status"] == "proposed":
        next_step = "Pick a time for your interview above. We'll confirm it by email."
    elif interview and interview["status"] == "scheduled":
        next_step = "Your interview is booked. We'll remind you the day before and an hour before."
    return {"interview": interview, "offer": offer,
            "first_name": (candidate.get("full_name") or "").split(" ")[0], "job_title": job["title"],
            "applied_at": application["created_at"], "stage": stage, "stage_label": STAGE_LABELS[stage],
            "closed": stage in CLOSED, "steps": steps, "next": next_step,
            "kept_until": candidate.get("retain_until")}


def withdraw(token: str) -> dict:
    application = by_token(token)
    if application["stage"] in CLOSED or application["stage"] == "hired":
        raise HrError("This application is already closed.", 409)
    db().table("hr_applications").update({"stage": "withdrew", "stage_changed_at": now_iso(), "updated_at": now_iso()}) \
        .eq("id", application["id"]).execute()
    add_event(application["id"], "withdrawn", None, {"from": application["stage"]})
    return status_view(token)


def anonymise_candidate(candidate_id: str) -> None:
    """Removes the person's details and CVs. Applications stay as anonymous counts for reporting."""
    applications = rows(db().table("hr_applications").select("id,cv_path,stage").eq("candidate_id", candidate_id)
                        .limit(100).execute())
    paths = [a["cv_path"] for a in applications if a.get("cv_path")]
    if paths:
        try:
            db().storage.from_(BUCKET).remove(paths)
        except Exception:
            logger.warning("CVs could not be removed for an anonymised candidate", exc_info=True)
    for application in applications:
        for interview in rows(db().table("hr_interviews").select("id,status").eq("application_id", application["id"])
                              .limit(20).execute()):
            slots_ = rows(db().table("hr_interview_interviewers").select("id,booking_id").eq("interview_id", interview["id"])
                          .limit(20).execute())
            booking_ids = [str(r["booking_id"]) for r in slots_ if r.get("booking_id")]
            if booking_ids:
                db().table("bookings").update({"topic": "Candidate (details deleted)", "member_time_zone": None}) \
                    .in_("id", booking_ids).execute()
                db().table("bookings").update({"status": "cancelled", "cancelled_by": "system",
                                               "cancel_reason": "The candidate's details were deleted."}) \
                    .in_("id", booking_ids).in_("status", ["held", "confirmed"]).execute()
            if interview["status"] in ("proposed", "scheduled"):
                db().table("hr_interviews").update({"status": "cancelled"}).eq("id", interview["id"]).execute()
            db().table("hr_interviews").update({"candidate_time_zone": None}).eq("id", interview["id"]).execute()
        if application["stage"] != "hired":
            db().table("hr_offers").update({"letter": "(Removed when the candidate's details were deleted.)",
                                            "signature_name": None, "signature_ip": None, "extra_terms": None}) \
                .eq("application_id", application["id"]).execute()
            db().table("hr_offers").update({"status": "withdrawn"}).eq("application_id", application["id"]) \
                .in_("status", ["sent", "accepted"]).execute()
        db().table("hr_applications").update({
            "cv_path": None, "cv_name": None, "cv_type": None, "answers": [], "portfolio_url": None, "token_hash": None,
            "stage": application["stage"] if application["stage"] in CLOSED + ["hired"] else "withdrew",
            "updated_at": now_iso()}).eq("id", application["id"]).execute()
        db().table("hr_application_events").delete().eq("application_id", application["id"]).eq("kind", "note").execute()
        db().table("hr_status_links").delete().eq("application_id", application["id"]).execute()
    db().table("hr_candidates").update({"email": None, "full_name": None, "phone": None, "location": None,
                                        "languages": None, "anonymised_at": now_iso(), "updated_at": now_iso()}) \
        .eq("id", candidate_id).execute()


def delete_my_details(token: str) -> None:
    application = by_token(token)
    anonymise_candidate(application["candidate_id"])
    audit(None, "hr.candidate.deleted_by_request", {"application_id": application["id"]})


def anonymise_expired() -> int:
    """Daily: candidates past their keep-until date are anonymised, unless they were hired."""
    today = now_utc().date().isoformat()
    due = rows(db().table("hr_candidates").select("id,retain_until").lt("retain_until", today)
               .is_("anonymised_at", "null").limit(500).execute())
    done = 0
    for candidate in due:
        hired = one(db().table("hr_applications").select("id").eq("candidate_id", candidate["id"]).eq("stage", "hired")
                    .limit(1).execute())
        if hired:
            continue
        anonymise_candidate(candidate["id"])
        done += 1
    if done:
        audit(None, "hr.candidates.anonymised", {"count": done})
    return done


# ---- HR staff: applications ----------------------------------------------------------------------------------------
def _days_since(value: str | None) -> int:
    try:
        then = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return 0
    return max(0, (now_utc() - then).days)


def list_applications(job_id: str | None = None, stage: str | None = None) -> list[dict]:
    query = db().table("hr_applications").select("*").order("created_at", desc=True).limit(500)
    if job_id:
        query = query.eq("job_id", job_id)
    if stage:
        query = query.eq("stage", stage)
    applications = rows(query.execute())
    candidate_ids = list({str(a["candidate_id"]) for a in applications})
    candidates = {str(c["id"]): c for c in rows(db().table("hr_candidates").select("*").in_("id", candidate_ids)
                                                .limit(1000).execute())} if candidate_ids else {}
    jobs = {str(j["id"]): j for j in rows(db().table("hr_jobs").select("id,title").limit(500).execute())}
    out = []
    for application in applications:
        candidate = candidates.get(str(application["candidate_id"]), {})
        out.append({"id": application["id"], "job_id": application["job_id"],
                    "job_title": jobs.get(str(application["job_id"]), {}).get("title", ""),
                    "stage": application["stage"], "created_at": application["created_at"],
                    "days_in_stage": _days_since(application.get("stage_changed_at") or application["created_at"]),
                    "stage_changed_at": application.get("stage_changed_at"),
                    "name": candidate.get("full_name") or "Removed candidate", "email": candidate.get("email"),
                    "location": candidate.get("location"), "languages": candidate.get("languages")})
    return out


def application_detail(application_id: str, actor_id: str) -> dict:
    application = one(db().table("hr_applications").select("*").eq("id", application_id).limit(1).execute())
    if not application:
        raise HrError("That application doesn't exist.", 404)
    candidate = one(db().table("hr_candidates").select("*").eq("id", application["candidate_id"]).limit(1).execute()) or {}
    others = [a for a in rows(db().table("hr_applications").select("id,job_id,stage,created_at")
                              .eq("candidate_id", application["candidate_id"]).limit(50).execute())
              if str(a["id"]) != str(application_id)]
    events = rows(db().table("hr_application_events").select("*").eq("application_id", application_id)
                  .order("created_at").limit(200).execute())
    job = get_job(application["job_id"])
    application.pop("token_hash", None)
    from app.hr import interviews, offers
    return {"application": {**application, "has_cv": bool(application.get("cv_path"))},
            "interviews": interviews.for_application(application_id),
            "offers": offers.for_application(application_id),
            "candidate": {k: candidate.get(k) for k in ("id", "full_name", "email", "phone", "location", "languages",
                                                        "retain_until", "anonymised_at")},
            "job": {"id": job["id"], "title": job["title"], "trial_task": job.get("trial_task"),
                    "skills": interviews.skills_for(job)},
            "other_applications": others, "events": events}


def cv_link(application_id: str, actor_id: str) -> str:
    application = one(db().table("hr_applications").select("id,cv_path").eq("id", application_id).limit(1).execute())
    if not application or not application.get("cv_path"):
        raise HrError("There's no CV on this application.", 404)
    try:
        result = db().storage.from_(BUCKET).create_signed_url(application["cv_path"], 300)
    except Exception:
        result = None
    url = None
    if isinstance(result, dict):
        url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
    if url and url.startswith("/"):
        from urllib.parse import urljoin
        from app.config.settings import settings
        url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", url.lstrip("/"))
    if not url:
        raise HrError("The CV couldn't be opened. Try again.", 503)
    add_event(application_id, "cv_viewed", actor_id)
    audit(actor_id, "hr.cv.viewed", {"application_id": application_id})
    return url


def move_stage(application_id: str, stage: str, reason: str | None, actor_id: str, notify: bool = True) -> dict:
    if stage not in STAGES + CLOSED or stage == "withdrew":
        raise HrError("Choose a stage.", 422)
    application = one(db().table("hr_applications").select("id,stage,job_id,candidate_id").eq("id", application_id)
                      .limit(1).execute())
    if not application:
        raise HrError("That application doesn't exist.", 404)
    if application["stage"] == stage:
        return application_detail(application_id, actor_id)
    if application["stage"] in ("withdrew", "hired"):
        raise HrError("This application is closed.", 409)
    if stage == "hired":
        raise HrError("Hire someone with the Hire button once they have accepted the offer.", 409)
    if stage == "not_moving_forward" and not clean(reason, 300):
        raise HrError("Add a short reason. It stays inside FayFort.", 422)
    db().table("hr_applications").update({"stage": stage, "close_reason": clean(reason, 300) if stage in CLOSED else None,
                                          "stage_changed_at": now_iso(), "updated_at": now_iso()}) \
        .eq("id", application_id).execute()
    add_event(application_id, "stage_changed", actor_id, {"from": application["stage"], "to": stage})
    audit(actor_id, "hr.application.stage", {"application_id": application_id, "to": stage})
    if notify:
        notify_stage(application, stage, actor_id)
    return application_detail(application_id, actor_id)


def add_note(application_id: str, text: str, actor_id: str) -> dict:
    note = (text or "").strip()[:2000]
    if not note:
        raise HrError("Write a note first.", 422)
    if not one(db().table("hr_applications").select("id").eq("id", application_id).limit(1).execute()):
        raise HrError("That application doesn't exist.", 404)
    add_event(application_id, "note", actor_id, {"text": note})
    return application_detail(application_id, actor_id)


# ---- Owner: who has HR access --------------------------------------------------------------------------------------
def hr_team() -> list[dict]:
    from app.workforce.team import people
    workers = rows(db().table("fayfort_workers").select("user_id,status,staff_role,job_title,hr_access")
                   .neq("status", "inactive").limit(500).execute())
    names = people([str(w["user_id"]) for w in workers])
    return [{"user_id": w["user_id"], "name": names.get(str(w["user_id"]), {}).get("name", "FayFort team"),
             "status": w.get("status"), "staff_role": w.get("staff_role"), "job_title": w.get("job_title"),
             "hr_access": bool(w.get("hr_access"))} for w in workers]


def set_hr_access(worker_id: str, allowed: bool, actor_id: str) -> None:
    worker = one(db().table("fayfort_workers").select("user_id").eq("user_id", worker_id).limit(1).execute())
    if not worker:
        raise HrError("That worker doesn't exist.", 404)
    db().table("fayfort_workers").update({"hr_access": allowed}).eq("user_id", worker_id).execute()
    audit(actor_id, "hr.access", {"worker_id": worker_id, "hr_access": allowed})



async def hr_loop() -> None:
    """Every 5 minutes: interview reminders and finishing (app/hr/interviews.py). Every 6 hours: anonymise candidates
    whose keep-until date has passed."""
    import asyncio
    from app.hr import interviews
    await asyncio.sleep(60)
    last_retention = 0.0
    while True:
        try:
            counts = await asyncio.to_thread(interviews.sweep)
            from app.hr import offers
            counts["offers_expired"] = await asyncio.to_thread(offers.expire)
            if any(counts.values()):
                logger.info("Interview sweep: %s", counts)
            if time.monotonic() - last_retention > 6 * 3600:
                await asyncio.to_thread(anonymise_expired)
                last_retention = time.monotonic()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("HR sweep failed; will retry")
        await asyncio.sleep(300)
