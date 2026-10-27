"""Operations Center API for the Store team, store sections, campaigns and the Schedule
(docs/CATALOG_MERCHANDISING_PLAN.md). Registered next to the Operations router.

Who can do what:
- Store team workers and administrators use the Products workspace and build store sections.
- Only an administrator publishes a listing, sends one back, or archives a store product in Shopify.
- Every member of staff can open the Schedule; what it shows depends on their departments.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Callable, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.accounts import operations_flow as flow
from app.accounts.schedule import build_schedule
from app.commerce import campaigns, merch_sections, shopify, store_team
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)

MEDIA_BUCKET = "product-media"
MEDIA_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm"}
IMAGE_MAX = 15 * 1024 * 1024
VIDEO_MAX = 100 * 1024 * 1024


class ListingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["store_product", "sourcing_item"]
    product_id: UUID | None = None
    title: str | None = Field(default=None, max_length=160)


class ListingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=5000)
    category_ref: str | None = Field(default=None, max_length=200)
    option_name: str | None = Field(default=None, max_length=60)
    option_values: list[str] | None = Field(default=None, max_length=30)
    price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    compare_at_price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    cost: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    price_guide_min: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    price_guide_max: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    min_order: int | None = Field(default=None, ge=1, le=1_000_000)
    lead_time_min_days: int | None = Field(default=None, ge=0, le=365)
    lead_time_max_days: int | None = Field(default=None, ge=0, le=365)
    availability_status: Literal["available", "sourcing", "unavailable"] | None = None
    planned_live_at: datetime | None = None
    media_order: list[int] | None = Field(default=None, max_length=10)
    clear: list[Literal["option_name", "compare_at_price", "cost", "price_guide_min", "price_guide_max", "min_order",
                        "lead_time_min_days", "lead_time_max_days", "planned_live_at", "category_ref"]] = Field(default_factory=list)

    @field_validator("title", "description", "option_name")
    @classmethod
    def trimmed(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("option_values")
    @classmethod
    def clean_values(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = list(dict.fromkeys(v.strip()[:60] for v in value if v and v.strip()))
        return cleaned[:30]

    @model_validator(mode="after")
    def ranges(self):
        if self.price_guide_min and self.price_guide_max and self.price_guide_max < self.price_guide_min:
            raise ValueError("The price guide's top must be at least its start.")
        if self.lead_time_min_days is not None and self.lead_time_max_days is not None \
                and self.lead_time_max_days < self.lead_time_min_days:
            raise ValueError("The longest lead time must be at least the shortest.")
        return self

    def changes(self) -> dict:
        values = self.model_dump(exclude_unset=True, exclude={"clear", "media_order"})
        for key in ("price", "compare_at_price", "cost", "price_guide_min", "price_guide_max"):
            if values.get(key) is not None:
                values[key] = float(values[key])
        if isinstance(values.get("planned_live_at"), datetime):
            moment = values["planned_live_at"]
            values["planned_live_at"] = (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).isoformat()
        for key in self.clear:
            values[key] = None
        return values


class MediaUrl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=10, max_length=2000)
    media_type: Literal["image", "video"] = "image"

    @field_validator("url")
    @classmethod
    def https(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("https://"):
            raise ValueError("Use an https:// link.")
        return value


class LinkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=8, max_length=2000)


class ReviewNote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str = Field(min_length=3, max_length=1000)


class Reason(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=500)


class CategoryChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category_ref: str = Field(min_length=1, max_length=200)


class RetireDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["keep", "retire"]
    reason: str = Field(min_length=3, max_length=500)


class SectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=60)
    hook: str = Field(default="", max_length=40)
    style: Literal["deal", "trend", "category"] = "deal"
    accent: Literal["pink", "navy", "gold", "green", "purple"] = "pink"
    category_ref: str | None = Field(default=None, max_length=200)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    priority: int = Field(default=100, ge=0, le=1000)
    min_items: int = Field(default=3, ge=1, le=12)
    status: Literal["draft", "published"] = "published"
    product_ids: list[UUID] = Field(default_factory=list, max_length=12)

    @field_validator("title", "hook")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()


class CampaignPrep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prize_ready: bool | None = None
    section_ready: bool | None = None
    announcement: str | None = Field(default=None, max_length=2000)


def create_store_team_router(trusted_fayfort_staff: Callable[[str | None], dict | None]) -> APIRouter:
    router = APIRouter(tags=["store-team"])

    def staff_identity(authorization: str | None) -> dict:
        staff = trusted_fayfort_staff(authorization)
        if not staff:
            raise HTTPException(status_code=403, detail="Active FayFort staff access is required.")
        return staff

    def departments_for(worker_id: str) -> list[str]:
        found = rows(db().table("operations_worker_departments").select("department").eq("worker_id", worker_id)
                     .eq("can_claim", True).execute())
        return list(dict.fromkeys(str(row["department"]) for row in found))

    def is_admin(staff: dict) -> bool:
        return staff.get("role") == "platform_admin"

    def store_staff(authorization: str | None) -> dict:
        staff = staff_identity(authorization)
        if not is_admin(staff) and "store_team" not in departments_for(staff["user_id"]):
            raise HTTPException(status_code=403, detail="This is Store team work. Ask an administrator to add you to the Store team.")
        return staff

    def admin_only(authorization: str | None) -> dict:
        staff = staff_identity(authorization)
        if not is_admin(staff):
            raise HTTPException(status_code=403, detail="Only a platform administrator can do this.")
        return staff

    def actor_type(staff: dict) -> str:
        return "platform_admin" if is_admin(staff) else "worker"

    def failure(exc: Exception, default: str) -> HTTPException:
        if isinstance(exc, HTTPException):
            return exc
        if isinstance(exc, LookupError):
            return HTTPException(status_code=404, detail=str(exc))
        if isinstance(exc, (store_team.ListingError, merch_sections.SectionError)):
            return HTTPException(status_code=409, detail=str(exc))
        if isinstance(exc, shopify.ShopifyError):
            return HTTPException(status_code=502, detail=f"Shopify didn't accept it: {exc}"[:300])
        logger.exception(default)
        return HTTPException(status_code=503, detail=default)

    def load_item(work_item_id: UUID, staff: dict) -> dict:
        item = one(db().table("operations_work_items").select("*").eq("id", str(work_item_id)).limit(1).execute())
        if not item:
            raise HTTPException(status_code=404, detail="Operations work item not found.")
        if is_admin(staff) or item.get("assigned_worker_id") == staff["user_id"] \
                or item.get("department") in departments_for(staff["user_id"]):
            return item
        raise HTTPException(status_code=404, detail="Operations work item not found.")

    def require_owner(item: dict | None, staff: dict) -> None:
        if is_admin(staff):
            return
        if not item or item.get("assigned_worker_id") != staff["user_id"] or item.get("status") != "claimed":
            raise HTTPException(status_code=403, detail="Claim this work item first.")

    def listing_and_item(listing_id: UUID, staff: dict, *, owner: bool = True) -> tuple[dict, dict | None]:
        try:
            listing = store_team.get_listing(str(listing_id))
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        item = store_team.listing_item(str(listing_id))
        if owner:
            require_owner(item, staff)
        return listing, item

    # ---- products workspace ---------------------------------------------------------------
    @router.get("/operations/store/products")
    def store_products(tab: Literal["store", "sourcing", "listings"] = "store",
                       q: str = Query(default="", max_length=100), authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            if tab == "listings":
                return {"listings": store_team.listings(), "can_publish": is_admin(staff)}
            found = store_team.store_products(q) if tab == "store" else store_team.sourcing_products(q)
            return {"products": found, "can_publish": is_admin(staff), "shopify_connected": shopify.admin_configured()}
        except Exception as exc:
            raise failure(exc, "Products could not be loaded.") from exc

    @router.get("/operations/store/categories")
    def store_categories(authorization: str | None = Header(default=None)):
        store_staff(authorization)
        from app.commerce import service
        return {"categories": [{"source_ref": c["source_ref"], "category": c["category"], "group_name": c.get("group_name"),
                                "product_type": c.get("product_type")} for c in service.categories()]}

    @router.post("/operations/store/listings", status_code=201)
    def create_listing(payload: ListingCreate, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            listing, item = store_team.open_listing(
                kind=payload.kind, actor_id=staff["user_id"], actor_role=staff.get("role") or "worker",
                values={"title": payload.title or ""} if payload.title else None,
                product_id=str(payload.product_id) if payload.product_id else None)
            return {"listing": store_team.listing_view(listing), "work_item": item}
        except Exception as exc:
            raise failure(exc, "The listing could not be started.") from exc

    @router.get("/operations/store/listings/{listing_id}")
    def get_listing(listing_id: UUID, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, item = listing_and_item(listing_id, staff, owner=False)
        return {"listing": store_team.listing_view(listing), "work_item": item, "can_publish": is_admin(staff),
                "can_edit": listing["status"] in store_team.EDITABLE and (
                    is_admin(staff) or bool(item and item.get("assigned_worker_id") == staff["user_id"] and item.get("status") == "claimed"))}

    @router.patch("/operations/store/listings/{listing_id}")
    def update_listing(listing_id: UUID, payload: ListingUpdate, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, _item = listing_and_item(listing_id, staff)
        changes = payload.changes()
        if payload.media_order is not None:
            media = listing.get("media") or []
            if sorted(payload.media_order) != list(range(len(media))):
                raise HTTPException(status_code=422, detail="The new photo order doesn't match the photos.")
            changes["media"] = [media[i] for i in payload.media_order]
        if changes.get("category_ref"):
            if not one(db().table("directory_categories").select("source_ref").eq("source_ref", changes["category_ref"]).limit(1).execute()):
                raise HTTPException(status_code=422, detail="Choose one of the FayFort categories.")
        try:
            return {"listing": store_team.listing_view(store_team.update_listing(listing, changes))}
        except Exception as exc:
            raise failure(exc, "The listing could not be saved.") from exc

    @router.post("/operations/store/listings/{listing_id}/media", status_code=201)
    async def upload_media(listing_id: UUID, request: Request, filename: str = Query(min_length=1, max_length=255),
                           authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, _item = listing_and_item(listing_id, staff)
        if listing["status"] not in store_team.EDITABLE:
            raise HTTPException(status_code=409, detail="This listing is with an administrator.")
        if len(listing.get("media") or []) >= 10:
            raise HTTPException(status_code=409, detail="A listing holds up to 10 photos and videos.")
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type not in MEDIA_TYPES:
            raise HTTPException(status_code=415, detail="Upload a JPEG, PNG, WebP, MP4 or WebM file.")
        limit = VIDEO_MAX if content_type.startswith("video/") else IMAGE_MAX
        buffer = bytearray()
        async for chunk in request.stream():
            buffer.extend(chunk)
            if len(buffer) > limit:
                raise HTTPException(status_code=413, detail="Photos must be 15 MB or smaller, videos 100 MB.")
        content = bytes(buffer)
        signatures = {"image/jpeg": content.startswith(b"\xff\xd8\xff"),
                      "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
                      "image/webp": len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP",
                      "video/mp4": len(content) >= 12 and content[4:8] == b"ftyp",
                      "video/webm": content.startswith(b"\x1aE\xdf\xa3")}
        if not content or not signatures.get(content_type):
            raise HTTPException(status_code=415, detail="The file content doesn't match its type.")
        path = f"listings/{listing_id}/{uuid4().hex}.{MEDIA_TYPES[content_type]}"
        try:
            storage = db().storage.from_(MEDIA_BUCKET)
            storage.upload(path, content, {"content-type": content_type, "upsert": "false"})
            public = storage.get_public_url(path)
            url = public if isinstance(public, str) else (public or {}).get("publicUrl") or (public or {}).get("publicURL")
            if not url:
                raise RuntimeError("No public URL for the upload")
            url = str(url).split("?", 1)[0]
            safe_alt = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", filename.replace("\\", "/").split("/")[-1])[:120]
            media = [*(listing.get("media") or []), {"media_type": "video" if content_type.startswith("video/") else "image",
                                                     "url": url, "alt": safe_alt or None, "source": "upload", "storage_path": path}]
            return {"listing": store_team.listing_view(store_team.update_listing(listing, {"media": media}))}
        except HTTPException:
            raise
        except Exception as exc:
            raise failure(exc, "The file could not be uploaded.") from exc

    @router.post("/operations/store/listings/{listing_id}/media-url", status_code=201)
    def add_media_url(listing_id: UUID, payload: MediaUrl, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, _item = listing_and_item(listing_id, staff)
        if len(listing.get("media") or []) >= 10:
            raise HTTPException(status_code=409, detail="A listing holds up to 10 photos and videos.")
        host = (re.match(r"^https://([^/]+)", payload.url) or [None, ""])[1].lower()
        instagram = host in ("instagram.com", "www.instagram.com")
        if instagram and listing["kind"] == "store_product":
            raise HTTPException(status_code=422, detail="Shopify can't import Instagram posts. Upload the photo or video instead.")
        media = [*(listing.get("media") or []), {"media_type": payload.media_type, "url": payload.url,
                                                 "source": "instagram" if instagram else "url"}]
        try:
            return {"listing": store_team.listing_view(store_team.update_listing(listing, {"media": media}))}
        except Exception as exc:
            raise failure(exc, "The link could not be added.") from exc

    @router.post("/operations/store/listings/{listing_id}/from-link")
    def fill_from_link(listing_id: UUID, payload: LinkInput, authorization: str | None = Header(default=None)):
        """Paste a shop product link: fills the empty name, description, rough price and one cover photo."""
        staff = store_staff(authorization)
        listing, _item = listing_and_item(listing_id, staff)
        try:
            result = store_team.fill_from_link(listing, payload.url, bucket=MEDIA_BUCKET)
            return {**result, "listing": store_team.listing_view(result["listing"])}
        except Exception as exc:
            raise failure(exc, "The link could not be read. Try again, or fill the details by hand.") from exc

    @router.delete("/operations/store/listings/{listing_id}/media/{index}")
    def remove_media(listing_id: UUID, index: int, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, _item = listing_and_item(listing_id, staff)
        media = list(listing.get("media") or [])
        if index < 0 or index >= len(media):
            raise HTTPException(status_code=404, detail="That photo isn't on this listing.")
        removed = media.pop(index)
        try:
            updated = store_team.update_listing(listing, {"media": media})
        except Exception as exc:
            raise failure(exc, "The photo could not be removed.") from exc
        if removed.get("storage_path"):
            try:
                db().storage.from_(MEDIA_BUCKET).remove([removed["storage_path"]])
            except Exception:
                logger.warning("Could not delete an unused listing upload")
        return {"listing": store_team.listing_view(updated)}

    @router.post("/operations/store/listings/{listing_id}/submit")
    def submit_listing(listing_id: UUID, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, _item = listing_and_item(listing_id, staff)
        try:
            return {"listing": store_team.listing_view(store_team.submit(listing, staff["user_id"]))}
        except Exception as exc:
            raise failure(exc, "The listing could not be sent for review.") from exc

    @router.post("/operations/store/listings/{listing_id}/publish")
    def publish_listing(listing_id: UUID, authorization: str | None = Header(default=None)):
        staff = admin_only(authorization)
        listing, _item = listing_and_item(listing_id, staff, owner=False)
        try:
            return {"listing": store_team.listing_view(store_team.publish(listing, staff["user_id"]))}
        except Exception as exc:
            raise failure(exc, "The listing could not be published.") from exc

    @router.post("/operations/store/listings/{listing_id}/send-back")
    def send_back_listing(listing_id: UUID, payload: ReviewNote, authorization: str | None = Header(default=None)):
        staff = admin_only(authorization)
        listing, _item = listing_and_item(listing_id, staff, owner=False)
        try:
            return {"listing": store_team.listing_view(store_team.send_back(listing, staff["user_id"], payload.note))}
        except Exception as exc:
            raise failure(exc, "The listing could not be sent back.") from exc

    @router.post("/operations/store/listings/{listing_id}/cancel")
    def cancel_listing(listing_id: UUID, payload: Reason, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        listing, item = listing_and_item(listing_id, staff, owner=False)
        if not is_admin(staff):
            require_owner(item, staff)
        try:
            return {"listing": store_team.listing_view(store_team.cancel(listing, staff["user_id"], payload.reason))}
        except Exception as exc:
            raise failure(exc, "The listing could not be cancelled.") from exc

    # ---- work item actions -------------------------------------------------------------------
    @router.post("/operations/work-items/{work_item_id}/map-category")
    def map_category(work_item_id: UUID, payload: CategoryChoice, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        item = load_item(work_item_id, staff)
        require_owner(item, staff)
        meta = item.get("metadata") or {}
        if meta.get("source_kind") != "unmapped_product":
            raise HTTPException(status_code=409, detail="This isn't a category task.")
        try:
            return store_team.map_category(str(meta.get("product_id")), payload.category_ref, staff["user_id"])
        except Exception as exc:
            raise failure(exc, "The category could not be saved.") from exc

    @router.post("/operations/work-items/{work_item_id}/retire")
    def retire_decision(work_item_id: UUID, payload: RetireDecision, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        item = load_item(work_item_id, staff)
        meta = item.get("metadata") or {}
        if meta.get("source_kind") != "retire_product":
            raise HTTPException(status_code=409, detail="This isn't a retire task.")
        waiting_for_admin = item.get("status") == "waiting" and meta.get("retire_requested_by")
        if waiting_for_admin and not is_admin(staff):
            raise HTTPException(status_code=409, detail="An administrator is deciding this one.")
        if not waiting_for_admin:
            require_owner(item, staff)
        try:
            if payload.decision == "keep":
                return store_team.keep_listing(item, staff["user_id"], actor_type(staff), payload.reason)
            return store_team.retire_listing(item, staff["user_id"], staff.get("role") or "worker", payload.reason)
        except Exception as exc:
            raise failure(exc, "That couldn't be saved.") from exc

    @router.post("/operations/work-items/{work_item_id}/campaign")
    def campaign_prep(work_item_id: UUID, payload: CampaignPrep, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        item = load_item(work_item_id, staff)
        require_owner(item, staff)
        if item.get("work_type") != "prepare_campaign":
            raise HTTPException(status_code=409, detail="This isn't a campaign task.")
        try:
            return campaigns.update_prep(item, prize_ready=payload.prize_ready, section_ready=payload.section_ready,
                                         announcement=payload.announcement, actor_id=staff["user_id"],
                                         actor_type=actor_type(staff))
        except Exception as exc:
            raise failure(exc, "The preparation could not be saved.") from exc

    # ---- store sections ------------------------------------------------------------------------
    @router.get("/operations/store/sections")
    def list_sections(authorization: str | None = Header(default=None)):
        store_staff(authorization)
        try:
            return {"sections": merch_sections.staff_sections()}
        except Exception as exc:
            raise failure(exc, "Sections could not be loaded.") from exc

    @router.get("/operations/store/section-candidates")
    def section_candidates(q: str = Query(default="", max_length=100), authorization: str | None = Header(default=None)):
        store_staff(authorization)
        from app.commerce import service
        products = [p for p in service.load_products() if merch_sections.product_is_live(p)]
        if q.strip():
            needle = q.strip().casefold()
            products = [p for p in products if needle in str(p.get("name") or "").casefold()]
        products.sort(key=lambda p: str(p.get("name") or "").casefold())
        return {"products": service.cards(products[:200])}

    def _save_section(payload: SectionInput, staff: dict, section_id: str | None):
        values = payload.model_dump(exclude={"product_ids"})
        if values.get("starts_at") is None:
            values.pop("starts_at")
        try:
            return {"section": merch_sections.save_section(values, [str(p) for p in payload.product_ids],
                                                           staff["user_id"], section_id)}
        except Exception as exc:
            raise failure(exc, "The section could not be saved.") from exc

    @router.post("/operations/store/sections", status_code=201)
    def create_section(payload: SectionInput, authorization: str | None = Header(default=None)):
        return _save_section(payload, store_staff(authorization), None)

    @router.put("/operations/store/sections/{section_id}")
    def update_section(section_id: UUID, payload: SectionInput, authorization: str | None = Header(default=None)):
        return _save_section(payload, store_staff(authorization), str(section_id))

    @router.post("/operations/store/sections/{section_id}/archive")
    def archive_section(section_id: UUID, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            merch_sections.archive_section(str(section_id), staff["user_id"])
        except Exception as exc:
            raise failure(exc, "The section could not be archived.") from exc
        return {"section_id": str(section_id), "status": "archived"}

    # ---- schedule ------------------------------------------------------------------------------
    @router.get("/operations/store/overview")
    def store_overview(authorization: str | None = Header(default=None)):
        """The Store team desk's cards (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R6): the next Finds drop and how full it is,
        listings by state, products waiting for a category, and campaigns, sections and drops in the next two weeks."""
        staff = store_staff(authorization)
        try:
            from app.finds import service as finds
            now = datetime.now(timezone.utc)
            drops = [d for d in finds.staff_drops() if d.get("state") in ("planned", "early", "released")]
            next_drop = drops[0] if drops else None
            find_rows = rows(db().table("finds").select("status").in_("status", list(finds.OPEN)).limit(2000).execute())
            listing_rows = rows(db().table("store_listings").select("status,updated_at")
                                .in_("status", ["draft", "in_review", "changes_requested", "published", "failed"])
                                .limit(2000).execute())
            week_ago = (now - timedelta(days=7)).isoformat()
            listings = {state: sum(1 for row in listing_rows if row.get("status") == state)
                        for state in ("draft", "in_review", "changes_requested", "failed")}
            listings["published_this_week"] = sum(1 for row in listing_rows if row.get("status") == "published"
                                                  and str(row.get("updated_at") or "") >= week_ago)
            unmapped = len(rows(db().table("directory_products").select("id").eq("category_needs_mapping", True)
                                .eq("active", True).limit(1000).execute()))
            coming = build_schedule(start=now, end=now + timedelta(days=14), admin=is_admin(staff), user_id=staff["user_id"],
                                    departments=["store_team"], types={"giveaway", "sale", "section", "drop", "launch"})
            return {"next_drop": next_drop,
                    "finds_in_research": {state: sum(1 for row in find_rows if row.get("status") == state) for state in finds.OPEN},
                    "listings": listings, "unmapped_products": unmapped,
                    "coming_up": sorted(coming, key=lambda entry: str(entry.get("at") or ""))[:8]}
        except Exception as exc:
            raise failure(exc, "The Store team desk's cards could not be loaded.") from exc

    @router.get("/operations/schedule")
    def schedule(start: datetime, end: datetime, types: str = Query(default="", max_length=200),
                 department: str | None = Query(default=None, max_length=40),
                 worker_id: UUID | None = None, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        admin = is_admin(staff)
        departments = [] if admin else departments_for(staff["user_id"])
        if department and not admin and department not in departments:
            raise HTTPException(status_code=403, detail="You can only look at your own departments.")
        start = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
        end = end if end.tzinfo else end.replace(tzinfo=timezone.utc)
        try:
            entries = build_schedule(start=start, end=end, admin=admin, user_id=staff["user_id"], departments=departments,
                                     types={t for t in types.split(",") if t} or None, department=department or None,
                                     worker_id=str(worker_id) if (worker_id and admin) else None)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            raise failure(exc, "The schedule could not be loaded.") from exc
        workers = []
        if admin:
            try:
                workers = rows(db().table("fayfort_workers").select("user_id,status")
                               .eq("status", "active").limit(200).execute())
                labelled = []
                for worker in workers:
                    label = str(worker["user_id"])[:8]
                    try:
                        user = getattr(db().auth.admin.get_user_by_id(str(worker["user_id"])), "user", None)
                        meta = getattr(user, "user_metadata", None) or {}
                        label = str(meta.get("display_name") or meta.get("full_name") or getattr(user, "email", None) or label)
                    except Exception:
                        pass
                    labelled.append({**worker, "label": label})
                workers = labelled
            except Exception:
                workers = []
        return {"entries": entries, "can_plan": admin, "workers": workers,
                "start": start.isoformat(), "end": end.isoformat()}

    return router
