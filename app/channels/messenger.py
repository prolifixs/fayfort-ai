from __future__ import annotations

import hashlib
import hmac
import json
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.channels.manual import process_manual_inbound
from app.database.channel_events import mark_inbound_delivery_outcome
from app.database.connections import get_connection_credentials, list_messenger_connections_for_page
from app.schemas.channel import ManualInboundPayload

logger = logging.getLogger(__name__)


def create_messenger_webhook_router(
    verify_token: str,
    message_handler: Callable[[str, dict[str, str], str | None], dict[str, Any]],
    outbound_handler: Callable[..., dict[str, Any]] | None = None,
    inbound_message_handler: Callable[..., dict[str, Any]] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/webhooks/messenger", tags=["messenger"])

    @router.get("")
    def verify_webhook(request: Request):
        mode = request.query_params.get("hub.mode", "")
        supplied = request.query_params.get("hub.verify_token", "")
        challenge = request.query_params.get("hub.challenge", "")
        if not verify_token:
            raise HTTPException(status_code=503, detail="Messenger webhook verification is not configured.")
        if mode != "subscribe" or not hmac.compare_digest(supplied, verify_token):
            raise HTTPException(status_code=403, detail="Messenger webhook verification failed.")
        return PlainTextResponse(challenge)

    @router.post("")
    async def receive_webhook(
        request: Request,
        signature: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    ):
        raw_body = await request.body()
        if len(raw_body) > 1_000_000:
            raise HTTPException(status_code=413, detail="Messenger webhook payload is too large.")
        if not signature or not signature.startswith("sha256="):
            raise HTTPException(status_code=401, detail="Messenger webhook signature is missing.")
        try:
            payload = json.loads(raw_body)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(status_code=400, detail="Messenger webhook payload is invalid.")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Messenger webhook payload is invalid.")
        entries = payload.get("entry")
        if payload.get("object") != "page" or not isinstance(entries, list) or not entries:
            raise HTTPException(status_code=400, detail="Messenger Page webhook entries are missing.")

        resolved: dict[str, tuple[dict[str, Any], dict[str, str]]] = {}
        try:
            for entry in entries:
                page_id = str(entry.get("id", "")) if isinstance(entry, dict) else ""
                if not page_id:
                    raise HTTPException(status_code=400, detail="Messenger Page ID is missing.")
                if page_id in resolved:
                    continue
                matches = list_messenger_connections_for_page(page_id)
                if not matches:
                    fingerprint = hashlib.sha256(page_id.encode("utf-8")).hexdigest()[:12]
                    logger.warning("Messenger webhook acknowledged without processing: page_fingerprint=%s; entries=%d", fingerprint, len(entries))
                    continue
                if len(matches) != 1:
                    raise HTTPException(status_code=409, detail="Messenger Page is not uniquely connected.")
                connection = matches[0]
                credentials = get_connection_credentials(connection["business_id"], connection["id"])
                if not credentials or not credentials.get("app_secret"):
                    raise HTTPException(status_code=503, detail="Messenger webhook credentials are unavailable.")
                resolved[page_id] = (connection, credentials)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Could not resolve Messenger Page webhook")
            raise HTTPException(status_code=503, detail="Messenger Page could not be resolved.")
        if not resolved:
            return {"status": "accepted", "processed": 0}

        supplied_signature = signature.removeprefix("sha256=")
        for _, credentials in resolved.values():
            expected = hmac.new(credentials["app_secret"].encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(supplied_signature, expected):
                raise HTTPException(status_code=401, detail="Messenger webhook signature is invalid.")

        processed = 0
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            page_id = str(entry.get("id", ""))
            if page_id not in resolved:
                continue
            connection, credentials = resolved[page_id]
            if connection.get("status") in {"paused", "disconnected"}:
                continue
            safe_settings = connection.get("safe_settings") or {}
            if safe_settings.get("inbound_enabled") is False:
                continue
            messaging = entry.get("messaging", [])
            if not isinstance(messaging, list):
                continue
            for item in messaging:
                if not isinstance(item, dict):
                    continue
                message = item.get("message") or {}
                sender_id = str((item.get("sender") or {}).get("id", ""))
                recipient_id = str((item.get("recipient") or {}).get("id", ""))
                if sender_id == page_id or recipient_id != page_id or message.get("is_echo") is True:
                    continue
                event_id = str(message.get("mid", ""))
                content = message.get("text")
                if not sender_id or not event_id or not isinstance(content, str) or not content.strip():
                    continue
                inbound = ManualInboundPayload(
                    business_id=connection["business_id"], customer_external_id=sender_id,
                    provider_event_id=event_id, content=content,
                )
                try:
                    result = process_manual_inbound(
                        inbound, None, message_handler, channel_override="messenger",
                        require_identity=False, connection_id=connection["id"],
                        inbound_message_handler=inbound_message_handler,
                        automation_reply_enabled=safe_settings.get("auto_reply_enabled") is True,
                    )
                except Exception:
                    logger.exception("Messenger inbound processing failed")
                    continue
                if result.get("status") == "processed" and result.get("ai_message") and outbound_handler and safe_settings.get("auto_reply_enabled") is True:
                    try:
                        delivery = outbound_handler(
                            connection=connection, credentials=credentials,
                            conversation={"id": result["conversation_id"], "business_id": connection["business_id"], "business_connection_id": connection["id"], "customer_external_id": sender_id},
                            message=result["ai_message"], recipient_id=sender_id, require_auto_reply=True,
                        )
                        status = str(delivery.get("status") or "unknown")
                        if status not in {"sent", "rejected", "unknown", "blocked"}:
                            status = "unknown"
                        mark_inbound_delivery_outcome(str(result["ai_message"]["id"]), status, delivery.get("safe_error_code"))
                    except Exception:
                        logger.exception("Messenger outbound result could not be reconciled")
                        try:
                            mark_inbound_delivery_outcome(str(result["ai_message"]["id"]), "unknown", "provider_result_uncertain")
                        except Exception:
                            logger.exception("Could not preserve uncertain Messenger delivery state")
                processed += int(result.get("status") == "processed")
        return {"status": "accepted", "processed": processed}

    return router
