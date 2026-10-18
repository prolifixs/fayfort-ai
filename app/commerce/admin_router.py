"""Control Center commerce API (platform admins): Shopify connection and sync health, category
mapping, the grouped trend queue and pools, invoices, publishing sourced items, flash sales and
codes, giveaways, and orders."""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.commerce import catalog, service, shopify
from app.commerce.db import audit, db, one, rows
from app.config.settings import settings
from app.directory.identity import trusted_platform_admin
from app.membership import plans

logger = logging.getLogger(__name__)


class CategoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category_ref: str = Field(min_length=1, max_length=200)


class TrendUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "pooling", "sourcing", "closed", "dismissed"] | None = None
    linked_product_id: UUID | None = None
    unlink_product: bool = False
    pool_target: int | None = Field(default=None, ge=2, le=10000)
    pool_price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    pool_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    pool_deadline: datetime | None = None
    pool_note: str | None = Field(default=None, max_length=500)


class InvoiceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID


class DepositInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    expected_total: float = Field(gt=0, le=1_000_000)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")


class PublishInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID | None = None
    trend_item_id: UUID | None = None
    title: str | None = Field(default=None, max_length=255)
    price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    category_ref: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def one_source(self):
        if bool(self.request_id) == bool(self.trend_item_id):
            raise ValueError("Choose a request or a trend item.")
        return self


class SaleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    discount_type: Literal["percentage", "fixed_amount"]
    value: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    product_ids: list[UUID] = Field(min_length=1, max_length=100)
    starts_at: datetime
    ends_at: datetime
    code: str | None = Field(default=None, pattern=r"^[A-Z0-9_-]{3,40}$")
    usage_limit: int | None = Field(default=None, ge=1, le=100000)

    @field_validator("title")
    @classmethod
    def trimmed(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Required")
        return value.strip()

    @model_validator(mode="after")
    def check(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("The sale must end after it starts.")
        if self.discount_type == "percentage" and self.value > 90:
            raise ValueError("Percentage sales are capped at 90%.")
        return self


class GiveawayInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Scheduled by default: it opens and closes by itself on its dates. "draft" keeps it hidden until opened.
    status: Literal["open", "draft"] = "open"
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    prize_text: str = Field(min_length=1, max_length=300)
    prize_product_id: UUID | None = None
    starts_at: datetime
    ends_at: datetime
    winner_count: int = Field(default=1, ge=1, le=50)

    @model_validator(mode="after")
    def window(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("The giveaway must end after it starts.")
        return self


class GiveawayStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["open", "cancelled"]


def _iso(value: datetime) -> str:
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()


def create_admin_commerce_router() -> APIRouter:
    router = APIRouter(tags=["commerce"])
    sync_lock = threading.Lock()

    def require_admin(authorization: str | None) -> str:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return admin["user_id"]

    def require_shopify() -> None:
        if not shopify.admin_configured():
            raise HTTPException(status_code=409, detail="Shopify isn't connected yet. Add the Shopify settings on the API server first.")

    def shopify_failure(exc: Exception) -> HTTPException:
        logger.warning("Shopify call failed: %s", exc)
        return HTTPException(status_code=502, detail=f"Shopify: {exc}")

    # ---- overview, setup, sync --------------------------------------------------------------
    @router.get("/platform/commerce/overview")
    def overview(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            products = rows(db().table("directory_products").select("source,active,in_stock,category_needs_mapping")
                            .limit(20000).execute())
            shopify_products = [p for p in products if p.get("source") == "shopify"]
            runs = rows(db().table("commerce_sync_runs").select("*").order("started_at", desc=True).limit(5).execute())
            hooks = rows(db().table("commerce_webhook_events").select("topic,status,received_at,error")
                         .order("received_at", desc=True).limit(10).execute())
            trends = rows(db().table("commerce_trend_items").select("status,want_count,pool_target").limit(5000).execute())
            invoices = rows(db().table("commerce_invoices").select("status").limit(5000).execute())
            since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            orders = rows(db().table("commerce_orders").select("id,total").gte("placed_at", since).limit(5000).execute())
            checkouts = rows(db().table("commerce_checkouts").select("id").gte("created_at", since).limit(5000).execute())
            webhook_url = (settings.PUBLIC_API_URL or "").rstrip("/") + "/commerce/shopify/webhooks"
            return {
                "connection": {
                    "store_domain": shopify.shop_domain() or None,
                    "admin_configured": shopify.admin_configured(),
                    "storefront_configured": shopify.storefront_configured(),
                    "webhook_secret_configured": bool(shopify.webhook_secret()),
                    "sync_enabled": settings.COMMERCE_SYNC_ENABLED,
                    "webhook_url": webhook_url if webhook_url.startswith("https://") else None,
                    "api_version": settings.SHOPIFY_API_VERSION,
                },
                "catalog": {
                    "shopify_products": len(shopify_products),
                    "shopify_active": sum(1 for p in shopify_products if p.get("active")),
                    "in_stock": sum(1 for p in shopify_products if p.get("active") and p.get("in_stock")),
                    "needs_category": sum(1 for p in shopify_products if p.get("active") and p.get("category_needs_mapping")),
                    "fayfort_listings": sum(1 for p in products if p.get("source") != "shopify" and p.get("active")),
                },
                "sync_runs": runs,
                "recent_webhooks": hooks,
                "trends": {
                    "open": sum(1 for t in trends if t["status"] == "open"),
                    "pooling": sum(1 for t in trends if t["status"] == "pooling"),
                    "pools_ready": sum(1 for t in trends if t["status"] == "pooling" and t.get("pool_target")
                                       and int(t.get("want_count") or 0) >= int(t["pool_target"])),
                },
                "invoices": {status: sum(1 for i in invoices if i["status"] == status) for status in ("sent", "paid", "failed")},
                "orders_7_days": {"count": len(orders), "total": round(sum(float(o.get("total") or 0) for o in orders), 2),
                                  "checkouts_started": len(checkouts)},
            }
        except Exception as exc:
            logger.exception("Could not load commerce overview")
            raise HTTPException(status_code=503, detail="Commerce overview could not be loaded.") from exc

    @router.post("/platform/commerce/setup")
    def setup(authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        base = (settings.PUBLIC_API_URL or "").rstrip("/")
        if not base.startswith("https://"):
            raise HTTPException(status_code=409, detail="PUBLIC_API_URL must be the public HTTPS API address before webhooks can be registered.")
        try:
            definition = shopify.ensure_category_definition()
            hooks = shopify.ensure_webhooks(base + "/commerce/shopify/webhooks")
        except shopify.ShopifyError as exc:
            raise shopify_failure(exc) from exc
        audit(admin_id, "shopify_setup", {"definition": definition, "webhooks": hooks})
        return {"category_definition": definition, "webhooks": hooks}

    @router.post("/platform/commerce/sync", status_code=202)
    def sync_now(authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        if not sync_lock.acquire(blocking=False):
            raise HTTPException(status_code=409, detail="A sync is already running.")

        def run():
            try:
                catalog.reconcile("manual")
            except Exception:
                logger.exception("Manual Shopify sync failed")
            finally:
                service.clear_cache()
                sync_lock.release()
        threading.Thread(target=run, name="fayfort-shopify-sync", daemon=True).start()
        audit(admin_id, "sync_started", {})
        return {"started": True}

    # ---- category mapping -------------------------------------------------------------------
    @router.get("/platform/commerce/products")
    def products(authorization: str | None = Header(default=None), needs_category: bool = False,
                 q: str = Query(default="", max_length=100)):
        require_admin(authorization)
        try:
            query = db().table("directory_products").select(
                "id,name,source,shopify_product_id,category_ref,category_needs_mapping,price_min,currency,in_stock,"
                "active,media_url,product_type,synced_at").eq("source", "shopify")
            if needs_category:
                query = query.eq("category_needs_mapping", True)
            found = rows(query.order("name").limit(500).execute())
            if q.strip():
                found = [p for p in found if q.strip().casefold() in str(p.get("name") or "").casefold()]
            for product in found:
                product["shopify_admin_url"] = shopify.admin_product_url(product["shopify_product_id"]) \
                    if shopify.shop_domain() else None
            return {"products": found, "categories": [
                {"source_ref": c["source_ref"], "category": c["category"], "group_name": c.get("group_name"),
                 "product_type": c.get("product_type")} for c in service.categories()]}
        except Exception as exc:
            logger.exception("Could not load commerce products")
            raise HTTPException(status_code=503, detail="Products could not be loaded.") from exc

    @router.put("/platform/commerce/products/{product_id}/category")
    def set_category(product_id: UUID, payload: CategoryInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        product = one(db().table("directory_products").select("id,source,shopify_product_id")
                      .eq("id", str(product_id)).maybe_single().execute())
        if not product or product.get("source") != "shopify":
            raise HTTPException(status_code=404, detail="Shopify product not found.")
        category = one(db().table("directory_categories").select("source_ref").eq("source_ref", payload.category_ref)
                       .maybe_single().execute())
        if not category:
            raise HTTPException(status_code=422, detail="Choose one of the FayFort categories.")
        if shopify.admin_configured():
            try:
                shopify.set_product_category(product["shopify_product_id"], payload.category_ref)
            except shopify.ShopifyError as exc:
                raise shopify_failure(exc) from exc
        db().table("directory_products").update({"category_ref": payload.category_ref, "category_needs_mapping": False}) \
            .eq("id", str(product_id)).execute()
        try:  # the Store team's "Choose a category" task for this product is done too
            from app.commerce import store_team
            open_item = store_team._active_item_for("unmapped_product", str(product_id))
            if open_item:
                from app.accounts import operations_flow
                operations_flow.close_item("unmapped_product", str(open_item["metadata"]["source_id"]),
                                           reason=f"Category set to {payload.category_ref} in Control Center.")
        except Exception:
            logger.exception("Could not close the category task")
        audit(admin_id, "category_mapped", {"product_id": str(product_id), "category_ref": payload.category_ref})
        return {"product_id": str(product_id), "category_ref": payload.category_ref}

    # ---- trend queue and pools --------------------------------------------------------------
    @router.get("/platform/commerce/trends")
    def trends(authorization: str | None = Header(default=None),
               status: Literal["open", "pooling", "sourcing", "closed", "dismissed"] | None = None):
        require_admin(authorization)
        try:
            query = db().table("commerce_trend_items").select(service.TREND_FIELDS)
            if status:
                query = query.eq("status", status)
            found = rows(query.order("last_shared_at", desc=True).limit(300).execute())
            found.sort(key=lambda t: (-(int(t.get("want_count") or 0) * 2 + int(t.get("share_count") or 0))))
            linked_ids = [str(t["linked_product_id"]) for t in found if t.get("linked_product_id")]
            linked = {c["id"]: c for c in service.cards(service.load_products(ids=linked_ids))} if linked_ids else {}
            return {"trends": [{**service.trend_card(t, linked=linked), "ready": bool(
                t.get("status") == "pooling" and t.get("pool_target") and int(t.get("want_count") or 0) >= int(t["pool_target"]))}
                for t in found]}
        except Exception as exc:
            logger.exception("Could not load trend queue")
            raise HTTPException(status_code=503, detail="The trend queue could not be loaded.") from exc

    @router.put("/platform/commerce/trends/{trend_id}")
    def update_trend(trend_id: UUID, payload: TrendUpdate, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        trend = one(db().table("commerce_trend_items").select(service.TREND_FIELDS).eq("id", str(trend_id))
                    .maybe_single().execute())
        if not trend:
            raise HTTPException(status_code=404, detail="Trend item not found.")
        values: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
        for key in ("status", "pool_target", "pool_currency", "pool_note"):
            value = getattr(payload, key)
            if value is not None:
                values[key] = value
        if payload.pool_price is not None:
            values["pool_price"] = float(payload.pool_price)
        if payload.pool_deadline is not None:
            values["pool_deadline"] = _iso(payload.pool_deadline)
        newly_linked = None
        if payload.unlink_product:
            values["linked_product_id"] = None
        elif payload.linked_product_id:
            product = service.load_products(ids=[str(payload.linked_product_id)])
            if not product:
                raise HTTPException(status_code=422, detail="Link an active product.")
            values["linked_product_id"] = str(payload.linked_product_id)
            if str(trend.get("linked_product_id") or "") != str(payload.linked_product_id):
                newly_linked = product[0]
        merged = {**trend, **values}
        if merged.get("status") == "pooling" and not (merged.get("pool_target") and merged.get("pool_price")
                                                      and merged.get("pool_currency")):
            raise HTTPException(status_code=422, detail="A pool needs a target, a group price and a currency.")
        db().table("commerce_trend_items").update(values).eq("id", str(trend_id)).execute()
        if newly_linked:
            # Connects Find It back to the catalog: everyone who wanted it hears it's in the store.
            for member in rows(db().table("commerce_pool_members").select("member_id").eq("trend_item_id", str(trend_id)).execute()):
                service.queue_email(str(member["member_id"]), category="notifications", template="commerce_found",
                                    title=f"Found it: {newly_linked['name']}",
                                    body=f"The item you shared is now in the FayFort store as {newly_linked['name']}.",
                                    href="/member/chat")
        audit(admin_id, "trend_updated", {"trend_id": str(trend_id), **{k: str(v) for k, v in values.items()}})
        return {"trend": {**trend, **values}}

    @router.post("/platform/commerce/trends/{trend_id}/invoices")
    def invoice_pool(trend_id: UUID, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        try:
            result = service.send_pool_invoices(str(trend_id), admin_id)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        audit(admin_id, "pool_invoiced", {"trend_id": str(trend_id), "sent": result["sent"],
                                          "failed": len(result["failed"])})
        return result

    # ---- sourcing deposits (docs/MEMBERSHIP_PLAN.md) ------------------------------------------
    def _deposit_view(invoice: dict | None) -> dict | None:
        if not invoice:
            return None
        return {"id": invoice["id"], "amount": invoice["amount"], "currency": invoice["currency"],
                "status": invoice["status"]}

    def _deposits_due(*, exclude: set[str]) -> list[dict]:
        """Open sourcing requests (not cancelled, not yet paid for) that have no deposit invoice."""
        since = (service.now_utc() - timedelta(days=120)).isoformat()
        found = rows(db().table("member_purchase_requests").select(
            "id,member_id,request_title,expected_total,expected_currency,created_at")
            .gte("created_at", since).order("created_at", desc=True).limit(200).execute())
        found = [r for r in found if str(r["id"]) not in exclude]
        if not found:
            return []
        events = rows(db().table("member_request_events").select("request_id,stage,sequence_no")
                      .in_("request_id", [str(r["id"]) for r in found]).limit(5000).execute())
        latest: dict[str, tuple[int, str]] = {}
        for event in events:
            key = str(event["request_id"])
            if key not in latest or int(event["sequence_no"]) > latest[key][0]:
                latest[key] = (int(event["sequence_no"]), str(event["stage"]))
        due = []
        terms_cache: dict[str, dict] = {}
        for request in found:
            stage = latest.get(str(request["id"]), (0, "submitted"))[1]
            if stage in ("purchase_confirmed", "in_transit", "delivered", "cancelled"):
                continue
            member = str(request["member_id"])
            terms = terms_cache.setdefault(member, plans.deposit_terms(member))
            expected = float(request["expected_total"]) if request.get("expected_total") else None
            due.append({**request, "stage": stage, "tier": terms["tier"], "rate": terms["rate"],
                        "reason": terms["reason"],
                        "suggested_deposit": round(expected * terms["rate"], 2) if expected else None})
        return due[:100]

    @router.post("/platform/commerce/invoices/deposit", status_code=201)
    def create_deposit_invoice(payload: DepositInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        try:
            invoice = service.send_deposit_invoice(str(payload.request_id), payload.expected_total, payload.currency, admin_id)
            quote = invoice.pop("quote")
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except shopify.ShopifyError as exc:
            raise shopify_failure(exc) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            if "duplicate" in str(exc).casefold() or "unique" in str(exc).casefold():
                raise HTTPException(status_code=409, detail="This request already has a deposit invoice.") from exc
            logger.exception("Could not send deposit invoice")
            raise HTTPException(status_code=503, detail="The deposit invoice could not be sent.") from exc
        audit(admin_id, "deposit_sent", {"request_id": str(payload.request_id), "invoice_id": str(invoice["id"]),
                                         "amount": quote["amount"], "rate": quote["rate"]})
        return {"invoice": invoice}

    # ---- invoices for sourcing requests ------------------------------------------------------
    @router.get("/platform/commerce/invoices")
    def invoices(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            sent = rows(db().table("commerce_invoices").select("*").order("created_at", desc=True).limit(200).execute())
            selected = rows(db().table("operations_sourcing_member_options").select(
                "id,request_id,product_name,product_url,price_amount,currency,selected_at")
                .eq("status", "selected").order("selected_at", desc=True).limit(200).execute())
            live = [i for i in sent if i.get("request_id") and i["status"] in ("draft", "sent", "paid")]
            invoiced = {str(i["request_id"]) for i in live if i.get("kind", "order") == "order"}
            deposits = {str(i["request_id"]): i for i in live if i.get("kind") == "deposit"}
            request_ids = [str(o["request_id"]) for o in selected if str(o["request_id"]) not in invoiced]
            requests = {str(r["id"]): r for r in rows(db().table("member_purchase_requests").select(
                "id,member_id,request_title").in_("id", request_ids).execute())} if request_ids else {}
            ready = [{**option, "request_title": requests[str(option["request_id"])]["request_title"],
                      "member_id": requests[str(option["request_id"])]["member_id"],
                      "can_invoice": bool(option.get("price_amount") and option.get("currency")),
                      "deposit": _deposit_view(deposits.get(str(option["request_id"])))}
                     for option in selected if str(option["request_id"]) in requests]
            return {"invoices": sent, "ready_to_invoice": ready,
                    "deposits_due": _deposits_due(exclude=invoiced | set(deposits))}
        except Exception as exc:
            logger.exception("Could not load invoices")
            raise HTTPException(status_code=503, detail="Invoices could not be loaded.") from exc

    @router.post("/platform/commerce/invoices", status_code=201)
    def create_request_invoice(payload: InvoiceInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        try:
            invoice = service.send_request_invoice(str(payload.request_id), admin_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except shopify.ShopifyError as exc:
            raise shopify_failure(exc) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            if "duplicate" in str(exc).casefold() or "unique" in str(exc).casefold():
                raise HTTPException(status_code=409, detail="This request already has an invoice.") from exc
            logger.exception("Could not send request invoice")
            raise HTTPException(status_code=503, detail="The invoice could not be sent.") from exc
        audit(admin_id, "invoice_sent", {"request_id": str(payload.request_id), "invoice_id": str(invoice["id"])})
        return {"invoice": invoice}

    @router.post("/platform/commerce/publish-sourced", status_code=201)
    def publish_sourced(payload: PublishInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        title, price, description = payload.title, payload.price, ""
        if payload.request_id:
            option = one(db().table("operations_sourcing_member_options").select("product_name,price_amount")
                         .eq("request_id", str(payload.request_id)).eq("status", "selected").maybe_single().execute())
            request = one(db().table("member_purchase_requests").select("request_title,request_description")
                          .eq("id", str(payload.request_id)).maybe_single().execute())
            if not request:
                raise HTTPException(status_code=404, detail="Request not found.")
            title = title or (option or {}).get("product_name") or request["request_title"]
            price = price or ((option or {}).get("price_amount"))
            description = request.get("request_description") or ""
        else:
            trend = one(db().table("commerce_trend_items").select("title,description,pool_price")
                        .eq("id", str(payload.trend_item_id)).maybe_single().execute())
            if not trend:
                raise HTTPException(status_code=404, detail="Trend item not found.")
            title = title or trend.get("title") or "Sourced item"
            price = price or trend.get("pool_price")
            description = trend.get("description") or ""
        if not price:
            raise HTTPException(status_code=422, detail="Enter a price for the new product.")
        try:
            product_gid = shopify.create_draft_product(title=str(title)[:255], description=description[:5000],
                                                       price=f"{float(price):.2f}", category_ref=payload.category_ref)
        except shopify.ShopifyError as exc:
            raise shopify_failure(exc) from exc
        audit(admin_id, "sourced_item_published", {"product": product_gid, "request_id": str(payload.request_id or ""),
                                                   "trend_item_id": str(payload.trend_item_id or "")})
        return {"shopify_product_id": product_gid, "shopify_admin_url": shopify.admin_product_url(product_gid)}

    # ---- flash sales and codes ---------------------------------------------------------------
    @router.get("/platform/commerce/sales")
    def sales(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"sales": rows(db().table("commerce_flash_sales").select("*").order("starts_at", desc=True)
                                  .limit(200).execute())}
        except Exception as exc:
            logger.exception("Could not load sales")
            raise HTTPException(status_code=503, detail="Sales could not be loaded.") from exc

    @router.post("/platform/commerce/sales", status_code=201)
    def create_sale(payload: SaleInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        require_shopify()
        ids = [str(i) for i in payload.product_ids]
        products = rows(db().table("directory_products").select("id,shopify_product_id,source").in_("id", ids).execute())
        gids = [p["shopify_product_id"] for p in products if p.get("source") == "shopify"]
        if len(gids) != len(set(ids)):
            raise HTTPException(status_code=422, detail="Sales can only include products from the Shopify store.")
        record = one(db().table("commerce_flash_sales").insert({
            "title": payload.title, "discount_type": payload.discount_type, "value": float(payload.value),
            "product_ids": ids, "code": payload.code, "usage_limit": payload.usage_limit,
            "starts_at": _iso(payload.starts_at), "ends_at": _iso(payload.ends_at), "created_by": admin_id}).execute())
        try:
            discount_id = shopify.create_discount(title=payload.title, discount_type=payload.discount_type,
                                                  value=float(payload.value), product_gids=gids,
                                                  starts_at=_iso(payload.starts_at), ends_at=_iso(payload.ends_at),
                                                  code=payload.code, usage_limit=payload.usage_limit)
        except shopify.ShopifyError as exc:
            db().table("commerce_flash_sales").update({"status": "failed", "error": str(exc)[:500]}).eq("id", record["id"]).execute()
            raise shopify_failure(exc) from exc
        db().table("commerce_flash_sales").update({"shopify_discount_id": discount_id}).eq("id", record["id"]).execute()
        service.clear_cache()
        audit(admin_id, "sale_created", {"sale_id": str(record["id"]), "code": payload.code or ""})
        try:
            from app.commerce import campaigns
            campaigns.ensure_campaign("sale", record)
        except Exception:
            logger.exception("Could not open the Prepare a campaign task")
        return {"sale": {**record, "shopify_discount_id": discount_id}}

    @router.post("/platform/commerce/sales/{sale_id}/cancel")
    def cancel_sale(sale_id: UUID, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        sale = one(db().table("commerce_flash_sales").select("*").eq("id", str(sale_id)).maybe_single().execute())
        if not sale:
            raise HTTPException(status_code=404, detail="Sale not found.")
        if sale.get("shopify_discount_id") and shopify.admin_configured():
            try:
                shopify.delete_discount(sale["shopify_discount_id"], automatic=not sale.get("code"))
            except shopify.ShopifyError as exc:
                raise shopify_failure(exc) from exc
        db().table("commerce_flash_sales").update({"status": "cancelled"}).eq("id", str(sale_id)).execute()
        service.clear_cache()
        try:
            from app.accounts import operations_flow
            operations_flow.close_item("campaign_sale", str(sale_id), status="cancelled", reason="The sale was cancelled.")
        except Exception:
            logger.exception("Could not close the sale's campaign task")
        audit(admin_id, "sale_cancelled", {"sale_id": str(sale_id)})
        return {"sale_id": str(sale_id), "status": "cancelled"}

    # ---- giveaways --------------------------------------------------------------------------
    @router.get("/platform/commerce/giveaways")
    def list_giveaways(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            found = rows(db().table("commerce_giveaways").select("*").order("created_at", desc=True).limit(100).execute())
            ids = [str(g["id"]) for g in found]
            entries = rows(db().table("commerce_giveaway_entries").select("giveaway_id").in_("giveaway_id", ids)
                           .limit(100000).execute()) if ids else []
            winners = rows(db().table("commerce_giveaway_winners").select("giveaway_id,member_id,rank,prize_code,prize_error")
                           .in_("giveaway_id", ids).execute()) if ids else []
            counts: dict[str, int] = {}
            for entry in entries:
                counts[str(entry["giveaway_id"])] = counts.get(str(entry["giveaway_id"]), 0) + 1
            for giveaway in found:
                giveaway["entries"] = counts.get(str(giveaway["id"]), 0)
                giveaway["winners"] = sorted([w for w in winners if str(w["giveaway_id"]) == str(giveaway["id"])],
                                             key=lambda w: w["rank"])
            return {"giveaways": found}
        except Exception as exc:
            logger.exception("Could not load giveaways")
            raise HTTPException(status_code=503, detail="Giveaways could not be loaded.") from exc

    @router.post("/platform/commerce/giveaways", status_code=201)
    def create_giveaway(payload: GiveawayInput, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        record = one(db().table("commerce_giveaways").insert({
            "title": payload.title.strip(), "description": payload.description.strip(),
            "prize_text": payload.prize_text.strip(),
            "prize_product_id": str(payload.prize_product_id) if payload.prize_product_id else None,
            "starts_at": _iso(payload.starts_at), "ends_at": _iso(payload.ends_at),
            "winner_count": payload.winner_count, "status": payload.status, "created_by": admin_id}).execute())
        audit(admin_id, "giveaway_created", {"giveaway_id": str((record or {}).get("id"))})
        if record and payload.status == "open":
            try:
                from app.commerce import campaigns
                campaigns.ensure_campaign("giveaway", record)
            except Exception:
                logger.exception("Could not open the Prepare a campaign task")
        return {"giveaway": record}

    @router.put("/platform/commerce/giveaways/{giveaway_id}/status")
    def giveaway_status(giveaway_id: UUID, payload: GiveawayStatus, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        giveaway = one(db().table("commerce_giveaways").select("id,status").eq("id", str(giveaway_id)).maybe_single().execute())
        if not giveaway:
            raise HTTPException(status_code=404, detail="Giveaway not found.")
        allowed = {"draft": {"open", "cancelled"}, "open": {"cancelled"}}.get(giveaway["status"], set())
        if payload.status not in allowed:
            raise HTTPException(status_code=409, detail=f"A {giveaway['status']} giveaway can't be set to {payload.status}.")
        db().table("commerce_giveaways").update({"status": payload.status,
                                                 "updated_at": datetime.now(timezone.utc).isoformat()}) \
            .eq("id", str(giveaway_id)).execute()
        try:
            from app.commerce import campaigns
            from app.accounts import operations_flow
            if payload.status == "open":
                full = one(db().table("commerce_giveaways").select("*").eq("id", str(giveaway_id)).maybe_single().execute())
                campaigns.ensure_campaign("giveaway", full or {})
            else:
                operations_flow.close_item("campaign_giveaway", str(giveaway_id), status="cancelled",
                                           reason="The giveaway was cancelled.")
        except Exception:
            logger.exception("Could not update the giveaway's campaign task")
        audit(admin_id, f"giveaway_{payload.status}", {"giveaway_id": str(giveaway_id)})
        return {"giveaway_id": str(giveaway_id), "status": payload.status}

    @router.post("/platform/commerce/giveaways/{giveaway_id}/draw")
    def draw(giveaway_id: UUID, authorization: str | None = Header(default=None)):
        admin_id = require_admin(authorization)
        try:
            result = service.draw_giveaway(str(giveaway_id), admin_id)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        audit(admin_id, "giveaway_drawn", {"giveaway_id": str(giveaway_id), "seed": result["seed"],
                                           "entries": result["entries"], "winners": [w["member_id"] for w in result["winners"]]})
        return result

    # ---- orders -----------------------------------------------------------------------------
    @router.get("/platform/commerce/orders")
    def orders(authorization: str | None = Header(default=None), limit: int = Query(default=100, ge=1, le=500)):
        require_admin(authorization)
        try:
            return {"orders": rows(db().table("commerce_orders").select(
                "id,order_name,member_id,source,financial_status,fulfillment_status,cancelled_at,total,currency,"
                "line_items,placed_at,invoice_id").order("placed_at", desc=True).limit(limit).execute())}
        except Exception as exc:
            logger.exception("Could not load orders")
            raise HTTPException(status_code=503, detail="Orders could not be loaded.") from exc

    return router
