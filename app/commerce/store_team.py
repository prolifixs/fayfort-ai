"""Store team (docs/CATALOG_MERCHANDISING_PLAN.md §2–3): listing store products and sourcing items, the
administrator review that publishes them, mapping categories and retiring listings nobody wants.

Every piece of Store team work is an Operations work item in the ``store_team`` department, keyed like the other
outside-event items by ``metadata.source_kind`` + ``metadata.source_id``:

- store_listing     list_store_product / list_sourcing_item  (a listing being prepared, reviewed and published)
- unmapped_product  map_product                              (a synced Shopify product with no FayFort category)
- retire_product    retire_listing                           (no interest for 60 days, or sold out for 30 days)

Workers never change what customers see in Shopify: a store product is created as a DRAFT and only an
administrator's Publish (or Archive, for retiring) touches its status.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.accounts import operations_flow as flow
from app.commerce import shopify
from app.commerce.db import audit, db, one, rows

logger = logging.getLogger(__name__)

DEPARTMENT = "store_team"
EDITABLE = ("draft", "changes_requested")
OPEN = ("draft", "in_review", "changes_requested")
SOURCING_IDLE_DAYS = 60
SOLD_OUT_DAYS = 30
TREND_SHARES = 3
LISTING_FIELDS = (
    "title", "description", "category_ref", "option_name", "option_values", "price", "compare_at_price", "cost",
    "currency", "price_guide_min", "price_guide_max", "min_order", "lead_time_min_days", "lead_time_max_days",
    "availability_status", "planned_live_at", "source_url",
)
WORK_TYPE = {"store_product": "list_store_product", "sourcing_item": "list_sourcing_item"}
KIND_LABEL = {"store_product": "store product", "sourcing_item": "sourcing item"}
AVAILABILITY_LABEL = {"sourcing": "Sourced on request", "available": "Quick to source", "unavailable": "Not available now"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.isoformat()


def parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class ListingError(ValueError):
    """A listing can't do that right now (wrong status, missing details). Shown to staff as is."""


# ---------------------------------------------------------------------------------------------
# Notices
# ---------------------------------------------------------------------------------------------
def notify_admins(kind: str, item: dict | None, title: str, body: str, dedupe: str) -> None:
    try:
        db().rpc("notify_platform_admins", {
            "p_notification_type": kind, "p_work_item_id": (item or {}).get("id"),
            "p_title": title, "p_body": body,
            "p_href": f"/operations?workItem={item['id']}" if item else "/operations?view=products",
            "p_dedupe": dedupe}).execute()
    except Exception:
        logger.exception("Could not notify administrators")


def notify_worker(worker_id: str | None, kind: str, item: dict | None, title: str, body: str, dedupe: str) -> None:
    if not worker_id:
        return
    try:
        db().table("operations_worker_notifications").upsert({
            "worker_id": worker_id, "work_item_id": (item or {}).get("id"), "notification_type": kind,
            "title": title[:160], "body": body[:500],
            "href": f"/operations?workItem={item['id']}" if item else "/operations",
            "dedupe_key": f"{dedupe}:{worker_id}"[:240]}, on_conflict="dedupe_key", ignore_duplicates=True).execute()
    except Exception:
        logger.exception("Could not notify the worker")


# ---------------------------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------------------------
def get_listing(listing_id: str) -> dict:
    listing = one(db().table("store_listings").select("*").eq("id", str(listing_id)).limit(1).execute())
    if not listing:
        raise LookupError("Listing not found.")
    return listing


def listing_item(listing_id: str) -> dict | None:
    return flow.find_item("store_listing", str(listing_id))


def missing_details(listing: dict) -> list[str]:
    """What still has to be filled in before the listing can go to review."""
    missing = []
    if not str(listing.get("title") or "").strip():
        missing.append("a title")
    if not listing.get("category_ref"):
        missing.append("a category")
    if not (listing.get("media") or []):
        missing.append("at least one photo or video")
    if listing.get("kind") == "store_product":
        if not listing.get("price"):
            missing.append("a price")
        if listing.get("option_name") and not [v for v in listing.get("option_values") or [] if str(v).strip()]:
            missing.append("the option values (for example S, M, L)")
        if listing.get("compare_at_price") and listing.get("price") and float(listing["compare_at_price"]) <= float(listing["price"]):
            missing.append("a crossed-out price higher than the price (or none)")
    # A sourcing item may have no price: members then see "Contact our team for a price" (owner rule, 2026-10-20).
    if listing.get("kind") == "sourcing_item" and listing.get("id"):
        try:
            from app.finds import service as finds
            missing += finds.listing_missing(listing)
        except Exception:
            logger.exception("Could not check a find's research")
    return missing


def steps_done(listing: dict) -> dict[str, bool]:
    """Which parts are filled in, for the steps bar."""
    store = listing.get("kind") == "store_product"
    return {
        "details": bool(str(listing.get("title") or "").strip() and listing.get("category_ref")),
        "media": bool(listing.get("media")),
        "price": bool(listing.get("price")) if store else True,
    }


def listing_view(listing: dict) -> dict:
    view = dict(listing)
    view["missing"] = missing_details(listing)
    view["steps"] = steps_done(listing)
    view["kind_label"] = KIND_LABEL.get(listing.get("kind"), "listing")
    if listing.get("kind") == "sourcing_item" and listing.get("id"):
        try:
            from app.finds import service as finds
            find = finds.for_listing(str(listing["id"]))
            view["find"] = {"id": find["id"], "lane": find["lane"], "status": find["status"]} if find else None
        except Exception:
            view["find"] = None
    if listing.get("shopify_product_id"):
        try:
            view["shopify_admin_url"] = shopify.admin_product_url(listing["shopify_product_id"]) if shopify.shop_domain() else None
        except Exception:
            view["shopify_admin_url"] = None
    return view


def _summary(listing: dict) -> str:
    verb = "Edit" if listing.get("action") == "update" else "List"
    title = str(listing.get("title") or "").strip() or "untitled"
    return f"{verb} a {KIND_LABEL[listing['kind']]}: {title}"[:240]


def open_listing(*, kind: str, actor_id: str, actor_role: str, values: dict | None = None,
                 product_id: str | None = None, trend_item_id: str | None = None,
                 note: str | None = None) -> tuple[dict, dict | None]:
    """Start a listing and its work item. A worker who starts one has it claimed straight away."""
    if kind not in WORK_TYPE:
        raise ListingError("Choose a store product or a sourcing item.")
    row: dict[str, Any] = {"kind": kind, "action": "create", "status": "draft", "created_by": actor_id,
                           "media": [], **{k: v for k, v in (values or {}).items() if k in LISTING_FIELDS or k == "media"}}
    if product_id:
        product = one(db().table("directory_products").select("*").eq("id", str(product_id)).limit(1).execute())
        if not product:
            raise LookupError("Product not found.")
        expected = "store_product" if product.get("source") == "shopify" else "sourcing_item"
        if expected != kind:
            raise ListingError("That product is a different kind of listing.")
        existing = one(db().table("store_listings").select("id,status").eq("product_id", str(product_id))
                       .in_("status", list(OPEN)).limit(1).execute())
        if existing:
            raise ListingError("This product already has an edit in progress. Open it from the Store team queue.")
        row.update(prefill_from_product(product))
        row["action"] = "update"
    if trend_item_id:
        row["trend_item_id"] = str(trend_item_id)
    listing = one(db().table("store_listings").insert(row).execute())
    if not listing:
        raise RuntimeError("The listing could not be saved.")
    item = flow.ensure_item(
        source_kind="store_listing", source_id=str(listing["id"]), department=DEPARTMENT,
        work_type=WORK_TYPE[kind], summary=_summary(listing),
        next_action=note or "Fill in the details, photos and price, then send it for review.",
        metadata={"listing_kind": kind, "listing_action": listing["action"], "product_id": listing.get("product_id"),
                  "trend_item_id": listing.get("trend_item_id")},
        due_at=iso(now() + timedelta(days=3)),
    )
    if item and actor_role == "worker":
        try:
            claimed = db().rpc("claim_operations_work_item", {"p_work_item_id": item["id"], "p_worker_id": actor_id}).execute()
            data = getattr(claimed, "data", None)
            item = (data[0] if isinstance(data, list) and data else data) if isinstance(data, (list, dict)) else item
        except Exception:
            logger.info("Listing work item left open: the worker couldn't claim it (department access?)")
    return listing, item


def prefill_from_product(product: dict) -> dict:
    media = rows(db().table("commerce_media").select("position,media_type,url,alt").eq("product_id", str(product["id"]))
                 .order("position").execute())
    if not media and product.get("media_url"):
        media = [{"media_type": product.get("media_type") or "image", "url": product["media_url"],
                  "source": product.get("media_source") or "url"}]
    store = product.get("source") == "shopify"
    return {
        "product_id": str(product["id"]),
        "shopify_product_id": product.get("shopify_product_id"),
        "title": product.get("name") or "",
        "description": product.get("description") or "",
        "category_ref": product.get("category_ref"),
        "price": product.get("price_min") if store else None,
        "compare_at_price": product.get("compare_at_max") if store else None,
        "currency": product.get("currency"),
        "price_guide_min": None if store else product.get("price_min"),
        "price_guide_max": None if store else product.get("price_max"),
        "min_order": product.get("min_order"),
        "lead_time_min_days": product.get("lead_time_min_days"),
        "lead_time_max_days": product.get("lead_time_max_days"),
        "availability_status": product.get("availability_status") or "sourcing",
        "source_url": product.get("source_url"),
        "media": [{"media_type": m.get("media_type") or "image", "url": m["url"], "alt": m.get("alt"),
                   "source": m.get("source") or "existing"} for m in media if m.get("url")][:10],
    }


def update_listing(listing: dict, changes: dict) -> dict:
    if listing["status"] not in EDITABLE:
        raise ListingError("This listing is with an administrator. Wait for the review, or ask them to send it back.")
    values = {k: v for k, v in changes.items() if k in LISTING_FIELDS or k == "media"}
    if "media" in values:
        values["media"] = clean_media(values["media"])
    if not values:
        return listing
    values["updated_at"] = iso(now())
    db().table("store_listings").update(values).eq("id", str(listing["id"])).execute()
    updated = {**listing, **values}
    item = listing_item(str(listing["id"]))
    if item and ("title" in values) and item.get("summary") != _summary(updated):
        db().table("operations_work_items").update({"summary": _summary(updated), "updated_at": iso(now())}) \
            .eq("id", item["id"]).execute()
    return updated


def clean_media(media: Any) -> list[dict]:
    out = []
    for entry in (media or [])[:10]:
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or "").strip()
        if not url.startswith("https://"):
            continue
        out.append({"media_type": "video" if entry.get("media_type") == "video" else "image", "url": url[:2000],
                    "alt": (str(entry.get("alt"))[:200] if entry.get("alt") else None),
                    "source": entry.get("source") if entry.get("source") in ("upload", "url", "instagram", "existing", "trend") else "url",
                    **({"storage_path": str(entry["storage_path"])[:500]} if entry.get("storage_path") else {})})
    return out


def submit(listing: dict, actor_id: str) -> dict:
    """Send for review. A store product is created (or updated) in Shopify as a DRAFT first, so the administrator
    can see exactly what will go live."""
    if listing["status"] not in EDITABLE:
        raise ListingError("This listing was already sent for review.")
    missing = missing_details(listing)
    if missing:
        raise ListingError("Add " + ", ".join(missing) + " first.")
    values: dict[str, Any] = {"status": "in_review", "submitted_by": actor_id, "submitted_at": iso(now()),
                              "error": None, "updated_at": iso(now())}
    if listing["kind"] == "store_product" and listing["action"] == "create":
        if not shopify.admin_configured():
            raise ListingError("Shopify isn't connected yet, so store products can't be drafted.")
        draft = {**listing}
        if listing.get("shopify_product_id"):
            shopify.update_listing_product({**draft, "new_media": []})
        else:
            values["shopify_product_id"] = shopify.create_listing_product(draft)
    db().table("store_listings").update(values).eq("id", str(listing["id"])).execute()
    listing = {**listing, **values}
    _find_hook("on_submit", listing)
    item = listing_item(str(listing["id"]))
    if item:
        reason = "Waiting for an administrator to review and publish."
        db().table("operations_work_items").update({
            "status": "waiting", "waiting_on": "internal", "waiting_reason": reason, "claimed_until": None,
            "next_action": "An administrator reviews the preview, then publishes it or sends it back with a note.",
            "updated_at": iso(now()), "version": int(item.get("version") or 1) + 1}).eq("id", item["id"]).execute()
        flow.add_event(item, "status_changed", "Sent for review.", next_status="waiting",
                       actor_user_id=actor_id, actor_type="worker")
        notify_admins("review_needed", item, f"Review a {KIND_LABEL[listing['kind']]}: {listing['title']}"[:160],
                      "A Store team listing is ready. Check the preview, then publish it or send it back.",
                      f"listing:{listing['id']}:{listing['submitted_at']}")
    return listing


def send_back(listing: dict, admin_id: str, note: str) -> dict:
    if listing["status"] != "in_review":
        raise ListingError("Only a listing waiting for review can be sent back.")
    values = {"status": "changes_requested", "review_note": note.strip()[:1000], "reviewed_by": admin_id,
              "reviewed_at": iso(now()), "updated_at": iso(now())}
    db().table("store_listings").update(values).eq("id", str(listing["id"])).execute()
    _find_hook("on_send_back", listing)
    item = listing_item(str(listing["id"]))
    if item:
        submitter = listing.get("submitted_by") or item.get("assigned_worker_id")
        db().table("operations_work_items").update({
            "status": "open", "waiting_on": None, "waiting_reason": None, "claimed_until": None,
            "assigned_worker_id": submitter if submitter and submitter != admin_id else None,
            "next_action": f"Changes asked: {note.strip()}"[:500], "updated_at": iso(now()),
            "version": int(item.get("version") or 1) + 1}).eq("id", item["id"]).execute()
        flow.add_event(item, "status_changed", f"Sent back by an administrator: {note.strip()}"[:1000],
                       next_status="open", actor_user_id=admin_id, actor_type="platform_admin")
        notify_worker(submitter, "review_done", item, f"Changes asked: {listing['title']}"[:160], note.strip()[:500],
                      f"listing-back:{listing['id']}:{values['reviewed_at']}")
    audit(admin_id, "listing_sent_back", {"listing_id": str(listing["id"])})
    return {**listing, **values}


def publish(listing: dict, admin_id: str) -> dict:
    """The administrator's Publish. Returns the listing plus ``channels_published`` for store products."""
    if listing["status"] != "in_review":
        raise ListingError("Only a listing waiting for review can be published.")
    result: dict[str, Any] = {}
    product_id = listing.get("product_id")
    if listing["kind"] == "store_product":
        if not shopify.admin_configured():
            raise ListingError("Shopify isn't connected.")
        if listing["action"] == "update":
            new_media = [m for m in listing.get("media") or [] if m.get("source") != "existing"]
            shopify.update_listing_product({**listing, "new_media": new_media})
        else:
            if not listing.get("shopify_product_id"):
                raise ListingError("The Shopify draft is missing. Send it back so the worker can submit it again.")
            shopify.set_product_status(listing["shopify_product_id"], "ACTIVE")
            result["channels_published"] = shopify.publish_to_sales_channels(listing["shopify_product_id"])
        try:
            from app.commerce import catalog
            catalog.sync_one(listing["shopify_product_id"])
        except Exception:
            logger.exception("Published, but the immediate catalog refresh failed; the webhook will catch up")
        found = one(db().table("directory_products").select("id")
                    .eq("shopify_product_id", shopify.gid("Product", listing["shopify_product_id"])).limit(1).execute())
        product_id = (found or {}).get("id") or product_id
    else:
        product_id = save_sourcing_product(listing, admin_id)
        try:
            from app.finds import service as finds
            finds.on_publish(listing, str(product_id), admin_id)
        except Exception:
            logger.exception("Published, but the find could not be scheduled")
    values = {"status": "published", "product_id": str(product_id) if product_id else None, "reviewed_by": admin_id,
              "reviewed_at": iso(now()), "published_at": iso(now()), "updated_at": iso(now()), "review_note": None}
    db().table("store_listings").update(values).eq("id", str(listing["id"])).execute()
    if listing.get("trend_item_id") and product_id:
        db().table("commerce_trend_items").update({"linked_product_id": str(product_id)}) \
            .eq("id", str(listing["trend_item_id"])).execute()
    item = listing_item(str(listing["id"]))
    reason = "Published by an administrator."
    if listing["kind"] == "store_product" and listing["action"] == "create" and not result.get("channels_published"):
        reason += " Tick its sales channels in Shopify if it doesn't show in the shop."
    flow.close_item("store_listing", str(listing["id"]), reason=reason)
    if item:
        notify_worker(listing.get("submitted_by"), "review_done", item, f"Published: {listing['title']}"[:160],
                      "An administrator published your listing.", f"listing-live:{listing['id']}")
    try:
        from app.commerce import service
        service.clear_cache()
    except Exception:
        pass
    audit(admin_id, "listing_published", {"listing_id": str(listing["id"]), "product_id": str(product_id or "")})
    return {**listing, **values, **result}


def _find_hook(name: str, listing: dict) -> None:
    try:
        from app.finds import service as finds
        getattr(finds, name)(listing)
    except Exception:
        logger.exception("Could not update the find for a listing (%s)", name)


def save_sourcing_product(listing: dict, actor_id: str) -> str:
    media = listing.get("media") or []
    try:
        from app.finds import service as finds
        find_active = finds.publish_active(listing)
    except Exception:
        logger.exception("Could not check whether a listing is a find")
        find_active = None
    first = media[0] if media else None
    values: dict[str, Any] = {
        "source": "fayfort", "name": str(listing["title"]).strip()[:160],
        "description": str(listing.get("description") or "")[:2000], "category_ref": listing["category_ref"],
        "availability_status": listing.get("availability_status") or "sourcing",
        "active": True if find_active is None else find_active,  # a find stays out of the catalog until its drop
        "price_min": listing.get("price_guide_min"), "price_max": listing.get("price_guide_max") or listing.get("price_guide_min"),
        "currency": listing.get("currency") or "USD", "min_order": listing.get("min_order"),
        "lead_time_min_days": listing.get("lead_time_min_days"), "lead_time_max_days": listing.get("lead_time_max_days"),
        "media_url": first["url"] if first else None,
        "media_type": (first.get("media_type") or "image") if first else None,
        "media_source": ("instagram" if first.get("source") == "instagram" else "url") if first else None,
        "media_storage_path": None, "updated_by": actor_id, "retired_at": None, "retired_reason": None,
        "source_url": listing.get("source_url"),
    }
    if listing.get("product_id"):
        before = one(db().table("directory_products").select("availability_status").eq("id", str(listing["product_id"]))
                     .limit(1).execute()) or {}
        db().table("directory_products").update(values).eq("id", str(listing["product_id"])).execute()
        product_id = str(listing["product_id"])
        if find_active is not None and before.get("availability_status") != values["availability_status"]:
            try:
                from app.finds import service as finds
                finds.availability_changed(product_id, values["availability_status"])
            except Exception:
                logger.exception("Could not alert members watching a find")
    else:
        created = one(db().table("directory_products").insert({**values, "created_by": actor_id}).execute())
        if not created:
            raise RuntimeError("The sourcing item could not be saved.")
        product_id = str(created["id"])
    db().table("commerce_media").delete().eq("product_id", product_id).execute()
    gallery = [{"product_id": product_id, "position": index, "media_type": m.get("media_type") or "image",
                "url": m["url"], "alt": m.get("alt")} for index, m in enumerate(media[:10]) if m.get("source") != "instagram"]
    if gallery:
        db().table("commerce_media").insert(gallery).execute()
    return product_id


# ---------------------------------------------------------------------------------------------
# Add a sourcing item from a product link (owner request, 2026-10-20)
# ---------------------------------------------------------------------------------------------
COVER_MAX = 1200
GENERIC_TITLES = {"instagram", "login • instagram", "tiktok - make your day", "tiktok", "access denied", "just a moment...",
                  "attention required! | cloudflare", "robot check", "captcha", "security check", "page not found"}


def _price(value: Any) -> float | None:
    try:
        number = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return round(number, 2) if 0 < number < 10_000_000 else None


def shrink_cover(content: bytes) -> bytes:
    """One cover photo per link item, at most COVER_MAX px on the long side, saved as JPEG."""
    from io import BytesIO
    from PIL import Image
    with Image.open(BytesIO(content)) as image:
        image.load()
        image = image.convert("RGB")
        image.thumbnail((COVER_MAX, COVER_MAX))
        out = BytesIO()
        image.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue()


def fill_from_link(listing: dict, url: str, *, fetch=None, fetch_image=None, bucket: str = "product-media") -> dict:
    """Read a shop page and fill the empty parts of a sourcing listing: name, description, rough price and one
    cover photo. Keeps the link on the listing. Returns {"listing", "read", "filled", "notes"}."""
    from app.commerce import links
    fetch = fetch or links.fetch_preview
    fetch_image = fetch_image or links.fetch_image
    if listing.get("kind") != "sourcing_item":
        raise ListingError("Links fill sourcing items only.")
    if listing["status"] not in EDITABLE:
        raise ListingError("This listing is with an administrator.")
    canonical = links.canonical_url(links.find_url(url) or url)
    if not canonical:
        raise ListingError("That doesn't look like a web link. Paste the full address, starting with https://")
    product = one(db().table("directory_products").select("id,name").eq("source_url", canonical).eq("active", True)
                  .limit(1).execute())
    if product and str(product["id"]) != str(listing.get("product_id") or ""):
        raise ListingError(f"This link is already listed as \u201c{product.get('name')}\u201d. Edit that item from Sourcing instead.")
    other = one(db().table("store_listings").select("id,title").eq("source_url", canonical).in_("status", list(OPEN))
                .neq("id", str(listing["id"])).limit(1).execute())
    if other:
        raise ListingError(f"Another listing in progress already uses this link ({other.get('title') or 'untitled'}).")
    preview = fetch(canonical)
    title = (preview.title or "").strip()
    if title.casefold() in GENERIC_TITLES or len(title) < 3:
        title = ""
    platform = getattr(preview, "platform", "web")
    changes: dict[str, Any] = {"source_url": canonical}
    filled: list[str] = []
    notes: list[str] = []
    if title and not str(listing.get("title") or "").strip():
        changes["title"] = title[:160]
        filled.append("name")
    description = (preview.description or "").strip()
    if description and not str(listing.get("description") or "").strip():
        changes["description"] = description[:2000]
        filled.append("description")
    extra = getattr(preview, "extra", None) or {}
    price = _price(extra.get("price"))
    currency = str(extra.get("currency") or "").upper()
    if price and not listing.get("price_guide_min"):
        changes["price_guide_min"] = price
        if re.fullmatch(r"[A-Z]{3}", currency):
            changes["currency"] = currency
        filled.append("rough price")
    media = list(listing.get("media") or [])
    if preview.image_url and not media and title:
        got = fetch_image(preview.image_url)
        if got:
            try:
                cover = shrink_cover(got[0])
                path = f"listings/{listing['id']}/link-cover.jpg"
                storage = db().storage.from_(bucket)
                storage.upload(path, cover, {"content-type": "image/jpeg", "upsert": "true"})
                public = storage.get_public_url(path)
                public_url = public if isinstance(public, str) else (public or {}).get("publicUrl") or (public or {}).get("publicURL")
                if public_url:
                    changes["media"] = [{"media_type": "image", "url": str(public_url).split("?", 1)[0],
                                         "alt": (title or "Product")[:200], "source": "upload", "storage_path": path}]
                    filled.append("cover photo")
            except Exception:
                logger.warning("Could not save the cover photo from a product link", exc_info=True)
    if not title:
        if platform == "instagram":
            notes.append("Instagram doesn't let us read posts. Type the name and price, and upload a photo from the post.")
        else:
            notes.append("This shop didn't let us read the page. The link is saved; type the name and price and upload a photo.")
    else:
        if "cover photo" not in filled and not media:
            notes.append("No photo could be taken from the page. Upload one.")
        if "rough price" not in filled and not listing.get("price_guide_min"):
            notes.append("The page shows no price we can read. Add a rough price, or leave it for \u201cContact our team\u201d.")
    if "rough price" in filled and changes.get("currency") and changes["currency"] != "USD":
        notes.append(f"The price is in {changes['currency']}. Check it before you send it for review.")
    updated = update_listing(listing, changes)
    return {"listing": updated, "read": bool(title), "filled": filled, "notes": notes}


def cancel(listing: dict, actor_id: str, reason: str) -> dict:
    if listing["status"] not in OPEN:
        raise ListingError("This listing is already finished.")
    values = {"status": "cancelled", "updated_at": iso(now()), "review_note": reason.strip()[:1000] or None}
    db().table("store_listings").update(values).eq("id", str(listing["id"])).execute()
    note = f"Listing cancelled: {reason.strip()}"[:1000]
    if listing.get("shopify_product_id") and listing.get("action") == "create":
        note += " The Shopify draft stays in Shopify; delete it there if it isn't needed."
    flow.close_item("store_listing", str(listing["id"]), status="cancelled", reason=note)
    _find_hook("on_cancel", listing)
    return {**listing, **values}


# ---------------------------------------------------------------------------------------------
# Products list for the workspace
# ---------------------------------------------------------------------------------------------
def store_products(q: str = "") -> list[dict]:
    found = rows(db().table("directory_products").select(
        "id,name,source,shopify_product_id,shopify_status,category_ref,category_needs_mapping,price_min,price_max,"
        "compare_at_max,currency,in_stock,total_inventory,active,media_url,media_type,sold_out_since,updated_at")
        .eq("source", "shopify").order("name").limit(1000).execute())
    return _with_state(found, q)


def sourcing_products(q: str = "") -> list[dict]:
    found = rows(db().table("directory_products").select(
        "id,name,source,category_ref,description,availability_status,price_min,price_max,currency,min_order,"
        "lead_time_min_days,lead_time_max_days,active,media_url,media_type,media_source,retired_at,created_at,updated_at")
        .eq("source", "fayfort").order("name").limit(1000).execute())
    return _with_state(found, q)


def _with_state(found: list[dict], q: str) -> list[dict]:
    if q.strip():
        needle = q.strip().casefold()
        found = [p for p in found if needle in str(p.get("name") or "").casefold()]
    ids = [str(p["id"]) for p in found]
    pending = {}
    if ids:
        for row in rows(db().table("store_listings").select("id,product_id,status").in_("product_id", ids)
                        .in_("status", list(OPEN)).execute()):
            pending[str(row["product_id"])] = row
    for product in found:
        status = str(product.get("shopify_status") or "").lower()
        listing = pending.get(str(product["id"]))
        if listing:
            state = "in_review" if listing["status"] == "in_review" else "editing"
        elif product.get("source") == "shopify":
            state = ("hidden" if not product.get("active") and status == "active"
                     else "draft" if status == "draft" else "archived" if status in ("archived", "deleted")
                     else "sold_out" if product.get("in_stock") is False else "live")
        else:
            state = "retired" if product.get("retired_at") or not product.get("active") else "live"
        product["state"] = state
        product["open_listing_id"] = listing["id"] if listing else None
        if product.get("shopify_product_id"):
            try:
                product["shopify_admin_url"] = shopify.admin_product_url(product["shopify_product_id"]) if shopify.shop_domain() else None
            except Exception:
                product["shopify_admin_url"] = None
    return found


def listings(statuses: list[str] | None = None) -> list[dict]:
    query = db().table("store_listings").select("*")
    if statuses:
        query = query.in_("status", statuses)
    return [listing_view(row) for row in rows(query.order("updated_at", desc=True).limit(300).execute())]


# ---------------------------------------------------------------------------------------------
# Map new products (synced Shopify products with no FayFort category)
# ---------------------------------------------------------------------------------------------
def _active_item_for(kind: str, product_id: str) -> dict | None:
    return one(db().table("operations_work_items").select("*").eq("metadata->>source_kind", kind)
               .eq("metadata->>product_id", str(product_id)).in_("status", list(flow.ACTIVE)).limit(1).execute())


def sync_unmapped_products() -> int:
    opened = 0
    products = rows(db().table("directory_products").select("id,name,category_needs_mapping,shopify_status")
                    .eq("category_needs_mapping", True).limit(500).execute())
    waiting = {str(p["id"]) for p in products}
    for product in products:
        if _active_item_for("unmapped_product", str(product["id"])):
            continue
        if flow.ensure_item(source_kind="unmapped_product", source_id=f"{product['id']}:{now().date().isoformat()}",
                            department=DEPARTMENT, work_type="map_product",
                            summary=f"Choose a category: {str(product.get('name') or 'new product')[:180]}",
                            next_action="Pick the FayFort category that fits so members can find it in Browse.",
                            priority="low", metadata={"product_id": str(product["id"]), "product_name": product.get("name")},
                            due_at=iso(now() + timedelta(days=2))):
            opened += 1
    for item in rows(db().table("operations_work_items").select("*").eq("work_type", "map_product")
                     .in_("status", list(flow.ACTIVE)).execute()):
        product_id = str((item.get("metadata") or {}).get("product_id") or "")
        if product_id and product_id not in waiting:
            flow.close_item("unmapped_product", str(item["metadata"]["source_id"]), reason="The product has a category now.")
    return opened


def map_category(product_id: str, category_ref: str, actor_id: str) -> dict:
    product = one(db().table("directory_products").select("id,source,shopify_product_id").eq("id", str(product_id))
                  .limit(1).execute())
    if not product:
        raise LookupError("Product not found.")
    category = one(db().table("directory_categories").select("source_ref").eq("source_ref", category_ref).limit(1).execute())
    if not category:
        raise ListingError("Choose one of the FayFort categories.")
    if product.get("source") == "shopify" and shopify.admin_configured():
        shopify.set_product_category(product["shopify_product_id"], category_ref)  # a FayFort field, not visible to buyers
    db().table("directory_products").update({"category_ref": category_ref, "category_needs_mapping": False}) \
        .eq("id", str(product_id)).execute()
    item = _active_item_for("unmapped_product", str(product_id))
    if item:
        flow.close_item("unmapped_product", str(item["metadata"]["source_id"]), reason=f"Category set to {category_ref}.")
    audit(actor_id, "category_mapped", {"product_id": str(product_id), "category_ref": category_ref})
    return {"product_id": str(product_id), "category_ref": category_ref}


# ---------------------------------------------------------------------------------------------
# Retire listings nobody wants
# ---------------------------------------------------------------------------------------------
def retire_candidates(at: datetime | None = None) -> list[tuple[dict, str]]:
    at = at or now()
    out: list[tuple[dict, str]] = []
    products = rows(db().table("directory_products").select(
        "id,name,source,shopify_product_id,in_stock,sold_out_since,retire_snoozed_until,created_at,active")
        .eq("active", True).limit(5000).execute())
    idle_since = iso(at - timedelta(days=SOURCING_IDLE_DAYS))
    sourcing = [p for p in products if p.get("source") == "fayfort" and (parse(p.get("created_at")) or at) < at - timedelta(days=SOURCING_IDLE_DAYS)]
    old_enough = {str(p["id"]) for p in sourcing}
    interested: set[str] = set()
    if sourcing:
        ids = [str(p["id"]) for p in sourcing]
        for event in rows(db().table("commerce_intent_events").select("product_id").in_("product_id", ids)
                          .gte("created_at", idle_since).limit(20000).execute()):
            interested.add(str(event.get("product_id")))
        for request in rows(db().table("member_purchase_requests").select("product_id").in_("product_id", ids)
                            .gte("created_at", idle_since).limit(5000).execute()):
            interested.add(str(request.get("product_id")))
    for product in products:
        snoozed = parse(product.get("retire_snoozed_until"))
        if snoozed and snoozed > at:
            continue
        if product.get("source") == "fayfort" and str(product["id"]) in old_enough and str(product["id"]) not in interested:
            out.append((product, f"No views or requests in {SOURCING_IDLE_DAYS} days."))
        elif product.get("source") == "shopify" and product.get("in_stock") is False:
            since = parse(product.get("sold_out_since"))
            if since and since < at - timedelta(days=SOLD_OUT_DAYS):
                out.append((product, f"Sold out since {since.date().isoformat()} ({(at - since).days} days)."))
    return out


def sync_retire_candidates() -> int:
    opened = 0
    for product, reason in retire_candidates():
        if _active_item_for("retire_product", str(product["id"])):
            continue
        store = product.get("source") == "shopify"
        if flow.ensure_item(source_kind="retire_product", source_id=f"{product['id']}:{now().date().isoformat()}",
                            department=DEPARTMENT, work_type="retire_listing",
                            summary=f"Retire or keep: {str(product.get('name') or 'listing')[:180]}",
                            next_action=f"{reason} Retire it, or keep it with a reason.",
                            priority="low", due_at=iso(now() + timedelta(days=7)),
                            metadata={"product_id": str(product["id"]), "product_name": product.get("name"),
                                      "product_source": product.get("source"), "reason": reason,
                                      "store_product": store}):
            opened += 1
    return opened


def keep_listing(item: dict, actor_id: str, actor_type: str, reason: str) -> dict:
    meta = item.get("metadata") or {}
    product_id = str(meta.get("product_id") or "")
    days = SOLD_OUT_DAYS if meta.get("store_product") else SOURCING_IDLE_DAYS
    until = iso(now() + timedelta(days=days))
    db().table("directory_products").update({"retire_snoozed_until": until}).eq("id", product_id).execute()
    flow.add_event(item, "status_changed", f"Kept: {reason.strip()}"[:1000], actor_user_id=actor_id, actor_type=actor_type)
    flow.close_item("retire_product", str(meta.get("source_id")), reason=f"Kept for another {days} days.")
    return {"kept_until": until}


def retire_listing(item: dict, actor_id: str, actor_role: str, reason: str) -> dict:
    """Sourcing items retire straight away (they come back by publishing an edit). A store product is archived in
    Shopify, which only an administrator can do: a worker's choice goes to an administrator to confirm."""
    meta = item.get("metadata") or {}
    product_id = str(meta.get("product_id") or "")
    product = one(db().table("directory_products").select("id,name,source,shopify_product_id").eq("id", product_id)
                  .limit(1).execute())
    if not product:
        raise LookupError("Product not found.")
    actor_type = "platform_admin" if actor_role == "platform_admin" else "worker"
    clean = reason.strip()[:500]
    if product.get("source") == "shopify":
        if actor_role != "platform_admin":
            db().table("operations_work_items").update({
                "status": "waiting", "waiting_on": "internal",
                "waiting_reason": "Waiting for an administrator to archive it in Shopify.", "claimed_until": None,
                "metadata": {**meta, "retire_requested_by": actor_id, "retire_reason": clean},
                "next_action": "An administrator confirms and archives the product in Shopify.",
                "updated_at": iso(now()), "version": int(item.get("version") or 1) + 1}).eq("id", item["id"]).execute()
            flow.add_event(item, "status_changed", f"Asked to retire: {clean}", next_status="waiting",
                           actor_user_id=actor_id, actor_type=actor_type)
            notify_admins("review_needed", item, f"Archive in Shopify? {product.get('name')}"[:160],
                          f"The Store team asks to retire this sold-out product: {clean}"[:500], f"retire:{item['id']}")
            return {"status": "waiting_for_admin"}
        if shopify.admin_configured() and product.get("shopify_product_id"):
            shopify.set_product_status(product["shopify_product_id"], "ARCHIVED")
    db().table("directory_products").update({"active": False, "retired_at": iso(now()), "retired_reason": clean or None}) \
        .eq("id", product_id).execute()
    flow.add_event(item, "status_changed", f"Retired: {clean}"[:1000], actor_user_id=actor_id, actor_type=actor_type)
    flow.close_item("retire_product", str(meta.get("source_id")), reason="Retired.")
    db().table("merch_section_items").delete().eq("product_id", product_id).execute()
    audit(actor_id, "listing_retired", {"product_id": product_id})
    return {"status": "retired"}


# ---------------------------------------------------------------------------------------------
# Trends shared by 3+ members become a sourcing listing to prepare
# ---------------------------------------------------------------------------------------------
def sync_trend_listings() -> int:
    opened = 0
    trends = rows(db().table("commerce_trend_items").select(
        "id,title,description,image_url,canonical_url,platform,share_count,status,linked_product_id")
        .in_("status", ["open", "pooling"]).gte("share_count", TREND_SHARES).limit(200).execute())
    for trend in trends:
        if trend.get("linked_product_id"):
            continue
        if one(db().table("store_listings").select("id").eq("trend_item_id", str(trend["id"])).limit(1).execute()):
            continue  # one listing per trend, ever: a cancelled one isn't reopened
        title = str(trend.get("title") or "Shared item").strip()[:160]
        media = [{"media_type": "image", "url": trend["image_url"], "source": "trend"}] \
            if str(trend.get("image_url") or "").startswith("https://") else []
        description = str(trend.get("description") or "").strip()
        if trend.get("canonical_url"):
            description = (description + "\n\n" if description else "") + f"Shared from: {trend['canonical_url']}"
        try:
            listing, item = open_listing(
                kind="sourcing_item", actor_id=None, actor_role="system",  # type: ignore[arg-type]
                values={"title": title, "description": description[:5000], "media": media},
                trend_item_id=str(trend["id"]),
                note=f"{trend.get('share_count')} members shared this. Check it, add photos and a price guide, then send it for review.")
        except Exception:
            logger.exception("Could not open a listing for a trend")
            continue
        if item:
            opened += 1
            db().table("operations_work_items").update({
                "summary": f"List a sourcing item: {title} · {trend.get('share_count')} members shared it"[:240]}) \
                .eq("id", item["id"]).execute()
    return opened
