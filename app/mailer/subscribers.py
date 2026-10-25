"""Newsletter for visitors who aren't members (owner request, 2026-10-25).

POST /public/newsletter/subscribe            email + where it came from; sends a "confirm your email" message
POST /public/newsletter/confirm              token from that message (fayfort.com/newsletter posts it)
POST /public/newsletter/unsubscribe          token from a newsletter (fayfort.com/newsletter, with a button)
POST /public/newsletter/unsubscribe/one-click  the List-Unsubscribe header (mail apps' own unsubscribe button)

Only confirmed subscribers get newsletters. A subscriber who is also a member is sent the member copy only.
Answers never reveal whether an email is already on the list.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from app.config.settings import PUBLIC_SITE_ORIGINS, settings
from app.database.client import supabase
from app.mailer.render import _paragraph, newsletter_email, shell, RenderedEmail

logger = logging.getLogger(__name__)

SITE_URL = PUBLIC_SITE_ORIGINS[0]  # https://www.fayfort.com
CONFIRM_RESEND_MINUTES = 10
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
Source = Literal["site_footer", "site_popup", "go", "catalog_popup", "newsletter_page"]


class SubscribeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)
    source: Source = "site_footer"


class TokenInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: UUID


class _Limiter:
    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            hits = self.hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(status_code=429, detail="Too many tries. Please wait a minute.")
            hits.append(now)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_email(value: str) -> str | None:
    email = (value or "").strip().lower()
    return email if _EMAIL.match(email) and len(email) <= 320 else None


def _one(response) -> dict | None:
    data = getattr(response, "data", None) if response is not None else None
    if isinstance(data, list):
        return data[0] if data else None
    return data or None


def confirm_url(token: str) -> str:
    return f"{SITE_URL}/newsletter?{urlencode({'confirm': token})}"


def unsubscribe_url(token: str) -> str:
    return f"{SITE_URL}/newsletter?{urlencode({'unsubscribe': token})}"


def one_click_url(token: str) -> str | None:
    base = (settings.PUBLIC_API_URL or "").rstrip("/")
    return f"{base}/public/newsletter/unsubscribe/one-click?{urlencode({'token': token})}" if base.startswith("https://") else None


def confirmation_email(token: str) -> RenderedEmail:
    url = confirm_url(token)
    heading = "Confirm your email"
    parts = ["Thanks for signing up to the FayFort newsletter: new finds from China every week and early access to "
             "our giveaways.",
             "Tap the button to confirm it's you. If you didn't sign up, ignore this email and you won't hear from us."]
    footer = "You're getting this because this email address was entered on fayfort.com."
    html = shell(heading=heading, intro_html="".join(_paragraph(p) for p in parts), button_label="Confirm my email",
                 button_url=url, footer_note=footer, unsubscribe_url=None)
    text = f"{heading}\n\n" + "\n\n".join(parts) + f"\n\nConfirm my email: {url}\n\n{footer}"
    return RenderedEmail(subject="Confirm your FayFort newsletter", html=html, text=text)


def _queue(to: str, rendered: RenderedEmail, template: str, *, newsletter_id: str | None = None,
           headers: dict | None = None) -> None:
    row = {"category": "newsletter", "template": template, "to_email": to,
           "payload": {"subject": rendered.subject, "html": rendered.html, "text": rendered.text,
                       **({"headers": headers} if headers else {})}}
    if newsletter_id:
        row["newsletter_id"] = newsletter_id
    supabase.table("email_outbox").insert(row).execute()


def subscribe(email: str, source: str) -> None:
    found = _one(supabase.table("newsletter_subscribers").select("id,status,confirm_token,confirm_sent_at")
                 .eq("email", email).limit(1).execute())
    if found and found["status"] == "confirmed":
        return
    if found:
        sent = found.get("confirm_sent_at")
        if sent:
            try:
                last = datetime.fromisoformat(str(sent).replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - last < timedelta(minutes=CONFIRM_RESEND_MINUTES):
                    return
            except ValueError:
                pass
        supabase.table("newsletter_subscribers").update({"status": "pending", "confirm_sent_at": now_iso(),
                                                         "unsubscribed_at": None, "updated_at": now_iso()}) \
            .eq("id", found["id"]).execute()
        token = str(found["confirm_token"])
    else:
        created = _one(supabase.table("newsletter_subscribers").insert({
            "email": email, "source": source, "confirm_sent_at": now_iso()}).execute())
        if not created:
            raise RuntimeError("subscriber not saved")
        token = str(created["confirm_token"])
    _queue(email, confirmation_email(token), "newsletter_confirm")


def confirm(token: UUID) -> bool:
    found = _one(supabase.table("newsletter_subscribers").select("id,status").eq("confirm_token", str(token))
                 .limit(1).execute())
    if not found:
        return False
    if found["status"] != "confirmed":
        supabase.table("newsletter_subscribers").update({"status": "confirmed", "confirmed_at": now_iso(),
                                                         "unsubscribed_at": None, "updated_at": now_iso()}) \
            .eq("id", found["id"]).execute()
    return True


def unsubscribe(token: UUID) -> None:
    supabase.table("newsletter_subscribers").update({"status": "unsubscribed", "unsubscribed_at": now_iso(),
                                                     "updated_at": now_iso()}) \
        .eq("unsubscribe_token", str(token)).execute()


def member_emails() -> set[str]:
    emails: set[str] = set()
    page = 1
    while True:
        users = supabase.auth.admin.list_users(page=page, per_page=1000) or []
        for user in users:
            email = getattr(user, "email", None)
            if email:
                emails.add(email.strip().lower())
        if len(users) < 1000:
            break
        page += 1
    return emails


def visitor_recipients(exclude: set[str] | None = None) -> list[dict]:
    """Confirmed subscribers who aren't members (members get the member copy)."""
    found = supabase.table("newsletter_subscribers").select("email,unsubscribe_token").eq("status", "confirmed") \
        .limit(50000).execute().data or []
    skip = member_emails() if exclude is None else exclude
    return [row for row in found if row["email"] not in skip]


def queue_newsletter(newsletter: dict, recipients: list[dict]) -> int:
    footer = "You're getting this because you subscribed to the FayFort newsletter on fayfort.com."
    for row in recipients:
        token = str(row["unsubscribe_token"])
        rendered = newsletter_email(subject=newsletter["subject"], body_text=newsletter["body_text"],
                                    unsubscribe_url=unsubscribe_url(token), footer=footer)
        one_click = one_click_url(token)
        headers = {"List-Unsubscribe": f"<{one_click}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"} \
            if one_click else None
        _queue(row["email"], rendered, "newsletter_visitor", newsletter_id=str(newsletter["id"]), headers=headers)
    return len(recipients)


def counts() -> dict:
    rows = supabase.table("newsletter_subscribers").select("status").limit(50000).execute().data or []
    result = {"confirmed": 0, "pending": 0, "unsubscribed": 0}
    for row in rows:
        result[row["status"]] = result.get(row["status"], 0) + 1
    return result


def create_public_newsletter_router() -> APIRouter:
    router = APIRouter(tags=["newsletter"])
    limiter = _Limiter(6)

    def ip(forwarded: str | None) -> str:
        return (forwarded or "anon").split(",")[0].strip()[:64]

    @router.post("/public/newsletter/subscribe", status_code=202)
    def subscribe_route(payload: SubscribeInput, x_forwarded_for: str | None = Header(default=None),
                        cf_connecting_ip: str | None = Header(default=None)):
        limiter.check(cf_connecting_ip or ip(x_forwarded_for))
        email = clean_email(payload.email)
        if not email:
            raise HTTPException(status_code=422, detail="Enter a valid email address.")
        try:
            subscribe(email, payload.source)
        except Exception as exc:
            logger.exception("Newsletter sign-up failed")
            raise HTTPException(status_code=503, detail="We couldn't sign you up just now. Please try again.") from exc
        return {"ok": True, "message": "Check your inbox and tap the link to confirm."}

    @router.post("/public/newsletter/confirm")
    def confirm_route(payload: TokenInput, x_forwarded_for: str | None = Header(default=None),
                      cf_connecting_ip: str | None = Header(default=None)):
        limiter.check(cf_connecting_ip or ip(x_forwarded_for))
        if not confirm(payload.token):
            raise HTTPException(status_code=404, detail="That link has expired or was already used.")
        return {"confirmed": True}

    @router.post("/public/newsletter/unsubscribe")
    def unsubscribe_route(payload: TokenInput, x_forwarded_for: str | None = Header(default=None),
                          cf_connecting_ip: str | None = Header(default=None)):
        limiter.check(cf_connecting_ip or ip(x_forwarded_for))
        unsubscribe(payload.token)
        return {"unsubscribed": True}

    @router.post("/public/newsletter/unsubscribe/one-click")
    def one_click_route(token: UUID = Query(...), x_forwarded_for: str | None = Header(default=None),
                        cf_connecting_ip: str | None = Header(default=None)):
        limiter.check(cf_connecting_ip or ip(x_forwarded_for))
        unsubscribe(token)
        return {"ok": True}

    return router
