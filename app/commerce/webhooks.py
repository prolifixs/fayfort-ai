"""Shopify webhooks (P1 catalog, P7/P8 orders). Signed with the app secret; each delivery is recorded
once (X-Shopify-Webhook-Id) and processed after the 200 so Shopify never times out."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from app.commerce import catalog, service, shopify
from app.commerce.db import db

logger = logging.getLogger(__name__)


def _mark(webhook_id: str, status: str, error: str | None = None) -> None:
    try:
        db().table("commerce_webhook_events").update({
            "status": status, "error": error[:500] if error else None,
            "processed_at": datetime.now(timezone.utc).isoformat()}).eq("webhook_id", webhook_id).execute()
    except Exception:
        logger.exception("Could not update a webhook record")


def process(topic: str, payload: dict, webhook_id: str) -> str:
    try:
        if topic in ("products/create", "products/update"):
            catalog.sync_one(str(payload.get("admin_graphql_api_id") or payload.get("id")))
        elif topic == "products/delete":
            catalog.retire_product(shopify.gid("Product", payload.get("id")))
        elif topic == "inventory_levels/update":
            item = shopify.admin_graphql(
                "query Item($id: ID!) { inventoryItem(id: $id) { variant { product { id } } } }",
                {"id": shopify.gid("InventoryItem", payload.get("inventory_item_id"))})
            product_id = (((item.get("inventoryItem") or {}).get("variant") or {}).get("product") or {}).get("id")
            if not product_id:
                _mark(webhook_id, "ignored", "inventory item has no product")
                return "ignored"
            catalog.sync_one(product_id)
        elif topic in ("orders/create", "orders/updated", "orders/paid", "orders/cancelled", "orders/fulfilled"):
            service.record_order(payload)
            try:
                from app.membership import landed
                landed.record_from_order(payload)
            except Exception:
                logger.exception("LANDED owner could not be recorded from an order")
        else:
            _mark(webhook_id, "ignored", f"topic {topic} is not handled")
            return "ignored"
        _mark(webhook_id, "processed")
        return "processed"
    except Exception as exc:
        logger.exception("Shopify webhook %s failed", topic)
        _mark(webhook_id, "failed", str(exc))
        return "failed"


def create_shopify_webhook_router() -> APIRouter:
    router = APIRouter(tags=["commerce"])

    @router.post("/commerce/shopify/webhooks")
    async def shopify_webhook(request: Request, background: BackgroundTasks,
                              x_shopify_hmac_sha256: str | None = Header(default=None),
                              x_shopify_topic: str | None = Header(default=None),
                              x_shopify_webhook_id: str | None = Header(default=None)):
        raw = await request.body()
        if not shopify.verify_webhook(raw, x_shopify_hmac_sha256):
            raise HTTPException(status_code=401, detail="Invalid webhook signature.")
        if len(raw) > 2_000_000:
            raise HTTPException(status_code=413, detail="Webhook body too large.")
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="Webhook body is not JSON.") from exc
        topic = (x_shopify_topic or "").strip().lower()
        webhook_id = (x_shopify_webhook_id or "").strip()[:200] or f"{topic}:{payload.get('id')}:{payload.get('updated_at')}"
        try:
            existing = db().table("commerce_webhook_events").select("webhook_id").eq("webhook_id", webhook_id) \
                .maybe_single().execute()
            if existing is not None and getattr(existing, "data", None):
                return {"ok": True, "duplicate": True}
            db().table("commerce_webhook_events").insert({"webhook_id": webhook_id, "topic": topic[:100]}).execute()
        except Exception:
            logger.exception("Could not record a webhook delivery; processing anyway")
        background.add_task(process, topic, payload if isinstance(payload, dict) else {}, webhook_id)
        return {"ok": True}

    return router
