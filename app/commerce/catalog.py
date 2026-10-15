"""P1 catalog sync: Shopify products -> directory_products (+ commerce_variants, commerce_media).

Shopify stays the source of truth. Webhooks resync one product; the reconcile loop and the
Control Center "Sync now" walk the whole catalog and retire products Shopify no longer has.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from app.commerce import shopify
from app.commerce.db import db, one, rows

logger = logging.getLogger(__name__)
_TAGS = re.compile(r"<[^>]+>")
# Shopify products with this tag stay out of the FayFort shop (services, ebooks such as LANDED).
HIDE_TAG = "fayfort-hide"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money(value: Any) -> float | None:
    try:
        return round(float(value), 2) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _https(url: Any) -> str | None:
    text = str(url or "").strip()
    return text if text.startswith("https://") else None


def category_lookup() -> tuple[set[str], dict[str, str]]:
    """Known category refs, plus product-type -> category ref for products with no FayFort category set."""
    found = rows(db().table("directory_categories").select("source_ref,product_type,category").limit(5000).execute())
    refs = {str(row["source_ref"]) for row in found}
    by_type: dict[str, str] = {}
    for row in found:
        for key in (row.get("product_type"), row.get("category")):
            if key:
                by_type.setdefault(str(key).strip().casefold(), str(row["source_ref"]))
    return refs, by_type


def resolve_category(node: dict, refs: set[str], by_type: dict[str, str]) -> str | None:
    value = ((node.get("category") or {}).get("value") or "").strip()
    if value in refs:
        return value
    product_type = str(node.get("productType") or "").strip().casefold()
    if product_type and product_type in by_type:
        return by_type[product_type]
    for tag in node.get("tags") or []:
        candidate = str(tag).strip()
        if candidate in refs:
            return candidate
        if candidate.casefold() in by_type:
            return by_type[candidate.casefold()]
    return None


def map_media(node: dict) -> list[dict]:
    media: list[dict] = []
    for item in ((node.get("media") or {}).get("nodes") or []):
        kind = item.get("mediaContentType")
        preview = _https(((item.get("preview") or {}).get("image") or {}).get("url"))
        if kind == "IMAGE":
            url = _https((item.get("image") or {}).get("url")) or preview
            if url:
                media.append({"media_type": "image", "url": url, "preview_url": preview, "alt": (item.get("alt") or None)})
        elif kind == "VIDEO":
            sources = item.get("sources") or []
            mp4 = next((s for s in sources if "mp4" in str(s.get("mimeType", ""))), sources[0] if sources else None)
            url = _https((mp4 or {}).get("url"))
            if url:
                media.append({"media_type": "video", "url": url, "preview_url": preview, "alt": (item.get("alt") or None)})
        elif kind == "EXTERNAL_VIDEO":
            url = _https(item.get("originUrl"))
            if url:
                media.append({"media_type": "video", "url": url, "preview_url": preview, "alt": (item.get("alt") or None)})
    for position, item in enumerate(media[:20]):
        item["position"] = position
        if item["alt"]:
            item["alt"] = str(item["alt"])[:512]
    return media[:20]


def map_variants(node: dict) -> list[dict]:
    variants = []
    for item in ((node.get("variants") or {}).get("nodes") or []):
        price = _money(item.get("price"))
        if price is None:
            continue
        variants.append({
            "shopify_variant_id": str(item["id"]),
            "title": str(item.get("title") or "")[:255],
            "sku": (str(item["sku"])[:255] if item.get("sku") else None),
            "price": price,
            "compare_at_price": _money(item.get("compareAtPrice")),
            "available": bool(item.get("availableForSale")),
            "inventory_quantity": item.get("inventoryQuantity"),
            "options": [{"name": o.get("name"), "value": o.get("value")} for o in item.get("selectedOptions") or []],
            "position": int(item.get("position") or len(variants) + 1),
            "image_url": _https((item.get("image") or {}).get("url")),
            "updated_at": now_iso(),
        })
    return variants


def map_product(node: dict, refs: set[str], by_type: dict[str, str]) -> dict:
    variants = map_variants(node)
    media = map_media(node)
    category = resolve_category(node, refs, by_type)
    price_range = node.get("priceRangeV2") or {}
    min_price = _money((price_range.get("minVariantPrice") or {}).get("amount"))
    max_price = _money((price_range.get("maxVariantPrice") or {}).get("amount"))
    currency = (price_range.get("minVariantPrice") or {}).get("currencyCode")
    compare = [v["compare_at_price"] for v in variants if v["compare_at_price"] and v["compare_at_price"] > v["price"]]
    in_stock = any(v["available"] for v in variants)
    status = str(node.get("status") or "").upper()
    hidden = any(str(tag).strip().casefold() == HIDE_TAG for tag in node.get("tags") or [])
    first = media[0] if media else None
    description = _TAGS.sub(" ", str(node.get("description") or "")).strip()
    return {
        "product": {
            "source": "shopify",
            "shopify_product_id": str(node["id"]),
            "shopify_handle": node.get("handle"),
            "shopify_status": status.lower() or None,
            "name": (str(node.get("title") or "Untitled product").strip() or "Untitled product")[:160],
            "description": description[:2000],
            "category_ref": category,
            "category_needs_mapping": category is None and not hidden,
            "vendor": (str(node.get("vendor"))[:200] if node.get("vendor") else None),
            "product_type": (str(node.get("productType"))[:200] if node.get("productType") else None),
            "tags": [str(tag)[:100] for tag in (node.get("tags") or [])][:50],
            "price_min": min_price,
            "price_max": max_price,
            "compare_at_max": max(compare) if compare else None,
            "currency": currency if currency and re.fullmatch(r"[A-Z]{3}", str(currency)) else None,
            "in_stock": in_stock,
            "total_inventory": node.get("totalInventory"),
            "availability_status": "available" if in_stock else "unavailable",
            "active": status == "ACTIVE" and not hidden,
            "online_store_url": _https(node.get("onlineStoreUrl")),
            "media_url": first["url"] if first else None,
            "media_type": first["media_type"] if first else None,
            "media_source": "url" if first else None,
            "media_storage_path": None,
            "shopify_updated_at": node.get("updatedAt"),
            "synced_at": now_iso(),
        },
        "variants": variants,
        "media": media,
    }


def upsert_product(node: dict, refs: set[str] | None = None, by_type: dict[str, str] | None = None) -> str:
    """Write one Shopify product and its variants and media. Returns the FayFort product id."""
    if refs is None or by_type is None:
        refs, by_type = category_lookup()
    mapped = map_product(node, refs, by_type)
    product = mapped["product"]
    existing = one(db().table("directory_products").select("id,in_stock,category_ref,category_needs_mapping")
                   .eq("shopify_product_id", product["shopify_product_id"]).maybe_single().execute())
    if existing and existing.get("category_ref") and product["category_ref"] is None and product["category_needs_mapping"]:
        # A category staff mapped in FayFort survives until Shopify's metafield catches up.
        product["category_ref"] = existing["category_ref"]
        product["category_needs_mapping"] = False
    if existing and existing.get("in_stock") is False and product["in_stock"]:
        product["restocked_at"] = now_iso()
    if existing:
        db().table("directory_products").update(product).eq("id", existing["id"]).execute()
        product_id = str(existing["id"])
    else:
        created = one(db().table("directory_products").insert(product).execute())
        if not created:
            raise RuntimeError("Product insert returned no row")
        product_id = str(created["id"])
    keep = []
    for variant in mapped["variants"]:
        db().table("commerce_variants").upsert({**variant, "product_id": product_id},
                                               on_conflict="shopify_variant_id").execute()
        keep.append(variant["shopify_variant_id"])
    current = rows(db().table("commerce_variants").select("id,shopify_variant_id").eq("product_id", product_id).execute())
    for row in current:
        if row["shopify_variant_id"] not in keep:
            db().table("commerce_variants").delete().eq("id", row["id"]).execute()
    db().table("commerce_media").delete().eq("product_id", product_id).execute()
    if mapped["media"]:
        db().table("commerce_media").insert([{**item, "product_id": product_id} for item in mapped["media"]]).execute()
    return product_id


def retire_product(shopify_product_id: str) -> bool:
    found = one(db().table("directory_products").select("id").eq("shopify_product_id", shopify_product_id)
                .maybe_single().execute())
    if not found:
        return False
    db().table("directory_products").update({"active": False, "shopify_status": "deleted", "in_stock": False,
                                             "availability_status": "unavailable", "synced_at": now_iso()}) \
        .eq("id", found["id"]).execute()
    return True


def sync_one(product_gid: str) -> str:
    node = shopify.fetch_product(product_gid)
    if not node:
        retire_product(shopify.gid("Product", product_gid))
        return "retired"
    upsert_product(node)
    return "upserted"


def _start_run(kind: str) -> str | None:
    try:
        run = one(db().table("commerce_sync_runs").insert({"kind": kind}).execute())
        return str(run["id"]) if run else None
    except Exception:
        logger.exception("Could not record a sync run")
        return None


def _finish_run(run_id: str | None, values: dict) -> None:
    if not run_id:
        return
    try:
        db().table("commerce_sync_runs").update({**values, "finished_at": now_iso()}).eq("id", run_id).execute()
    except Exception:
        logger.exception("Could not finish a sync run record")


def reconcile(kind: str = "reconcile", *, products: Callable[[], Iterable[dict]] | None = None) -> dict[str, int]:
    """Full walk of the Shopify catalog. Products missing from Shopify are retired, not deleted."""
    run_id = _start_run(kind)
    seen = upserted = removed = 0
    try:
        refs, by_type = category_lookup()
        live: set[str] = set()
        for node in (products or shopify.iter_products)():
            seen += 1
            try:
                upsert_product(node, refs, by_type)
                upserted += 1
                live.add(str(node["id"]))
            except Exception:
                logger.exception("Could not sync a Shopify product")
        known = rows(db().table("directory_products").select("id,shopify_product_id,active")
                     .eq("source", "shopify").limit(20000).execute())
        for row in known:
            if row.get("shopify_product_id") not in live and row.get("active"):
                if retire_product(str(row["shopify_product_id"])):
                    removed += 1
        result = {"products_seen": seen, "products_upserted": upserted, "products_removed": removed}
        _finish_run(run_id, {**result, "status": "ok"})
        return result
    except Exception as exc:
        _finish_run(run_id, {"products_seen": seen, "products_upserted": upserted, "products_removed": removed,
                             "status": "failed", "error": str(exc)[:500]})
        raise
