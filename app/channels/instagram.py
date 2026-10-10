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
from app.config.settings import settings
from app.database.connections import (
    get_connection_credentials,
    list_instagram_connections_for_account,
)
from app.database.channel_events import mark_inbound_delivery_outcome
from app.schemas.channel import ManualInboundPayload


logger = logging.getLogger(__name__)


def create_instagram_webhook_router(
    message_handler: Callable[[str, dict[str, str], str | None], dict[str, Any]],
    outbound_handler: Callable[..., dict[str, Any]] | None = None,
    inbound_message_handler: Callable[..., dict[str, Any]] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/webhooks/instagram", tags=["instagram"])

    @router.get("")
    def verify_webhook(request: Request):
        mode = request.query_params.get("hub.mode", "")
        verify_token = request.query_params.get("hub.verify_token", "")
        challenge = request.query_params.get("hub.challenge", "")
        configured_token = settings.META_VERIFY_TOKEN
        if not configured_token:
            raise HTTPException(status_code=503, detail="Instagram webhook verification is not configured.")
        if mode != "subscribe" or not hmac.compare_digest(verify_token, configured_token):
            raise HTTPException(status_code=403, detail="Instagram webhook verification failed.")
        return PlainTextResponse(challenge)

    @router.post("")
    async def receive_webhook(
        request: Request,
        signature: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    ):
        raw_body = await request.body()
        if len(raw_body) > 1_000_000:
            raise HTTPException(status_code=413, detail="Instagram webhook payload is too large.")
        if not signature or not signature.startswith("sha256="):
            raise HTTPException(status_code=401, detail="Instagram webhook signature is missing.")
        try:
            payload = json.loads(raw_body)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(status_code=400, detail="Instagram webhook payload is invalid.")
        entries = payload.get("entry") if isinstance(payload, dict) else None
        if not isinstance(entries, list) or not entries:
            raise HTTPException(status_code=400, detail="Instagram webhook entries are missing.")

        resolved: dict[str, tuple[dict[str, Any], dict[str, str]]] = {}
        try:
            for entry in entries:
                account_id = str(entry.get("id", "")) if isinstance(entry, dict) else ""
                if not account_id:
                    raise HTTPException(status_code=400, detail="Instagram webhook account is missing.")
                if account_id in resolved:
                    continue
                matches = list_instagram_connections_for_account(account_id)
                if not matches:
                    # Meta dashboard tests use synthetic account IDs; acknowledge without side effects.
                    account_fingerprint = hashlib.sha256(account_id.encode("utf-8")).hexdigest()[:12]
                    logger.warning("Instagram webhook acknowledged without processing: account_fingerprint=%s; entries=%d; object=%s", account_fingerprint, len(entries), payload.get("object", "unknown"))
                    continue
                if len(matches) != 1:
                    raise HTTPException(status_code=409, detail="Instagram webhook account is not uniquely connected.")
                connection = matches[0]
                credentials = get_connection_credentials(connection["business_id"], connection["id"])
                app_secret = credentials.get("app_secret") if credentials else None
                if not app_secret:
                    raise HTTPException(status_code=503, detail="Instagram webhook credentials are unavailable.")
                resolved[account_id] = (connection, credentials)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Could not resolve Instagram webhook account")
            raise HTTPException(status_code=503, detail="Instagram webhook account could not be resolved.")
        # Synthetic Meta dashboard events have no linked account, so no tenant secret is available.
        if not resolved:
            return {"status": "accepted", "processed": 0}

        supplied_signature = signature.removeprefix("sha256=")
        for _, credentials in resolved.values():
            expected_signature = hmac.new(
                credentials["app_secret"].encode("utf-8"), raw_body, hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(supplied_signature, expected_signature):
                raise HTTPException(status_code=401, detail="Instagram webhook signature is invalid.")

        processed = 0
        for entry in entries:
            account_id = str(entry["id"])
            if account_id not in resolved:
                continue
            connection, _ = resolved[account_id]
            if connection.get("status") in {"paused", "disconnected"}:
                logger.warning("Instagram webhook skipped: connection status is inactive")
                continue
            if (connection.get("safe_settings") or {}).get("inbound_enabled") is False:
                logger.warning("Instagram webhook skipped: inbound is disabled")
                continue
            messages = entry.get("messaging", [])
            if not isinstance(messages, list):
                logger.warning("Instagram webhook skipped: messaging field is not a list")
                continue
            logger.warning("Instagram webhook matched account; message_events=%d", len(messages))
            for item in messages:
                if not isinstance(item, dict):
                    continue
                message = item.get("message") or {}
                sender_id = str((item.get("sender") or {}).get("id", ""))
                if sender_id == account_id or message.get("is_echo") is True:
                    continue
                event_id = str(message.get("mid", ""))
                content = message.get("text")
                if not sender_id or not event_id or not isinstance(content, str) or not content.strip():
                    continue
                inbound = ManualInboundPayload(
                    business_id=connection["business_id"],
                    customer_external_id=sender_id,
                    provider_event_id=event_id,
                    content=content,
                )
                result = process_manual_inbound(
                    inbound,
                    None,
                    message_handler,
                    channel_override="instagram",
                    require_identity=False,
                    connection_id=connection["id"],
                    inbound_message_handler=inbound_message_handler,
                    automation_reply_enabled=(
                        (connection.get("safe_settings") or {}).get("auto_reply_enabled") is True
                    ),
                )
                logger.warning("Instagram inbound event outcome: %s", result.get("status", "unknown"))
                if (
                    result.get("status") == "processed"
                    and result.get("ai_message")
                    and outbound_handler
                    and (connection.get("safe_settings") or {}).get("auto_reply_enabled") is True
                ):
                    try:
                        delivery = outbound_handler(
                            connection=connection,
                            credentials=resolved[account_id][1],
                            conversation={
                                "id": result["conversation_id"],
                                "business_id": connection["business_id"],
                                "business_connection_id": connection["id"],
                                "customer_external_id": sender_id,
                            },
                            message=result["ai_message"],
                            recipient_id=sender_id,
                            require_auto_reply=True,
                        )
                        logger.warning("Instagram AI outbound status: %s", delivery.get("status", "unknown"))
                        delivery_status = str(delivery.get("status") or "unknown")
                        if delivery_status not in {"sent", "rejected", "unknown", "blocked"}:
                            delivery_status = "unknown"
                        try:
                            mark_inbound_delivery_outcome(
                                str(result["ai_message"]["id"]),
                                delivery_status,
                                delivery.get("safe_error_code"),
                            )
                        except Exception:
                            logger.exception("Could not reconcile inbound event with provider delivery ledger")
                    except Exception:
                        # A provider send outcome must not make Meta replay an
                        # already-processed inbound event; the delivery record
                        # is the source for reconciliation and safe retry.
                        logger.exception("Instagram outbound delivery failed after inbound processing")
                        try:
                            mark_inbound_delivery_outcome(
                                str(result["ai_message"]["id"]),
                                "unknown",
                                "provider_result_uncertain",
                            )
                        except Exception:
                            logger.exception("Could not preserve uncertain inbound delivery state")
                processed += 1
        logger.warning("Instagram webhook complete; processed=%d", processed)
        return {"status": "accepted", "processed": processed}

    return router
