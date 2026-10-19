"""Customer reviews on www.fayfort.com (docs/PUBLIC_SITE_REBUILD_PLAN.md, "Customer reviews").

Public:   GET /public/site/reviews (published reviews and the star summary).
Staff (platform admin, Control Center -> Website):
          GET /platform/site/reviews, POST /platform/site/reviews/screenshot (one image per call, read automatically),
          POST /platform/site/reviews (typed in), PUT/DELETE /platform/site/reviews/{id}.
Members (Orders & requests): GET /members/reviews, POST /members/reviews, POST /members/reviews/invites/{id}/dismiss.

Rules that keep the reviews honest:
- Nothing is public until staff publish it, and staff are asked to publish every genuine review, good or bad.
- A member's words and stars are theirs: staff can publish, hide or feature a member review, not rewrite it.
- Screenshot reviews keep the original image privately so anyone on the team can check the wording.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from typing import Callable, Literal
from urllib.parse import urljoin
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.commerce.db import audit, db, one, rows
from app.directory.identity import trusted_platform_admin
from app.site.review_import import SOURCES, extract_review, read_screenshot_text, short_name

logger = logging.getLogger(__name__)

BUCKET = "review-screenshots"
MAX_BYTES = 8 * 1024 * 1024
MAX_PUBLIC = 30
STAFF_HREF = "/?page=website#reviews"
IMAGE_TYPES = {
    "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": ("webp", lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"),
}
PUBLIC_FIELDS = "id,source,rating,body,display_name,country,product,reviewed_on,published_at,featured"
Source = Literal["member", "instagram", "whatsapp", "facebook", "tiktok", "email", "google", "other"]


def _clean(value: str | None, limit: int) -> str | None:
    text = re.sub(r"\s+", " ", (value or "")).strip()
    return text[:limit] or None


def _clean_body(value: str | None) -> str:
    # Keep the customer's line breaks, tidy the rest.
    text = re.sub(r"[ \t]+", " ", (value or "").replace("\r", "")).strip()
    return re.sub(r"\n{3,}", "\n\n", text)[:1500]


class ReviewFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["instagram", "whatsapp", "facebook", "tiktok", "email", "google", "other"] = "instagram"
    body: str = Field(default="", max_length=1500)
    display_name: str | None = Field(default=None, max_length=60)
    country: str | None = Field(default=None, max_length=60)
    product: str | None = Field(default=None, max_length=120)
    rating: int | None = Field(default=None, ge=1, le=5)
    reviewed_on: date | None = None
    staff_note: str | None = Field(default=None, max_length=500)


class ReviewUpdate(ReviewFields):
    status: Literal["pending", "published", "hidden"] = "pending"
    featured: bool = False


class MemberReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invite_id: UUID
    rating: int = Field(ge=1, le=5)
    body: str = Field(min_length=10, max_length=1000)
    display_name: str = Field(min_length=1, max_length=60)
    country: str | None = Field(default=None, max_length=60)

    @field_validator("body")
    @classmethod
    def words(cls, value: str) -> str:
        if len(re.findall(r"\w+", value)) < 3:
            raise ValueError("Write a few words about how it went.")
        return value


def _signed_url(path: str) -> str | None:
    try:
        result = db().storage.from_(BUCKET).create_signed_url(path, 900)
        url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if url and url.startswith("/"):
            from app.config.settings import settings
            url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", url.lstrip("/"))
        return url
    except Exception:
        logger.warning("Review screenshot link could not be made", exc_info=True)
        return None


def public_reviews() -> dict:
    """Published reviews, featured first, and the average of the stars customers gave."""
    published = rows(db().table("customer_reviews").select(PUBLIC_FIELDS).eq("status", "published")
                     .order("featured", desc=True).order("published_at", desc=True).limit(200).execute())
    rated = [int(r["rating"]) for r in published if r.get("rating")]
    return {
        "summary": {
            "average": round(sum(rated) / len(rated), 1) if rated else None,
            "rated_count": len(rated),
            "total": len(published),
            "stars": {str(n): sum(1 for value in rated if value == n) for n in range(5, 0, -1)},
        },
        "reviews": [{
            "id": r["id"], "source": r["source"], "rating": r.get("rating"), "body": r["body"],
            "name": r.get("display_name"), "country": r.get("country"), "product": r.get("product"),
            "date": r.get("reviewed_on") or str(r.get("published_at") or "")[:10] or None,
            "verified_order": r["source"] == "member", "featured": bool(r.get("featured")),
        } for r in published[:MAX_PUBLIC]],
    }


def _publish_problem(review: dict) -> str | None:
    if len(_clean_body(review.get("body")).strip()) < 3:
        return "Add the customer's words before publishing."
    if not review.get("display_name"):
        return "Add a name to show (first name and initial, or their handle) before publishing."
    return None


def create_reviews_router(require_verified_member: Callable[[str | None], str]) -> APIRouter:
    router = APIRouter(tags=["site reviews"])

    def require_admin(authorization: str | None) -> str:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin["user_id"]

    def fail(message: str) -> HTTPException:
        logger.exception(message)
        return HTTPException(status_code=503, detail=message)

    # ---- Public ------------------------------------------------------------------------------
    @router.get("/public/site/reviews")
    def get_public_reviews():
        try:
            body = public_reviews()
        except Exception:
            logger.warning("Reviews could not be loaded", exc_info=True)
            body = {"summary": {"average": None, "rated_count": 0, "total": 0, "stars": {}}, "reviews": []}
        return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})

    # ---- Staff -------------------------------------------------------------------------------
    @router.get("/platform/site/reviews")
    def list_reviews(status: Literal["all", "pending", "published", "hidden"] = Query(default="all"),
                     authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            query = db().table("customer_reviews").select("*").order("created_at", desc=True).limit(300)
            if status != "all":
                query = query.eq("status", status)
            found = rows(query.execute())
            counts: dict[str, int] = {"pending": 0, "published": 0, "hidden": 0}
            for row in rows(db().table("customer_reviews").select("status").limit(5000).execute()):
                counts[row["status"]] = counts.get(row["status"], 0) + 1
        except Exception as exc:
            raise fail("Reviews could not be loaded.") from exc
        for row in found:
            row["screenshot_url"] = _signed_url(row["screenshot_path"]) if row.get("screenshot_path") else None
            row.pop("screenshot_path", None)
        return {"reviews": found, "counts": counts}

    @router.post("/platform/site/reviews/screenshot", status_code=201)
    async def import_screenshot(request: Request,
                                source: Literal["instagram", "whatsapp", "facebook", "tiktok", "email", "google", "other"] | None = None,
                                authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        image_type = IMAGE_TYPES.get(content_type)
        if not image_type:
            raise HTTPException(status_code=415, detail="Upload a JPEG, PNG or WebP screenshot.")
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_BYTES:
                raise HTTPException(status_code=413, detail="Screenshots must be 8 MB or smaller.")
        if not content:
            raise HTTPException(status_code=422, detail="Choose a screenshot to upload.")
        if not image_type[1](content):
            raise HTTPException(status_code=415, detail="That file isn't the image type it says it is.")
        path = f"imports/{datetime.now(timezone.utc):%Y/%m}/{uuid4()}.{image_type[0]}"
        try:
            db().storage.from_(BUCKET).upload(path, bytes(content), {"content-type": content_type, "upsert": "false"})
        except Exception as exc:
            raise fail("The screenshot could not be saved.") from exc
        ocr_text = read_screenshot_text(bytes(content))
        found = extract_review(ocr_text)
        try:
            created = one(db().table("customer_reviews").insert({
                "source": source or found["source"] or "instagram", "status": "pending",
                "body": _clean_body(found["body"]), "display_name": short_name(found["display_name"]),
                "country": found["country"], "product": found["product"], "rating": found["rating"],
                "reviewed_on": found["reviewed_on"], "screenshot_path": path, "ocr_text": ocr_text or None,
                "staff_note": found["note"], "created_by": admin_id,
            }).execute())
        except Exception as exc:
            try:
                db().storage.from_(BUCKET).remove([path])
            except Exception:
                pass
            raise fail("The review could not be saved.") from exc
        audit(admin_id, "site.review.import", {"id": (created or {}).get("id"), "read": bool(ocr_text)})
        if created:
            created["screenshot_url"] = _signed_url(path)
            created.pop("screenshot_path", None)
        return {"review": created}

    @router.post("/platform/site/reviews", status_code=201)
    def add_review(payload: ReviewFields, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            created = one(db().table("customer_reviews").insert({
                "source": payload.source, "status": "pending", "body": _clean_body(payload.body),
                "display_name": _clean(payload.display_name, 60), "country": _clean(payload.country, 60),
                "product": _clean(payload.product, 120), "rating": payload.rating,
                "reviewed_on": payload.reviewed_on.isoformat() if payload.reviewed_on else None,
                "staff_note": _clean(payload.staff_note, 500), "created_by": admin_id,
            }).execute())
        except Exception as exc:
            raise fail("The review could not be saved.") from exc
        audit(admin_id, "site.review.add", {"id": (created or {}).get("id")})
        return {"review": created}

    @router.put("/platform/site/reviews/{review_id}")
    def update_review(review_id: UUID, payload: ReviewUpdate, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            current = one(db().table("customer_reviews").select("*").eq("id", str(review_id)).limit(1).execute())
        except Exception as exc:
            raise fail("The review could not be loaded.") from exc
        if not current:
            raise HTTPException(status_code=404, detail="Review not found.")
        changes: dict = {"status": payload.status, "featured": payload.featured and payload.status == "published",
                         "staff_note": _clean(payload.staff_note, 500),
                         "display_name": _clean(payload.display_name, 60), "country": _clean(payload.country, 60),
                         "updated_at": datetime.now(timezone.utc).isoformat()}
        if current["source"] != "member":
            # Screenshot and typed-in reviews: staff fix misreads. A member's own words and stars are left alone.
            changes.update({"source": payload.source, "body": _clean_body(payload.body),
                            "product": _clean(payload.product, 120), "rating": payload.rating,
                            "reviewed_on": payload.reviewed_on.isoformat() if payload.reviewed_on else None})
        if payload.status == "published":
            problem = _publish_problem({**current, **changes})
            if problem:
                raise HTTPException(status_code=422, detail=problem)
            if not current.get("published_at"):
                changes["published_at"] = datetime.now(timezone.utc).isoformat()
        try:
            updated = rows(db().table("customer_reviews").update(changes).eq("id", str(review_id)).execute())
        except Exception as exc:
            raise fail("The review could not be saved.") from exc
        audit(admin_id, "site.review.update", {"id": str(review_id), "status": payload.status})
        review = updated[0] if updated else {**current, **changes}
        if review.get("screenshot_path"):
            review["screenshot_url"] = _signed_url(review["screenshot_path"])
        review.pop("screenshot_path", None)
        return {"review": review}

    @router.delete("/platform/site/reviews/{review_id}")
    def delete_review(review_id: UUID, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            removed = rows(db().table("customer_reviews").delete().eq("id", str(review_id)).execute())
        except Exception as exc:
            raise fail("The review could not be removed.") from exc
        if not removed:
            raise HTTPException(status_code=404, detail="Review not found.")
        if removed[0].get("screenshot_path"):
            try:
                db().storage.from_(BUCKET).remove([removed[0]["screenshot_path"]])
            except Exception:
                logger.warning("Review screenshot could not be removed", exc_info=True)
        audit(admin_id, "site.review.remove", {"id": str(review_id)})
        return {"removed": str(review_id)}

    # ---- Members -----------------------------------------------------------------------------
    @router.get("/members/reviews")
    def member_reviews(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            invites = rows(db().table("customer_review_invites").select("id,title,request_id,order_id,created_at")
                           .eq("member_id", member_id).is_("reviewed_at", "null").is_("dismissed_at", "null")
                           .order("created_at", desc=True).limit(10).execute())
            mine = rows(db().table("customer_reviews").select("id,rating,body,product,status,created_at")
                        .eq("member_id", member_id).order("created_at", desc=True).limit(20).execute())
            profile = one(db().table("member_profiles").select("display_name").eq("user_id", member_id).limit(1).execute())
            address = one(db().table("member_addresses").select("country").eq("member_id", member_id)
                          .order("created_at").limit(1).execute())
        except Exception as exc:
            raise fail("Your reviews could not be loaded.") from exc
        return {
            "invites": [{"id": i["id"], "title": i["title"], "kind": "request" if i.get("request_id") else "order",
                         "created_at": i["created_at"]} for i in invites],
            "reviews": mine,
            "defaults": {"display_name": short_name((profile or {}).get("display_name")),
                         "country": (address or {}).get("country")},
        }

    @router.post("/members/reviews", status_code=201)
    def submit_member_review(payload: MemberReview, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            invite = one(db().table("customer_review_invites").select("id,title,reviewed_at,dismissed_at")
                         .eq("id", str(payload.invite_id)).eq("member_id", member_id).limit(1).execute())
            if not invite:
                raise HTTPException(status_code=404, detail="That order isn't waiting for a review.")
            if invite.get("reviewed_at"):
                raise HTTPException(status_code=409, detail="You've already reviewed this one. Thank you!")
            created = one(db().table("customer_reviews").insert({
                "source": "member", "status": "pending", "rating": payload.rating, "body": _clean_body(payload.body),
                "display_name": _clean(payload.display_name, 60), "country": _clean(payload.country, 60),
                "product": _clean(invite["title"], 120), "member_id": member_id, "invite_id": invite["id"],
            }).execute())
            db().table("customer_review_invites").update({"reviewed_at": datetime.now(timezone.utc).isoformat()})\
                .eq("id", invite["id"]).eq("member_id", member_id).execute()
        except HTTPException:
            raise
        except Exception as exc:
            raise fail("Your review could not be saved. Please try again.") from exc
        try:
            stars = "★" * payload.rating
            db().rpc("notify_platform_admins", {
                "p_notification_type": "review_needed", "p_work_item_id": None,
                "p_title": f"New customer review to check · {stars}",
                "p_body": f"{_clean(payload.display_name, 60)}: {_clean(payload.body, 140)}",
                "p_href": STAFF_HREF, "p_dedupe": f"customer-review:{(created or {}).get('id')}",
            }).execute()
        except Exception:
            logger.warning("Administrators could not be told about a new review", exc_info=True)
        return {"review": {"id": (created or {}).get("id"), "status": "pending"}}

    @router.post("/members/reviews/invites/{invite_id}/dismiss")
    def dismiss_invite(invite_id: UUID, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            updated = rows(db().table("customer_review_invites").update({"dismissed_at": datetime.now(timezone.utc).isoformat()})
                           .eq("id", str(invite_id)).eq("member_id", member_id).is_("reviewed_at", "null").execute())
        except Exception as exc:
            raise fail("That couldn't be saved.") from exc
        if not updated:
            raise HTTPException(status_code=404, detail="That order isn't waiting for a review.")
        return {"dismissed": str(invite_id)}

    return router


__all__ = ["create_reviews_router", "public_reviews", "SOURCES"]
