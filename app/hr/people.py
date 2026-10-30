"""HR H5 (docs/HR_AND_HIRING_PLAN.md sections 3.4 and 3.7): people records, documents and policies.

HR (the HR flag, the CEO, platform admins) keeps each team member's employment record: job, manager, dates, hours,
probation, personal details and an emergency contact (never pay, never ID documents). Documents per person live in the
private hr-documents bucket. Policies are handbook pages with versions; every active team member reads and accepts the
current version in My HR. Every team member sees and updates their own personal details in My HR.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from app.commerce.db import audit, db, one, rows
from app.hr import service
from app.hr.service import JOB_TYPES, LOCATIONS, HrError

logger = logging.getLogger(__name__)

BUCKET = "hr-documents"
MAX_BYTES = 10 * 1024 * 1024
DOC_KINDS = {"contract": "Contract", "certificate": "Certificate", "other": "Other", "offer": "Offer letter"}
DOC_TYPES = {
    "application/pdf": ("pdf", lambda d: d.startswith(b"%PDF-")),
    "image/jpeg": ("jpg", lambda d: d.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda d: d.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": ("webp", lambda d: len(d) >= 12 and d[:4] == b"RIFF" and d[8:12] == b"WEBP"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("docx", lambda d: d.startswith(b"PK\x03\x04")),
}
JOB_FIELDS = ("job_title", "job_type", "location", "start_date", "probation_end", "hours_per_week", "manager_id", "status")
PERSONAL_FIELDS = ("legal_name", "preferred_name", "phone", "country", "city", "date_of_birth", "emergency_name",
                   "emergency_relationship", "emergency_phone")
LIMITS = {"legal_name": 120, "preferred_name": 80, "phone": 40, "country": 80, "city": 80, "emergency_name": 120,
          "emergency_relationship": 60, "emergency_phone": 40, "job_title": 80}
DESK_LABEL = {k: v for k, v in service.DEPARTMENTS.items() if k != "leadership"}


def today() -> date:
    return service.now_utc().date()


def event(worker_id: str, kind: str, actor_id: str | None, detail: dict | None = None) -> None:
    db().table("hr_employment_events").insert({"worker_id": worker_id, "kind": kind, "actor_id": actor_id,
                                               "detail": detail or {}}).execute()


def _worker(worker_id: str) -> dict:
    worker = one(db().table("fayfort_workers").select("user_id,status,staff_role,job_title").eq("user_id", worker_id)
                 .limit(1).execute())
    if not worker:
        raise HrError("That person isn't on the team.", 404)
    return worker


def record(worker_id: str) -> dict | None:
    return one(db().table("hr_employment").select("*").eq("worker_id", worker_id).limit(1).execute())


def ensure_record(worker_id: str, actor_id: str | None) -> dict:
    """People who joined before HR existed get a record the first time HR opens it."""
    found = record(worker_id)
    if found:
        return found
    worker = _worker(worker_id)
    db().table("hr_employment").insert({"worker_id": worker_id, "job_title": worker.get("job_title"),
                                        "status": "active" if worker.get("status") == "active" else "starting",
                                        "created_by": actor_id}).execute()
    event(worker_id, "record_opened", actor_id)
    return record(worker_id) or {}


def _status(rec: dict, worker: dict) -> str:
    if rec.get("status") == "finished" or worker.get("status") == "inactive":
        return "finished"
    start = rec.get("start_date")
    if worker.get("status") == "active" and (not start or date.fromisoformat(str(start)) <= today()):
        return "active"
    return "starting"


def _clean_value(key: str, value: Any) -> Any:
    if value in (None, ""):
        return None
    if key in ("start_date", "probation_end", "date_of_birth"):
        try:
            day = date.fromisoformat(str(value)[:10])
        except ValueError:
            raise HrError(f"{key.replace('_', ' ').capitalize()} isn't a date.", 422)
        if key == "date_of_birth" and not (date(1930, 1, 1) <= day <= today()):
            raise HrError("Check the date of birth.", 422)
        return day.isoformat()
    if key == "hours_per_week":
        hours = int(value)
        if not 1 <= hours <= 60:
            raise HrError("Hours a week are 1 to 60.", 422)
        return hours
    if key == "job_type" and value not in JOB_TYPES:
        raise HrError("Choose a job type.", 422)
    if key == "location" and value not in LOCATIONS:
        raise HrError("Choose a location.", 422)
    if key == "status" and value not in ("starting", "active"):
        raise HrError("Finishing someone's employment comes with offboarding.", 422)
    if key == "manager_id":
        manager = one(db().table("fayfort_workers").select("user_id,status").eq("user_id", str(value)).limit(1).execute())
        if not manager or manager.get("status") != "active":
            raise HrError("The manager must be an active member of the team.", 422)
        return str(value)
    return service.clean(value, LIMITS.get(key, 120))


# ---- HR: the team list and one person's record --------------------------------------------------------------------
def team() -> list[dict]:
    from app.workforce.team import people as names_for
    workers = rows(db().table("fayfort_workers").select("user_id,status,staff_role,job_title").neq("status", "inactive")
                   .limit(500).execute())
    ids = [str(w["user_id"]) for w in workers]
    records = {str(r["worker_id"]): r for r in rows(db().table("hr_employment").select("*").in_("worker_id", ids).execute())} if ids else {}
    names = names_for(ids)
    pending = policies_pending_counts(ids)
    out = []
    for worker in workers:
        rec = records.get(str(worker["user_id"])) or {}
        probation_end = rec.get("probation_end")
        out.append({
            "worker_id": worker["user_id"], "name": names.get(str(worker["user_id"]), {}).get("name", "FayFort team"),
            "photo_url": names.get(str(worker["user_id"]), {}).get("photo_url"), "staff_role": worker.get("staff_role"),
            "job_title": rec.get("job_title") or worker.get("job_title"), "start_date": rec.get("start_date"),
            "status": _status(rec, worker), "has_record": bool(rec), "manager_id": rec.get("manager_id"),
            "probation_due": bool(probation_end and not rec.get("probation_passed_at")
                                  and date.fromisoformat(str(probation_end)) <= today()),
            "probation_end": probation_end if not rec.get("probation_passed_at") else None,
            "policies_to_read": pending.get(str(worker["user_id"]), 0),
        })
    return sorted(out, key=lambda p: (p["status"] != "starting", p["name"].casefold()))


def person(worker_id: str, actor_id: str) -> dict:
    from app.workforce.team import people as names_for
    worker = _worker(worker_id)
    rec = ensure_record(worker_id, actor_id)
    departments = [r["department"] for r in rows(db().table("operations_worker_departments").select("department")
                                                 .eq("worker_id", worker_id).execute())]
    ids = [worker_id] + ([str(rec["manager_id"])] if rec.get("manager_id") else [])
    names = names_for(ids)
    timeline = rows(db().table("hr_employment_events").select("*").eq("worker_id", worker_id)
                    .order("created_at", desc=True).limit(100).execute())
    actor_names = names_for([str(e["actor_id"]) for e in timeline if e.get("actor_id")])
    return {
        "worker_id": worker_id, "name": names.get(worker_id, {}).get("name", "FayFort team"),
        "photo_url": names.get(worker_id, {}).get("photo_url"), "staff_role": worker.get("staff_role"),
        "account_status": worker.get("status"), "status": _status(rec, worker),
        "desks": [DESK_LABEL.get(d, d) for d in departments],
        "job": {k: rec.get(k) for k in JOB_FIELDS} | {"probation_passed_at": rec.get("probation_passed_at")},
        "manager_name": names.get(str(rec.get("manager_id")), {}).get("name") if rec.get("manager_id") else None,
        "personal": {k: rec.get(k) for k in PERSONAL_FIELDS},
        "timeline": [{**e, "actor_name": actor_names.get(str(e.get("actor_id")), {}).get("name") if e.get("actor_id") else None}
                     for e in timeline],
        "documents": documents_for(worker_id),
        "policies": policy_status_for(worker_id),
    }


def update(worker_id: str, fields: dict, actor_id: str, *, own: bool = False) -> dict:
    """HR edits job and personal fields; a team member edits only their own personal details."""
    rec = ensure_record(worker_id, actor_id)
    allowed = PERSONAL_FIELDS if own else JOB_FIELDS + PERSONAL_FIELDS
    values = {k: _clean_value(k, fields[k]) for k in allowed if k in fields}
    if values.get("manager_id") == worker_id:
        raise HrError("Someone can't be their own manager.", 422)
    changed = {k: v for k, v in values.items() if str(rec.get(k) or "") != str(v or "")}
    if not changed:
        return rec
    db().table("hr_employment").update({**changed, "updated_at": service.now_iso()}).eq("worker_id", worker_id).execute()
    job_changes = sorted(k for k in changed if k in JOB_FIELDS)
    if job_changes:
        event(worker_id, "job_changed", actor_id, {"fields": job_changes,
                                                   **({"job_title": changed["job_title"]} if "job_title" in changed else {})})
        if "job_title" in changed:
            db().table("fayfort_workers").update({"job_title": changed["job_title"]}).eq("user_id", worker_id).execute()
    if any(k in PERSONAL_FIELDS for k in changed):
        event(worker_id, "details_changed", actor_id, {"by": "self" if own else "hr"})
    audit(actor_id, "hr.person.updated", {"worker_id": worker_id, "fields": sorted(changed)})
    return record(worker_id) or {}


def probation(worker_id: str, decision: str, months: int | None, note: str | None, actor_id: str) -> dict:
    rec = ensure_record(worker_id, actor_id)
    if rec.get("probation_passed_at"):
        raise HrError("Probation is already passed.", 409)
    if decision == "pass":
        db().table("hr_employment").update({"probation_passed_at": service.now_iso(), "updated_at": service.now_iso()}) \
            .eq("worker_id", worker_id).execute()
        event(worker_id, "probation_passed", actor_id, {"note": service.clean(note, 500)} if note else {})
    elif decision == "extend":
        if not months or not 1 <= int(months) <= 6:
            raise HrError("Extend by 1 to 6 months.", 422)
        base = date.fromisoformat(str(rec.get("probation_end"))) if rec.get("probation_end") else today()
        new_end = service.add_months(max(base, today()), int(months))
        db().table("hr_employment").update({"probation_end": new_end.isoformat(), "updated_at": service.now_iso()}) \
            .eq("worker_id", worker_id).execute()
        event(worker_id, "probation_extended", actor_id, {"until": new_end.isoformat(), "note": service.clean(note, 500)})
    else:
        raise HrError("Choose pass or extend.", 422)
    audit(actor_id, "hr.probation", {"worker_id": worker_id, "decision": decision})
    return record(worker_id) or {}


# ---- Documents ---------------------------------------------------------------------------------------------------
def documents_for(worker_id: str, *, own: bool = False) -> list[dict]:
    query = db().table("hr_documents").select("id,kind,title,file_name,file_type,file_size,offer_id,visible_to_worker,created_at") \
        .eq("worker_id", worker_id).order("created_at", desc=True).limit(200)
    if own:
        query = query.eq("visible_to_worker", True)
    return [{**d, "kind_label": DOC_KINDS.get(d["kind"], d["kind"])} for d in rows(query.execute())]


def add_document(worker_id: str, kind: str, title: str, file_name: str | None, content_type: str, content: bytes,
                 actor_id: str, visible: bool = True) -> dict:
    _worker(worker_id)
    if kind not in ("contract", "certificate", "other"):
        raise HrError("Choose contract, certificate or other.", 422)
    title = service.clean(title, 120)
    if not title:
        raise HrError("Give the document a title.", 422)
    kind_info = DOC_TYPES.get(content_type)
    if not kind_info:
        raise HrError("Upload a PDF, Word file or a JPEG, PNG or WebP image.", 415)
    if not content:
        raise HrError("Choose a file to upload.", 422)
    if len(content) > MAX_BYTES:
        raise HrError("Documents must be 10 MB or smaller.", 413)
    if not kind_info[1](content):
        raise HrError("That file isn't the type it says it is.", 415)
    path = f"people/{worker_id}/{uuid4()}.{kind_info[0]}"
    db().storage.from_(BUCKET).upload(path, content, {"content-type": content_type, "upsert": "false"})
    try:
        created = one(db().table("hr_documents").insert({
            "worker_id": worker_id, "kind": kind, "title": title, "file_path": path,
            "file_name": service.clean(file_name, 160), "file_type": content_type, "file_size": len(content),
            "visible_to_worker": visible, "uploaded_by": actor_id}).execute())
    except Exception:
        try:
            db().storage.from_(BUCKET).remove([path])
        except Exception:
            pass
        raise
    event(worker_id, "document_added", actor_id, {"title": title})
    audit(actor_id, "hr.document.added", {"worker_id": worker_id, "document_id": (created or {}).get("id")})
    return created or {}


def document_link(document_id: str, actor_id: str, *, own_worker: str | None = None) -> dict:
    """A 5-minute link to the file, or the offer letter's text. `own_worker` limits it to that person's own documents."""
    doc = one(db().table("hr_documents").select("*").eq("id", document_id).limit(1).execute())
    if not doc or (own_worker and (str(doc["worker_id"]) != str(own_worker) or not doc.get("visible_to_worker"))):
        raise HrError("That document doesn't exist.", 404)
    audit(actor_id, "hr.document.viewed", {"document_id": document_id, "worker_id": doc["worker_id"]})
    if doc.get("offer_id") and not doc.get("file_path"):
        offer = one(db().table("hr_offers").select("letter,signature_name,responded_at").eq("id", doc["offer_id"]).limit(1).execute()) or {}
        return {"text": offer.get("letter") or "", "signed_by": offer.get("signature_name"), "signed_at": offer.get("responded_at")}
    try:
        result = db().storage.from_(BUCKET).create_signed_url(doc["file_path"], 300)
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
        raise HrError("The document couldn't be opened. Try again.", 503)
    return {"url": url}


def remove_document(document_id: str, actor_id: str) -> None:
    doc = one(db().table("hr_documents").select("*").eq("id", document_id).limit(1).execute())
    if not doc:
        raise HrError("That document doesn't exist.", 404)
    if doc["kind"] == "offer":
        raise HrError("The signed offer stays on the record.", 409)
    db().table("hr_documents").delete().eq("id", document_id).execute()
    if doc.get("file_path"):
        try:
            db().storage.from_(BUCKET).remove([doc["file_path"]])
        except Exception:
            logger.warning("Document file could not be removed", exc_info=True)
    event(str(doc["worker_id"]), "document_removed", actor_id, {"title": doc["title"]})
    audit(actor_id, "hr.document.removed", {"document_id": document_id, "worker_id": doc["worker_id"]})


# ---- Policies ----------------------------------------------------------------------------------------------------
def _slug(title: str, policy_id: str | None = None) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "policy"
    slug, n = base, 2
    while True:
        found = one(db().table("hr_policies").select("id").eq("slug", slug).limit(1).execute())
        if not found or str(found["id"]) == str(policy_id):
            return slug
        slug, n = f"{base}-{n}", n + 1


def _active_workers() -> list[str]:
    return [str(w["user_id"]) for w in rows(db().table("fayfort_workers").select("user_id").eq("status", "active")
                                             .limit(1000).execute())]


def policies(*, include_drafts: bool = True) -> list[dict]:
    query = db().table("hr_policies").select("*").order("position").limit(200)
    found = [p for p in rows(query.execute()) if include_drafts or p["status"] == "published"]
    workers = _active_workers()
    acks = rows(db().table("hr_policy_acknowledgements").select("policy_id,worker_id,version").limit(20000).execute())
    out = []
    for policy in found:
        current = {str(a["worker_id"]) for a in acks if str(a["policy_id"]) == str(policy["id"]) and int(a["version"]) == int(policy["version"])}
        out.append({**policy, "has_changes": policy["status"] == "draft" or (policy.get("published_body") or "") != policy["body"],
                    "accepted": len(current & set(workers)) if policy["status"] == "published" else 0,
                    "team_size": len(workers)})
    return out


def save_policy(policy_id: str | None, fields: dict, actor_id: str) -> dict:
    title = service.clean(fields.get("title"), 120)
    if not title or len(title) < 2:
        raise HrError("Give the policy a title.", 422)
    values = {"title": title, "summary": service.clean(fields.get("summary"), 300) or "",
              "body": (fields.get("body") or "").replace("\r", "").strip()[:30000], "updated_by": actor_id,
              "updated_at": service.now_iso()}
    if policy_id:
        if not one(db().table("hr_policies").select("id").eq("id", policy_id).limit(1).execute()):
            raise HrError("That policy doesn't exist.", 404)
        db().table("hr_policies").update(values).eq("id", policy_id).execute()
    else:
        count = len(rows(db().table("hr_policies").select("id").limit(500).execute()))
        created = one(db().table("hr_policies").insert({**values, "slug": _slug(title), "position": count + 1,
                                                        "status": "draft", "version": 0}).execute())
        policy_id = str((created or {}).get("id"))
    audit(actor_id, "hr.policy.saved", {"policy_id": policy_id})
    return get_policy(policy_id)


def get_policy(policy_id: str) -> dict:
    policy = one(db().table("hr_policies").select("*").eq("id", policy_id).limit(1).execute())
    if not policy:
        raise HrError("That policy doesn't exist.", 404)
    return policy


def publish(policy_id: str, actor_id: str) -> dict:
    """Publishes the current text as a new version. Everyone on the team is asked to read and accept it."""
    policy = get_policy(policy_id)
    if len(policy["body"].strip()) < 20:
        raise HrError("Write the policy before publishing it.", 422)
    if policy["status"] == "published" and (policy.get("published_body") or "") == policy["body"]:
        raise HrError("There are no changes to publish.", 409)
    version = int(policy.get("version") or 0) + 1
    db().table("hr_policies").update({"status": "published", "version": version, "published_body": policy["body"],
                                      "published_at": service.now_iso(), "published_by": actor_id,
                                      "updated_at": service.now_iso()}).eq("id", policy_id).execute()
    workers = _active_workers()
    if workers:
        try:
            db().table("operations_worker_notifications").upsert([
                {"worker_id": w, "notification_type": "hiring", "title": f"Please read: {policy['title']}"[:160],
                 "body": "A staff policy was published or updated. Open My account → My HR to read and accept it.",
                 "href": "/operations", "dedupe_key": f"policy:{policy_id}:{version}:{w}"} for w in workers
            ], on_conflict="dedupe_key", ignore_duplicates=True).execute()
        except Exception:
            logger.exception("Could not tell the team about a policy")
    audit(actor_id, "hr.policy.published", {"policy_id": policy_id, "version": version})
    return get_policy(policy_id)


def archive(policy_id: str, actor_id: str) -> dict:
    get_policy(policy_id)
    db().table("hr_policies").update({"status": "archived", "updated_at": service.now_iso()}).eq("id", policy_id).execute()
    audit(actor_id, "hr.policy.archived", {"policy_id": policy_id})
    return get_policy(policy_id)


def acknowledgements(policy_id: str) -> dict:
    from app.workforce.team import people as names_for
    policy = get_policy(policy_id)
    workers = _active_workers()
    acks = {str(a["worker_id"]): a for a in rows(db().table("hr_policy_acknowledgements").select("*").eq("policy_id", policy_id)
                                                 .eq("version", int(policy["version"] or 0)).limit(2000).execute())}
    names = names_for(workers)
    people = [{"worker_id": w, "name": names.get(w, {}).get("name", "FayFort team"),
               "accepted_at": (acks.get(w) or {}).get("acknowledged_at")} for w in workers]
    return {"version": policy["version"], "people": sorted(people, key=lambda p: (bool(p["accepted_at"]), p["name"].casefold()))}


def policy_status_for(worker_id: str) -> list[dict]:
    published = [p for p in rows(db().table("hr_policies").select("id,title,summary,version,published_at,status")
                                 .eq("status", "published").order("position").limit(200).execute())]
    acks = rows(db().table("hr_policy_acknowledgements").select("policy_id,version,acknowledged_at").eq("worker_id", worker_id)
                .limit(1000).execute())
    out = []
    for policy in published:
        mine = [a for a in acks if str(a["policy_id"]) == str(policy["id"])]
        current = next((a for a in mine if int(a["version"]) == int(policy["version"])), None)
        out.append({"id": policy["id"], "title": policy["title"], "summary": policy["summary"], "version": policy["version"],
                    "published_at": policy["published_at"], "accepted_at": (current or {}).get("acknowledged_at"),
                    "accepted_before": bool(mine) and not current})
    return out


def policies_pending_counts(worker_ids: list[str]) -> dict[str, int]:
    published = rows(db().table("hr_policies").select("id,version").eq("status", "published").limit(200).execute())
    if not published or not worker_ids:
        return {}
    acks = rows(db().table("hr_policy_acknowledgements").select("policy_id,worker_id,version").in_("worker_id", worker_ids)
                .limit(20000).execute())
    done = {(str(a["policy_id"]), str(a["worker_id"]), int(a["version"])) for a in acks}
    return {w: sum((str(p["id"]), w, int(p["version"])) not in done for p in published) for w in worker_ids}


def read_policy(policy_id: str) -> dict:
    policy = get_policy(policy_id)
    if policy["status"] != "published":
        raise HrError("That policy isn't published.", 404)
    return {"id": policy["id"], "title": policy["title"], "summary": policy["summary"], "body": policy["published_body"] or "",
            "version": policy["version"], "published_at": policy["published_at"]}


def accept_policy(policy_id: str, worker_id: str, version: int) -> list[dict]:
    policy = get_policy(policy_id)
    if policy["status"] != "published":
        raise HrError("That policy isn't published.", 404)
    if int(version) != int(policy["version"]):
        raise HrError("This policy was just updated. Read the new version, then accept it.", 409)
    db().table("hr_policy_acknowledgements").upsert({"policy_id": policy_id, "worker_id": worker_id, "version": int(version),
                                                    "acknowledged_at": service.now_iso()},
                                                   on_conflict="policy_id,worker_id,version", ignore_duplicates=True).execute()
    event(worker_id, "policy_accepted", worker_id, {"title": policy["title"], "version": int(version)})
    return policy_status_for(worker_id)


# ---- My HR -------------------------------------------------------------------------------------------------------
def mine(worker_id: str) -> dict:
    from app.workforce.team import people as names_for
    worker = _worker(worker_id)
    rec = record(worker_id) or {}
    manager = names_for([str(rec["manager_id"])]).get(str(rec["manager_id"]), {}).get("name") if rec.get("manager_id") else None
    return {"job": {"job_title": rec.get("job_title") or worker.get("job_title"), "job_type": rec.get("job_type"),
                    "location": rec.get("location"), "start_date": rec.get("start_date"),
                    "probation_end": None if rec.get("probation_passed_at") else rec.get("probation_end"),
                    "hours_per_week": rec.get("hours_per_week"), "manager": manager},
            "personal": {k: rec.get(k) for k in PERSONAL_FIELDS},
            "documents": documents_for(worker_id, own=True),
            "policies": policy_status_for(worker_id)}


def on_hired(worker_id: str, offer: dict, actor_id: str) -> None:
    """Called by Hire (H4): the signed offer becomes the first document, and the timeline starts."""
    db().table("hr_documents").insert({"worker_id": worker_id, "kind": "offer", "title": f"Signed offer: {offer['job_title']}",
                                       "offer_id": offer["id"], "uploaded_by": actor_id}).execute()
    event(worker_id, "hired", actor_id, {"job_title": offer["job_title"], "start_date": offer["start_date"]})


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
