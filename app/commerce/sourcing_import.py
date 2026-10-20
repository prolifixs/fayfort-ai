"""Bulk import of FayFort sourcing items from FayFort's own social posts (owner request, 2026-10-20).

POST /platform/commerce/sourcing/import   one item per call (platform admins)

Each item becomes a directory_products row (source fayfort, availability sourcing) with its photos and
videos copied into the product-media bucket, so nothing depends on short-lived social CDN links.
- At most MAX_MEDIA pieces of media per item; a video counts once (its cover image rides along as the poster).
- Media is only fetched from known social CDN hosts, over https, without following redirects, with size caps.
- import_ref ("instagram:<post code>") makes it safe to run again: the same post updates the same item, and media
  already copied is kept unless refresh_media is set.
- No price means price_min stays empty and members see "Contact our team for a price". A price is a rough guide.
"""
from __future__ import annotations

import logging
import re
from decimal import Decimal
from typing import Literal
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.commerce.db import audit, db, one, rows
from app.directory.identity import trusted_platform_admin

logger = logging.getLogger(__name__)

MEDIA_BUCKET = "product-media"
MAX_MEDIA = 5
IMAGE_LIMIT = 15 * 1024 * 1024
VIDEO_LIMIT = 60 * 1024 * 1024
ALLOWED_HOST_SUFFIXES = (".cdninstagram.com", ".fbcdn.net")
CONTENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4"}
REF = re.compile(r"^instagram:[A-Za-z0-9_-]{5,40}$")


class ImportMedia(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(max_length=4000)
    media_type: Literal["image", "video"]
    preview_url: str | None = Field(default=None, max_length=4000)


class ImportItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    import_ref: str = Field(max_length=60)
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    category_ref: str = Field(min_length=1, max_length=200)
    price_min: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    price_max: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    media: list[ImportMedia] = Field(default_factory=list, max_length=20)
    refresh_media: bool = False

    @field_validator("import_ref")
    @classmethod
    def ref_shape(cls, value: str) -> str:
        if not REF.fullmatch(value):
            raise ValueError("Use instagram:<post code>.")
        return value

    @field_validator("name", "description")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def prices(self):
        if self.price_max is not None and self.price_min is None:
            self.price_min = self.price_max
        if self.price_min is not None and self.price_max is not None and self.price_max < self.price_min:
            raise ValueError("The highest price can't be below the lowest.")
        return self


class MediaRejected(Exception):
    pass


def allowed_media_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host.endswith(suffix) for suffix in ALLOWED_HOST_SUFFIXES)


def fetch_media(url: str, kind: str) -> tuple[bytes, str]:
    """Download one file from a social CDN. Returns (content, content_type)."""
    if not allowed_media_url(url):
        raise MediaRejected("not a social CDN link")
    limit = VIDEO_LIMIT if kind == "video" else IMAGE_LIMIT
    with requests.get(url, timeout=(10, 60), stream=True, allow_redirects=False,
                      headers={"User-Agent": "Mozilla/5.0 FayFort catalog import"}) as response:
        if response.status_code != 200:
            raise MediaRejected(f"the link answered {response.status_code}")
        content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        if content_type not in CONTENT_TYPES or not content_type.startswith(kind):
            raise MediaRejected(f"unexpected file type {content_type or 'unknown'}")
        chunks, size = [], 0
        for chunk in response.iter_content(256 * 1024):
            size += len(chunk)
            if size > limit:
                raise MediaRejected("file too large")
            chunks.append(chunk)
    if not size:
        raise MediaRejected("empty file")
    return b"".join(chunks), content_type


def store_media(path: str, content: bytes, content_type: str) -> str:
    bucket = db().storage.from_(MEDIA_BUCKET)
    bucket.upload(path, content, {"content-type": content_type, "upsert": "true"})
    public = bucket.get_public_url(path)
    if not public:
        raise RuntimeError("No public URL for the upload")
    return str(public).rstrip("?")


def copy_media(ref: str, media: list[ImportMedia]) -> tuple[list[dict], list[str]]:
    """Copy up to MAX_MEDIA pieces into storage. Returns (gallery rows without product_id, skip notes)."""
    folder = "imports/" + re.sub(r"[^A-Za-z0-9_-]", "-", ref)
    gallery: list[dict] = []
    skipped: list[str] = []
    for index, item in enumerate(media):
        if len(gallery) >= MAX_MEDIA:
            skipped.append(f"media {index + 1}: over the limit of {MAX_MEDIA}")
            continue
        try:
            content, content_type = fetch_media(item.url, item.media_type)
            url = store_media(f"{folder}/{index}.{CONTENT_TYPES[content_type]}", content, content_type)
            row = {"media_type": item.media_type, "url": url, "preview_url": None, "storage_path": f"{folder}/{index}.{CONTENT_TYPES[content_type]}"}
            if item.media_type == "video" and item.preview_url:
                try:
                    cover, cover_type = fetch_media(item.preview_url, "image")
                    cover_path = f"{folder}/{index}-cover.{CONTENT_TYPES[cover_type]}"
                    row["preview_url"] = store_media(cover_path, cover, cover_type)
                    row["cover_path"] = cover_path
                except MediaRejected as exc:
                    skipped.append(f"media {index + 1} cover: {exc}")
            gallery.append(row)
        except MediaRejected as exc:
            skipped.append(f"media {index + 1}: {exc}")
        except Exception:
            logger.warning("Import media %s for %s failed", index, ref, exc_info=True)
            skipped.append(f"media {index + 1}: could not be copied")
    return gallery, skipped


def primary(gallery: list[dict]) -> tuple[str, str, str] | None:
    """The picture shown on cards: the first image, else a video's cover, else the first video."""
    for row in gallery:
        if row["media_type"] == "image":
            return row["url"], "image", row["storage_path"]
    for row in gallery:
        if row.get("preview_url"):
            return row["preview_url"], "image", row["cover_path"]
    if gallery:
        return gallery[0]["url"], "video", gallery[0]["storage_path"]
    return None


def import_item(item: ImportItem, actor_id: str) -> dict:
    if not one(db().table("directory_categories").select("source_ref").eq("source_ref", item.category_ref).limit(1).execute()):
        raise HTTPException(status_code=422, detail=f"Unknown category {item.category_ref}.")
    existing = one(db().table("directory_products").select("id,media_url").eq("import_ref", item.import_ref).limit(1).execute())
    values = {
        "source": "fayfort", "name": item.name[:160], "description": item.description[:2000],
        "category_ref": item.category_ref, "availability_status": "sourcing", "active": True,
        "price_min": float(item.price_min) if item.price_min is not None else None,
        "price_max": float(item.price_max or item.price_min) if item.price_min is not None else None,
        "currency": item.currency, "import_ref": item.import_ref, "updated_by": actor_id,
        "retired_at": None, "retired_reason": None,
    }
    have_media = bool(existing and rows(db().table("commerce_media").select("product_id")
                                        .eq("product_id", str(existing["id"])).limit(1).execute()))
    gallery: list[dict] = []
    skipped: list[str] = []
    if item.refresh_media or not have_media:
        gallery, skipped = copy_media(item.import_ref, item.media)
        main = primary(gallery)
        if main:
            values.update({"media_url": main[0], "media_type": main[1], "media_source": "upload", "media_storage_path": main[2]})
        elif not existing or not existing.get("media_url"):
            values.update({"media_url": None, "media_type": None, "media_source": None, "media_storage_path": None})
    if existing:
        product_id = str(existing["id"])
        db().table("directory_products").update(values).eq("id", product_id).execute()
    else:
        created = one(db().table("directory_products").insert({**values, "created_by": actor_id}).execute())
        if not created:
            raise HTTPException(status_code=503, detail="The item could not be saved.")
        product_id = str(created["id"])
    if gallery:
        db().table("commerce_media").delete().eq("product_id", product_id).execute()
        db().table("commerce_media").insert([
            {"product_id": product_id, "position": position, "media_type": row["media_type"], "url": row["url"],
             "preview_url": row.get("preview_url"), "alt": item.name[:200]}
            for position, row in enumerate(gallery)]).execute()
    audit(actor_id, "sourcing.import", {"import_ref": item.import_ref, "product_id": product_id,
                                        "media": len(gallery), "skipped": skipped[:10]})
    return {"product_id": product_id, "created": not existing, "media_copied": len(gallery),
            "media_kept": have_media and not gallery, "skipped": skipped}


def create_sourcing_import_router() -> APIRouter:
    router = APIRouter(tags=["commerce"])

    @router.post("/platform/commerce/sourcing/import")
    def import_one(payload: ImportItem, authorization: str | None = Header(default=None)):
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        try:
            return import_item(payload, admin["user_id"])
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Sourcing import failed for %s", payload.import_ref)
            raise HTTPException(status_code=503, detail="The item could not be imported. Try again.") from exc

    return router
