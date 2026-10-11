from __future__ import annotations

import logging
import re
from pathlib import PurePath
from typing import Literal
from uuid import UUID, uuid4
from urllib.parse import urljoin, urlsplit

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.database.client import supabase
from app.directory.identity import trusted_platform_admin, trusted_user_id
from app.config.settings import settings
from app.accounts.member_chat import create_member_chat_router
from app.accounts.member_chat_review import create_member_chat_review_router
from app.accounts.member_notifications import create_member_notifications_router
from app.accounts.member_theme_admin import create_member_theme_admin_router
from app.accounts.member_profile_photo import create_member_profile_photo_router, _signed_url as signed_member_photo_url

logger = logging.getLogger(__name__)
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_REQUEST_MEDIA_BUCKET = "member-request-evidence"
_REQUEST_MEDIA_MAX_BYTES = 100 * 1024 * 1024
_REQUEST_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"}
_REQUEST_SOURCE_BUCKET = "member-request-source-images"
_REQUEST_SOURCE_MAX_BYTES = 10 * 1024 * 1024
_BASE_MEMBER_THEME = {
    "theme_id": "base",
    "display_name": "FayFort base",
    "design": {
        "palette_preset": "ocean-blue",
        "wrapper_style": "soft",
        "colors": {
            "page_background": "#FFFFFF", "surface": "#F7F9FA", "text": "#17212B",
            "muted_text": "#526170", "accent": "#005A9C", "accent_foreground": "#FFFFFF",
            "border": "#637180", "focus": "#005A9C",
        },
    },
}


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
    product_id: UUID | None = None
    conversation_id: UUID | None = None
    source_type: Literal["saved_product", "catalog_product", "url", "image", "description"] | None = None
    source_url: str | None = Field(default=None, max_length=2000)

    @field_validator("request_title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a request title.")
        return value

    @model_validator(mode="after")
    def validate_source(self) -> "MemberPurchaseRequest":
        if self.source_type is None:
            self.source_type = "catalog_product" if self.product_id else "description"
        if self.source_type in {"saved_product", "catalog_product"}:
            if self.product_id is None or self.source_url is not None:
                raise ValueError("Choose a catalog product for this request source.")
        elif self.source_type == "url":
            parsed = urlsplit(self.source_url or "")
            if self.product_id is not None or not self.source_url or re.search(r"\s", self.source_url) or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Enter a valid HTTPS product link.")
        elif self.source_type == "image":
            raise ValueError("Upload the screenshot using the request image endpoint.")
        elif self.product_id is not None or self.source_url is not None:
            raise ValueError("A description request cannot include a product or link.")
        return self


class MemberThemePreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme_id: str = Field(min_length=1, max_length=80)

    @field_validator("theme_id")
    @classmethod
    def available_theme_only(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if normalized != "base" and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", normalized):
            raise ValueError("Theme IDs must use lowercase letters, numbers, and hyphens.")
        return normalized


class MemberShippingDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shipping_phone: str | None = Field(default=None, max_length=40)
    shipping_address_line1: str | None = Field(default=None, max_length=160)
    shipping_address_line2: str | None = Field(default=None, max_length=160)
    shipping_city: str | None = Field(default=None, max_length=100)
    shipping_region: str | None = Field(default=None, max_length=100)
    shipping_postal_code: str | None = Field(default=None, max_length=32)
    shipping_country: str | None = Field(default=None, max_length=100)

    @field_validator("shipping_phone", mode="before")
    @classmethod
    def normalize_shipping_phone(cls, value: object) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            return None
        digits = re.sub(r"\D", "", normalized)
        if not re.fullmatch(r"[+0-9(). -]+", normalized) or not 7 <= len(digits) <= 15:
            raise ValueError("Enter a phone number with 7 to 15 digits.")
        return normalized

    @field_validator(
        "shipping_address_line1", "shipping_address_line2", "shipping_city",
        "shipping_region", "shipping_postal_code", "shipping_country", mode="before",
    )
    @classmethod
    def normalize_shipping_address_text(cls, value: object) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @model_validator(mode="after")
    def require_usable_address(self) -> "MemberShippingDetails":
        parts = (
            self.shipping_address_line1, self.shipping_address_line2, self.shipping_city,
            self.shipping_region, self.shipping_postal_code, self.shipping_country,
        )
        if any(parts) and not (self.shipping_address_line1 and self.shipping_city and self.shipping_country):
            raise ValueError("Complete address line 1, city, and country to save a shipping address.")
        return self


class RequestMilestone(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: str = Field(min_length=1, max_length=40)
    member_note: str | None = Field(default=None, max_length=1000)
    carrier_name: str | None = Field(default=None, max_length=100)
    tracking_number: str | None = Field(default=None, max_length=120)
    tracking_url: str | None = Field(default=None, max_length=2000)


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

    router.include_router(create_member_chat_router(require_verified_member))
    router.include_router(create_member_chat_review_router(require_verified_member, require_active_worker))
    router.include_router(create_member_notifications_router(require_verified_member))
    router.include_router(create_member_profile_photo_router(require_verified_member))
    router.include_router(create_member_theme_admin_router(trusted_platform_admin))

    def event_projection(event: dict) -> dict:
        return {"id": event["id"], "sequence_no": event["sequence_no"], "stage": event["stage"],
            "member_note": event.get("member_note"), "details": event.get("details") or {},
            "media": [], "created_at": event["created_at"]}

    def add_event_media(events_by_request: dict[str, list[dict]]) -> None:
        event_ids = [event["id"] for events in events_by_request.values() for event in events
            if event["stage"] == "item_in_warehouse"]
        if not event_ids:
            return
        rows = (supabase.table("member_request_media")
            .select("id,event_id,storage_path,content_type,byte_size,original_filename,created_at")
            .in_("event_id", event_ids).order("created_at").execute().data or [])
        by_event = {event["id"]: event for events in events_by_request.values() for event in events}
        for row in rows:
            signed = supabase.storage.from_(_REQUEST_MEDIA_BUCKET).create_signed_url(row["storage_path"], 900)
            signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
            if signed_url and signed_url.startswith("/"):
                signed_url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", signed_url.lstrip("/"))
            event = by_event.get(row["event_id"])
            if event and signed_url:
                event["media"].append({"id": row["id"], "url": signed_url,
                    "content_type": row["content_type"], "byte_size": row["byte_size"],
                    "original_filename": row["original_filename"], "created_at": row["created_at"]})

    def add_request_source_media(requests: list[dict]) -> None:
        request_ids = [str(row["id"]) for row in requests]
        for row in requests:
            row["source_media"] = []
        if not request_ids:
            return
        media_rows = (supabase.table("member_request_source_media")
            .select("id,request_id,storage_path,content_type,byte_size,original_filename,created_at")
            .in_("request_id", request_ids).order("created_at").execute().data or [])
        if not isinstance(media_rows, list):
            media_rows = []
        by_request = {str(row["id"]): row for row in requests}
        for media in media_rows:
            signed = supabase.storage.from_(_REQUEST_SOURCE_BUCKET).create_signed_url(media["storage_path"], 900)
            signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
            if signed_url and signed_url.startswith("/"):
                signed_url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", signed_url.lstrip("/"))
            owner = by_request.get(str(media["request_id"]))
            if owner and signed_url:
                owner["source_media"].append({"id": media["id"], "url": signed_url,
                    "content_type": media["content_type"], "byte_size": media["byte_size"],
                    "original_filename": media["original_filename"], "created_at": media["created_at"]})

    def load_request_events(requests: list[dict]) -> list[dict]:
        request_ids = [row["id"] for row in requests]
        if not request_ids:
            return []
        result = (supabase.table("member_request_events")
            .select("id,request_id,sequence_no,stage,member_note,details,created_at")
            .in_("request_id", request_ids).order("sequence_no").execute())
        return result.data or []

    @router.post("/members/requests/image", status_code=201)
    async def create_member_request_with_image(
        request: Request,
        request_title: str = Query(min_length=1, max_length=160),
        request_description: str | None = Query(default=None, max_length=2000),
        filename: str = Query(default="product-screenshot", max_length=255),
        conversation_id: UUID | None = Query(default=None),
        authorization: str | None = Header(default=None),
    ):
        user_id = require_verified_member(authorization)
        request_title = request_title.strip()
        if not request_title:
            raise HTTPException(status_code=422, detail="Enter a request title.")
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        signatures = {"image/jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
            "image/png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/webp": lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"}
        if content_type not in signatures:
            raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, or WebP screenshot.")
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > _REQUEST_SOURCE_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Screenshots must be 10 MiB or smaller.")
        buffer = bytearray()
        async for chunk in request.stream():
            buffer.extend(chunk)
            if len(buffer) > _REQUEST_SOURCE_MAX_BYTES:
                raise HTTPException(status_code=413, detail="Screenshots must be 10 MiB or smaller.")
        content = bytes(buffer)
        if not content:
            raise HTTPException(status_code=422, detail="Choose a screenshot before submitting the request.")
        if not signatures[content_type](content):
            raise HTTPException(status_code=415, detail="The screenshot content does not match its declared image type.")
        raw_name = filename.replace("\\", "/").split("/")[-1]
        safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", raw_name)[:255].strip(" .") or "product-screenshot"
        storage_path = f"{user_id}/{uuid4()}/{safe_name}"
        try:
            supabase.storage.from_(_REQUEST_SOURCE_BUCKET).upload(storage_path, content,
                {"content-type": content_type, "upsert": "false"})
            rpc_parameters = {
                "p_member_id": user_id,
                "p_request_title": request_title,
                "p_request_description": request_description,
                "p_product_id": None,
                "p_source_type": "image",
                "p_source_url": None,
                "p_source_image": {"storage_path": storage_path, "content_type": content_type,
                    "byte_size": len(content), "original_filename": safe_name},
            }
            if conversation_id:
                created = supabase.rpc("create_member_request_from_chat", {
                    "p_conversation_id": str(conversation_id), **rpc_parameters,
                }).execute()
            else:
                created = supabase.rpc("create_member_purchase_request", rpc_parameters).execute()
            request_id = created.data if created is not None else None
            if isinstance(request_id, list):
                request_id = request_id[0] if request_id else None
            if not request_id:
                raise RuntimeError("Request transaction did not return an ID")
            return {"request_id": str(request_id), "stage": "submitted", "source_type": "image"}
        except Exception as exc:
            try:
                supabase.storage.from_(_REQUEST_SOURCE_BUCKET).remove([storage_path])
            except Exception:
                logger.exception("Could not clean up staged member request screenshot")
            message = str(exc).casefold()
            if "member_chat_not_found" in message or "not found" in message:
                raise HTTPException(status_code=404, detail="The linked chat was not found.") from exc
            if "member_chat_already_linked" in message or "already linked" in message:
                raise HTTPException(status_code=409, detail="This chat is already linked to a request.") from exc
            logger.exception("Could not create member request with screenshot")
            raise HTTPException(status_code=503, detail="Your screenshot request could not be submitted.") from exc

    @router.get("/members/me")
    def member_profile(authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            response = (
                supabase.table("member_profiles")
                .select("user_id,display_name,points_balance,rank_level,subrank,member_tier,selected_theme,member_photo_path,shipping_phone,shipping_address_line1,shipping_address_line2,shipping_city,shipping_region,shipping_postal_code,shipping_country,created_at")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            if response is None or not response.data:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            profile = dict(response.data)
            photo_path = profile.pop("member_photo_path", None)
            profile["profile_photo_url"] = signed_member_photo_url(photo_path) if photo_path else None
            return {"profile": profile}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load member profile")
            raise HTTPException(status_code=503, detail="Member profile could not be loaded.") from exc

    @router.patch("/members/me")
    def update_member_shipping_details(
        payload: MemberShippingDetails,
        authorization: str | None = Header(default=None),
    ):
        user_id = require_verified_member(authorization)
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(status_code=422, detail="Provide at least one shipping detail to update.")
        try:
            response = (supabase.table("member_profiles")
                .update(updates)
                .eq("user_id", user_id)
                .select("user_id,display_name,points_balance,rank_level,subrank,member_tier,selected_theme,member_photo_path,shipping_phone,shipping_address_line1,shipping_address_line2,shipping_city,shipping_region,shipping_postal_code,shipping_country,created_at")
                .execute())
            rows = response.data or []
            if not rows:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            profile = dict(rows[0])
            photo_path = profile.pop("member_photo_path", None)
            profile["profile_photo_url"] = signed_member_photo_url(photo_path) if photo_path else None
            return {"profile": profile}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not update member shipping details")
            raise HTTPException(status_code=503, detail="Shipping details could not be saved.") from exc

    @router.get("/members/me/theme")
    def get_member_theme(authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            profile_result = (supabase.table("member_profiles")
                .select("member_tier,selected_theme").eq("user_id", user_id).maybe_single().execute())
            profile = profile_result.data if profile_result else None
            if not profile:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            selected_theme = profile.get("selected_theme") or "base"
            member_tier = profile.get("member_tier") or "free"
            if selected_theme == "base":
                return {"selected_theme": selected_theme, "active_theme": _BASE_MEMBER_THEME, "fallback_reason": None}
            theme_result = (supabase.table("member_themes")
                .select("theme_id,display_name,status,requires_paid,published_revision")
                .eq("theme_id", selected_theme).maybe_single().execute())
            theme = theme_result.data if theme_result else None
            if not theme or theme.get("status") != "published" or not theme.get("published_revision"):
                return {"selected_theme": selected_theme, "active_theme": _BASE_MEMBER_THEME, "fallback_reason": "theme_unavailable"}
            if theme.get("requires_paid") and member_tier not in {"standard", "pro"}:
                return {"selected_theme": selected_theme, "active_theme": _BASE_MEMBER_THEME, "fallback_reason": "plan_ineligible"}
            revision_result = (supabase.table("member_theme_revisions")
                .select("revision,palette_preset,wrapper_style,colors")
                .eq("theme_id", selected_theme).eq("revision", theme["published_revision"]).maybe_single().execute())
            revision = revision_result.data if revision_result else None
            if not revision:
                return {"selected_theme": selected_theme, "active_theme": _BASE_MEMBER_THEME, "fallback_reason": "theme_unavailable"}
            return {"selected_theme": selected_theme, "active_theme": {
                "theme_id": selected_theme,
                "display_name": theme["display_name"],
                "revision": revision["revision"],
                "design": {key: revision[key] for key in ("palette_preset", "wrapper_style", "colors")},
            }, "fallback_reason": None}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not resolve member theme")
            raise HTTPException(status_code=503, detail="Member theme could not be loaded.") from exc

    @router.get("/members/themes")
    def list_member_themes(authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            profile_result = (supabase.table("member_profiles")
                .select("member_tier,selected_theme").eq("user_id", user_id).maybe_single().execute())
            profile = profile_result.data if profile_result else None
            if not profile:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            tier = profile.get("member_tier") or "free"
            themes_result = (supabase.table("member_themes")
                .select("theme_id,display_name,description,status,requires_paid,published_revision")
                .eq("status", "published").order("display_name").execute())
            published = themes_result.data or [] if themes_result else []
            choices = [{
                "theme_id": "base", "display_name": _BASE_MEMBER_THEME["display_name"],
                "description": "FayFort’s standard member theme.", "requires_paid": False,
                "can_apply": True, "is_current": (profile.get("selected_theme") or "base") == "base",
            }]
            for theme in published:
                if not theme.get("published_revision"):
                    continue
                choices.append({
                    "theme_id": theme["theme_id"], "display_name": theme["display_name"],
                    "description": theme.get("description") or "", "requires_paid": bool(theme.get("requires_paid")),
                    "can_apply": not theme.get("requires_paid") or tier in {"standard", "pro"},
                    "is_current": (profile.get("selected_theme") or "base") == theme["theme_id"],
                })
            return {"member_tier": tier, "selected_theme": profile.get("selected_theme") or "base", "themes": choices}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not list member themes")
            raise HTTPException(status_code=503, detail="Member themes could not be loaded.") from exc

    @router.get("/members/themes/{theme_id}/preview")
    def preview_published_member_theme(theme_id: str, authorization: str | None = Header(default=None)):
        require_verified_member(authorization)
        if theme_id == "base":
            return {**_BASE_MEMBER_THEME, "revision": None}
        try:
            theme_result = (supabase.table("member_themes")
                .select("theme_id,display_name,status,published_revision")
                .eq("theme_id", theme_id).maybe_single().execute())
            theme = theme_result.data if theme_result else None
            if not theme or theme.get("status") != "published" or not theme.get("published_revision"):
                raise HTTPException(status_code=404, detail="That published theme is not available to preview.")
            revision_result = (supabase.table("member_theme_revisions")
                .select("revision,palette_preset,wrapper_style,colors")
                .eq("theme_id", theme_id).eq("revision", theme["published_revision"]).maybe_single().execute())
            revision = revision_result.data if revision_result else None
            if not revision:
                raise HTTPException(status_code=404, detail="That published theme is not available to preview.")
            return {"theme_id": theme_id, "display_name": theme["display_name"], "revision": revision["revision"],
                "design": {key: revision[key] for key in ("palette_preset", "wrapper_style", "colors")}}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not preview published member theme")
            raise HTTPException(status_code=503, detail="Theme preview could not be loaded.") from exc

    @router.put("/members/me/theme")
    def set_member_theme(
        payload: MemberThemePreference,
        authorization: str | None = Header(default=None),
    ):
        user_id = require_verified_member(authorization)
        try:
            if payload.theme_id != "base":
                profile_result = (supabase.table("member_profiles")
                    .select("member_tier").eq("user_id", user_id).maybe_single().execute())
                profile = profile_result.data if profile_result else None
                if not profile:
                    raise HTTPException(status_code=404, detail="Member profile is not available yet.")
                theme_result = (supabase.table("member_themes")
                    .select("theme_id,status,requires_paid,published_revision")
                    .eq("theme_id", payload.theme_id).maybe_single().execute())
                theme = theme_result.data if theme_result else None
                if not theme or theme.get("status") != "published" or not theme.get("published_revision"):
                    raise HTTPException(status_code=404, detail="That published theme is not available to apply.")
                if theme.get("requires_paid") and profile.get("member_tier") not in {"standard", "pro"}:
                    raise HTTPException(status_code=403, detail="A Standard or Pro member plan is required to apply this theme.")
            response = (supabase.table("member_profiles")
                .update({"selected_theme": payload.theme_id})
                .eq("user_id", user_id)
                .select("selected_theme")
                .execute())
            rows = response.data or []
            if not rows:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            return {"selected_theme": rows[0]["selected_theme"]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not update member theme preference")
            raise HTTPException(status_code=503, detail="Theme preference could not be saved.") from exc

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
                .select("id,product_id,product_name_snapshot,request_title,request_description,source_type,source_url,created_at,updated_at")
                .eq("member_id", user_id).order("created_at", desc=True).limit(100).execute().data or [])
            add_request_source_media(rows)
            events = load_request_events(rows)
            events_by_request: dict[str, list[dict]] = {}
            for event in events:
                events_by_request.setdefault(str(event["request_id"]), []).append(event_projection(event))
            add_event_media(events_by_request)
            return {"requests": [{**row, "events": events_by_request.get(str(row["id"]), [])} for row in rows]}
        except Exception as exc:
            logger.exception("Could not load member purchasing requests")
            raise HTTPException(status_code=503, detail="Your requests could not be loaded.") from exc

    @router.get("/members/requests/{request_id}")
    def member_request_detail(request_id: UUID, authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            result = (supabase.table("member_purchase_requests")
                .select("id,product_id,product_name_snapshot,request_title,request_description,source_type,source_url,created_at,updated_at")
                .eq("id", str(request_id)).eq("member_id", user_id).maybe_single().execute())
            row = result.data if result is not None else None
            if not row:
                raise HTTPException(status_code=404, detail="Request not found.")
            add_request_source_media([row])
            events = (supabase.table("member_request_events")
                .select("id,request_id,sequence_no,stage,member_note,details,created_at")
                .eq("request_id", str(request_id)).order("sequence_no").execute().data or [])
            projected = [event_projection(event) for event in events]
            by_request = {str(request_id): projected}
            add_event_media(by_request)
            return {"request": {**row, "events": projected}}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load member purchasing request")
            raise HTTPException(status_code=503, detail="Your request could not be loaded.") from exc

    @router.post("/members/requests", status_code=201)
    def create_member_request(payload: MemberPurchaseRequest, authorization: str | None = Header(default=None)):
        user_id = require_verified_member(authorization)
        try:
            rpc_parameters = {
                "p_member_id": user_id,
                "p_request_title": payload.request_title,
                "p_request_description": payload.request_description,
                "p_product_id": str(payload.product_id) if payload.product_id else None,
                "p_source_type": payload.source_type,
                "p_source_url": payload.source_url,
                "p_source_image": None,
            }
            if payload.conversation_id:
                created = supabase.rpc("create_member_request_from_chat", {
                    "p_conversation_id": str(payload.conversation_id),
                    **rpc_parameters,
                }).execute()
            else:
                created = supabase.rpc("create_member_purchase_request", rpc_parameters).execute()
            request_id = created.data if created is not None else None
            if isinstance(request_id, list):
                request_id = request_id[0] if request_id else None
            if not request_id:
                raise RuntimeError("Request transaction did not return an ID")
            return {"request_id": str(request_id), "stage": "submitted"}
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc).casefold()
            if "product is not available" in message:
                raise HTTPException(status_code=404, detail="This product is no longer available.") from exc
            if "product is not saved by this member" in message:
                raise HTTPException(status_code=403, detail="Choose a product from your saved products.") from exc
            logger.exception("Could not create member purchasing request")
            raise HTTPException(status_code=503, detail="Your request could not be submitted.") from exc

    @router.get("/workers/requests")
    def assigned_worker_requests(authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        try:
            rows = (supabase.table("member_purchase_requests")
                .select("id,request_title,request_description,product_id,product_name_snapshot,source_type,source_url,created_at,updated_at")
                .eq("assigned_worker_id", worker_id).order("created_at").limit(100).execute().data or [])
            add_request_source_media(rows)
            events = load_request_events(rows)
            events_by_request: dict[str, list[dict]] = {}
            for event in events:
                events_by_request.setdefault(str(event["request_id"]), []).append(event_projection(event))
            add_event_media(events_by_request)
            return {"requests": [{**row, "events": events_by_request.get(str(row["id"]), [])} for row in rows]}
        except Exception as exc:
            logger.exception("Could not load worker assigned requests")
            raise HTTPException(status_code=503, detail="Assigned requests could not be loaded.") from exc

    @router.post("/workers/requests/{request_id}/events")
    def append_worker_milestone(request_id: UUID, payload: RequestMilestone, authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        if payload.stage == "shipped" and not (payload.tracking_number and payload.tracking_number.strip()):
            raise HTTPException(status_code=422, detail="A tracking number is required before marking this request shipped.")
        if payload.stage != "shipped" and any((payload.carrier_name, payload.tracking_number, payload.tracking_url)):
            raise HTTPException(status_code=422, detail="Shipment details can only be added to a shipped milestone.")
        if payload.tracking_url and not payload.tracking_url.startswith("https://"):
            raise HTTPException(status_code=422, detail="Tracking links must use HTTPS.")
        details = ({"tracking_number": payload.tracking_number.strip(),
            **({"carrier_name": payload.carrier_name.strip()} if payload.carrier_name and payload.carrier_name.strip() else {}),
            **({"tracking_url": payload.tracking_url} if payload.tracking_url else {})}
            if payload.stage == "shipped" else {})
        try:
            result = supabase.rpc("append_member_request_milestone", {
                "p_request_id": str(request_id),
                "p_worker_id": worker_id,
                "p_stage": payload.stage,
                "p_member_note": payload.member_note,
                "p_details": details,
            }).execute()
            return {"request_id": str(request_id), "stage": payload.stage, "sequence_no": result.data if result else None}
        except Exception as exc:
            message = str(exc).casefold()
            if "request not found" in message or "not assigned" in message:
                raise HTTPException(status_code=404, detail="This request is not assigned to your worker account.") from exc
            if "invalid request stage transition" in message:
                raise HTTPException(status_code=409, detail="That milestone cannot follow the current request stage.") from exc
            logger.exception("Could not append worker request milestone")
            raise HTTPException(status_code=503, detail="The request milestone could not be saved.") from exc

    @router.post("/workers/requests/{request_id}/evidence", status_code=201)
    async def upload_request_evidence(request_id: UUID, request: Request,
        filename: str = Query(min_length=1, max_length=255), authorization: str | None = Header(default=None)):
        worker_id = require_active_worker(authorization)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type not in _REQUEST_MEDIA_TYPES:
            raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, WebP, MP4, or WebM file.")
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > _REQUEST_MEDIA_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Evidence files must be 100 MiB or smaller.")
        buffer = bytearray()
        async for chunk in request.stream():
            buffer.extend(chunk)
            if len(buffer) > _REQUEST_MEDIA_MAX_BYTES:
                raise HTTPException(status_code=413, detail="Evidence files must be 100 MiB or smaller.")
        content = bytes(buffer)
        if not content:
            raise HTTPException(status_code=422, detail="Choose a non-empty evidence file.")
        signatures = {"image/jpeg": content.startswith(b"\xff\xd8\xff"),
            "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/webp": len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP",
            "video/mp4": len(content) >= 12 and content[4:8] == b"ftyp",
            "video/webm": content.startswith(b"\x1aE\xdf\xa3")}
        if not signatures.get(content_type, False):
            raise HTTPException(status_code=415, detail="The file content does not match its declared media type.")
        try:
            request_result = (supabase.table("member_purchase_requests")
                .select("id,assigned_worker_id").eq("id", str(request_id)).maybe_single().execute())
            request_row = request_result.data if request_result is not None else None
            if not request_row or request_row.get("assigned_worker_id") != worker_id:
                raise HTTPException(status_code=404, detail="This request is not assigned to your worker account.")
            latest = (supabase.table("member_request_events").select("id,stage")
                .eq("request_id", str(request_id)).order("sequence_no", desc=True).limit(1).maybe_single().execute())
            current_event = latest.data if latest is not None else None
            if not current_event or current_event.get("stage") != "item_in_warehouse":
                raise HTTPException(status_code=409, detail="Evidence can only be uploaded during the item-in-warehouse stage.")
            raw_name = filename.replace("\\", "/").split("/")[-1]
            safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", raw_name)[:255].strip(" .") or "evidence"
            storage_path = f"{request_id}/{current_event['id']}/{uuid4()}/{safe_name}"
            supabase.storage.from_(_REQUEST_MEDIA_BUCKET).upload(storage_path, content,
                {"content-type": content_type, "upsert": "false"})
            try:
                inserted = (supabase.table("member_request_media").insert({
                    "request_id": str(request_id), "event_id": current_event["id"],
                    "storage_path": storage_path, "content_type": content_type,
                    "byte_size": len(content), "original_filename": safe_name, "created_by": worker_id,
                }).execute().data or [])
            except Exception:
                supabase.storage.from_(_REQUEST_MEDIA_BUCKET).remove([storage_path])
                raise
            signed = supabase.storage.from_(_REQUEST_MEDIA_BUCKET).create_signed_url(storage_path, 900)
            signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
            if signed_url and signed_url.startswith("/"):
                signed_url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", signed_url.lstrip("/"))
            media_row = inserted[0] if inserted else {}
            return {"media": {"id": media_row.get("id"), "url": signed_url,
                "content_type": content_type, "byte_size": len(content),
                "original_filename": safe_name}}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not upload member request evidence")
            raise HTTPException(status_code=503, detail="The warehouse evidence could not be saved.") from exc

    @router.patch("/platform/requests/{request_id}/assignment")
    def assign_request_worker(request_id: UUID, payload: RequestAssignment, authorization: str | None = Header(default=None)):
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
                .eq("id", str(request_id)).select("id").execute())
            if not result.data:
                raise HTTPException(status_code=404, detail="Request not found.")
            return {"request_id": str(request_id), "assigned_worker_id": payload.worker_id}
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
