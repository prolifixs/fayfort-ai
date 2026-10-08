from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from app.channels.manual import ManualChannelAuthorizationError, process_manual_inbound
from app.schemas.channel import ManualInboundPayload


logger = logging.getLogger(__name__)


def create_manual_channel_router(
    message_handler: Callable[[str, dict[str, str], str | None], dict[str, Any]],
) -> APIRouter:
    router = APIRouter(prefix="/channels", tags=["channels"])

    @router.post("/manual/inbound")
    def receive_manual_inbound(
        payload: ManualInboundPayload,
        authorization: str | None = Header(default=None),
    ):
        try:
            return process_manual_inbound(payload, authorization, message_handler)
        except ManualChannelAuthorizationError:
            raise HTTPException(
                status_code=401,
                detail="A valid signed-in business member is required.",
            )
        except Exception:
            logger.exception("Manual inbound event could not be processed")
            raise HTTPException(
                status_code=503,
                detail="The inbound event could not be completed. Check its recorded status before retrying.",
            )

    return router