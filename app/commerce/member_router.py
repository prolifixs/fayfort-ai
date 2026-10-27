"""Member commerce API used inside the chat shell: rails, browse, product panel, intent signals, cart
and checkout, Find It and Source it, Orders & requests, and giveaways."""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.commerce import ranking, service, shopify
from app.commerce.db import db, one, rows
from app.directory.identity import trusted_user_id

logger = logging.getLogger(__name__)

EventType = Literal["view", "add_to_cart", "search", "category", "save", "checkout"]


class IntentEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_type: EventType
    product_id: UUID | None = None
    category_ref: str | None = Field(default=None, max_length=200)
    query: str | None = Field(default=None, max_length=200)


class IntentBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(min_length=1, max_length=64)
    events: list[IntentEvent] = Field(min_length=1, max_length=20)


class CartLineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    variant_id: UUID
    quantity: int = Field(ge=0, le=99)
    session_id: str | None = Field(default=None, max_length=64)


class FindItInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(min_length=1, max_length=64)

    @field_validator("text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Type something or paste a link.")
        return value.strip()


class WantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(min_length=1, max_length=64)
    conversation_id: UUID | None = None
    note: str | None = Field(default=None, max_length=1000)


class _Limiter:
    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window, self.calls, self.lock = limit, window, defaultdict(deque), threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            calls = self.calls[key]
            while calls and now - calls[0] > self.window:
                calls.popleft()
            if len(calls) >= self.limit:
                raise HTTPException(status_code=429, detail="Too many requests. Wait a minute and try again.")
            calls.append(now)


def verified_member(authorization: str | None) -> str:
    user_id = trusted_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="A valid signed-in member is required.")
    token = authorization.partition(" ")[2].strip() if authorization else ""
    try:
        user = getattr(db().auth.get_user(token), "user", None)
    except Exception as exc:
        logger.exception("Could not verify member")
        raise HTTPException(status_code=503, detail="Member access could not be verified.") from exc
    if not user or getattr(user, "email_confirmed_at", None) is None:
        raise HTTPException(status_code=403, detail="Verify your email before using your member account.")
    return user_id


def _fail(message: str, exc: Exception) -> HTTPException:
    logger.exception(message)
    return HTTPException(status_code=503, detail=message)


def create_member_commerce_router() -> APIRouter:
    router = APIRouter(tags=["commerce"])
    find_limiter = _Limiter(20)
    write_limiter = _Limiter(60)

    @router.get("/members/shop/home")
    def shop_home(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return service.rails(member_id)
        except Exception as exc:
            raise _fail("The shop could not be loaded.", exc) from exc

    @router.get("/members/shop/products")
    def browse(authorization: str | None = Header(default=None), q: str = Query(default="", max_length=100),
               category_ref: str | None = Query(default=None, max_length=200),
               group: str | None = Query(default=None, max_length=100),
               top: str | None = Query(default=None, max_length=120),
               sort: Literal["for_you", "newest", "price_low", "price_high"] = "for_you",
               in_stock: bool = False, saved_only: bool = False, limit: int = Query(default=60, ge=1, le=100),
               offset: int = Query(default=0, ge=0, le=5000)):
        member_id = verified_member(authorization)
        try:
            products = service.load_products()
            if saved_only:
                saved = service.saved_ids(member_id)
                products = [p for p in products if str(p["id"]) in saved]
            groups = service.category_groups()
            if category_ref:
                products = [p for p in products if p.get("category_ref") == category_ref]
            if group:
                products = [p for p in products if groups.get(str(p.get("category_ref") or "")) == group]
            if top:
                tops = service.top_categories()
                products = [p for p in products if tops.get(str(p.get("category_ref") or "")) == top]
            if in_stock:
                products = [p for p in products if p.get("source") == "shopify" and p.get("in_stock")]
            query_terms = ranking.terms(q)
            if query_terms:
                products = [p for p in products if ranking.relevance(p, ranking.Intent(), query_terms) > 0]
            intent = service.member_intent(member_id)
            cards = service.ranked(products, intent, query_terms=query_terms or None, saved=service.saved_ids(member_id),
                                   diversify=not query_terms and not category_ref)
            if sort == "newest":
                created = {str(p["id"]): str(p.get("created_at") or "") for p in products}
                cards.sort(key=lambda c: created.get(c["id"], ""), reverse=True)
            elif sort in ("price_low", "price_high"):
                price = lambda c: ((c.get("sale") or {}).get("sale_price") or c.get("price") or 0.0)
                cards = [c for c in cards if c.get("price") is not None]
                cards.sort(key=price, reverse=sort == "price_high")
            counts: dict[str, int] = defaultdict(int)
            for product in service.load_products():
                counts[groups.get(str(product.get("category_ref") or "")) or ""] += 1
            group_list = sorted({g for g in groups.values() if g})
            return {"products": cards[offset:offset + limit], "total": len(cards), "offset": offset,
                    "has_more": offset + limit < len(cards),
                    "groups": [{"name": g, "count": counts.get(g, 0)} for g in group_list],
                    "categories": [{"source_ref": c["source_ref"], "category": c["category"],
                                    "group_name": c.get("group_name"), "product_type": c.get("product_type")}
                                   for c in service.categories() if not group or c.get("group_name") == group]}
        except HTTPException:
            raise
        except Exception as exc:
            raise _fail("Products could not be loaded.", exc) from exc

    @router.get("/members/shop/products/{product_id}")
    def product_detail(product_id: UUID, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            found = service.load_products(ids=[str(product_id)])
            if not found:
                # A FayFort Find before it joins the catalog, for members whose drop is open (docs/FINDS_PLAN.md).
                from app.finds import service as finds
                early = finds.visible_product(member_id, str(product_id))
                found = [early] if early else []
            if not found:
                raise HTTPException(status_code=404, detail="This product isn't available.")
            product = found[0]
            card = service.cards([product], saved=service.saved_ids(member_id), member_id=member_id)[0]
            variants = rows(db().table("commerce_variants").select(
                "id,title,price,compare_at_price,available,options,position,image_url")
                .eq("product_id", str(product_id)).order("position").execute())
            for variant in variants:
                variant["sale_price"] = ranking.sale_price(float(variant["price"]), card.get("sale"))
            media = service.media_for([str(product_id)]).get(str(product_id)) or (
                [{"media_type": product.get("media_type"), "url": product.get("media_url"), "preview_url": None,
                  "alt": product.get("name")}] if product.get("media_url") else [])
            from app.finds import service as finds
            find = finds.for_product(str(product_id))
            card["find"] = {"id": find["id"], "lane": find["lane"]} if find and find.get("status") in finds.LIVE else None
            return {"product": {**card, "description": product.get("description") or "", "vendor": product.get("vendor")},
                    "variants": variants, "media": media,
                    "pairs_with": service.pairs_with([str(product_id)], exclude=set())}
        except HTTPException:
            raise
        except Exception as exc:
            raise _fail("This product could not be loaded.", exc) from exc

    @router.get("/members/shop/sections/{section_id}")
    def shop_section(section_id: str, authorization: str | None = Header(default=None)):
        """Every product in one store section (the tile on Browse shows the first three)."""
        member_id = verified_member(authorization)
        if len(section_id) > 64:
            raise HTTPException(status_code=404, detail="This section isn't live.")
        try:
            from app.commerce import merch_sections
            saved = service.saved_ids(member_id)
            section = merch_sections.member_section(section_id, lambda found: service.cards(found, saved=saved))
        except Exception as exc:
            raise _fail("This section could not be loaded.", exc) from exc
        if not section:
            raise HTTPException(status_code=404, detail="This section isn't live any more.")
        return {"section": section}

    @router.post("/members/shop/events", status_code=202)
    def intent_events(payload: IntentBatch, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        write_limiter.check(member_id)
        try:
            count = service.record_events(member_id, payload.session_id, [
                {**event.model_dump(), "product_id": str(event.product_id) if event.product_id else None}
                for event in payload.events])
            return {"recorded": count}
        except Exception as exc:
            raise _fail("Activity could not be saved.", exc) from exc

    # ---- cart -------------------------------------------------------------------------------
    @router.get("/members/cart")
    def get_cart(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return service.cart(member_id)
        except Exception as exc:
            raise _fail("Your cart could not be loaded.", exc) from exc

    @router.put("/members/cart/lines")
    def set_cart_line(payload: CartLineInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        write_limiter.check(member_id)
        try:
            variant = one(db().table("commerce_variants").select("id,product_id,price,available")
                          .eq("id", str(payload.variant_id)).maybe_single().execute())
            if not variant:
                raise HTTPException(status_code=404, detail="That option isn't available any more.")
            if payload.quantity == 0:
                db().table("commerce_cart_lines").delete().eq("member_id", member_id) \
                    .eq("variant_id", str(payload.variant_id)).execute()
            else:
                if not variant.get("available"):
                    raise HTTPException(status_code=409, detail="That option is sold out.")
                db().table("commerce_cart_lines").upsert({"member_id": member_id, "variant_id": str(payload.variant_id),
                                                          "quantity": payload.quantity},
                                                         on_conflict="member_id,variant_id").execute()
                service.record_events(member_id, payload.session_id or "cart", [{
                    "event_type": "add_to_cart", "product_id": str(variant["product_id"]), "price": variant.get("price")}])
            return service.cart(member_id)
        except HTTPException:
            raise
        except Exception as exc:
            raise _fail("Your cart could not be updated.", exc) from exc

    @router.post("/members/cart/checkout")
    def checkout(request: Request, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        write_limiter.check(member_id)
        try:
            current = service.cart(member_id)
            lines = [line for line in current["lines"] if line["available"]]
            if not lines:
                raise HTTPException(status_code=409, detail="Your cart is empty or its items are sold out.")
            variant_ids = [line["variant_id"] for line in lines]
            shopify_ids = {str(v["id"]): v["shopify_variant_id"] for v in rows(db().table("commerce_variants")
                           .select("id,shopify_variant_id").in_("id", variant_ids).execute())}
            cart_id, url = shopify.create_checkout(
                lines=[(shopify_ids[line["variant_id"]], line["quantity"]) for line in lines if line["variant_id"] in shopify_ids],
                member_id=member_id, email=service.member_email(member_id),
                buyer_ip=request.client.host if request.client else None)
            if not url.startswith("https://"):
                raise HTTPException(status_code=502, detail="Shopify didn't return a checkout link. Try again.")
            db().table("commerce_checkouts").insert({"member_id": member_id, "shopify_cart_id": cart_id[:500],
                                                     "checkout_url": url, "line_count": len(lines),
                                                     "subtotal": current["subtotal"], "currency": current["currency"]}).execute()
            return {"checkout_url": url}
        except HTTPException:
            raise
        except shopify.ShopifyError as exc:
            logger.warning("Checkout failed: %s", exc)
            raise HTTPException(status_code=502, detail="Checkout isn't available right now. Try again in a minute.") from exc
        except Exception as exc:
            raise _fail("Checkout could not be started.", exc) from exc

    # ---- Find It ----------------------------------------------------------------------------
    @router.post("/members/find-it")
    def find_it(payload: FindItInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        find_limiter.check(member_id)
        try:
            return service.find_it(member_id, payload.text, session_id=payload.session_id)
        except Exception as exc:
            raise _fail("We couldn't look that up. Try again.", exc) from exc

    @router.post("/members/find-it/{trend_item_id}/want", status_code=201)
    def want(trend_item_id: UUID, payload: WantInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        write_limiter.check(member_id)
        try:
            return service.want_trend_item(member_id, str(trend_item_id), session_id=payload.session_id,
                                           conversation_id=str(payload.conversation_id) if payload.conversation_id else None,
                                           note=payload.note)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise _fail("We couldn't start sourcing this item. Try again.", exc) from exc

    # ---- Orders & requests ------------------------------------------------------------------
    @router.get("/members/orders")
    def member_orders(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            orders = rows(db().table("commerce_orders").select(
                "id,order_name,source,financial_status,fulfillment_status,cancelled_at,total,currency,line_items,"
                "tracking,status_url,placed_at,invoice_id").eq("member_id", member_id)
                .order("placed_at", desc=True).limit(100).execute())
            invoices = rows(db().table("commerce_invoices").select(
                "id,request_id,trend_item_id,title,amount,currency,quantity,invoice_url,status,sent_at,paid_at,created_at,"
                "kind,deposit_credit,ship_to")
                .eq("member_id", member_id).in_("status", ["sent", "paid"]).order("created_at", desc=True)
                .limit(100).execute())
            wants = rows(db().table("commerce_pool_members").select("trend_item_id,request_id,joined_at")
                         .eq("member_id", member_id).order("joined_at", desc=True).limit(100).execute())
            trend_ids = [str(w["trend_item_id"]) for w in wants]
            trends = {str(t["id"]): t for t in rows(db().table("commerce_trend_items").select(service.TREND_FIELDS)
                                                    .in_("id", trend_ids).execute())} if trend_ids else {}
            pools = [{**service.trend_card(trends[str(w["trend_item_id"])], member_wants=set(trend_ids)),
                      "request_id": w.get("request_id"), "joined_at": w["joined_at"]}
                     for w in wants if str(w["trend_item_id"]) in trends]
            return {"orders": orders, "invoices": invoices, "wanted": pools}
        except Exception as exc:
            raise _fail("Your orders could not be loaded.", exc) from exc

    # ---- giveaways --------------------------------------------------------------------------
    @router.get("/members/giveaways")
    def giveaways(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return {"giveaways": service.open_giveaways(member_id)}
        except Exception as exc:
            raise _fail("Giveaways could not be loaded.", exc) from exc

    @router.post("/members/giveaways/{giveaway_id}/enter", status_code=201)
    def enter_giveaway(giveaway_id: UUID, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        write_limiter.check(member_id)
        try:
            giveaway = one(db().table("commerce_giveaways").select("id,status,starts_at,ends_at")
                           .eq("id", str(giveaway_id)).maybe_single().execute())
            now = service.now_utc()
            if not giveaway or giveaway["status"] != "open" or not (
                    ranking.parse_time(giveaway["starts_at"]) <= now < ranking.parse_time(giveaway["ends_at"])):
                raise HTTPException(status_code=409, detail="This giveaway isn't open for entries.")
            db().table("commerce_giveaway_entries").upsert({"giveaway_id": str(giveaway_id), "member_id": member_id},
                                                           on_conflict="giveaway_id,member_id",
                                                           ignore_duplicates=True).execute()
            from app.membership import ranks
            ranks.safe_recompute(member_id)
            return {"giveaway_id": str(giveaway_id), "entered": True}
        except HTTPException:
            raise
        except Exception as exc:
            raise _fail("Your entry could not be saved.", exc) from exc

    return router
