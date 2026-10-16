"""Ads API (docs/ADS_PLAN.md): what a member sees, impression and click counts, ads.txt, and the Control Center admin."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.ads import service
from app.commerce.db import audit, db, one, rows
from app.commerce.member_router import _Limiter, verified_member
from app.directory.identity import trusted_platform_admin

logger = logging.getLogger(__name__)

IMAGE_BUCKET = "ad-images"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {
    "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": ("webp", lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"),
    "image/gif": ("gif", lambda data: data[:6] in (b"GIF87a", b"GIF89a")),
}
TARGET_PATTERN = re.compile(r"^(https://\S+|/member/\S*|action:plans)$")
Source = Literal["google", "custom", "google_then_custom"]
GoogleFormat = Literal["auto", "fluid", "rectangle", "horizontal"]


class AdEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    placement: str = Field(pattern=r"^[a-z_]{3,40}$")
    creative_id: UUID | None = None
    source: Literal["google", "custom"]
    kind: Literal["impression", "click"]


class AdEventsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[AdEvent] = Field(min_length=1, max_length=30)


class SettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    google_enabled: bool
    google_client: str | None = Field(default=None, max_length=40)
    google_test_mode: bool = False
    max_per_screen: int = Field(default=3, ge=1, le=6)

    @field_validator("google_client")
    @classmethod
    def publisher_id(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if not value:
            return None
        if value.startswith("pub-"):
            value = "ca-" + value
        if not re.fullmatch(r"ca-pub-[0-9]{10,20}", value):
            raise ValueError("The AdSense publisher ID looks like ca-pub-1234567890123456.")
        return value

    @model_validator(mode="after")
    def google_needs_client(self):
        if self.google_enabled and not self.google_client:
            raise ValueError("Add the AdSense publisher ID before switching Google ads on.")
        return self


class PlacementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    source: Source
    google_slot_id: str | None = Field(default=None, max_length=20)
    google_format: GoogleFormat = "auto"
    google_layout_key: str | None = Field(default=None, max_length=40)
    priority: int = Field(default=50, ge=0, le=999)

    @field_validator("google_slot_id")
    @classmethod
    def slot(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if not value:
            return None
        if not re.fullmatch(r"[0-9]{6,20}", value):
            raise ValueError("The ad unit ID is the number AdSense shows as data-ad-slot, for example 1234567890.")
        return value

    @field_validator("google_layout_key")
    @classmethod
    def layout_key(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        if not value:
            return None
        if not re.fullmatch(r"[-+a-z0-9]{3,40}", value):
            raise ValueError("The layout key is the data-ad-layout-key value from AdSense, for example -6t+ed+2i-1n-4w.")
        return value


class CreativeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    status: Literal["draft", "active", "paused", "archived"] = "draft"
    advertiser: str | None = Field(default=None, max_length=80)
    headline: str = Field(min_length=1, max_length=80)
    body: str | None = Field(default=None, max_length=200)
    cta_label: str = Field(default="Learn more", min_length=1, max_length=30)
    target_url: str = Field(min_length=1, max_length=500)
    image_url: str | None = Field(default=None, max_length=500)
    tone: Literal["brand", "light", "dark", "accent"] = "brand"
    placements: list[str] = Field(default_factory=list, max_length=12)
    weight: int = Field(default=1, ge=1, le=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @field_validator("name", "headline", "cta_label")
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field can't be empty.")
        return value

    @field_validator("advertiser", "body", "image_url")
    @classmethod
    def optional(cls, value: str | None) -> str | None:
        return (value or "").strip() or None

    @field_validator("target_url")
    @classmethod
    def target(cls, value: str) -> str:
        value = value.strip()
        if not TARGET_PATTERN.fullmatch(value):
            raise ValueError("The link must start with https://, a /member/ page, or be action:plans.")
        return value

    @field_validator("image_url")
    @classmethod
    def image(cls, value: str | None) -> str | None:
        if value and not re.fullmatch(r"https://\S+", value):
            raise ValueError("The image must be an https:// address.")
        return value

    @model_validator(mode="after")
    def dates(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("The end date must be after the start date.")
        return self


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def create_ads_router() -> APIRouter:
    router = APIRouter(tags=["ads"])
    event_limiter = _Limiter(60)

    def require_admin(authorization: str | None) -> str:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin["user_id"]

    def fail(message: str, exc: Exception) -> HTTPException:
        logger.exception(message)
        return HTTPException(status_code=503, detail=message)

    # ---- members ----------------------------------------------------------------------------
    @router.get("/members/ads")
    def member_ads(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return service.member_ads(member_id)
        except Exception as exc:
            logger.warning("Ads could not be loaded: %s", type(exc).__name__)
            return {"show": False, "reason": "unavailable"}

    @router.post("/members/ads/events")
    def ad_events(payload: AdEventsInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        event_limiter.check(member_id)
        events = [{"placement": e.placement, "creative_id": str(e.creative_id) if e.creative_id else None,
                   "source": e.source, "kind": e.kind} for e in payload.events]
        try:
            return {"recorded": service.record_events(events)}
        except Exception as exc:
            logger.warning("Ad events could not be recorded: %s", type(exc).__name__)
            return {"recorded": 0}

    @router.get("/ads.txt", response_class=PlainTextResponse)
    def ads_txt():
        try:
            body = service.ads_txt()
        except Exception as exc:
            raise fail("ads.txt is unavailable.", exc) from exc
        if not body:
            raise HTTPException(status_code=404, detail="No ad network is set up.")
        return PlainTextResponse(body, headers={"Cache-Control": "public, max-age=3600"})

    # ---- Control Center ---------------------------------------------------------------------
    @router.get("/platform/ads")
    def admin_overview(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            config = service.settings_row()
            placements = rows(db().table("ad_placements").select("*").order("priority").execute())
            creatives = rows(db().table("ad_creatives").select("*").order("created_at", desc=True).execute())
            return {"settings": config, "placements": placements, "creatives": creatives,
                    "stats": service.stats(30), "ads_txt": service.ads_txt()}
        except Exception as exc:
            raise fail("Ads could not be loaded.", exc) from exc

    @router.put("/platform/ads/settings")
    def save_settings(payload: SettingsInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        values = {**payload.model_dump(), "updated_by": admin_id, "updated_at": service.now_utc().isoformat()}
        try:
            db().table("ad_settings").upsert({"id": 1, **values}, on_conflict="id").execute()
        except Exception as exc:
            raise fail("Ad settings could not be saved.", exc) from exc
        service.clear_cache()
        audit(admin_id, "ads.settings", payload.model_dump())
        return {"settings": service.settings_row()}

    @router.put("/platform/ads/placements/{key}")
    def save_placement(key: str, payload: PlacementInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        if payload.enabled and payload.source == "google" and not payload.google_slot_id:
            raise HTTPException(status_code=422, detail="Add the Google ad unit ID, or choose a source with custom ads.")
        try:
            updated = rows(db().table("ad_placements").update(
                {**payload.model_dump(), "updated_at": service.now_utc().isoformat()}).eq("key", key).execute())
        except Exception as exc:
            raise fail("The placement could not be saved.", exc) from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Placement not found.")
        service.clear_cache()
        audit(admin_id, "ads.placement", {"key": key, **payload.model_dump()})
        return {"placement": updated[0]}

    def creative_values(payload: CreativeInput) -> dict:
        known = {row["key"] for row in rows(db().table("ad_placements").select("key").execute())}
        unknown = [key for key in payload.placements if key not in known]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown placement: {', '.join(unknown)}")
        if payload.status == "active" and not payload.placements:
            raise HTTPException(status_code=422, detail="Choose at least one placement before making the ad active.")
        values = payload.model_dump()
        values["placements"] = list(dict.fromkeys(payload.placements))
        values["starts_at"], values["ends_at"] = _iso(payload.starts_at), _iso(payload.ends_at)
        return values

    @router.post("/platform/ads/creatives", status_code=201)
    def create_creative(payload: CreativeInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        values = creative_values(payload)
        try:
            created = one(db().table("ad_creatives").insert({**values, "created_by": admin_id}).execute())
        except Exception as exc:
            raise fail("The ad could not be saved.", exc) from exc
        service.clear_cache()
        audit(admin_id, "ads.creative.create", {"id": (created or {}).get("id"), "name": payload.name})
        return {"creative": created}

    @router.put("/platform/ads/creatives/{creative_id}")
    def update_creative(creative_id: UUID, payload: CreativeInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        values = creative_values(payload)
        try:
            updated = rows(db().table("ad_creatives").update(
                {**values, "updated_at": service.now_utc().isoformat()}).eq("id", str(creative_id)).execute())
        except Exception as exc:
            raise fail("The ad could not be saved.", exc) from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Ad not found.")
        service.clear_cache()
        audit(admin_id, "ads.creative.update", {"id": str(creative_id), "status": payload.status})
        return {"creative": updated[0]}

    @router.delete("/platform/ads/creatives/{creative_id}")
    def archive_creative(creative_id: UUID, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            updated = rows(db().table("ad_creatives").update(
                {"status": "archived", "updated_at": service.now_utc().isoformat()}).eq("id", str(creative_id)).execute())
        except Exception as exc:
            raise fail("The ad could not be archived.", exc) from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Ad not found.")
        service.clear_cache()
        audit(admin_id, "ads.creative.archive", {"id": str(creative_id)})
        return {"creative": updated[0]}

    @router.post("/platform/ads/images", status_code=201)
    async def upload_image(request: Request, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        image_type = IMAGE_TYPES.get(content_type)
        if not image_type:
            raise HTTPException(status_code=415, detail="Choose a JPEG, PNG, WebP or GIF image.")
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_IMAGE_BYTES:
                raise HTTPException(status_code=413, detail="Ad images must be 5 MB or smaller.")
        if not content:
            raise HTTPException(status_code=422, detail="Choose an image first.")
        if not image_type[1](content):
            raise HTTPException(status_code=415, detail="The image content does not match its type.")
        path = f"creatives/{uuid4()}.{image_type[0]}"
        try:
            bucket = db().storage.from_(IMAGE_BUCKET)
            bucket.upload(path, bytes(content), {"content-type": content_type, "upsert": "false"})
            url = bucket.get_public_url(path)
        except Exception as exc:
            raise fail("The image could not be uploaded.", exc) from exc
        url = str(url).rstrip("?")
        audit(admin_id, "ads.image.upload", {"path": path})
        return {"image_url": url}

    return router
