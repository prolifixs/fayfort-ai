from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from app.database.client import supabase
from app.database.outbound_deliveries import begin_delivery_attempt, finish_delivery_attempt

logger = logging.getLogger(__name__)
MESSENGER_API_VERSION = "v26.0"
MESSENGER_RESPONSE_WINDOW = timedelta(hours=24)


def _latest_customer_message_at(conversation_id: str) -> datetime | None:
    rows = (supabase.table("messages").select("created_at")
        .eq("conversation_id", conversation_id).eq("sender_type", "customer")
        .order("created_at", desc=True).limit(1).execute()).data or []
    if not rows or not rows[0].get("created_at"):
        return None
    value = datetime.fromisoformat(str(rows[0]["created_at"]).replace("Z", "+00:00"))
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def deliver_messenger_text(
    *, connection: dict[str, Any], credentials: dict[str, str],
    conversation: dict[str, Any], message: dict[str, Any],
    recipient_id: str | None = None, require_auto_reply: bool = False,
    retry_rejected: bool = False,
) -> dict[str, Any]:
    """Send a Page response with an idempotent delivery record and a 24-hour gate."""
    settings = connection.get("safe_settings") or {}
    if connection.get("status") != "connected" or not credentials.get("page_access_token"):
        return {"status": "blocked", "safe_error_code": "connection_unavailable"}
    if settings.get("outbound_enabled") is not True:
        return {"status": "disabled", "safe_error_code": "outbound_disabled"}
    if require_auto_reply and settings.get("auto_reply_enabled") is not True:
        return {"status": "disabled", "safe_error_code": "auto_reply_disabled"}

    recipient = recipient_id or str(conversation.get("customer_external_id") or "")
    text = message.get("content")
    message_id = str(message.get("id") or "")
    business_id = str(connection.get("business_id") or "")
    connection_id = str(connection.get("id") or "")
    conversation_id = str(conversation.get("id") or "")
    page_id = str(connection.get("provider_account_id") or credentials.get("page_id") or "")
    if not all((recipient, text, message_id, business_id, connection_id, conversation_id, page_id)):
        return {"status": "blocked", "safe_error_code": "delivery_fields_missing"}

    delivery, claimed = begin_delivery_attempt(
        business_id=business_id, connection_id=connection_id,
        conversation_id=conversation_id, message_id=message_id,
        channel="messenger", retry_rejected=retry_rejected,
    )
    if not delivery or not claimed:
        return {
            "status": delivery.get("status") if delivery else "unknown",
            "delivery_id": delivery.get("id") if delivery else None,
            "duplicate": True,
            "safe_error_code": delivery.get("safe_error_code") if delivery else None,
        }
    attempt = int(delivery["attempt_count"])
    last_customer_message = _latest_customer_message_at(conversation_id)
    if last_customer_message is None or datetime.now(timezone.utc) - last_customer_message > MESSENGER_RESPONSE_WINDOW:
        finished = finish_delivery_attempt(delivery["id"], attempt, "rejected", "response_window_expired")
        return {"status": "rejected", "delivery_id": finished["id"], "safe_error_code": "response_window_expired"}

    endpoint = f"https://graph.facebook.com/{MESSENGER_API_VERSION}/{page_id}/messages"
    try:
        response = requests.post(
            endpoint,
            headers={"Authorization": f"Bearer {credentials['page_access_token']}"},
            json={"recipient": {"id": recipient}, "messaging_type": "RESPONSE", "message": {"text": text}},
            timeout=15,
        )
    except requests.ConnectTimeout as exc:
        logger.warning("Messenger outbound connection timed out before provider response (%s)", type(exc).__name__)
        finished = finish_delivery_attempt(delivery["id"], attempt, "rejected", "connect_timeout")
        return {"status": "rejected", "delivery_id": finished["id"], "safe_error_code": "connect_timeout"}
    except requests.RequestException as exc:
        logger.warning("Messenger outbound result is uncertain (%s)", type(exc).__name__)
        finished = finish_delivery_attempt(delivery["id"], attempt, "unknown", "provider_result_uncertain")
        return {"status": "unknown", "delivery_id": finished["id"], "safe_error_code": "provider_result_uncertain"}

    result: dict[str, Any] = {}
    try:
        parsed = response.json()
        if isinstance(parsed, dict):
            result = parsed
    except ValueError:
        pass
    provider_message_id = result.get("message_id")
    if response.status_code == 200 and isinstance(provider_message_id, str) and provider_message_id:
        finished = finish_delivery_attempt(delivery["id"], attempt, "sent", provider_message_id=provider_message_id)
        return {"status": "sent", "delivery_id": finished["id"], "provider_message_id": provider_message_id}

    provider_error = result.get("error") if isinstance(result.get("error"), dict) else {}
    provider_code = provider_error.get("code")
    safe_code = f"meta_error_{provider_code}" if isinstance(provider_code, int) else f"meta_http_{response.status_code}"
    if isinstance(provider_code, int) and isinstance(provider_error.get("error_subcode"), int):
        safe_code += f"_subcode_{provider_error['error_subcode']}"
    logger.warning("Messenger outbound rejected or uncertain: http_status=%s safe_code=%s", response.status_code, safe_code)
    status = "rejected" if 400 <= response.status_code < 500 and response.status_code not in {408, 425} else "unknown"
    if response.status_code == 200:
        status, safe_code = "unknown", "provider_receipt_missing"
    finished = finish_delivery_attempt(delivery["id"], attempt, status, safe_code)
    return {"status": status, "delivery_id": finished["id"], "safe_error_code": safe_code}
