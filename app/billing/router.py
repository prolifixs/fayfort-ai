"""Member plan billing API: subscribe (Stripe Checkout), manage (customer portal), pause/resume, the Stripe webhook,
and the Control Center status/setup."""
from __future__ import annotations

import json
import logging
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.billing import service, stripe_api
from app.commerce.member_router import _Limiter, verified_member
from app.directory.identity import trusted_platform_admin

logger = logging.getLogger(__name__)


class CheckoutInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: Literal["standard", "pro"]
    interval: Literal["month", "year"] = "month"


class PauseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    months: int = Field(ge=1, le=12)


class MoveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dry_run: bool = True


def _member_call(action, message: str):
    try:
        return action()
    except service.BillingError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except stripe_api.StripeError as exc:
        logger.warning("Stripe call failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payments couldn't be reached. Please try again shortly.") from exc
    except Exception as exc:
        logger.exception(message)
        raise HTTPException(status_code=503, detail=message) from exc


def create_billing_router() -> APIRouter:
    router = APIRouter(tags=["billing"])
    writes = _Limiter(10)

    def require_billing() -> None:
        if not stripe_api.configured():
            raise HTTPException(status_code=409, detail="Plan upgrades aren't open yet. Please try again later.")

    # ---- members -----------------------------------------------------------------------------
    @router.get("/members/subscription")
    def subscription(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        return _member_call(lambda: service.member_view(member_id), "Your subscription could not be loaded.")

    @router.post("/members/subscription/checkout")
    def checkout(payload: CheckoutInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        require_billing()
        return {"url": _member_call(lambda: service.start_checkout(member_id, payload.plan, payload.interval),
                                    "Checkout could not be started.")}

    @router.post("/members/subscription/portal")
    def portal(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        require_billing()
        return {"url": _member_call(lambda: service.portal_url(member_id), "Subscription settings could not be opened.")}

    @router.post("/members/subscription/pause")
    def pause(payload: PauseInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        require_billing()
        return _member_call(lambda: service.pause(member_id, payload.months), "Your plan could not be paused.")

    @router.post("/members/subscription/resume")
    def resume(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        require_billing()
        return _member_call(lambda: service.resume(member_id), "Your plan could not be resumed.")

    # ---- Stripe webhook ----------------------------------------------------------------------
    @router.post(service.WEBHOOK_PATH)
    async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None)):
        raw = await request.body()
        secret = service.webhook_secret()
        if not secret or not stripe_api.verify_signature(raw, stripe_signature, secret):
            raise HTTPException(status_code=400, detail="Invalid signature.")
        try:
            event = json.loads(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid payload.") from exc
        try:
            result = service.handle_event(event)
        except Exception as exc:
            logger.exception("Stripe webhook %s failed", event.get("type"))
            raise HTTPException(status_code=500, detail="Webhook processing failed.") from exc  # Stripe retries
        return {"ok": True, "result": result}

    # ---- Control Center ----------------------------------------------------------------------
    def require_admin(authorization: str | None) -> str:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin["user_id"]

    @router.get("/platform/billing/status")
    def billing_status(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return service.status()
        except Exception as exc:
            logger.exception("Billing status failed")
            raise HTTPException(status_code=503, detail="Billing status could not be loaded.") from exc

    @router.post("/platform/billing/setup")
    def billing_setup(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        if not stripe_api.configured():
            raise HTTPException(status_code=409, detail="Add STRIPE_SECRET_KEY to the API server first.")
        try:
            result = service.ensure_setup()
            service.reconcile()
            return result
        except Exception as exc:
            logger.exception("Billing setup failed")
            raise HTTPException(status_code=503, detail=f"Stripe setup failed: {exc}") from exc

    @router.post("/platform/billing/move-to-current-prices")
    def move_prices(payload: MoveInput, authorization: str | None = Header(default=None)):
        """After a price change: move subscribers still on an old price to the current one at their next renewal."""
        require_admin(authorization)
        if not stripe_api.configured():
            raise HTTPException(status_code=409, detail="Stripe isn't connected.")
        try:
            return service.move_to_current_prices(dry_run=payload.dry_run)
        except stripe_api.StripeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return router
