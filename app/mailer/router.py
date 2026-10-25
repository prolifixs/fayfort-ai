"""Email API: Control Center email management (platform admins), member email preferences, and
token-based unsubscribe for links in emails."""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config.settings import settings
from app.database.client import supabase
from app.directory.identity import trusted_platform_admin
from app.mailer import subscribers
from app.mailer.render import newsletter_email
from app.mailer.resend_client import EmailSendError, delivery_configured, send_email
from app.mailer.sender import CATEGORIES, MEMBER_CATEGORIES, member_preferences, now_utc

logger = logging.getLogger(__name__)

Category = Literal["conversations", "fulfillment", "notifications", "newsletter", "account_security"]
MemberCategory = Literal["conversations", "fulfillment", "notifications", "newsletter"]
CATEGORY_LABELS = {
    "conversations": "Conversation replies",
    "fulfillment": "Request and fulfilment updates",
    "notifications": "Account notifications",
    "newsletter": "Newsletter",
    "account_security": "Staff security emails",
}
CATEGORY_DESCRIPTIONS = {
    "conversations": "When a FayFort person replies in a member's chat. At most one email per member every 15 minutes.",
    "fulfillment": "When a request moves stage: sourcing, purchase, warehouse, shipping, delivery.",
    "notifications": "Photo review updates and recurring request schedule changes.",
    "newsletter": "Newsletters you send from this page.",
    "account_security": "Password reset links sent from FayFort Workers. Always on.",
}


class CategorySwitch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class NewsletterInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(min_length=1, max_length=150)
    body_text: str = Field(min_length=1, max_length=20000)

    @field_validator("subject", "body_text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Required")
        return value.strip()


class MemberPreferencesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversations: bool | None = None
    fulfillment: bool | None = None
    notifications: bool | None = None
    newsletter: bool | None = None


class UnsubscribeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: UUID
    category: MemberCategory | Literal["all"]


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


def _audit(actor_id: str, action: str, detail: dict) -> None:
    try:
        supabase.table("email_admin_audit").insert({"actor_id": actor_id, "action": action, "detail": detail}).execute()
    except Exception:
        logger.exception("Could not record email admin audit entry")


def _staff_ids() -> set[str]:
    rows = supabase.table("fayfort_workers").select("user_id").execute().data or []
    return {str(row["user_id"]) for row in rows}


def newsletter_recipients() -> list[str]:
    """Member ids for a newsletter: confirmed email, not staff, newsletter preference on."""
    staff = _staff_ids()
    members: list[str] = []
    page = 1
    while True:
        users = supabase.auth.admin.list_users(page=page, per_page=1000) or []
        for user in users:
            user_id = str(getattr(user, "id", ""))
            metadata = getattr(user, "app_metadata", None) or {}
            is_admin = isinstance(metadata, dict) and (metadata.get("platform_admin") is True
                                                       or "platform_admin" in (metadata.get("roles") or []))
            if (user_id and getattr(user, "email_confirmed_at", None) and getattr(user, "email", None)
                    and user_id not in staff and not is_admin):
                members.append(user_id)
        if len(users) < 1000:
            break
        page += 1
    if not members:
        return []
    opted_out: set[str] = set()
    for start in range(0, len(members), 500):
        chunk = members[start:start + 500]
        rows = (supabase.table("member_email_preferences").select("member_id")
                .in_("member_id", chunk).eq("newsletter", False).execute().data or [])
        opted_out.update(str(row["member_id"]) for row in rows)
    return [member for member in members if member not in opted_out]


def create_email_router() -> APIRouter:
    router = APIRouter(tags=["email"])
    admin_limiter = _Limiter(30)
    public_limiter = _Limiter(20)

    def require_admin(authorization: str | None) -> dict:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin

    # ---- Control Center -------------------------------------------------------------------

    @router.get("/platform/email/overview")
    def email_overview(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            settings_rows = supabase.table("email_category_settings").select("category,enabled,updated_at").execute().data or []
            switches = {row["category"]: row for row in settings_rows}
            since = (now_utc() - timedelta(days=7)).isoformat()
            recent = (supabase.table("email_outbox").select("category,status")
                      .gte("created_at", since).limit(10000).execute().data or [])
            counts: dict[str, dict[str, int]] = {c: {"sent": 0, "skipped": 0, "failed": 0, "queued": 0} for c in CATEGORIES}
            for row in recent:
                bucket = "queued" if row["status"] in ("queued", "sending") else row["status"]
                counts.setdefault(row["category"], {}).setdefault(bucket, 0)
                counts[row["category"]][bucket] += 1
            return {
                "delivery": {
                    "configured": delivery_configured(),
                    "enabled": settings.EMAIL_DELIVERY_ENABLED,
                    "from": settings.EMAIL_FROM,
                    "reply_to": settings.EMAIL_REPLY_TO,
                },
                "categories": [{
                    "category": category,
                    "label": CATEGORY_LABELS[category],
                    "description": CATEGORY_DESCRIPTIONS[category],
                    "enabled": True if category == "account_security" else bool(switches.get(category, {}).get("enabled", True)),
                    "locked": category == "account_security",
                    "last_7_days": counts.get(category, {}),
                } for category in CATEGORIES],
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load email overview")
            raise HTTPException(status_code=503, detail="Email settings could not be loaded.") from exc

    @router.put("/platform/email/categories/{category}")
    def set_category(category: Category, payload: CategorySwitch, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        admin_limiter.check(admin["user_id"])
        if category == "account_security":
            raise HTTPException(status_code=409, detail="Staff security emails can't be switched off.")
        try:
            supabase.table("email_category_settings").upsert({
                "category": category, "enabled": payload.enabled, "updated_by": admin["user_id"],
                "updated_at": now_utc().isoformat(),
            }, on_conflict="category").execute()
        except Exception as exc:
            logger.exception("Could not change email category switch")
            raise HTTPException(status_code=503, detail="The setting could not be saved.") from exc
        _audit(admin["user_id"], "category_enabled" if payload.enabled else "category_disabled", {"category": category})
        return {"category": category, "enabled": payload.enabled}

    @router.get("/platform/email/log")
    def email_log(authorization: str | None = Header(default=None),
                  status: Literal["queued", "sending", "sent", "failed", "skipped"] | None = Query(default=None),
                  category: Category | None = Query(default=None),
                  limit: int = Query(default=100, ge=1, le=500)):
        require_admin(authorization)
        try:
            query = (supabase.table("email_outbox")
                     .select("id,category,template,member_id,to_email,newsletter_id,status,skip_reason,subject,"
                             "attempts,last_error,created_at,sent_at,next_attempt_at")
                     .order("created_at", desc=True).limit(limit))
            if status:
                query = query.eq("status", status)
            if category:
                query = query.eq("category", category)
            rows = query.execute().data or []
            emails: dict[str, str | None] = {}
            for member_id in {row["member_id"] for row in rows if row.get("member_id")}:
                try:
                    user = getattr(supabase.auth.admin.get_user_by_id(member_id), "user", None)
                    emails[member_id] = getattr(user, "email", None)
                except Exception:
                    emails[member_id] = None
            for row in rows:
                row["recipient"] = row.get("to_email") or emails.get(row.get("member_id") or "", None)
                row.pop("to_email", None)
            return {"emails": rows}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load email log")
            raise HTTPException(status_code=503, detail="The email log could not be loaded.") from exc

    @router.post("/platform/email/log/{email_id}/retry")
    def retry_email(email_id: UUID, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        admin_limiter.check(admin["user_id"])
        response = (supabase.table("email_outbox").select("id,status,category")
                    .eq("id", str(email_id)).maybe_single().execute())
        row = response.data if response is not None else None
        if not row:
            raise HTTPException(status_code=404, detail="Email not found.")
        if row["status"] != "failed" or row["category"] == "account_security":
            raise HTTPException(status_code=409, detail="Only failed customer emails can be retried.")
        supabase.table("email_outbox").update({
            "status": "queued", "attempts": 0, "next_attempt_at": now_utc().isoformat(), "last_error": None,
        }).eq("id", str(email_id)).execute()
        _audit(admin["user_id"], "email_retried", {"email_id": str(email_id)})
        return {"queued": True}

    # ---- Newsletter -------------------------------------------------------------------------

    @router.get("/platform/newsletters")
    def list_newsletters(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        rows = (supabase.table("newsletters")
                .select("id,subject,body_text,status,recipient_count,created_at,updated_at,sent_at")
                .order("created_at", desc=True).limit(50).execute().data or [])
        sent_ids = [row["id"] for row in rows if row["status"] != "draft"]
        delivered: dict[str, dict[str, int]] = {}
        if sent_ids:
            outbox = (supabase.table("email_outbox").select("newsletter_id,status")
                      .in_("newsletter_id", sent_ids).limit(50000).execute().data or [])
            for item in outbox:
                bucket = delivered.setdefault(item["newsletter_id"], {})
                bucket[item["status"]] = bucket.get(item["status"], 0) + 1
        for row in rows:
            row["delivery"] = delivered.get(row["id"], {})
        try:
            visitors = subscribers.counts()
        except Exception:
            logger.warning("Newsletter subscriber counts could not be read", exc_info=True)
            visitors = None
        return {"newsletters": rows, "visitor_subscribers": visitors}

    @router.post("/platform/newsletters", status_code=201)
    def create_newsletter(payload: NewsletterInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        admin_limiter.check(admin["user_id"])
        rows = supabase.table("newsletters").insert({
            "subject": payload.subject, "body_text": payload.body_text, "created_by": admin["user_id"],
        }).execute().data or []
        if not rows:
            raise HTTPException(status_code=503, detail="The newsletter could not be saved.")
        _audit(admin["user_id"], "newsletter_saved", {"newsletter_id": rows[0]["id"]})
        return {"newsletter": rows[0]}

    def draft(newsletter_id: str) -> dict:
        response = supabase.table("newsletters").select("*").eq("id", newsletter_id).maybe_single().execute()
        row = response.data if response is not None else None
        if not row:
            raise HTTPException(status_code=404, detail="Newsletter not found.")
        return row

    @router.put("/platform/newsletters/{newsletter_id}")
    def update_newsletter(newsletter_id: UUID, payload: NewsletterInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        admin_limiter.check(admin["user_id"])
        if draft(str(newsletter_id))["status"] != "draft":
            raise HTTPException(status_code=409, detail="A sent newsletter can't be edited.")
        rows = (supabase.table("newsletters").update({
            "subject": payload.subject, "body_text": payload.body_text, "updated_at": now_utc().isoformat(),
        }).eq("id", str(newsletter_id)).eq("status", "draft").execute().data or [])
        _audit(admin["user_id"], "newsletter_saved", {"newsletter_id": str(newsletter_id)})
        return {"newsletter": rows[0] if rows else None}

    @router.get("/platform/newsletters/{newsletter_id}/preview")
    def preview_newsletter(newsletter_id: UUID, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        row = draft(str(newsletter_id))
        rendered = newsletter_email(subject=row["subject"], body_text=row["body_text"], unsubscribe_url="#unsubscribe")
        members = len(newsletter_recipients())
        visitors = len(subscribers.visitor_recipients())
        return {"subject": rendered.subject, "html": rendered.html, "recipients": members + visitors,
                "members": members, "visitors": visitors, "daily_limit": 100}

    @router.post("/platform/newsletters/{newsletter_id}/test")
    def test_newsletter(newsletter_id: UUID, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        admin_limiter.check(admin["user_id"])
        row = draft(str(newsletter_id))
        user = getattr(supabase.auth.admin.get_user_by_id(admin["user_id"]), "user", None)
        to = getattr(user, "email", None)
        if not to:
            raise HTTPException(status_code=409, detail="Your account has no email address.")
        rendered = newsletter_email(subject=f"[Test] {row['subject']}", body_text=row["body_text"], unsubscribe_url=None)
        try:
            send_email(to=to, subject=rendered.subject, html=rendered.html, text=rendered.text)
        except EmailSendError as exc:
            raise HTTPException(status_code=503, detail=f"The test email could not be sent: {exc}") from exc
        _audit(admin["user_id"], "newsletter_test_sent", {"newsletter_id": str(newsletter_id)})
        return {"sent_to": to}

    @router.post("/platform/newsletters/{newsletter_id}/send")
    def send_newsletter(newsletter_id: UUID, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        admin_limiter.check(admin["user_id"])
        row = draft(str(newsletter_id))
        if row["status"] != "draft":
            raise HTTPException(status_code=409, detail="This newsletter was already sent.")
        if not delivery_configured() or not settings.EMAIL_DELIVERY_ENABLED:
            raise HTTPException(status_code=409, detail="Email delivery is off on the server, so nothing would be sent.")
        recipients = newsletter_recipients()
        visitors = subscribers.visitor_recipients()
        if not recipients and not visitors:
            raise HTTPException(status_code=409, detail="No subscribers to send to.")
        # Claim the newsletter first so a double click can't send it twice.
        claimed = (supabase.table("newsletters").update({
            "status": "sending", "sent_by": admin["user_id"], "sent_at": now_utc().isoformat(),
            "recipient_count": len(recipients) + len(visitors),
        }).eq("id", str(newsletter_id)).eq("status", "draft").execute().data or [])
        if not claimed:
            raise HTTPException(status_code=409, detail="This newsletter was already sent.")
        for start in range(0, len(recipients), 500):
            supabase.table("email_outbox").upsert([
                {"category": "newsletter", "template": "newsletter", "member_id": member_id,
                 "newsletter_id": str(newsletter_id)}
                for member_id in recipients[start:start + 500]
            ], on_conflict="newsletter_id,member_id", ignore_duplicates=True).execute()
        # Visitors who subscribed on fayfort.com (members among them already got the member copy above).
        subscribers.queue_newsletter(row, visitors)
        supabase.table("newsletters").update({"status": "sent"}).eq("id", str(newsletter_id)).execute()
        total = len(recipients) + len(visitors)
        _audit(admin["user_id"], "newsletter_sent", {"newsletter_id": str(newsletter_id), "recipients": total,
                                                     "visitors": len(visitors)})
        return {"recipients": total, "members": len(recipients), "visitors": len(visitors)}

    # ---- Members ----------------------------------------------------------------------------

    def member_id_from(authorization: str | None) -> str:
        from app.directory.identity import trusted_user_id
        user_id = trusted_user_id(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="A valid signed-in member is required.")
        return user_id

    @router.get("/members/me/email-preferences")
    def get_member_preferences(authorization: str | None = Header(default=None)):
        member_id = member_id_from(authorization)
        row = member_preferences(member_id)
        return {"preferences": {category: bool(row.get(category, True)) for category in MEMBER_CATEGORIES}}

    @router.put("/members/me/email-preferences")
    def set_member_preferences(payload: MemberPreferencesInput, authorization: str | None = Header(default=None)):
        member_id = member_id_from(authorization)
        member_preferences(member_id)
        changes = {k: v for k, v in payload.model_dump().items() if v is not None}
        if changes:
            changes["updated_at"] = now_utc().isoformat()
            supabase.table("member_email_preferences").update(changes).eq("member_id", member_id).execute()
        row = member_preferences(member_id)
        return {"preferences": {category: bool(row.get(category, True)) for category in MEMBER_CATEGORIES}}

    # ---- Unsubscribe links (no sign-in; the token identifies the member) --------------------

    def unsubscribe(token: UUID, category: str) -> dict:
        fields = list(MEMBER_CATEGORIES) if category == "all" else [category]
        rows = (supabase.table("member_email_preferences")
                .update({**{field: False for field in fields}, "updated_at": now_utc().isoformat()})
                .eq("unsubscribe_token", str(token)).execute().data or [])
        # Same answer whether or not the token exists, so links can't be used to probe accounts.
        return {"unsubscribed": fields, "matched": bool(rows)}

    @router.post("/email/unsubscribe")
    def unsubscribe_from_page(payload: UnsubscribeInput, x_forwarded_for: str | None = Header(default=None)):
        public_limiter.check((x_forwarded_for or "anon").split(",")[0].strip())
        result = unsubscribe(payload.token, payload.category)
        return {"unsubscribed": result["unsubscribed"]}

    @router.post("/email/unsubscribe/one-click")
    def unsubscribe_one_click(token: UUID = Query(...), category: MemberCategory = Query(...),
                              x_forwarded_for: str | None = Header(default=None)):
        public_limiter.check((x_forwarded_for or "anon").split(",")[0].strip())
        unsubscribe(token, category)
        return {"ok": True}

    return router
