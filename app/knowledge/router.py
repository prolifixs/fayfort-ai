from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.database.business_faqs import (
    create_business_faq_version,
    get_business_faq,
    list_business_faq_events,
    list_business_faqs,
    review_business_faq,
)
from app.directory.identity import trusted_business_member
from app.services.faq_matching import normalize_faq_question


class BusinessFaqDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1, max_length=3000)

    @field_validator("question", "answer")
    @classmethod
    def require_nonblank_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Text cannot be blank.")
        return normalized


class BusinessFaqReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "archive"]


def create_business_faq_router() -> APIRouter:
    router = APIRouter(tags=["business-faqs"])

    def authorize(business_id: str, authorization: str | None) -> dict:
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        return member

    def authorize_admin(business_id: str, authorization: str | None) -> dict:
        member = authorize(business_id, authorization)
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required to manage FAQs.")
        return member

    def normalize_rpc_result(result: dict | None) -> dict:
        if not isinstance(result, dict):
            raise HTTPException(status_code=503, detail="FAQ workflow is unavailable.")
        if result.get("error") == "not_found":
            raise HTTPException(status_code=404, detail="FAQ not found in this business.")
        return result

    @router.get("/businesses/{business_id}/faqs")
    def business_faqs(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            return {"business_id": business_id, "faqs": list_business_faqs(business_id)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Business FAQs could not be loaded.") from exc

    @router.get("/businesses/{business_id}/faqs/{faq_id}/events")
    def faq_events(
        business_id: str,
        faq_id: str,
        authorization: str | None = Header(default=None),
    ):
        authorize(business_id, authorization)
        try:
            if get_business_faq(business_id, faq_id) is None:
                raise HTTPException(status_code=404, detail="FAQ not found in this business.")
            return {"business_id": business_id, "faq_id": faq_id, "events": list_business_faq_events(business_id, faq_id)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail="FAQ review history could not be loaded.") from exc

    @router.post("/businesses/{business_id}/faqs", status_code=201)
    def create_faq(
        business_id: str,
        payload: BusinessFaqDraft,
        authorization: str | None = Header(default=None),
    ):
        member = authorize_admin(business_id, authorization)
        question_key = normalize_faq_question(payload.question)
        if not question_key:
            raise HTTPException(status_code=422, detail="Provide a question containing letters or numbers.")
        try:
            result = create_business_faq_version(
                faq_id=None,
                business_id=business_id,
                actor_id=member["user_id"],
                question=payload.question,
                question_key=question_key,
                answer=payload.answer,
            )
            return {"faq": normalize_rpc_result(result)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail="FAQ draft could not be saved.") from exc

    @router.post("/businesses/{business_id}/faqs/{faq_id}/revisions", status_code=201)
    def revise_faq(
        business_id: str,
        faq_id: str,
        payload: BusinessFaqDraft,
        authorization: str | None = Header(default=None),
    ):
        member = authorize_admin(business_id, authorization)
        question_key = normalize_faq_question(payload.question)
        if not question_key:
            raise HTTPException(status_code=422, detail="Provide a question containing letters or numbers.")
        try:
            result = create_business_faq_version(
                faq_id=faq_id,
                business_id=business_id,
                actor_id=member["user_id"],
                question=payload.question,
                question_key=question_key,
                answer=payload.answer,
            )
            return {"faq": normalize_rpc_result(result)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail="FAQ revision could not be saved.") from exc

    @router.post("/businesses/{business_id}/faqs/{faq_id}/review")
    def review_faq(
        business_id: str,
        faq_id: str,
        payload: BusinessFaqReview,
        authorization: str | None = Header(default=None),
    ):
        member = authorize_admin(business_id, authorization)
        try:
            result = review_business_faq(
                faq_id=faq_id,
                business_id=business_id,
                actor_id=member["user_id"],
                decision=payload.decision,
            )
            return {"faq": normalize_rpc_result(result)}
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc)
            if "business_faqs_approved_question" in message or "idx_business_faqs_approved_question" in message:
                raise HTTPException(status_code=409, detail="An approved FAQ already answers that exact question.") from exc
            raise HTTPException(status_code=503, detail="FAQ review could not be saved.") from exc

    return router
