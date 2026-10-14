"""Background email sender: claims due outbox rows, applies switches and preferences, renders, sends.

Runs on the API host when EMAIL_DELIVERY_ENABLED=true. Every decision is written back to the
row (sent, skipped with a reason, or failed with the error) so the Control Center log explains it.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlencode

from app.accounts.member_notifications import _project_notifications
from app.config.settings import settings
from app.database.client import supabase
from app.mailer.render import RenderedEmail, newsletter_email, notification_email
from app.mailer.resend_client import EmailSendError, delivery_configured, send_email

logger = logging.getLogger(__name__)

CATEGORIES = ("conversations", "fulfillment", "notifications", "newsletter", "account_security")
MEMBER_CATEGORIES = ("conversations", "fulfillment", "notifications", "newsletter")
ALWAYS_ON = {"account_security"}
CONVERSATION_COALESCE_MINUTES = 15
MAX_ATTEMPTS = 5
# Alerts that waited longer than this (for example while sending was off) are skipped, not sent late.
STALE_ALERT_HOURS = 24
BACKOFF_MINUTES = (1, 5, 15, 60)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def app_url(path: str) -> str:
    return settings.APP_PUBLIC_URL.rstrip("/") + path


def unsubscribe_page_url(token: str, category: str) -> str:
    return app_url("/email/unsubscribe?" + urlencode({"token": token, "category": category}))


def one_click_unsubscribe_url(token: str, category: str) -> str | None:
    base = (settings.PUBLIC_API_URL or "").rstrip("/")
    if not base.startswith("https://"):
        return None
    return base + "/email/unsubscribe/one-click?" + urlencode({"token": token, "category": category})


def enabled_categories() -> dict[str, bool]:
    rows = supabase.table("email_category_settings").select("category,enabled").execute().data or []
    switches = {category: True for category in CATEGORIES}
    switches.update({row["category"]: bool(row["enabled"]) for row in rows})
    for category in ALWAYS_ON:
        switches[category] = True
    return switches


def member_preferences(member_id: str) -> dict[str, Any]:
    """Preferences row for a member, created with defaults (all on) the first time it's needed."""
    response = (supabase.table("member_email_preferences").select("*")
                .eq("member_id", member_id).maybe_single().execute())
    row = response.data if response is not None else None
    if row:
        return row
    created = supabase.table("member_email_preferences").upsert(
        {"member_id": member_id}, on_conflict="member_id").execute().data or []
    return created[0] if created else {"member_id": member_id, **{c: True for c in MEMBER_CATEGORIES},
                                       "unsubscribe_token": None}


def member_email(member_id: str) -> str | None:
    """Confirmed email for a member; None means the email must not be sent."""
    user = getattr(supabase.auth.admin.get_user_by_id(member_id), "user", None)
    if not user or getattr(user, "email_confirmed_at", None) is None:
        return None
    email = getattr(user, "email", None)
    return email.strip() if email else None


def _update(row_id: str, values: dict[str, Any]) -> None:
    supabase.table("email_outbox").update(values).eq("id", row_id).execute()


def _skip(row: dict, reason: str) -> str:
    _update(row["id"], {"status": "skipped", "skip_reason": reason[:120]})
    return "skipped"


def _recently_emailed_conversation(member_id: str, row_id: str) -> bool:
    since = (now_utc() - timedelta(minutes=CONVERSATION_COALESCE_MINUTES)).isoformat()
    rows = (supabase.table("email_outbox").select("id")
            .eq("member_id", member_id).eq("category", "conversations").eq("status", "sent")
            .gte("sent_at", since).neq("id", row_id).limit(1).execute().data or [])
    return bool(rows)


def build_member_email(row: dict, preferences: dict) -> RenderedEmail | None:
    """Render a notification or newsletter email; None means the source no longer exists."""
    token = preferences.get("unsubscribe_token")
    unsubscribe = unsubscribe_page_url(str(token), row["category"]) if token else None
    if row["category"] == "newsletter":
        response = (supabase.table("newsletters").select("subject,body_text")
                    .eq("id", row["newsletter_id"]).maybe_single().execute())
        letter = response.data if response is not None else None
        if not letter:
            return None
        return newsletter_email(subject=letter["subject"], body_text=letter["body_text"], unsubscribe_url=unsubscribe)
    if not row.get("notification_id"):
        return None
    notifications = (supabase.table("member_notifications")
                     .select("id,notification_type,request_event_id,worker_message_id,review_id,review_status,"
                             "schedule_event_id,created_at,read_at,banner_dismissed_at")
                     .eq("id", row["notification_id"]).eq("member_id", row["member_id"]).execute().data or [])
    projected = _project_notifications(notifications, row["member_id"]) if notifications else []
    if not projected:
        return None
    item = projected[0]
    return notification_email(category=row["category"], title=item["title"], body=item["body"],
                              url=app_url(item["href"]), unsubscribe_url=unsubscribe)


def deliver(row: dict, *, switches: dict[str, bool], send: Callable[..., str] = send_email) -> str:
    """Decide and deliver one claimed outbox row. Returns the final status."""
    category = row["category"]
    try:
        if not switches.get(category, True):
            return _skip(row, "category switched off in Control Center")
        to = row.get("to_email")
        headers: dict[str, str] = {}
        created = row.get("created_at")
        if category in ("conversations", "fulfillment", "notifications") and created:
            try:
                age = now_utc() - datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                if age > timedelta(hours=STALE_ALERT_HOURS):
                    return _skip(row, "older than 24 hours when sending was possible")
            except ValueError:
                pass
        if row.get("member_id") and category in MEMBER_CATEGORIES:
            preferences = member_preferences(row["member_id"])
            if not preferences.get(category, True):
                return _skip(row, "member turned this category off")
            if category == "conversations" and _recently_emailed_conversation(row["member_id"], row["id"]):
                return _skip(row, "coalesced: a conversation email was sent in the last 15 minutes")
            to = member_email(row["member_id"])
            if not to:
                return _skip(row, "no confirmed email address")
            rendered = build_member_email(row, preferences)
            if rendered is None:
                return _skip(row, "source no longer exists")
            token = preferences.get("unsubscribe_token")
            one_click = one_click_unsubscribe_url(str(token), category) if token else None
            if one_click:
                headers = {"List-Unsubscribe": f"<{one_click}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
        else:
            payload = row.get("payload") or {}
            if not to or not payload.get("html"):
                return _skip(row, "nothing to send")
            rendered = RenderedEmail(subject=payload.get("subject", "FayFort"), html=payload["html"],
                                     text=payload.get("text", ""))
        message_id = send(to=to, subject=rendered.subject, html=rendered.html, text=rendered.text,
                          headers=headers or None, idempotency_key=f"fayfort-outbox-{row['id']}")
        _update(row["id"], {"status": "sent", "subject": rendered.subject[:200], "sent_at": now_utc().isoformat(),
                            "provider_message_id": message_id[:200] or None, "last_error": None,
                            "to_email": to if category == "account_security" else None})
        return "sent"
    except EmailSendError as exc:
        attempts = int(row.get("attempts") or 1)
        if exc.retryable and attempts < MAX_ATTEMPTS:
            delay = BACKOFF_MINUTES[min(attempts - 1, len(BACKOFF_MINUTES) - 1)]
            _update(row["id"], {"status": "queued", "last_error": str(exc)[:500],
                                "next_attempt_at": (now_utc() + timedelta(minutes=delay)).isoformat()})
            return "queued"
        _update(row["id"], {"status": "failed", "last_error": str(exc)[:500]})
        return "failed"
    except Exception as exc:  # unexpected: keep the row visible and retryable from the Control Center
        logger.exception("Email outbox row could not be processed")
        _update(row["id"], {"status": "failed", "last_error": f"{type(exc).__name__}: processing error"[:500]})
        return "failed"


def process_batch(limit: int = 20, *, send: Callable[..., str] = send_email) -> dict[str, int]:
    supabase.rpc("requeue_stale_email_outbox", {"p_minutes": 10}).execute()
    rows = supabase.rpc("claim_email_outbox", {"p_limit": limit}).execute().data or []
    counts: dict[str, int] = {}
    if not rows:
        return counts
    switches = enabled_categories()
    for row in rows:
        status = deliver(row, switches=switches, send=send)
        counts[status] = counts.get(status, 0) + 1
    return counts


def send_immediately(*, to: str, rendered: RenderedEmail, category: str = "account_security",
                     template: str = "staff_password_reset", send: Callable[..., str] = send_email) -> dict:
    """Security emails: record in the outbox and send now (still logged if sending fails)."""
    inserted = supabase.table("email_outbox").insert({
        "category": category, "template": template, "to_email": to, "status": "sending", "attempts": 1,
        "payload": {"subject": rendered.subject, "html": rendered.html, "text": rendered.text},
    }).execute().data or []
    row = inserted[0] if inserted else {"id": None}
    try:
        message_id = send(to=to, subject=rendered.subject, html=rendered.html, text=rendered.text,
                          headers=None, idempotency_key=f"fayfort-outbox-{row['id']}")
        if row["id"]:
            # The action link is single-use and secret: drop the rendered body once it is sent.
            _update(row["id"], {"status": "sent", "subject": rendered.subject, "sent_at": now_utc().isoformat(),
                                "provider_message_id": message_id or None, "payload": {}})
        return {"sent": True}
    except EmailSendError as exc:
        if row["id"]:
            _update(row["id"], {"status": "failed", "last_error": str(exc)[:500], "payload": {}})
        raise


async def email_sender_loop() -> None:
    interval = max(5, settings.EMAIL_SENDER_INTERVAL_SECONDS)
    while True:
        try:
            if delivery_configured():
                counts = await asyncio.to_thread(process_batch)
                if counts:
                    logger.info("Email sender cycle: %s", counts)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Email sender cycle failed")
        await asyncio.sleep(interval)
