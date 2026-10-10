from __future__ import annotations

import logging
import re
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.database.client import supabase
from app.directory.identity import trusted_platform_admin, trusted_user_id
from app.config.settings import settings

logger = logging.getLogger(__name__)
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class WorkerInvite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if not _EMAIL.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


class MemberPurchaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_title: str = Field(min_length=1, max_length=160)
    request_description: str | None = Field(default=None, max_length=2000)
    product_id: str | None = Field(default=None, min_length=36, max_length=36)

    @field_validator("request_title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a request title.")
        return value


class RequestMilestone(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: str = Field(min_length=1, max_length=40)
    member_note: str | None = Field(default=None, max_length=1000)


class RequestAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worker_id: str | None = Field(default=None, min_length=36, max_length=36)


def create_accounts_router() -> APIRouter:
    router = APIRouter(tags=["accounts"])

    def require_verified_member(authorization: str | None) -> str:
        user_id = trusted_user_id(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="A valid signed-in member is required.")
        token = authorization.partition(" ")[2].strip() if authorization else ""
        try:
            auth_response = supabase.auth.get_user(token)
            user = getattr(auth_response, "user", None)
            if not user or getattr(user, "email_confirmed_at", None) is None:
                raise HTTPException(status_code=403, detail="Verify your email before using your member account.")
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not verify member email")
            raise HTTPException(status_code=503, detail="Member access could not be verified.") from exc
        return user_id

    def require_active_worker(authorization: str | None) -> str:
        user_id = trusted_user_id(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="A valid signed-in FayFort worker is required.")
        token = authorization.partition(" ")[2].strip() if authorization else ""
        try:
            auth_response = supabase.auth.get_user(token)
            user = getattr(auth_response, "user", None)
            if not user or getattr(user, "email_confirmed_at", None) is None:
                raise HTTPException(status_code=403, detail="Verify your email before using worker tools.")
            response = (supabase.table("fayfort_workers").select("status")
                .eq("user_id", user_id).maybe_single().execute())
            worker = response.data if response is not None else None
            if not worker or worker.get("status") != "active":
                raise HTTPException(status_code=403, detail="An active FayFort worker account is required.")
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not verify FayFort worker access")
            raise HTTPException(status_code=503, detail="Worker access could not be verified.") from exc
        return user_id

    def event_projection(event: dict) -> dict:
        return {"id": event["id"], "sequence_no": event["sequence_no"], "stage": event["stage"],
            "member_note": event.get("member_note"), "created_at": event["created_at"]}

    def load_request_events(requests: list[dict]) -> list[dict]:
        request_ids = [row["id"] for row in requests]
        if not request_ids:
            return []
        result = (supabase.table("member_request_events")
            .select("id,request_id,sequence_no,stage,member_note,created_at")
            .in_("request_id", request_ids).order("sequence_no").execute())
        return result.data or []

    @router.get("/members/me")
    def member_profile(authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            response = (
                supabase.table("member_profiles")
                .select("user_id,display_name,points_balance,rank_level,subrank,created_at")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            if response is None or not response.data:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            return {"profile": response.data}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load member profile")
            raise HTTPException(status_code=503, detail="Member profile could not be loaded.") from exc

    @router.get("/members/products")
    def member_products(
        q: str = Query(default="", max_length=100),
        category_ref: str | None = Query(default=None, max_length=200),
        saved_only: bool = False,
        limit: int = Query(default=60, ge=1, le=100),
        authorization: str | None = Header(default=None),
    ):
        user_id = require_verified_member(authorization)
        try:
            saved_rows = (supabase.table("member_saved_products")
                .select("product_id").eq("member_id", user_id).execute().data or [])
            saved_ids = [str(row["product_id"]) for row in saved_rows]
            products = []
            if not saved_only or saved_ids:
                query = (supabase.table("directory_products")
                    .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
                    .eq("active", True))
                term = q.strip()
                if term:
                    query = query.ilike("name", f"%{term}%")
                if category_ref:
                    query = query.eq("category_ref", category_ref)
                if saved_only:
                    query = query.in_("id", saved_ids)
                products = query.order("name").limit(limit).execute().data or []
            categories = (supabase.table("directory_categories")
                .select("source_ref,category,product_type")
                .order("category").limit(2000).execute().data or [])
            return {"products": products, "saved_product_ids": saved_ids, "categories": categories}
        except Exception as exc:
            logger.exception("Could not load member product catalog")
            raise HTTPException(status_code=503, detail="The product catalog could not be loaded.") from exc

    @router.post("/members/products/{product_id}/saved", status_code=200)
    def save_member_product(product_id: str, authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            product_response = (supabase.table("directory_products").select("id")
                .eq("id", product_id).eq("active", True).maybe_single().execute())
            product = product_response.data if product_response is not None else None
            if not product:
                raise HTTPException(status_code=404, detail="This product is not available to save.")
            saved_response = (supabase.table("member_saved_products").select("product_id")
                .eq("member_id", user_id).eq("product_id", product_id).maybe_single().execute())
            existing = saved_response.data if saved_response is not None else None
            if not existing:
                supabase.table("member_saved_products").insert({
                    "member_id": user_id, "product_id": product_id,
                }).execute()
            return {"product_id": product_id, "saved": True}
        except HTTPException:
            raise
        except Exception as exc:
            # Treat concurrent duplicate saves as successful idempotent requests.
            if "duplicate" in str(exc).casefold() or "unique" in str(exc).casefold():
                return {"product_id": product_id, "saved": True}
            logger.exception("Could not save member product")
            raise HTTPException(status_code=503, detail="This product could not be saved.") from exc

    @router.delete("/members/products/{product_id}/saved")
    def unsave_member_product(product_id: str, authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            (supabase.table("member_saved_products").delete()
                .eq("member_id", user_id).eq("product_id", product_id).execute())
            return {"product_id": product_id, "saved": False}
        except Exception as exc:
            logger.exception("Could not remove member saved product")
            raise HTTPException(status_code=503, detail="This product could not be removed from saved items.") from exc

    @router.get("/members/requests")
    def member_requests(authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            rows = (supabase.table("member_purchase_requests")
                .select("id,product_id,product_name_snapshot,request_title,request_description,created_at,updated_at")
                .eq("member_id", user_id).order("created_at", desc=True).limit(100).execute().data or [])
            events = load_request_events(rows)
            events_by_request: dict[str, list[dict]] = {}
            for event in events:
                events_by_request.setdefault(str(event["request_id"]), []).append(event_projection(event))
            return {"requests": [{**row, "events": events_by_request.get(str(row["id"]), [])} for row in rows]}
        except Exception as exc:
            logger.exception("Could not load member purchasing requests")
            raise HTTPException(status_code=503, detail="Your requests could not be loaded.") from exc

    @router.get("/members/requests/{request_id}")
    def member_request_detail(request_id: UUID, authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            result = (supabase.table("member_purchase_requests")
                .select("id,product_id,product_name_snapshot,request_title,request_description,created_at,updated_at")
                .eq("id", str(request_id)).eq("member_id", user_id).maybe_single().execute())
            row = result.data if result is not None else None
            if not row:
                raise HTTPException(status_code=404, detail="Request not found.")
            events = (supabase.table("member_request_events")
                .select("id,sequence_no,stage,member_note,created_at")
                .eq("request_id", str(request_id)).order("sequence_no").execute().data or [])
            return {"request": {**row, "events": [event_projection(event) for event in events]}}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load member purchasing request")
            raise HTTPException(status_code=503, detail="Your request could not be loaded.") from exc

    @router.post("/members/requests", status_code=201)
    def create_member_request(payload: MemberPurchaseRequest, authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            created = supabase.rpc("create_member_purchase_request", {
                "p_member_id": user_id,
                "p_request_title": payload.request_title,
                "p_request_description": payload.request_description,
                "p_product_id": payload.product_id,
            }).execute()
            request_id = created.data if created is not None else None
            if isinstance(request_id, list):
                request_id = request_id[0] if request_id else None
            if not request_id:
                raise RuntimeError("Request transaction did not return an ID")
            return {"request_id": str(request_id), "stage": "submitted"}
        except Exception as exc:
            message = str(exc).casefold()
            if "product is not available" in message:
                raise HTTPException(status_code=404, detail="This product is no longer available.") from exc
            logger.exception("Could not create member purchasing request")
            raise HTTPException(status_code=503, detail="Your request could not be submitted.") from exc

    @router.get("/workers/requests")
    def assigned_worker_requests(authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            rows = (supabase.table("member_purchase_requests")
                .select("id,request_title,request_description,product_name_snapshot,created_at,updated_at")
                .eq("assigned_worker_id", worker_id).order("created_at").limit(100).execute().data or [])
            events = load_request_events(rows)
            events_by_request: dict[str, list[dict]] = {}
            for event in events:
                events_by_request.setdefault(str(event["request_id"]), []).append(event_projection(event))
            return {"requests": [{**row, "events": events_by_request.get(str(row["id"]), [])} for row in rows]}
        except Exception as exc:
            logger.exception("Could not load worker assigned requests")
            raise HTTPException(status_code=503, detail="Assigned requests could not be loaded.") from exc

    @router.post("/workers/requests/{request_id}/events")
    def append_worker_milestone(request_id: str, payload: RequestMilestone, authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            result = supabase.rpc("append_member_request_milestone", {
                "p_request_id": request_id,
                "p_worker_id": worker_id,
                "p_stage": payload.stage,
                "p_member_note": payload.member_note,
            }).execute()
            return {"request_id": request_id, "stage": payload.stage, "sequence_no": result.data if result else None}
        except Exception as exc:
            message = str(exc).casefold()
            if "request not found" in message or "not assigned" in message:
                raise HTTPException(status_code=404, detail="This request is not assigned to your worker account.") from exc
            if "invalid request stage transition" in message:
                raise HTTPException(status_code=409, detail="That milestone cannot follow the current request stage.") from exc
            logger.exception("Could not append worker request milestone")
            raise HTTPException(status_code=503, detail="The request milestone could not be saved.") from exc

    @router.patch("/platform/requests/{request_id}/assignment")
    def assign_request_worker(request_id: str, payload: RequestAssignment, authorization: str | None = Header(default=None)):
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        try:
            if payload.worker_id:
                worker_response = (supabase.table("fayfort_workers").select("user_id,status")
                    .eq("user_id", payload.worker_id).maybe_single().execute())
                worker = worker_response.data if worker_response is not None else None
                if not worker or worker.get("status") != "active":
                    raise HTTPException(status_code=409, detail="Only an active FayFort worker can be assigned.")
            result = (supabase.table("member_purchase_requests")
                .update({"assigned_worker_id": payload.worker_id})
                .eq("id", request_id).execute())
            if not result.data:
                raise HTTPException(status_code=404, detail="Request not found.")
            return {"request_id": request_id, "assigned_worker_id": payload.worker_id}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not assign request to worker")
            raise HTTPException(status_code=503, detail="The request assignment could not be saved.") from exc

    @router.get("/platform/requests")
    def platform_requests(authorization: str | None = Header(default=None)):
        if not trusted_platform_admin(authorization):
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        try:
            rows = (supabase.table("member_purchase_requests")
                .select("id,request_title,product_name_snapshot,created_at,assigned_worker_id")
                .order("created_at", desc=True).limit(200).execute().data or [])
            active = (supabase.table("fayfort_workers").select("user_id")
                .eq("status", "active").order("created_at").limit(500).execute().data or [])
            workers = []
            for worker in active:
                user_response = supabase.auth.admin.get_user_by_id(worker["user_id"])
                user = getattr(user_response, "user", None)
                workers.append({"user_id": worker["user_id"], "email": getattr(user, "email", None)})
            return {"requests": rows, "active_workers": workers}
        except Exception as exc:
            logger.exception("Could not load platform request assignment queue")
            raise HTTPException(status_code=503, detail="The request assignment queue could not be loaded.") from exc

    @router.post("/platform/workers", status_code=201)
    def invite_worker(
        payload: WorkerInvite,
        authorization: str | None = Header(default=None),
    ):
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        user_id = None
        try:
            invited = supabase.auth.admin.invite_user_by_email(
                payload.email,
                options={"redirect_to": settings.WORKER_INVITE_REDIRECT_URL},
            )
            user = getattr(invited, "user", None)
            user_id = getattr(user, "id", None)
            if not user_id:
                raise RuntimeError("The invitation did not return an account identity.")
            supabase.table("fayfort_workers").insert({
                "user_id": str(user_id),
                "status": "invited",
                "provisioned_by": admin["user_id"],
            }).execute()
            return {"worker": {"user_id": str(user_id), "email": payload.email, "status": "invited", "invitation_sent": True}}
        except HTTPException:
            raise
        except Exception as exc:
            # Avoid leaving an invited Auth identity without its workforce grant.
            if user_id:
                try:
                    supabase.auth.admin.delete_user(str(user_id))
                except Exception:
                    logger.exception("Could not roll back incomplete worker invitation")
            logger.info("Worker provisioning failed", exc_info=True)
            message = str(exc).casefold()
            if "already" in message or "exists" in message or "duplicate" in message:
                raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
            raise HTTPException(status_code=503, detail="Worker invitation could not be completed.") from exc

    @router.get("/workers/me")
    def worker_profile(authorization: str | None = Header(default=None)):
        user_id = trusted_user_id(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="A valid signed-in FayFort worker is required.")
        try:
            access_token = authorization.partition(" ")[2].strip() if authorization else ""
            auth_response = supabase.auth.get_user(access_token)
            user = getattr(auth_response, "user", None)
            if not user or getattr(user, "email_confirmed_at", None) is None:
                raise HTTPException(status_code=403, detail="Verify your email before using your FayFort worker account.")
            response = (
                supabase.table("fayfort_workers")
                .select("status,created_at")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            if response is None or not response.data:
                raise HTTPException(status_code=404, detail="This account is not provisioned as a FayFort worker.")
            return {"worker": response.data}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load FayFort worker account")
            raise HTTPException(status_code=503, detail="FayFort worker account could not be loaded.") from exc

    return router
