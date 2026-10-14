"""Minimal Resend HTTP API client (https://resend.com/docs/api-reference/emails/send-email)."""
from __future__ import annotations

import httpx

from app.config.settings import settings

RESEND_URL = "https://api.resend.com/emails"


class EmailSendError(Exception):
    def __init__(self, message: str, *, retryable: bool):
        super().__init__(message)
        self.retryable = retryable


def delivery_configured() -> bool:
    return bool(settings.RESEND_API_KEY.strip())


def send_email(*, to: str, subject: str, html: str, text: str, headers: dict[str, str] | None = None,
               idempotency_key: str | None = None, client: httpx.Client | None = None) -> str:
    """Send one email and return Resend's message id. Never logs the API key or the body."""
    if not delivery_configured():
        raise EmailSendError("Email delivery is not configured (RESEND_API_KEY is empty).", retryable=False)
    payload: dict = {
        "from": settings.EMAIL_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    if settings.EMAIL_REPLY_TO.strip():
        payload["reply_to"] = settings.EMAIL_REPLY_TO.strip()
    if headers:
        payload["headers"] = headers
    request_headers = {"Authorization": f"Bearer {settings.RESEND_API_KEY.strip()}"}
    if idempotency_key:
        request_headers["Idempotency-Key"] = idempotency_key[:256]
    owned = client is None
    http = client or httpx.Client(timeout=20)
    try:
        response = http.post(RESEND_URL, json=payload, headers=request_headers)
    except httpx.HTTPError as exc:
        raise EmailSendError(f"Network error reaching Resend: {type(exc).__name__}", retryable=True) from exc
    finally:
        if owned:
            http.close()
    if response.status_code in (200, 201, 202):
        data = response.json() if response.content else {}
        return str(data.get("id") or "")
    try:
        detail = response.json().get("message") or response.text
    except ValueError:
        detail = response.text
    retryable = response.status_code == 429 or response.status_code >= 500
    raise EmailSendError(f"Resend {response.status_code}: {str(detail)[:300]}", retryable=retryable)
