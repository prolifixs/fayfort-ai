"""Adding staff: roles, and making an existing account staff (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md sections 3 and 8).

Roles: staff (default), assistant (manages the CEO's calendar and bookings) and ceo (only one, counting a pending
invitation). Departments still decide what each person can work on in Operations.

Two kinds of invitation:
  new_account       nobody has this email yet: the Supabase invitation email (as before). Confirming the email
                    activates the worker (database trigger) and applies the chosen departments.
  existing_account  the email already has an account (usually a member): FayFort emails a link to /staff/join. The
                    person opens it, signs in as that account and presses Accept. Their member account is untouched.

Admins:  GET  /platform/staff/candidates?q=       search accounts (3+ characters, 10 results)
         POST /platform/staff/invitations         {user_id | email, staff_role, job_title, departments}
         PUT  /platform/workers/{id}/role         {staff_role, job_title}
Anyone:  GET  /staff/invitations/{token}          who the link is for (masked email), role, expired
Signed in: POST /staff/invitations/accept        {token}
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config.settings import settings, worker_invite_redirect_url
from app.database.client import supabase
from app.directory.identity import trusted_platform_admin, trusted_user_id
from app.mailer.render import staff_invitation_email
from app.mailer.resend_client import EmailSendError
from app.mailer.sender import send_immediately
from app.workforce.audit import record_workforce_audit

logger = logging.getLogger(__name__)

ROLES = {"staff": "Staff", "assistant": "Personal assistant to the CEO", "ceo": "CEO"}
ROLE_IN_SENTENCE = {"staff": "a team member", "assistant": "personal assistant to the CEO", "ceo": "CEO"}
DEPARTMENTS = ("conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team")
INVITE_DAYS = 7
Role = Literal["staff", "assistant", "ceo"]
Department = Literal["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team"]


class OnboardingError(ValueError):
    """Something the admin or the invited person can fix (shown as is)."""


class StaffInvitation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID | None = None
    email: str | None = Field(default=None, max_length=320)
    staff_role: Role = "staff"
    job_title: str | None = Field(default=None, max_length=80)
    departments: list[Department] = Field(default_factory=list, max_length=6)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str | None) -> str | None:
        value = (value or "").strip().casefold()
        if not value:
            return None
        local, _, domain = value.partition("@")
        if not local or "." not in domain or " " in value:
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("job_title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None

    @model_validator(mode="after")
    def one_target(self):
        if bool(self.user_id) == bool(self.email):
            raise ValueError("Choose an account or enter an email (one of them).")
        self.departments = list(dict.fromkeys(self.departments))
        return self


class RoleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    staff_role: Role
    job_title: str | None = Field(default=None, max_length=80)

    @field_validator("job_title")
    @classmethod
    def clean_title(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None


class AcceptInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=20, max_length=200)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.strip().encode()).hexdigest()


def mask_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    shown = local[:2] if len(local) > 3 else local[:1]
    return f"{shown}{'•' * max(2, len(local) - len(shown))}@{domain}"


def join_link(token: str) -> str:
    return settings.APP_PUBLIC_URL.rstrip("/") + f"/staff/join?token={token}"


def _data(response: Any) -> Any:
    return getattr(response, "data", None) if response is not None else None


def _worker(user_id: str) -> dict | None:
    return _data(supabase.table("fayfort_workers").select(
        "user_id,status,staff_role,job_title,invite_kind,invite_expires_at,provisioned_by,invitation_count")
        .eq("user_id", user_id).maybe_single().execute())


def _auth_user(user_id: str) -> Any:
    try:
        return getattr(supabase.auth.admin.get_user_by_id(user_id), "user", None)
    except Exception:
        logger.info("Account lookup failed", exc_info=True)
        return None


def _name(user: Any) -> str | None:
    metadata = getattr(user, "user_metadata", None) or {}
    name = metadata.get("display_name") or metadata.get("full_name") or metadata.get("name")
    return str(name).strip() if name and str(name).strip() else None


def _admin_name(admin_id: str) -> str | None:
    user = _auth_user(admin_id)
    return _name(user) or None


def current_ceo(exclude: str | None = None) -> dict | None:
    rows = _data(supabase.table("fayfort_workers").select("user_id,status").eq("staff_role", "ceo")
                 .in_("status", ["invited", "active"]).execute()) or []
    rows = [row for row in rows if str(row["user_id"]) != str(exclude or "")]
    return rows[0] if rows else None


def _ceo_taken_message(ceo: dict) -> str:
    user = _auth_user(str(ceo["user_id"]))
    who = _name(user) or (getattr(user, "email", None) if user else None) or "someone else"
    state = "has a pending CEO invitation" if ceo.get("status") == "invited" else "is the CEO"
    return f"{who} {state}. There can only be one CEO: change their role first."


def search_candidates(query: str) -> list[dict]:
    """Accounts matching an email, name or username, with whether they can be made staff."""
    rows = _data(supabase.rpc("search_accounts_for_staff", {"p_query": query.strip(), "p_limit": 10}).execute()) or []
    results = []
    for row in rows:
        reason = None
        if row.get("staff_status") == "active":
            reason = "Already on the team"
        elif row.get("staff_status") == "invited":
            reason = "Invitation pending"
        elif row.get("staff_status") == "inactive":
            reason = "Former staff: reactivate them in FayFort Workers"
        elif row.get("banned"):
            reason = "This account is blocked"
        elif not row.get("email_confirmed"):
            reason = "Email not verified yet"
        results.append({
            "user_id": str(row["user_id"]), "email": row.get("email"), "display_name": row.get("display_name"),
            "username": row.get("username"), "created_at": row.get("created_at"),
            "last_sign_in_at": row.get("last_sign_in_at"), "staff_status": row.get("staff_status"),
            "staff_role": row.get("staff_role"), "eligible": reason is None, "reason": reason,
        })
    return results


def _existing_by_email(email: str) -> dict | None:
    rows = _data(supabase.rpc("search_accounts_for_staff", {"p_query": email, "p_limit": 5}).execute()) or []
    return next((row for row in rows if (row.get("email") or "").casefold() == email), None)


def _send_existing(user_id: str, email: str, role: str, admin_id: str) -> tuple[str, str]:
    """Store a new link (earlier links stop working) and email it. Returns (sent_at, expires_at)."""
    token = secrets.token_urlsafe(32)
    sent = now_utc()
    expires = sent + timedelta(days=INVITE_DAYS)
    supabase.table("fayfort_workers").update({
        "invite_token_hash": token_hash(token), "invite_expires_at": expires.isoformat(),
        "invitation_sent_at": sent.isoformat(), "updated_at": sent.isoformat(),
    }).eq("user_id", user_id).execute()
    send_immediately(to=email, rendered=staff_invitation_email(
        action_link=join_link(token), role_label=ROLE_IN_SENTENCE.get(role, "a team member"),
        invited_by=_admin_name(admin_id), days=INVITE_DAYS), template="staff_invitation")
    return sent.isoformat(), expires.isoformat()


def invite(admin_id: str, payload: StaffInvitation) -> dict:
    if payload.staff_role == "ceo":
        ceo = current_ceo()
        if ceo:
            raise OnboardingError(_ceo_taken_message(ceo))
    target = None
    if payload.user_id:
        user = _auth_user(str(payload.user_id))
        if not user or not getattr(user, "email", None):
            raise LookupError("Account not found.")
        target = {"user_id": str(payload.user_id), "email": str(user.email).casefold(),
                  "email_confirmed": getattr(user, "email_confirmed_at", None) is not None,
                  "banned": bool(getattr(user, "banned_until", None))}
    else:
        found = _existing_by_email(payload.email or "")
        if found:
            target = {"user_id": str(found["user_id"]), "email": found["email"],
                      "email_confirmed": bool(found.get("email_confirmed")), "banned": bool(found.get("banned"))}
    if target:
        return _invite_existing(admin_id, target, payload)
    return _invite_new(admin_id, payload)


def _invite_existing(admin_id: str, target: dict, payload: StaffInvitation) -> dict:
    user_id = target["user_id"]
    if user_id == admin_id:
        raise OnboardingError("You can't invite your own account.")
    existing = _worker(user_id)
    if existing:
        raise OnboardingError({
            "active": "This account is already on the team.",
            "invited": "This account already has a pending invitation. Resend it from their profile.",
            "inactive": "This is former staff. Reactivate them from their profile in FayFort Workers.",
        }.get(existing.get("status"), "This account is already staff."))
    if target.get("banned"):
        raise OnboardingError("This account is blocked, so it can't be made staff.")
    if not target.get("email_confirmed"):
        raise OnboardingError("This account hasn't verified its email yet. Ask them to verify it first.")
    now = now_utc().isoformat()
    try:
        supabase.table("fayfort_workers").insert({
            "user_id": user_id, "status": "invited", "provisioned_by": admin_id, "invite_kind": "existing_account",
            "staff_role": payload.staff_role, "job_title": payload.job_title,
            "pending_departments": payload.departments, "invitation_sent_at": now,
        }).execute()
    except Exception as exc:
        if "uq_fayfort_workers_one_ceo" in str(exc):
            raise OnboardingError("There can only be one CEO: change the current CEO's role first.") from exc
        raise
    try:
        sent_at, expires_at = _send_existing(user_id, target["email"], payload.staff_role, admin_id)
    except Exception as exc:
        supabase.table("fayfort_workers").delete().eq("user_id", user_id).eq("status", "invited").execute()
        if isinstance(exc, EmailSendError):
            raise RuntimeError("The invitation email could not be sent. Check Control Center → Emails.") from exc
        raise
    record_workforce_audit(admin_id, user_id, "invited", target["email"],
                           {"kind": "existing_account", "role": payload.staff_role, "departments": payload.departments})
    return {"user_id": user_id, "email": target["email"], "status": "invited", "kind": "existing_account",
            "staff_role": payload.staff_role, "sent_at": sent_at, "expires_at": expires_at}


def _invite_new(admin_id: str, payload: StaffInvitation) -> dict:
    email = payload.email or ""
    user_id = None
    try:
        invited = supabase.auth.admin.invite_user_by_email(email, options={"redirect_to": worker_invite_redirect_url()})
        user_id = getattr(getattr(invited, "user", None), "id", None)
        if not user_id:
            raise RuntimeError("The invitation did not return an account.")
        supabase.table("fayfort_workers").insert({
            "user_id": str(user_id), "status": "invited", "provisioned_by": admin_id, "invite_kind": "new_account",
            "staff_role": payload.staff_role, "job_title": payload.job_title,
            "pending_departments": payload.departments,
        }).execute()
    except Exception as exc:
        if user_id:
            try:
                supabase.auth.admin.delete_user(str(user_id))
            except Exception:
                logger.exception("Could not roll back an incomplete staff invitation")
        text = str(exc).casefold()
        if "uq_fayfort_workers_one_ceo" in text:
            raise OnboardingError("There can only be one CEO: change the current CEO's role first.") from exc
        if "already" in text or "exists" in text or "registered" in text:
            raise OnboardingError("An account with this email already exists. Search for it and invite that account.") from exc
        raise
    record_workforce_audit(admin_id, str(user_id), "invited", email,
                           {"kind": "new_account", "role": payload.staff_role, "departments": payload.departments})
    return {"user_id": str(user_id), "email": email, "status": "invited", "kind": "new_account",
            "staff_role": payload.staff_role}


def resend_existing(admin_id: str, worker: dict, email: str) -> dict:
    """Resend for an existing-account invitation (the router's resend handles new accounts)."""
    count = min(int(worker.get("invitation_count") or 1) + 1, 50)
    sent_at, expires_at = _send_existing(str(worker["user_id"]), email, worker.get("staff_role") or "staff", admin_id)
    supabase.table("fayfort_workers").update({"invitation_count": count}).eq("user_id", str(worker["user_id"])).execute()
    return {"sent_at": sent_at, "expires_at": expires_at, "count": count}


def change_role(admin_id: str, worker_id: str, payload: RoleInput) -> dict:
    worker = _worker(worker_id)
    if not worker:
        raise LookupError("Worker not found.")
    if worker.get("status") == "inactive":
        raise OnboardingError("Reactivate this worker before changing their role.")
    if payload.staff_role == "ceo":
        ceo = current_ceo(exclude=worker_id)
        if ceo:
            raise OnboardingError(_ceo_taken_message(ceo))
    try:
        supabase.table("fayfort_workers").update({
            "staff_role": payload.staff_role, "job_title": payload.job_title, "updated_at": now_utc().isoformat(),
        }).eq("user_id", worker_id).execute()
    except Exception as exc:
        if "uq_fayfort_workers_one_ceo" in str(exc):
            raise OnboardingError("There can only be one CEO: change the current CEO's role first.") from exc
        raise
    user = _auth_user(worker_id)
    record_workforce_audit(admin_id, worker_id, "role_changed", getattr(user, "email", None) if user else None,
                           {"from": worker.get("staff_role") or "staff", "to": payload.staff_role,
                            "job_title": payload.job_title})
    return {"user_id": worker_id, "staff_role": payload.staff_role, "job_title": payload.job_title}


def preview(token: str) -> dict:
    row = _data(supabase.table("fayfort_workers").select("user_id,status,staff_role,job_title,invite_expires_at,provisioned_by")
                .eq("invite_token_hash", token_hash(token)).eq("invite_kind", "existing_account")
                .maybe_single().execute())
    if not row or row.get("status") != "invited":
        raise LookupError("This invitation link isn't valid any more. Ask a FayFort administrator for a new one.")
    expires = row.get("invite_expires_at")
    expired = False
    try:
        expired = bool(expires) and datetime.fromisoformat(str(expires).replace("Z", "+00:00")) <= now_utc()
    except ValueError:
        expired = True
    user = _auth_user(str(row["user_id"]))
    return {"email_hint": mask_email(getattr(user, "email", None) if user else None),
            "staff_role": row.get("staff_role") or "staff", "role_label": ROLES.get(row.get("staff_role") or "staff"),
            "job_title": row.get("job_title"), "invited_by": _admin_name(str(row["provisioned_by"])),
            "expires_at": expires, "expired": expired}


def accept(user_id: str, token: str) -> dict:
    try:
        result = _data(supabase.rpc("accept_staff_invitation", {"p_user_id": user_id,
                                                                "p_token_hash": token_hash(token)}).execute())
    except Exception as exc:
        text = str(exc)
        if "invitation_other_account" in text:
            raise PermissionError("This invitation is for a different account. Sign out, then sign in with the "
                                  "email the invitation was sent to.") from exc
        if "invitation_expired" in text:
            raise OnboardingError("This invitation has expired. Ask a FayFort administrator to send a new one.") from exc
        if "email_not_confirmed" in text:
            raise OnboardingError("Verify your email first, then open the invitation link again.") from exc
        if "invitation_not_found" in text:
            raise LookupError("This invitation link isn't valid any more. Ask a FayFort administrator for a new one.") from exc
        raise
    result = result[0] if isinstance(result, list) and result else (result or {})
    user = _auth_user(user_id)
    record_workforce_audit(str(result.get("provisioned_by") or "") or None, user_id, "invitation_accepted",
                           getattr(user, "email", None) if user else None, {"role": result.get("staff_role")})
    return {"status": "active", "staff_role": result.get("staff_role") or "staff", "job_title": result.get("job_title")}


class _Limiter:
    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window, self.calls, self.lock = limit, window, defaultdict(deque), threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            calls = self.calls[key]
            while calls and now - calls[0] > self.window:
                calls.popleft()
            if len(calls) >= self.limit:
                raise HTTPException(status_code=429, detail="Too many requests. Wait a minute and try again.")
            calls.append(now)


def _fail(exc: Exception, default: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, OnboardingError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, RuntimeError) and "Control Center" in str(exc):
        return HTTPException(status_code=503, detail=str(exc))
    logger.exception(default)
    return HTTPException(status_code=503, detail=default)


def create_onboarding_router() -> APIRouter:
    router = APIRouter(tags=["workforce"])
    search_limit, action_limit, token_limit = _Limiter(60), _Limiter(30), _Limiter(20)

    def admin(authorization: str | None) -> dict:
        found = trusted_platform_admin(authorization)
        if not found:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return found

    @router.get("/platform/staff/candidates")
    def candidates(q: str = Query(min_length=3, max_length=120), authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        search_limit.check(actor["user_id"])
        try:
            return {"accounts": search_candidates(q)}
        except Exception as exc:
            raise _fail(exc, "Accounts could not be searched.") from exc

    @router.post("/platform/staff/invitations", status_code=201)
    def create_invitation(payload: StaffInvitation, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        action_limit.check(actor["user_id"])
        try:
            return {"invitation": invite(actor["user_id"], payload), "roles": ROLES}
        except Exception as exc:
            raise _fail(exc, "The invitation could not be sent.") from exc

    @router.put("/platform/workers/{worker_id}/role")
    def set_role(worker_id: UUID, payload: RoleInput, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        action_limit.check(actor["user_id"])
        try:
            return {"worker": change_role(actor["user_id"], str(worker_id), payload)}
        except Exception as exc:
            raise _fail(exc, "The role could not be changed.") from exc

    @router.get("/staff/invitations/{token}")
    def invitation(token: str):
        if not 20 <= len(token) <= 200:
            raise HTTPException(status_code=404, detail="This invitation link isn't valid.")
        token_limit.check(f"preview:{token_hash(token)[:16]}")
        try:
            return {"invitation": preview(token)}
        except Exception as exc:
            raise _fail(exc, "The invitation could not be checked.") from exc

    @router.post("/staff/invitations/accept")
    def accept_invitation(payload: AcceptInput, authorization: str | None = Header(default=None)):
        user_id = trusted_user_id(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="Sign in to accept the invitation.")
        token_limit.check(f"accept:{user_id}")
        try:
            return {"worker": accept(user_id, payload.token)}
        except Exception as exc:
            raise _fail(exc, "The invitation could not be accepted.") from exc

    return router
