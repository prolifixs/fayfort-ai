"""Website content API: the Instagram posts and reels on www.fayfort.com.

Public: GET /public/site/instagram (no sign-in; only kind, shortcode and label). Control Center (platform admin):
list, add by link, edit label/active, reorder and remove.
"""
from __future__ import annotations

import logging
import re
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.commerce.db import audit, db, one, rows
from app.directory.identity import trusted_platform_admin

logger = logging.getLogger(__name__)

MAX_PUBLIC = 12
_LINK = re.compile(r"^https?://(?:www\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(p|reel|reels|tv)/([A-Za-z0-9_-]{5,40})/?(?:[?#].*)?$")


def parse_instagram_link(url: str) -> tuple[str, str]:
    """('p' | 'reel', shortcode) from a post or reel link; raises ValueError otherwise."""
    match = _LINK.match((url or "").strip())
    if not match:
        raise ValueError("Paste a link to an Instagram post or reel, e.g. https://www.instagram.com/reel/ABC123/")
    kind = "p" if match.group(1) in ("p", "tv") else "reel"
    return kind, match.group(2)


class NewPost(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=10, max_length=300)
    label: str | None = Field(default=None, max_length=80)

    @field_validator("url")
    @classmethod
    def instagram(cls, value: str) -> str:
        parse_instagram_link(value)
        return value.strip()


class PostUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str | None = Field(default=None, max_length=80)
    active: bool = True


class Order(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[UUID] = Field(min_length=1, max_length=100)


def _clean(label: str | None) -> str | None:
    return (label or "").strip() or None


def create_site_router() -> APIRouter:
    router = APIRouter(tags=["site"])

    def require_admin(authorization: str | None) -> str:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin["user_id"]

    def fail(message: str) -> HTTPException:
        logger.exception(message)
        return HTTPException(status_code=503, detail=message)

    def ordered() -> list[dict]:
        found = rows(db().table("site_instagram_posts").select("*").order("sort_order").execute())
        return sorted(found, key=lambda r: (int(r.get("sort_order") or 0), str(r.get("created_at") or "")))

    @router.get("/public/site/instagram")
    def public_instagram():
        try:
            posts = [r for r in ordered() if r.get("active")][:MAX_PUBLIC]
        except Exception:
            logger.warning("Instagram posts could not be loaded", exc_info=True)
            posts = []
        body = {"posts": [{"id": r["id"], "kind": r["kind"], "shortcode": r["shortcode"], "label": r.get("label")} for r in posts]}
        return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})

    @router.get("/platform/site/instagram")
    def list_posts(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"posts": ordered()}
        except Exception as exc:
            raise fail("Instagram posts could not be loaded.") from exc

    @router.post("/platform/site/instagram", status_code=201)
    def add_post(payload: NewPost, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        kind, shortcode = parse_instagram_link(payload.url)
        try:
            existing = one(db().table("site_instagram_posts").select("id").eq("kind", kind).eq("shortcode", shortcode).limit(1).execute())
            if existing:
                raise HTTPException(status_code=409, detail="That post is already on the list.")
            last = ordered()
            created = one(db().table("site_instagram_posts").insert({
                "kind": kind, "shortcode": shortcode, "label": _clean(payload.label), "active": True,
                "sort_order": (max((int(r.get("sort_order") or 0) for r in last), default=0) + 10), "created_by": admin_id,
            }).execute())
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("The post could not be added.") from exc
        audit(admin_id, "site.instagram.add", {"kind": kind, "shortcode": shortcode})
        return {"post": created}

    @router.put("/platform/site/instagram/{post_id}")
    def update_post(post_id: UUID, payload: PostUpdate, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            updated = rows(db().table("site_instagram_posts").update({
                "label": _clean(payload.label), "active": payload.active,
            }).eq("id", str(post_id)).execute())
        except Exception as exc:
            raise fail("The post could not be saved.") from exc
        if not updated:
            raise HTTPException(status_code=404, detail="Post not found.")
        audit(admin_id, "site.instagram.update", {"id": str(post_id), "active": payload.active})
        return {"post": updated[0]}

    @router.put("/platform/site/instagram-order")
    def reorder(payload: Order, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            for index, post_id in enumerate(payload.ids):
                db().table("site_instagram_posts").update({"sort_order": (index + 1) * 10}).eq("id", str(post_id)).execute()
            return {"posts": ordered()}
        except Exception as exc:
            raise fail("The order could not be saved.") from exc
        finally:
            audit(admin_id, "site.instagram.reorder", {"count": len(payload.ids)})

    @router.delete("/platform/site/instagram/{post_id}")
    def remove_post(post_id: UUID, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            removed = rows(db().table("site_instagram_posts").delete().eq("id", str(post_id)).execute())
        except Exception as exc:
            raise fail("The post could not be removed.") from exc
        if not removed:
            raise HTTPException(status_code=404, detail="Post not found.")
        audit(admin_id, "site.instagram.remove", {"id": str(post_id)})
        return {"removed": str(post_id)}

    return router
