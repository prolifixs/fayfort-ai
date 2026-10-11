from __future__ import annotations

import logging
from typing import Callable
from urllib.parse import urljoin
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request

from app.config.settings import settings
from app.database.client import supabase

logger = logging.getLogger(__name__)
BUCKET = "member-profile-photos"
MAX_BYTES = 5 * 1024 * 1024
MIME_SIGNATURES = {
    "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": ("webp", lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"),
}


def _signed_url(path: str) -> str:
    result = supabase.storage.from_(BUCKET).create_signed_url(path, 3600)
    url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
    if not url:
        raise RuntimeError("Storage did not return a signed URL")
    return urljoin(settings.SUPABASE_URL.rstrip("/") + "/", url.lstrip("/")) if url.startswith("/") else url


def create_member_profile_photo_router(require_verified_member: Callable[[str | None], str]) -> APIRouter:
    router = APIRouter(tags=["member-profile"])

    @router.post("/members/me/profile-photo", status_code=201)
    async def upload_profile_photo(request: Request, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        image_type = MIME_SIGNATURES.get(content_type)
        if not image_type:
            raise HTTPException(status_code=415, detail="Choose a JPEG, PNG, or WebP profile photo.")
        if request.headers.get("content-length"):
            try:
                if int(request.headers["content-length"]) > MAX_BYTES:
                    raise HTTPException(status_code=413, detail="Profile photos must be 5 MiB or smaller.")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid upload size.") from exc
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise HTTPException(status_code=413, detail="Profile photos must be 5 MiB or smaller.")
        if not content:
            raise HTTPException(status_code=422, detail="Choose a profile photo before uploading.")
        if not image_type[1](content):
            raise HTTPException(status_code=415, detail="The image content does not match its declared type.")

        path = f"{member_id}/{uuid4()}.{image_type[0]}"
        try:
            current = (supabase.table("member_profiles").select("member_photo_path")
                .eq("user_id", member_id).maybe_single().execute())
            profile = current.data if current else None
            if not profile:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            supabase.storage.from_(BUCKET).upload(path, bytes(content), {
                "content-type": content_type, "upsert": "false",
            })
            photo_url = _signed_url(path)
            updated = (supabase.table("member_profiles").update({"member_photo_path": path})
                .eq("user_id", member_id).select("user_id").execute().data or [])
            if not updated:
                raise RuntimeError("Member photo path was not saved")
            old_path = profile.get("member_photo_path")
            if old_path:
                try:
                    supabase.storage.from_(BUCKET).remove([old_path])
                except Exception:
                    logger.warning("Replaced member profile photo could not be removed", exc_info=True)
            return {"profile_photo_url": photo_url}
        except HTTPException:
            try:
                supabase.storage.from_(BUCKET).remove([path])
            except Exception:
                pass
            raise
        except Exception as exc:
            try:
                supabase.storage.from_(BUCKET).remove([path])
            except Exception:
                pass
            logger.exception("Could not update member profile photo")
            raise HTTPException(status_code=503, detail="Profile photo could not be saved.") from exc

    @router.delete("/members/me/profile-photo")
    def delete_profile_photo(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            response = (supabase.table("member_profiles").select("member_photo_path")
                .eq("user_id", member_id).maybe_single().execute())
            profile = response.data if response else None
            if not profile:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            path = profile.get("member_photo_path")
            supabase.table("member_profiles").update({"member_photo_path": None}).eq("user_id", member_id).execute()
            if path:
                supabase.storage.from_(BUCKET).remove([path])
            return {"profile_photo_url": None}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not remove member profile photo")
            raise HTTPException(status_code=503, detail="Profile photo could not be removed.") from exc

    return router
