"""Platform-admin workforce API: worker directory, profiles and audited account actions.

Every /platform/workers route requires the server-managed platform-admin claim (and an MFA-verified
session once STAFF_MFA_REQUIRED is on). Workers can read their own profile at /workers/me/profile.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.config.settings import click_to_continue_link, settings, staff_recovery_redirect_url, worker_invite_redirect_url
from app.database.client import supabase
from app.directory.identity import trusted_fayfort_staff, trusted_platform_admin
from app.workforce.audit import record_workforce_audit
from app.mailer.render import staff_password_reset_email
from app.mailer.resend_client import EmailSendError
from app.mailer.sender import send_immediately

logger = logging.getLogger(__name__)

ONLINE_WINDOW_SECONDS = 90
OPEN_WORK_STATUSES = ("open", "claimed", "waiting", "blocked")
BAN_FOREVER = "876000h"
ACTION_LIMIT_PER_MINUTE = 30
WORKER_COLUMNS = (
    "user_id,status,provisioned_by,created_at,updated_at,invitation_sent_at,invitation_count,"
    "activated_at,deactivated_at,deactivated_by,handoff_availability,handoff_available_until,"
    "handoff_availability_updated_at"
)


class DeactivateWorker(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=300)


class _ActionLimiter:
    """Small per-admin sliding window so a stolen admin session cannot mass-modify accounts quickly."""

    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit, self.window = limit, window_seconds
        self.calls: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            calls = self.calls[key]
            while calls and now - calls[0] > self.window:
                calls.popleft()
            if len(calls) >= self.limit:
                raise HTTPException(status_code=429, detail="Too many account actions. Wait a minute and try again.")
            calls.append(now)


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _iso(value: Any) -> str | None:
    parsed = _parse_time(value)
    return parsed.isoformat() if parsed else None


def _auth_summary(user_id: str) -> dict[str, Any]:
    """Identity facts from Supabase Auth; never includes tokens or factor secrets."""
    try:
        user = getattr(supabase.auth.admin.get_user_by_id(user_id), "user", None)
    except Exception:
        logger.info("Auth identity lookup failed for a worker", exc_info=True)
        user = None
    if not user:
        return {"email": None, "display_name": None, "last_sign_in_at": None, "email_confirmed_at": None,
                "mfa_enrolled": False, "banned": False}
    metadata = getattr(user, "user_metadata", None) or {}
    name = metadata.get("display_name") or metadata.get("full_name") or metadata.get("name")
    factors = getattr(user, "factors", None) or []
    banned_until = _parse_time(getattr(user, "banned_until", None))
    return {
        "email": (getattr(user, "email", None) or "").lower() or None,
        "display_name": str(name).strip() if name and str(name).strip() else None,
        "last_sign_in_at": _iso(getattr(user, "last_sign_in_at", None)),
        "email_confirmed_at": _iso(getattr(user, "email_confirmed_at", None)),
        "mfa_enrolled": any(getattr(factor, "status", None) == "verified" for factor in factors),
        "banned": bool(banned_until and banned_until > datetime.now(timezone.utc)),
    }


def _invitation_state(worker: dict, now: datetime) -> dict[str, Any] | None:
    if worker.get("status") != "invited":
        return None
    sent = _parse_time(worker.get("invitation_sent_at") or worker.get("created_at"))
    expires = datetime.fromtimestamp(sent.timestamp() + settings.AUTH_EMAIL_LINK_TTL_SECONDS, timezone.utc) if sent else None
    return {"sent_at": _iso(sent), "expires_at": _iso(expires), "expired": bool(expires and expires <= now),
            "count": int(worker.get("invitation_count") or 1)}


def _worker_row(worker_id: str) -> dict:
    response = supabase.table("fayfort_workers").select(WORKER_COLUMNS).eq("user_id", worker_id).maybe_single().execute()
    row = response.data if response is not None else None
    if not row:
        raise HTTPException(status_code=404, detail="Worker not found.")
    return row


def _present(worker: dict, auth: dict, last_seen: str | None, open_work: int, now: datetime) -> dict[str, Any]:
    seen = _parse_time(last_seen)
    online = bool(worker.get("status") == "active" and seen and now.timestamp() - seen.timestamp() <= ONLINE_WINDOW_SECONDS)
    return {
        "user_id": str(worker["user_id"]),
        "email": auth["email"],
        "display_name": auth["display_name"],
        "status": worker.get("status"),
        "online": online,
        "last_seen_at": _iso(last_seen),
        "last_sign_in_at": auth["last_sign_in_at"],
        "invited_at": _iso(worker.get("created_at")),
        "activated_at": _iso(worker.get("activated_at")),
        "deactivated_at": _iso(worker.get("deactivated_at")),
        "handoff_availability": worker.get("handoff_availability") or "offline",
        "mfa_enrolled": auth["mfa_enrolled"],
        "email_confirmed": auth["email_confirmed_at"] is not None,
        "open_work_count": open_work,
        "invitation": _invitation_state(worker, now),
    }


def _enrich(entries: list[dict]) -> None:
    """Photo, customer rating and whether each worker is on shift now (app/workforce/team.py)."""
    from app.workforce import team
    ids = [entry["user_id"] for entry in entries]
    try:
        who = team.people(ids)
        ratings = team.ratings_for(ids)
        on_shift = {str(r["worker_id"]): r for r in (supabase.table("worker_shifts").select("worker_id,on_break_since")
                    .is_("ended_at", "null").in_("worker_id", ids).execute().data or [])} if ids else {}
    except Exception:
        logger.warning("Worker photos, ratings or shifts could not be added", exc_info=True)
        who, ratings, on_shift = {}, {}, {}
    for entry in entries:
        entry["photo_url"] = (who.get(entry["user_id"]) or {}).get("photo_url")
        entry["rating"] = ratings.get(entry["user_id"])
        entry["on_shift"] = entry["user_id"] in on_shift
        entry["on_break"] = bool((on_shift.get(entry["user_id"]) or {}).get("on_break_since"))


def create_workforce_router() -> APIRouter:
    router = APIRouter(tags=["workforce"])
    limiter = _ActionLimiter(ACTION_LIMIT_PER_MINUTE)

    def require_admin(authorization: str | None) -> dict:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin

    def admin_action(authorization: str | None) -> dict:
        admin = require_admin(authorization)
        limiter.check(admin["user_id"])
        return admin

    def open_work_counts(worker_ids: list[str]) -> dict[str, int]:
        if not worker_ids:
            return {}
        rows = (supabase.table("operations_work_items").select("assigned_worker_id")
                .in_("assigned_worker_id", worker_ids).in_("status", list(OPEN_WORK_STATUSES))
                .limit(5000).execute().data or [])
        counts: dict[str, int] = defaultdict(int)
        for row in rows:
            counts[str(row["assigned_worker_id"])] += 1
        return counts

    def presence_for(worker_ids: list[str]) -> dict[str, str | None]:
        if not worker_ids:
            return {}
        rows = (supabase.table("operations_worker_presence").select("worker_id,last_seen_at")
                .in_("worker_id", worker_ids).execute().data or [])
        return {str(row["worker_id"]): row.get("last_seen_at") for row in rows}

    @router.get("/platform/workers")
    def list_workers(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            workers = (supabase.table("fayfort_workers").select(WORKER_COLUMNS)
                       .order("created_at").limit(500).execute().data or [])
            ids = [str(row["user_id"]) for row in workers]
            seen = presence_for(ids)
            work = open_work_counts(ids)
            now = datetime.now(timezone.utc)
            roster = [_present(row, _auth_summary(str(row["user_id"])), seen.get(str(row["user_id"])),
                               work.get(str(row["user_id"]), 0), now) for row in workers]
            _enrich(roster)
            order = {"active": 0, "invited": 1, "inactive": 2}
            roster.sort(key=lambda item: (order.get(item["status"], 3), not item["online"],
                                          -(_parse_time(item["last_seen_at"]) or datetime.min.replace(tzinfo=timezone.utc)).timestamp()))
            return {
                "workers": roster,
                "summary": {
                    "total": len(roster),
                    "active": sum(item["status"] == "active" for item in roster),
                    "online": sum(item["online"] for item in roster),
                    "invited": sum(item["status"] == "invited" for item in roster),
                    "inactive": sum(item["status"] == "inactive" for item in roster),
                    "without_mfa": sum(item["status"] == "active" and not item["mfa_enrolled"] for item in roster),
                },
                "online_window_seconds": ONLINE_WINDOW_SECONDS,
                "generated_at": now.isoformat(),
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load the worker directory")
            raise HTTPException(status_code=503, detail="The worker directory could not be loaded.") from exc

    def profile_payload(worker_id: str, include_admin_detail: bool) -> dict:
        worker = _worker_row(worker_id)
        now = datetime.now(timezone.utc)
        auth = _auth_summary(worker_id)
        seen = presence_for([worker_id]).get(worker_id)
        current_work = (supabase.table("operations_work_items")
                        .select("id,summary,department,status,priority,due_at,updated_at")
                        .eq("assigned_worker_id", worker_id).in_("status", list(OPEN_WORK_STATUSES))
                        .order("updated_at", desc=True).limit(50).execute().data or [])
        departments = (supabase.table("operations_worker_departments").select("department,can_claim")
                       .eq("worker_id", worker_id).execute().data or [])
        activity = (supabase.table("operations_work_events")
                    .select("work_item_id,event_type,previous_status,next_status,reason,created_at")
                    .eq("actor_user_id", worker_id).order("created_at", desc=True).limit(25).execute().data or [])
        profile = _present(worker, auth, seen, len(current_work), now)
        _enrich([profile])
        profile.update({
            "departments": [row["department"] for row in departments if row.get("can_claim")],
            "current_work": current_work,
            "recent_activity": activity,
            "handoff_available_until": _iso(worker.get("handoff_available_until")),
        })
        if include_admin_detail:
            audit = (supabase.table("workforce_audit").select("action,actor_id,detail,created_at")
                     .eq("target_id", worker_id).order("created_at", desc=True).limit(50).execute().data or [])
            try:
                sign_ins = supabase.rpc("workforce_auth_events", {"p_user_id": worker_id, "p_limit": 25}).execute().data or []
            except Exception:
                logger.info("Auth audit events unavailable for a worker", exc_info=True)
                sign_ins = []
            profile.update({"audit": audit, "auth_events": sign_ins, "banned": auth["banned"],
                            "deactivated_by": worker.get("deactivated_by"),
                            "provisioned_by": worker.get("provisioned_by")})
        return profile

    @router.get("/platform/workers/{worker_id}")
    def worker_profile(worker_id: UUID, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"worker": profile_payload(str(worker_id), include_admin_detail=True)}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load a worker profile")
            raise HTTPException(status_code=503, detail="The worker profile could not be loaded.") from exc

    @router.get("/workers/me/profile")
    def my_worker_profile(authorization: str | None = Header(default=None)):
        staff = trusted_fayfort_staff(authorization)
        if not staff or staff.get("role") != "worker":
            raise HTTPException(status_code=403, detail="An active FayFort worker account is required.")
        try:
            return {"worker": profile_payload(staff["user_id"], include_admin_detail=False)}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load own worker profile")
            raise HTTPException(status_code=503, detail="Your worker profile could not be loaded.") from exc

    @router.post("/platform/workers/{worker_id}/resend-invitation")
    def resend_invitation(worker_id: UUID, authorization: str | None = Header(default=None)):
        admin = admin_action(authorization)
        target = str(worker_id)
        worker = _worker_row(target)
        auth = _auth_summary(target)
        if worker.get("status") != "invited" or auth["email_confirmed_at"] or not auth["email"]:
            raise HTTPException(status_code=409, detail="Only a pending invitation can be resent.")
        try:
            supabase.auth.admin.invite_user_by_email(auth["email"], options={"redirect_to": worker_invite_redirect_url()})
            count = min(int(worker.get("invitation_count") or 1) + 1, 50)
            now = datetime.now(timezone.utc).isoformat()
            supabase.table("fayfort_workers").update({"invitation_sent_at": now, "invitation_count": count,
                                                      "updated_at": now}).eq("user_id", target).execute()
        except Exception as exc:
            logger.exception("Could not resend a worker invitation")
            raise HTTPException(status_code=503, detail="The invitation could not be resent.") from exc
        record_workforce_audit(admin["user_id"], target, "invitation_resent", auth["email"], {"count": count})
        return {"invitation": {"sent_at": now, "count": count}}

    @router.delete("/platform/workers/{worker_id}/invitation")
    def revoke_invitation(worker_id: UUID, authorization: str | None = Header(default=None)):
        admin = admin_action(authorization)
        target = str(worker_id)
        worker = _worker_row(target)
        auth = _auth_summary(target)
        if worker.get("status") != "invited" or auth["email_confirmed_at"]:
            raise HTTPException(status_code=409, detail="Only an invitation that hasn't been accepted can be revoked.")
        # Record first: the identity (and its audit foreign key) is deleted next.
        record_workforce_audit(admin["user_id"], target, "invitation_revoked", auth["email"], {})
        try:
            supabase.auth.admin.delete_user(target)
        except Exception as exc:
            logger.exception("Could not revoke a worker invitation")
            raise HTTPException(status_code=503, detail="The invitation could not be revoked.") from exc
        return {"revoked": True}

    @router.post("/platform/workers/{worker_id}/deactivate")
    def deactivate_worker(worker_id: UUID, payload: DeactivateWorker, authorization: str | None = Header(default=None)):
        admin = admin_action(authorization)
        target = str(worker_id)
        if target == admin["user_id"]:
            raise HTTPException(status_code=409, detail="You can't deactivate your own account.")
        worker = _worker_row(target)
        if worker.get("status") == "inactive":
            raise HTTPException(status_code=409, detail="This worker is already inactive.")
        auth = _auth_summary(target)
        now = datetime.now(timezone.utc).isoformat()
        try:
            # Status first: every staff endpoint checks it, so access ends on the worker's next request.
            supabase.table("fayfort_workers").update({
                "status": "inactive", "deactivated_at": now, "deactivated_by": admin["user_id"], "updated_at": now,
                "handoff_availability": "offline", "handoff_available_until": None,
                "handoff_availability_updated_at": now,
            }).eq("user_id", target).execute()
            released = supabase.rpc("release_workforce_assignments", {
                "p_worker_id": target, "p_actor_id": admin["user_id"],
                "p_reason": f"Worker deactivated: {payload.reason.strip()}",
            }).execute().data or {}
            # Banning blocks new sign-ins and token refreshes for every existing session.
            supabase.auth.admin.update_user_by_id(target, {"ban_duration": BAN_FOREVER})
        except Exception as exc:
            logger.exception("Could not complete worker deactivation")
            raise HTTPException(status_code=503, detail="The worker could not be fully deactivated. Try again.") from exc
        record_workforce_audit(admin["user_id"], target, "deactivated", auth["email"],
                               {"reason": payload.reason.strip(), "released": released})
        return {"worker": {"user_id": target, "status": "inactive", "deactivated_at": now}, "released": released}

    @router.post("/platform/workers/{worker_id}/reactivate")
    def reactivate_worker(worker_id: UUID, authorization: str | None = Header(default=None)):
        admin = admin_action(authorization)
        target = str(worker_id)
        worker = _worker_row(target)
        if worker.get("status") != "inactive":
            raise HTTPException(status_code=409, detail="Only an inactive worker can be reactivated.")
        auth = _auth_summary(target)
        next_status = "active" if auth["email_confirmed_at"] else "invited"
        now = datetime.now(timezone.utc).isoformat()
        try:
            supabase.auth.admin.update_user_by_id(target, {"ban_duration": "none"})
            supabase.table("fayfort_workers").update({
                "status": next_status, "deactivated_at": None, "deactivated_by": None, "updated_at": now,
            }).eq("user_id", target).execute()
        except Exception as exc:
            logger.exception("Could not reactivate a worker")
            raise HTTPException(status_code=503, detail="The worker could not be reactivated.") from exc
        record_workforce_audit(admin["user_id"], target, "reactivated", auth["email"], {"status": next_status})
        return {"worker": {"user_id": target, "status": next_status}}

    @router.post("/platform/workers/{worker_id}/password-reset")
    def send_password_reset(worker_id: UUID, authorization: str | None = Header(default=None)):
        admin = admin_action(authorization)
        target = str(worker_id)
        worker = _worker_row(target)
        auth = _auth_summary(target)
        if worker.get("status") != "active" or not auth["email"]:
            raise HTTPException(status_code=409, detail="A password reset can only be sent to an active worker.")
        try:
            # generate_link + FayFort's own sender: unaffected by the captcha on the public reset form.
            link = supabase.auth.admin.generate_link({
                "type": "recovery", "email": auth["email"],
                "options": {"redirect_to": staff_recovery_redirect_url()},
            })
            action_link = click_to_continue_link(link, staff_recovery_redirect_url())
            if not action_link:
                raise RuntimeError("No recovery link was generated.")
            send_immediately(to=auth["email"], rendered=staff_password_reset_email(action_link=action_link))
        except EmailSendError as exc:
            logger.warning("Worker password reset email failed: %s", exc)
            raise HTTPException(status_code=503, detail="The password reset email could not be sent. Check Control Center → Emails.") from exc
        except Exception as exc:
            logger.exception("Could not send a worker password reset")
            raise HTTPException(status_code=503, detail="The password reset email could not be sent.") from exc
        record_workforce_audit(admin["user_id"], target, "password_reset_sent", auth["email"], {})
        return {"sent": True}

    @router.post("/platform/workers/{worker_id}/mfa-reset")
    def reset_mfa(worker_id: UUID, authorization: str | None = Header(default=None)):
        admin = admin_action(authorization)
        target = str(worker_id)
        _worker_row(target)
        auth = _auth_summary(target)
        try:
            listed = supabase.auth.admin.mfa.list_factors({"user_id": target})
            factors = getattr(listed, "factors", listed) or []
            removed = 0
            for factor in factors:
                factor_id = getattr(factor, "id", None) or (factor.get("id") if isinstance(factor, dict) else None)
                if factor_id:
                    supabase.auth.admin.mfa.delete_factor({"id": str(factor_id), "user_id": target})
                    removed += 1
        except Exception as exc:
            logger.exception("Could not reset worker MFA")
            raise HTTPException(status_code=503, detail="Two-step verification could not be reset.") from exc
        record_workforce_audit(admin["user_id"], target, "mfa_reset", auth["email"], {"factors_removed": removed})
        return {"factors_removed": removed}

    return router
