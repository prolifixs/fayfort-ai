"""Member plan API: plan summary, consultations, the supplier directory and contact credits."""
from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.commerce import shopify
from app.commerce.member_router import _Limiter, verified_member
from app.config.settings import settings
from app.directory.identity import trusted_platform_admin
from app.membership import directory, landed, plans, ranks, service

logger = logging.getLogger(__name__)

RecordType = Literal["market", "service_provider", "hotel", "restaurant"]


class ConsultationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topic: str = Field(min_length=3, max_length=1000)

    @field_validator("topic")
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Tell us briefly what you'd like to discuss.")
        return value


class UnlockInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    record_type: RecordType
    record_id: UUID


class RedeemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reward: Literal["contact_credit"]


class LandedClaimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order_name: str = Field(min_length=1, max_length=40)
    email: str = Field(min_length=3, max_length=320)


class LandedSendInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["notice", "reminder"]
    dry_run: bool = True
    limit: int = Field(default=landed.DAILY_SEND_LIMIT, ge=1, le=landed.DAILY_SEND_LIMIT)


class LandedSyncInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    since: str = Field(default="2025-01-01", pattern=r"^\d{4}-\d{2}-\d{2}$")


class CreditInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pack: Literal["single", "pack5"]


def _fail(message: str, exc: Exception) -> HTTPException:
    logger.exception(message)
    return HTTPException(status_code=503, detail=message)


def _invoice_failure(exc: Exception, message: str) -> HTTPException:
    if isinstance(exc, ValueError):  # e.g. no confirmed email
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, shopify.ShopifyError):
        logger.warning("Shopify invoice failed: %s", exc)
        return HTTPException(status_code=502, detail="Payment link could not be created. Try again shortly.")
    return _fail(message, exc)


def _require_payments() -> None:
    if not shopify.admin_configured():
        raise HTTPException(status_code=409, detail="Payments aren't set up yet. Please try again later.")


def create_membership_router() -> APIRouter:
    router = APIRouter(tags=["membership"])
    writes = _Limiter(20)

    @router.get("/members/plan")
    def plan(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return plans.plan_summary(member_id)
        except Exception as exc:
            raise _fail("Your plan could not be loaded.", exc) from exc

    # ---- rank and points ---------------------------------------------------------------------
    @router.get("/members/rank")
    def rank(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return ranks.status(member_id)
        except Exception as exc:
            raise _fail("Your rank could not be loaded.", exc) from exc

    @router.post("/members/points/redeem")
    def redeem(payload: RedeemInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        try:
            return ranks.redeem(member_id, payload.reward)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            raise _fail("Your points could not be spent.", exc) from exc

    # ---- consultations -----------------------------------------------------------------------
    @router.get("/members/consultations")
    def consultations(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return {"consultations": service.list_consultations(member_id),
                    "quote": plans.consultation_quote(member_id)}
        except Exception as exc:
            raise _fail("Your consultations could not be loaded.", exc) from exc

    @router.post("/members/consultations", status_code=201)
    def book(payload: ConsultationInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        if plans.consultation_quote(member_id)["price"] > 0:
            _require_payments()
        try:
            return {"consultation": service.book_consultation(member_id, payload.topic)}
        except Exception as exc:
            raise _invoice_failure(exc, "Your consultation could not be booked.") from exc

    # ---- LANDED owners (app/membership/landed.py) ----------------------------------------------
    claims = _Limiter(5)

    @router.get("/members/landed")
    def landed_status(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return landed.status(member_id)
        except Exception as exc:
            raise _fail("Your LANDED access could not be checked.", exc) from exc

    @router.post("/members/landed/claim")
    def landed_claim(payload: LandedClaimInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        claims.check(member_id)
        try:
            return landed.claim(member_id, payload.order_name, payload.email)
        except landed.LandedError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        except Exception as exc:
            raise _fail("Your LANDED access could not be claimed.", exc) from exc

    def _admin(authorization: str | None) -> dict:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin

    @router.get("/platform/landed")
    def landed_summary(authorization: str | None = Header(default=None)):
        _admin(authorization)
        try:
            return landed.summary()
        except Exception as exc:
            raise _fail("LANDED buyers could not be loaded.", exc) from exc

    @router.post("/platform/landed/sync")
    def landed_sync(payload: LandedSyncInput, authorization: str | None = Header(default=None)):
        _admin(authorization)
        if not shopify.admin_configured():
            raise HTTPException(status_code=409, detail="Shopify isn't connected.")
        try:
            return {**landed.sync_from_shopify(payload.since + "T00:00:00Z"), "summary": landed.summary()}
        except shopify.ShopifyError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:
            raise _fail("LANDED buyers could not be read from Shopify.", exc) from exc

    @router.post("/platform/landed/send")
    def landed_send(payload: LandedSendInput, authorization: str | None = Header(default=None)):
        admin = _admin(authorization)
        try:
            result = landed.send_notices(payload.kind, app_url=settings.APP_PUBLIC_URL, dry_run=payload.dry_run,
                                         limit=payload.limit)
        except landed.LandedError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        except Exception as exc:
            raise _fail("LANDED emails could not be queued.", exc) from exc
        if not payload.dry_run:
            logger.info("LANDED %s emails queued by %s: %s", payload.kind, admin.get("user_id"), result.get("queued"))
        return result

    # ---- supplier directory ------------------------------------------------------------------
    @router.get("/members/directory")
    def search(authorization: str | None = Header(default=None), type: RecordType = "market",
               q: str = Query(default="", max_length=100)):
        member_id = verified_member(authorization)
        try:
            return {"results": directory.search(member_id, type, q), "contacts": plans.contact_status(member_id)}
        except Exception as exc:
            raise _fail("The directory could not be searched.", exc) from exc

    @router.get("/members/directory/unlocked")
    def my_contacts(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return {"results": directory.unlocked(member_id), "contacts": plans.contact_status(member_id)}
        except Exception as exc:
            raise _fail("Your contacts could not be loaded.", exc) from exc

    @router.post("/members/directory/unlock")
    def unlock(payload: UnlockInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        try:
            return {"record": directory.unlock(member_id, payload.record_type, str(payload.record_id))}
        except directory.DirectoryError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
        except Exception as exc:
            raise _fail("That contact could not be unlocked.", exc) from exc

    @router.post("/members/contact-credits", status_code=201)
    def buy_credits(payload: CreditInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        writes.check(member_id)
        _require_payments()
        try:
            invoice = service.buy_contact_credits(member_id, payload.pack)
        except service.MembershipError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            raise _invoice_failure(exc, "The payment link could not be created.") from exc
        return {"invoice": {k: invoice.get(k) for k in ("id", "invoice_url", "amount", "currency", "status")}}

    return router
