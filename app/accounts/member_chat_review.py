from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Callable
from urllib.parse import urljoin
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config.settings import settings
from app.database.client import supabase
from app.directory.identity import trusted_platform_admin

logger = logging.getLogger(__name__)
BUCKET = "member-chat-review-media"
MAX_BYTES = 10 * 1024 * 1024
MIME_SIGNATURES = {
    "image/jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
    "image/png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
}


class ReviewAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worker_id: UUID


class ReviewStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(pattern="^(under_review|reviewed)$")


class MemberReviewReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=2000)
    product_ids: list[UUID] = Field(default_factory=list, max_length=5)

    @field_validator("content")
    @classmethod
    def nonblank_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a reply to the member.")
        return value

    @field_validator("product_ids")
    @classmethod
    def unique_products(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Choose each suggested product only once.")
        return value


def _signed_url(path: str) -> str:
    response = supabase.storage.from_(BUCKET).create_signed_url(path, 300)
    url = response.get("signedURL") or response.get("signedUrl") or response.get("signed_url")
    if not url:
        raise RuntimeError("Storage did not return a signed URL")
    if url.startswith("/"):
        url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", url.lstrip("/"))
    return url


def create_member_chat_review_router(
    require_verified_member: Callable[[str | None], str],
    require_active_worker: Callable[[str | None], str],
) -> APIRouter:
    router = APIRouter(tags=["member-chat-review"])

    def owned_conversation(conversation_id: UUID, member_id: str) -> None:
        result = (supabase.table("member_conversations").select("id,retention_hold")
            .eq("id", str(conversation_id)).eq("member_id", member_id).maybe_single().execute())
        conversation = result.data if result is not None else None
        if not conversation:
            raise HTTPException(status_code=404, detail="Chat not found.")
        if conversation.get("retention_hold"):
            raise HTTPException(status_code=409, detail="This chat is read-only because it is linked to a sourcing request.")

    @router.post("/members/conversations/{conversation_id}/review-media", status_code=201)
    async def submit_review_media(
        conversation_id: UUID,
        request: Request,
        consent: bool = Query(default=False),
        filename: str = Query(default="photo", max_length=255),
        authorization: str | None = Header(default=None),
    ):
        member_id = require_verified_member(authorization)
        if not consent:
            raise HTTPException(status_code=422, detail="Confirm that you want to send this photo for FayFort human review.")
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        signature_check = MIME_SIGNATURES.get(content_type)
        if not signature_check:
            raise HTTPException(status_code=415, detail="Upload one JPEG, PNG, or WebP image.")
        if request.headers.get("content-length"):
            try:
                if int(request.headers["content-length"]) > MAX_BYTES:
                    raise HTTPException(status_code=413, detail="Photos must be 10 MiB or smaller.")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid upload size.") from exc
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise HTTPException(status_code=413, detail="Photos must be 10 MiB or smaller.")
        if not content:
            raise HTTPException(status_code=422, detail="Choose a photo before sending it for review.")
        if not signature_check(content):
            raise HTTPException(status_code=415, detail="The image content does not match its declared type.")

        try:
            owned_conversation(conversation_id, member_id)
            review_data = (supabase.table("member_chat_reviews").insert({
                "conversation_id": str(conversation_id), "member_id": member_id,
                "status": "pending_assignment",
            }).execute().data or [])
            review = review_data[0] if review_data else None
            if not review:
                raise RuntimeError("Review queue insert returned no record")
            safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", filename.replace("\\", "/").split("/")[-1])[:255].strip(" .") or "photo"
            storage_path = f"{review['id']}/{uuid4()}/{safe_name}"
            try:
                supabase.storage.from_(BUCKET).upload(storage_path, bytes(content), {
                    "content-type": content_type, "upsert": "false",
                })
                media_data = (supabase.table("member_chat_review_media").insert({
                    "review_id": review["id"], "storage_path": storage_path,
                    "content_type": content_type, "byte_size": len(content),
                    "original_filename": safe_name,
                    "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
                }).execute().data or [])
                if not media_data:
                    raise RuntimeError("Review media insert returned no record")
            except Exception:
                try:
                    supabase.storage.from_(BUCKET).remove([storage_path])
                finally:
                    supabase.table("member_chat_reviews").delete().eq("id", review["id"]).execute()
                raise
            try:
                from app.accounts import operations_flow  # a person picks it up from the Operations queue
                operations_flow.open_photo_review({**review, "member_id": member_id, "conversation_id": str(conversation_id)})
            except Exception:
                logger.exception("Could not open the photo review in Operations")
            return {"review": {"id": review["id"], "status": "pending_assignment",
                "created_at": review.get("created_at"), "media": {"content_type": content_type,
                "byte_size": len(content), "original_filename": safe_name}}}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not submit member photo review")
            raise HTTPException(status_code=503, detail="The photo could not be sent for human review.") from exc

    @router.get("/members/reviews")
    def member_reviews(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            rows = (supabase.table("member_chat_reviews").select("id,conversation_id,status,created_at,updated_at,reviewed_at")
                .eq("member_id", member_id).order("created_at", desc=True).limit(100).execute().data or [])
            return {"reviews": rows}
        except Exception as exc:
            logger.exception("Could not load member photo reviews")
            raise HTTPException(status_code=503, detail="Photo review status could not be loaded.") from exc

    def queue_rows(worker_id: str | None = None) -> list[dict]:
        query = (supabase.table("member_chat_reviews").select("id,conversation_id,member_id,assigned_worker_id,status,created_at,updated_at")
            .order("created_at").limit(200))
        if worker_id:
            query = query.eq("assigned_worker_id", worker_id)
        reviews = query.execute().data or []
        ids = [row["id"] for row in reviews]
        if not ids:
            return []
        media_rows = (supabase.table("member_chat_review_media")
            .select("id,review_id,content_type,byte_size,original_filename,expires_at")
            .in_("review_id", ids).order("created_at").execute().data or [])
        by_review: dict[str, list[dict]] = {}
        for row in media_rows:
            by_review.setdefault(row["review_id"], []).append({**row,
                "view_path": f"/workers/member-reviews/{row['review_id']}/media/{row['id']}"})
        return [{**review, "media": by_review.get(review["id"], [])} for review in reviews]

    @router.get("/platform/member-reviews")
    def admin_reviews(authorization: str | None = Header(default=None)):
        if not trusted_platform_admin(authorization):
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        try:
            reviews = queue_rows()
            active = (supabase.table("fayfort_workers").select("user_id,status")
                .eq("status", "active").order("created_at").limit(500).execute().data or [])
            workers = []
            for row in active:
                account = supabase.auth.admin.get_user_by_id(row["user_id"])
                user = getattr(account, "user", None)
                workers.append({"user_id": row["user_id"], "email": getattr(user, "email", None)})
            return {"reviews": reviews, "active_workers": workers}
        except Exception as exc:
            logger.exception("Could not load member photo review queue")
            raise HTTPException(status_code=503, detail="The review queue could not be loaded.") from exc

    @router.patch("/platform/member-reviews/{review_id}/assignment")
    def assign_review(review_id: UUID, payload: ReviewAssignment, authorization: str | None = Header(default=None)):
        if not trusted_platform_admin(authorization):
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        try:
            worker = (supabase.table("fayfort_workers").select("user_id,status")
                .eq("user_id", str(payload.worker_id)).maybe_single().execute())
            if not worker or not worker.data or worker.data.get("status") != "active":
                raise HTTPException(status_code=409, detail="Only an active FayFort worker can be assigned.")
            updated = (supabase.table("member_chat_reviews").update({
                "assigned_worker_id": str(payload.worker_id), "status": "assigned",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", str(review_id)).select("id,status,assigned_worker_id").execute().data or [])
            if not updated:
                raise HTTPException(status_code=404, detail="Photo review not found.")
            return {"review": updated[0]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not assign member photo review")
            raise HTTPException(status_code=503, detail="The review could not be assigned.") from exc

    @router.get("/workers/member-reviews")
    def worker_reviews(authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            return {"reviews": queue_rows(worker_id)}
        except Exception as exc:
            logger.exception("Could not load assigned member photo reviews")
            raise HTTPException(status_code=503, detail="Assigned photo reviews could not be loaded.") from exc

    @router.get("/workers/member-reviews/catalog")
    def worker_review_catalog(search: str = Query(default="", max_length=100),
                              authorization: str | None = Header(default=None)):
        require_active_worker(authorization)
        try:
            rows = (supabase.table("directory_products")
                .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
                .eq("active", True).order("name").limit(500).execute().data or [])
            terms = [term for term in search.casefold().split() if len(term) > 1][:8]
            if terms:
                rows = [row for row in rows if all(term in " ".join(
                    str(row.get(key) or "") for key in ("name", "category_ref", "description")
                ).casefold() for term in terms)]
            return {"products": rows[:50]}
        except Exception as exc:
            logger.exception("Could not load active catalog for member review")
            raise HTTPException(status_code=503, detail="The active product catalog could not be loaded.") from exc

    @router.get("/workers/member-reviews/{review_id}/messages")
    def worker_review_messages(review_id: UUID, authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            response = (supabase.table("member_chat_reviews")
                .select("id,conversation_id").eq("id", str(review_id))
                .eq("assigned_worker_id", worker_id).maybe_single().execute())
            review = response.data if response is not None else None
            if not review:
                raise HTTPException(status_code=404, detail="This photo review is not assigned to your worker account.")
            messages = (supabase.table("member_messages")
                .select("id,sender_type,content,related_product_ids,created_at")
                .eq("conversation_id", review["conversation_id"]).order("created_at").limit(200).execute().data or [])
            product_ids = list(dict.fromkeys(
                product_id for message in messages for product_id in message.get("related_product_ids", []) if product_id
            ))
            products = []
            if product_ids:
                products = (supabase.table("directory_products")
                    .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
                    .eq("active", True).in_("id", product_ids).execute().data or [])
            return {"messages": messages, "products": products}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load assigned member chat context")
            raise HTTPException(status_code=503, detail="The member chat context could not be loaded.") from exc

    @router.post("/workers/member-reviews/{review_id}/reply", status_code=201)
    def reply_to_member_review(review_id: UUID, payload: MemberReviewReply,
                               authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            response = (supabase.table("member_chat_reviews")
                .select("id,conversation_id,member_id,status")
                .eq("id", str(review_id)).eq("assigned_worker_id", worker_id).maybe_single().execute())
            review = response.data if response is not None else None
            if not review:
                raise HTTPException(status_code=404, detail="This photo review is not assigned to your worker account.")
            if review.get("status") != "reviewed":
                raise HTTPException(status_code=409, detail="Mark the photo review complete before replying to the member.")

            product_ids = [str(product_id) for product_id in payload.product_ids]
            products = []
            if product_ids:
                products = (supabase.table("directory_products")
                    .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
                    .eq("active", True).in_("id", product_ids).execute().data or [])
                if {str(item["id"]) for item in products} != set(product_ids):
                    raise HTTPException(status_code=409, detail="A selected product is no longer active; refresh the catalog.")
                products.sort(key=lambda item: product_ids.index(str(item["id"])))

            inserted = (supabase.table("member_messages").insert({
                "conversation_id": review["conversation_id"],
                "sender_type": "worker",
                "actor_user_id": worker_id,
                "content": payload.content,
                "related_product_ids": product_ids,
            }).execute().data or [])
            message = inserted[0] if inserted else None
            if not message:
                raise RuntimeError("Worker reply insert returned no message")
            try:
                from app.accounts import operations_flow
                operations_flow.close_item("photo_review", str(review_id), reason="Reply sent to the member.")
            except Exception:
                logger.exception("Could not close the photo review work item")
            return {"message": {key: message.get(key) for key in
                    ("id", "sender_type", "content", "related_product_ids", "created_at")},
                    "products": products}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not send human review reply")
            raise HTTPException(status_code=503, detail="The reply could not be sent to the member.") from exc

    @router.patch("/workers/member-reviews/{review_id}")
    def update_review(review_id: UUID, payload: ReviewStatus, authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        now = datetime.now(timezone.utc)
        values = {"status": payload.status, "updated_at": now.isoformat()}
        if payload.status == "reviewed":
            values["reviewed_at"] = now.isoformat()
        try:
            updated = (supabase.table("member_chat_reviews").update(values)
                .eq("id", str(review_id)).eq("assigned_worker_id", worker_id)
                .in_("status", ["assigned", "under_review"]).select("id,status,reviewed_at").execute().data or [])
            if not updated:
                raise HTTPException(status_code=404, detail="This photo review is not assigned to your worker account.")
            if payload.status == "reviewed":
                expiry = (now + timedelta(days=30)).isoformat()
                supabase.table("member_chat_review_media").update({"expires_at": expiry}).eq("review_id", str(review_id)).execute()
            return {"review": updated[0]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not update member photo review")
            raise HTTPException(status_code=503, detail="The review status could not be updated.") from exc

    @router.get("/workers/member-reviews/{review_id}/media/{media_id}")
    def worker_review_media(review_id: UUID, media_id: UUID, authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            media = (supabase.table("member_chat_review_media").select("storage_path")
                .eq("id", str(media_id)).eq("review_id", str(review_id)).maybe_single().execute())
            review = (supabase.table("member_chat_reviews").select("id")
                .eq("id", str(review_id)).eq("assigned_worker_id", worker_id).maybe_single().execute())
            if not media or not media.data or not review or not review.data:
                raise HTTPException(status_code=404, detail="This photo is not assigned to your worker account.")
            return {"url": _signed_url(media.data["storage_path"])}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not authorize member review photo")
            raise HTTPException(status_code=503, detail="The review photo could not be opened.") from exc

    @router.get("/platform/member-reviews/{review_id}/media/{media_id}")
    def admin_review_media(review_id: UUID, media_id: UUID, authorization: str | None = Header(default=None)):
        if not trusted_platform_admin(authorization):
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        try:
            media = (supabase.table("member_chat_review_media").select("storage_path")
                .eq("id", str(media_id)).eq("review_id", str(review_id)).maybe_single().execute())
            if not media or not media.data:
                raise HTTPException(status_code=404, detail="Review photo not found.")
            return {"url": _signed_url(media.data["storage_path"])}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not open member review photo as admin")
            raise HTTPException(status_code=503, detail="The review photo could not be opened.") from exc

    return router
