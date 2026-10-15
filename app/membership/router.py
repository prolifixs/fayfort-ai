"""Member plan API: plan summary, consultations, the supplier directory and contact credits."""
from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.commerce import shopify
from app.commerce.member_router import _Limiter, verified_member
from app.membership import directory, plans, service

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
