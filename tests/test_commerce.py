from __future__ import annotations

import base64
import hashlib
import hmac
import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.commerce import catalog, db as commerce_db, links, ranking, service, shopify
from app.commerce.admin_router import create_admin_commerce_router
from app.commerce.member_router import create_member_commerce_router
from app.commerce.webhooks import create_shopify_webhook_router, process

MEMBER = "00000000-0000-0000-0000-0000000000c1"
OTHER = "00000000-0000-0000-0000-0000000000c2"
ADMIN = "00000000-0000-0000-0000-0000000000a1"
NOW = datetime.now(timezone.utc)


def ago(**delta) -> str:
    return (NOW - timedelta(**delta)).isoformat()


def ahead(**delta) -> str:
    return (NOW + timedelta(**delta)).isoformat()


class Query:
    def __init__(self, db: "Db", table: str):
        self.db, self.table, self.filters, self.single, self.op, self.values = db, table, [], False, "select", None
        self.on_conflict, self.ignore_duplicates, self._order, self._limit = None, False, None, None

    def select(self, *_a, **_k): return self
    def order(self, column, desc=False): self._order = (column, desc); return self
    def limit(self, n): self._limit = n; return self
    def eq(self, c, v): self.filters.append((c, "eq", v)); return self
    def gte(self, c, v): self.filters.append((c, "gte", v)); return self
    def lt(self, c, v): self.filters.append((c, "lt", v)); return self
    def in_(self, c, v): self.filters.append((c, "in", list(v))); return self
    def maybe_single(self): self.single = True; return self
    def update(self, values): self.op, self.values = "update", values; return self
    def insert(self, values): self.op, self.values = "insert", values; return self
    def delete(self): self.op = "delete"; return self

    def upsert(self, values, on_conflict=None, ignore_duplicates=False):
        self.op, self.values, self.on_conflict, self.ignore_duplicates = "upsert", values, on_conflict, ignore_duplicates
        return self

    def _match(self, row):
        for c, op, v in self.filters:
            value = row.get(c)
            if op == "eq" and str(value) != str(v): return False
            if op == "gte" and (value is None or str(value) < str(v)): return False
            if op == "lt" and (value is None or str(value) >= str(v)): return False
            if op == "in" and str(value) not in [str(x) for x in v]: return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == "select":
            found = [r for r in rows if self._match(r)]
            if self._order:
                column, desc = self._order
                found.sort(key=lambda r: (r.get(column) is None, str(r.get(column) or "")), reverse=desc)
            if self._limit:
                found = found[: self._limit]
            if self.single:
                return SimpleNamespace(data=found[0] if found else None)
            return SimpleNamespace(data=[dict(r) for r in found])
        if self.op == "update":
            changed = [r for r in rows if self._match(r)]
            for r in changed:
                r.update(self.values)
            return SimpleNamespace(data=[dict(r) for r in changed])
        if self.op == "delete":
            keep = [r for r in rows if not self._match(r)]
            removed = len(rows) - len(keep)
            rows[:] = keep
            return SimpleNamespace(data=[{}] * removed)
        items = self.values if isinstance(self.values, list) else [self.values]
        out = []
        for item in items:
            item = dict(item)
            key = self.on_conflict.split(",") if self.on_conflict else None
            existing = next((r for r in rows if key and all(str(r.get(k)) == str(item.get(k)) for k in key)), None)
            if existing:
                if not self.ignore_duplicates:
                    existing.update(item)
                out.append(dict(existing))
                continue
            item.setdefault("id", str(uuid.uuid4()))
            item.setdefault("created_at", NOW.isoformat())
            for column, default in self.db.defaults.get(self.table, {}).items():
                item.setdefault(column, default)
            rows.append(item)
            out.append(dict(item))
        return SimpleNamespace(data=out)


class Db:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.rpcs: list[tuple[str, dict]] = []
        self.defaults = {"commerce_trend_items": {"status": "open", "share_count": 0, "want_count": 0,
                                                  "last_shared_at": NOW.isoformat()},
                         "commerce_invoices": {"status": "draft"},
                         "commerce_flash_sales": {"status": "scheduled"},
                         "commerce_giveaways": {"status": "draft"}}
        self.auth = MagicMock()
        self.auth.get_user.side_effect = self._get_user
        self.auth.admin.get_user_by_id.side_effect = lambda uid: SimpleNamespace(
            user=SimpleNamespace(id=uid, email=f"{uid[-2:]}@example.com"))

    @staticmethod
    def _get_user(token):
        uid = {"member": MEMBER, "other": OTHER, "admin": ADMIN}.get(token, MEMBER)
        return SimpleNamespace(user=SimpleNamespace(id=uid, email_confirmed_at="2026-10-01",
                                                    app_metadata={"platform_admin": True} if token == "admin" else {}))

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpcs.append((name, params))
        if name in ("create_member_purchase_request", "create_member_request_from_chat"):
            return SimpleNamespace(execute=lambda: SimpleNamespace(data="req-1"))
        if name == "record_commerce_invoice_paid":
            for invoice in self.rows.get("commerce_invoices", []):
                if invoice["id"] == params["p_invoice_id"]:
                    invoice["status"] = "paid"
            return SimpleNamespace(execute=lambda: SimpleNamespace(data="paid_and_confirmed"))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))


CATEGORIES = [
    {"source_ref": "hair-wigs", "category": "Wigs", "group_name": "Hair", "product_type": "Lace front wig"},
    {"source_ref": "hair-tools", "category": "Hair tools", "group_name": "Hair", "product_type": "Hair tool"},
    {"source_ref": "fabric-ankara", "category": "Ankara", "group_name": "Fabrics", "product_type": "Ankara fabric"},
]


def product(pid, name, category, *, price=50.0, in_stock=True, source="shopify", **extra):
    return {"id": pid, "name": name, "category_ref": category, "description": f"{name} description", "active": True,
            "source": source, "shopify_product_id": f"gid://shopify/Product/{pid}" if source == "shopify" else None,
            "price_min": price, "price_max": price, "currency": "USD", "in_stock": in_stock, "tags": [],
            "availability_status": "available" if in_stock else "unavailable", "media_url": "https://cdn/x.jpg",
            "media_type": "image", "total_inventory": 10, "created_at": ago(days=1), **extra}


def seeded_db(**extra_rows) -> Db:
    rows = {
        "directory_categories": [dict(c) for c in CATEGORIES],
        "directory_products": [
            product("p-wig", "Body wave lace front wig", "hair-wigs", price=120.0),
            product("p-wig2", "Straight bob wig", "hair-wigs", price=80.0),
            product("p-dryer", "Ionic hair dryer", "hair-tools", price=20.0),
            product("p-ankara", "Ankara print fabric 6 yards", "fabric-ankara", price=18.0),
            product("p-gone", "Sold out wig cap", "hair-tools", price=5.0, in_stock=False),
        ],
        "commerce_variants": [
            {"id": "v-wig", "product_id": "p-wig", "shopify_variant_id": "gid://shopify/ProductVariant/11",
             "title": "22 inch", "price": 120.0, "compare_at_price": None, "available": True, "options": [], "position": 1},
            {"id": "v-gone", "product_id": "p-gone", "shopify_variant_id": "gid://shopify/ProductVariant/12",
             "title": "Default", "price": 5.0, "available": False, "options": [], "position": 1},
        ],
    }
    rows.update(extra_rows)
    return Db(rows)


class DbCase(unittest.TestCase):
    db: Db

    def use(self, db: Db) -> Db:
        self.db = db
        patcher = patch.object(commerce_db, "client", db)
        patcher.start()
        self.addCleanup(patcher.stop)
        service.clear_cache()
        self.addCleanup(service.clear_cache)
        return db


# ---------------------------------------------------------------------------------------------
class RankingTests(unittest.TestCase):
    def test_intent_weights_strong_recent_signals_and_fades(self):
        events = [
            {"event_type": "paste_link", "category_ref": "hair-wigs", "query": "body wave wig", "created_at": ago(minutes=2)},
            {"event_type": "category", "category_ref": "fabric-ankara", "created_at": ago(minutes=100)},
        ]
        intent = ranking.build_intent(events, category_groups={"hair-wigs": "Hair", "fabric-ankara": "Fabrics"}, now=NOW)
        self.assertTrue(intent.active)
        self.assertGreater(intent.categories["hair-wigs"], 10 * intent.categories["fabric-ankara"])
        self.assertIn("wig", intent.words)
        self.assertEqual(intent.summary()["groups"][0], "Hair")

    def test_events_older_than_two_hours_are_ignored(self):
        intent = ranking.build_intent([{"event_type": "view", "category_ref": "x", "created_at": ago(hours=3)}], now=NOW)
        self.assertFalse(intent.active)
        self.assertEqual(intent.categories, {})

    def test_heat_counts_each_member_once_per_item(self):
        events = [{"product_id": "a", "member_id": MEMBER, "event_type": "view", "created_at": ago(minutes=1)}] * 50
        events += [{"product_id": "b", "member_id": m, "event_type": "view", "created_at": ago(minutes=1)}
                   for m in ("m1", "m2", "m3")]
        heat = ranking.heat_scores(events, now=NOW)
        self.assertGreater(heat["b"], heat["a"] * 2.5)

    def test_score_prefers_relevant_in_stock_and_price_fit(self):
        intent = ranking.build_intent([{"event_type": "add_to_cart", "category_ref": "hair-wigs", "price": 100,
                                        "created_at": ago(minutes=1)}], now=NOW)
        wig = product("a", "Wig", "hair-wigs", price=110)
        sold_out = product("b", "Wig", "hair-wigs", price=110, in_stock=False)
        pricey = product("c", "Wig", "hair-wigs", price=900)
        fabric = product("d", "Ankara", "fabric-ankara", price=100)
        scores = {p["id"]: ranking.score(p, intent, now=NOW) for p in (wig, sold_out, pricey, fabric)}
        self.assertGreater(scores["a"], scores["b"])
        self.assertGreater(scores["a"], scores["c"])
        self.assertGreater(scores["a"], scores["d"])

    def test_urgency_and_heat_lift_a_card(self):
        intent = ranking.Intent()
        plain = product("a", "Wig", "hair-wigs")
        ending = {**plain, "sale": {"ends_at": ahead(hours=5)}}
        self.assertGreater(ranking.score(ending, intent, now=NOW), ranking.score(plain, intent, now=NOW))
        self.assertGreater(ranking.score(plain, intent, heat=5), ranking.score(plain, intent, heat=0))

    def test_diversify_limits_runs_of_one_category(self):
        cards = [{"id": str(i), "category_ref": "a"} for i in range(4)] + [{"id": "x", "category_ref": "b"}]
        order = [c["category_ref"] for c in ranking.diversify(cards)]
        self.assertEqual(order[:3], ["a", "a", "b"])

    def test_sale_price(self):
        self.assertEqual(ranking.sale_price(100.0, {"discount_type": "percentage", "value": 25}), 75.0)
        self.assertEqual(ranking.sale_price(10.0, {"discount_type": "fixed_amount", "value": 15}), 0.0)
        self.assertIsNone(ranking.sale_price(10.0, None))


class LinkTests(unittest.TestCase):
    def test_find_and_canonicalise_links(self):
        self.assertEqual(links.find_url("look at this https://www.tiktok.com/@a/video/123?is_from_webapp=1&_r=1!"),
                         "https://www.tiktok.com/@a/video/123?is_from_webapp=1&_r=1")
        self.assertEqual(links.canonical_url("https://www.tiktok.com/@a/video/123?is_from_webapp=1"),
                         "https://tiktok.com/@a/video/123")
        self.assertEqual(links.canonical_url("http://shop.example.com/p/1/?utm_source=ig&color=red&fbclid=x#top"),
                         "https://shop.example.com/p/1?color=red")
        self.assertEqual(links.canonical_url("https://www.instagram.com/reel/ABC/?igsh=zz"), "https://instagram.com/reel/ABC")
        self.assertIsNone(links.canonical_url("ftp://example.com/x"))
        self.assertEqual(links.platform_for("vm.tiktok.com"), "tiktok")

    def test_private_and_non_https_addresses_are_never_fetched(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(200, text="<title>x</title>"))
        client = httpx.Client(transport=transport)
        self.assertIsNone(links.safe_get("https://intranet.example/x", client=client, resolver=lambda h: ["10.0.0.5"]))
        self.assertIsNone(links.safe_get("https://meta.example/x", client=client, resolver=lambda h: ["169.254.169.254"]))
        self.assertIsNone(links.safe_get("http://shop.example/x", client=client, resolver=lambda h: ["93.184.216.34"]))

    def test_redirect_to_a_private_address_is_blocked(self):
        def handler(request):
            if request.url.host == "shop.example":
                return httpx.Response(302, headers={"location": "https://internal.example/admin"})
            return httpx.Response(200, text="secret", headers={"content-type": "text/html"})
        client = httpx.Client(transport=httpx.MockTransport(handler))
        resolver = lambda host: ["93.184.216.34"] if host == "shop.example" else ["127.0.0.1"]
        self.assertIsNone(links.safe_get("https://shop.example/p", client=client, resolver=resolver))

    def test_open_graph_preview(self):
        page = ('<html><head><meta property="og:title" content="Silk press &amp; wig"/>'
                '<meta property="og:image" content="/img/1.jpg"><meta property="product:price:amount" content="45">'
                '<meta name="description" content="Soft"></head></html>')

        def handler(request):
            return httpx.Response(200, text=page, headers={"content-type": "text/html; charset=utf-8"})
        client = httpx.Client(transport=httpx.MockTransport(handler))
        preview = links.fetch_preview("https://shop.example/p/1", client=client, resolver=lambda h: ["93.184.216.34"])
        self.assertEqual(preview.status, "ok")
        self.assertEqual(preview.title, "Silk press & wig")
        self.assertEqual(preview.image_url, "https://shop.example/img/1.jpg")
        self.assertEqual(preview.extra["price"], "45")

    def test_tiktok_uses_oembed_and_failure_never_blocks(self):
        def handler(request):
            if request.url.path == "/oembed":
                return httpx.Response(200, json={"title": "Viral wig", "author_name": "@hairqueen",
                                                 "thumbnail_url": "https://p16.tiktokcdn.com/t.jpg"},
                                      headers={"content-type": "application/json"})
            return httpx.Response(404)
        client = httpx.Client(transport=httpx.MockTransport(handler))
        preview = links.fetch_preview("https://tiktok.com/@hairqueen/video/1", client=client,
                                      resolver=lambda h: ["93.184.216.34"])
        self.assertEqual((preview.status, preview.title, preview.author_name), ("ok", "Viral wig", "@hairqueen"))
        failed = links.fetch_preview("https://blocked.example/p", client=client, resolver=lambda h: ["93.184.216.34"])
        self.assertEqual(failed.status, "failed")
        self.assertEqual(failed.site_name, "blocked.example")


class ShopifyClientTests(unittest.TestCase):
    def test_webhook_signature(self):
        with patch.object(shopify.settings, "SHOPIFY_CLIENT_SECRET", "s3cret"), \
                patch.object(shopify.settings, "SHOPIFY_WEBHOOK_SECRET", ""):
            body = b'{"id":1}'
            good = base64.b64encode(hmac.new(b"s3cret", body, hashlib.sha256).digest()).decode()
            self.assertTrue(shopify.verify_webhook(body, good))
            self.assertFalse(shopify.verify_webhook(body + b" ", good))
            self.assertFalse(shopify.verify_webhook(body, None))

    def test_client_credentials_token_is_cached_and_graphql_errors_raise(self):
        calls = {"token": 0}

        def handler(request):
            if request.url.path == "/admin/oauth/access_token":
                calls["token"] += 1
                self.assertIn(b"grant_type=client_credentials", request.read())
                return httpx.Response(200, json={"access_token": "tok", "expires_in": 86399})
            self.assertEqual(request.headers["X-Shopify-Access-Token"], "tok")
            if b"bad" in request.read():
                return httpx.Response(200, json={"errors": [{"message": "Field 'bad' doesn't exist"}]})
            return httpx.Response(200, json={"data": {"shop": {"name": "FayFort"}}})
        client = httpx.Client(transport=httpx.MockTransport(handler))
        with patch.multiple(shopify.settings, SHOPIFY_STORE_DOMAIN="https://fayfort.myshopify.com/",
                            SHOPIFY_CLIENT_ID="id", SHOPIFY_CLIENT_SECRET="secret", SHOPIFY_ADMIN_ACCESS_TOKEN=""):
            shopify._token_cache.token = None
            self.assertEqual(shopify.admin_graphql("{ shop { name } }", client=client)["shop"]["name"], "FayFort")
            shopify.admin_graphql("{ shop { name } }", client=client)
            self.assertEqual(calls["token"], 1)
            with self.assertRaises(shopify.ShopifyError):
                shopify.admin_graphql("{ bad }", client=client)
            shopify._token_cache.token = None

    def test_app_not_installed_gets_a_clear_message(self):
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(400, text="<title>400 - Oauth error app_not_installed</title>")))
        with patch.multiple(shopify.settings, SHOPIFY_STORE_DOMAIN="fayfort.myshopify.com", SHOPIFY_CLIENT_ID="id",
                            SHOPIFY_CLIENT_SECRET="secret", SHOPIFY_ADMIN_ACCESS_TOKEN=""):
            shopify._token_cache.token = None
            with self.assertRaisesRegex(shopify.ShopifyError, "isn't installed on this store"):
                shopify.admin_token(client)

    def test_checkout_falls_back_to_cart_permalink(self):
        with patch.multiple(shopify.settings, SHOPIFY_STORE_DOMAIN="fayfort.myshopify.com",
                            SHOPIFY_STOREFRONT_ACCESS_TOKEN=""):
            cart_id, url = shopify.create_checkout(lines=[("gid://shopify/ProductVariant/11", 2)], member_id=MEMBER,
                                                   email="m@example.com")
        self.assertTrue(url.startswith("https://fayfort.myshopify.com/cart/11:2?"))
        self.assertIn("attributes%5Bfayfort_member_id%5D=" + MEMBER, url)

    def test_storefront_checkout_sends_member_attribute(self):
        seen = {}

        def handler(request):
            seen["headers"] = request.headers
            seen["body"] = json.loads(request.read())
            return httpx.Response(200, json={"data": {"cartCreate": {"cart": {"id": "gid://shopify/Cart/1",
                                  "checkoutUrl": "https://fayfort.myshopify.com/cart/c/1"}, "userErrors": []}}})
        with patch.multiple(shopify.settings, SHOPIFY_STORE_DOMAIN="fayfort.myshopify.com",
                            SHOPIFY_STOREFRONT_ACCESS_TOKEN="private"):
            _, url = shopify.create_checkout(lines=[("11", 1)], member_id=MEMBER, email=None,
                                             client=httpx.Client(transport=httpx.MockTransport(handler)))
        self.assertEqual(url, "https://fayfort.myshopify.com/cart/c/1")
        self.assertEqual(seen["headers"]["Shopify-Storefront-Private-Token"], "private")
        cart_input = seen["body"]["variables"]["input"]
        self.assertEqual(cart_input["lines"][0]["merchandiseId"], "gid://shopify/ProductVariant/11")
        self.assertEqual(cart_input["attributes"], [{"key": "fayfort_member_id", "value": MEMBER}])


SHOPIFY_NODE = {
    "id": "gid://shopify/Product/900", "handle": "body-wave", "title": "Body wave wig", "description": "<p>Soft</p>",
    "productType": "Lace front wig", "vendor": "FayFort", "tags": ["trending"], "status": "ACTIVE",
    "updatedAt": "2026-10-14T10:00:00Z", "onlineStoreUrl": "https://fayfort.com/products/body-wave", "totalInventory": 3,
    "category": None,
    "priceRangeV2": {"minVariantPrice": {"amount": "99.0", "currencyCode": "USD"},
                     "maxVariantPrice": {"amount": "140.0", "currencyCode": "USD"}},
    "media": {"nodes": [
        {"mediaContentType": "IMAGE", "alt": "Front", "image": {"url": "https://cdn.shopify.com/1.jpg"}, "preview": None},
        {"mediaContentType": "VIDEO", "alt": None, "preview": {"image": {"url": "https://cdn.shopify.com/v.jpg"}},
         "sources": [{"url": "https://cdn.shopify.com/v.m3u8", "mimeType": "application/x-mpegURL"},
                     {"url": "https://cdn.shopify.com/v.mp4", "mimeType": "video/mp4"}]},
    ]},
    "variants": {"nodes": [
        {"id": "gid://shopify/ProductVariant/1", "title": "18 inch", "sku": "BW18", "price": "99.00",
         "compareAtPrice": "120.00", "availableForSale": True, "inventoryQuantity": 3, "position": 1,
         "selectedOptions": [{"name": "Length", "value": "18"}], "image": None},
        {"id": "gid://shopify/ProductVariant/2", "title": "24 inch", "sku": None, "price": "140.00",
         "compareAtPrice": None, "availableForSale": False, "inventoryQuantity": 0, "position": 2,
         "selectedOptions": [{"name": "Length", "value": "24"}], "image": None},
    ]},
}


class CatalogTests(DbCase):
    def test_map_and_upsert_product_with_category_from_product_type(self):
        db = self.use(seeded_db())
        product_id = catalog.upsert_product(SHOPIFY_NODE)
        row = next(p for p in db.rows["directory_products"] if p["id"] == product_id)
        self.assertEqual(row["category_ref"], "hair-wigs")
        self.assertFalse(row["category_needs_mapping"])
        self.assertEqual((row["price_min"], row["price_max"], row["compare_at_max"]), (99.0, 140.0, 120.0))
        self.assertTrue(row["in_stock"] and row["active"])
        self.assertEqual(row["description"], "Soft")
        self.assertEqual(row["media_url"], "https://cdn.shopify.com/1.jpg")
        media = [m for m in db.rows["commerce_media"] if m["product_id"] == product_id]
        self.assertEqual([m["media_type"] for m in media], ["image", "video"])
        self.assertEqual(media[1]["url"], "https://cdn.shopify.com/v.mp4")
        variants = [v for v in db.rows["commerce_variants"] if v["product_id"] == product_id]
        self.assertEqual(len(variants), 2)

    def test_unknown_category_is_flagged_and_restock_is_stamped(self):
        db = self.use(seeded_db())
        node = {**SHOPIFY_NODE, "productType": "Mystery", "variants": {"nodes": [
            {**SHOPIFY_NODE["variants"]["nodes"][0], "availableForSale": False}]}}
        product_id = catalog.upsert_product(node)
        row = next(p for p in db.rows["directory_products"] if p["id"] == product_id)
        self.assertTrue(row["category_needs_mapping"])
        self.assertIsNone(row["category_ref"])
        self.assertFalse(row["in_stock"])
        catalog.upsert_product(SHOPIFY_NODE)
        self.assertIsNotNone(row.get("restocked_at"))
        self.assertTrue(row["in_stock"])

    def test_fayfort_hide_tag_keeps_a_product_out_of_the_shop(self):
        db = self.use(seeded_db())
        product_id = catalog.upsert_product({**SHOPIFY_NODE, "productType": "Ebook", "tags": ["Fayfort-Hide"]})
        row = next(p for p in db.rows["directory_products"] if p["id"] == product_id)
        self.assertFalse(row["active"])
        self.assertFalse(row["category_needs_mapping"])
        self.assertNotIn(product_id, [p["id"] for p in service.load_products()])

    def test_reconcile_retires_products_missing_from_shopify(self):
        db = self.use(seeded_db())
        result = catalog.reconcile("manual", products=lambda: iter([SHOPIFY_NODE]))
        self.assertEqual(result["products_upserted"], 1)
        self.assertEqual(result["products_removed"], 5)
        gone = next(p for p in db.rows["directory_products"] if p["id"] == "p-wig")
        self.assertFalse(gone["active"])
        self.assertEqual(db.rows["commerce_sync_runs"][0]["status"], "ok")


class FindItTests(DbCase):
    def fake_preview(self, canonical):
        return links.Preview(canonical_url=canonical, platform=links.platform_for(links.urlsplit(canonical).hostname),
                             status="ok", title="Body wave lace front wig 24 inch", image_url="https://p16.tiktokcdn.com/t.jpg",
                             author_name="@hairqueen")

    def test_link_creates_one_trend_item_shared_by_many_members(self):
        db = self.use(seeded_db())
        first = service.find_it(MEMBER, "https://www.tiktok.com/@hairqueen/video/1?_r=1 need this",
                                session_id="s1", fetch=self.fake_preview)
        service.find_it(OTHER, "https://tiktok.com/@hairqueen/video/1", session_id="s2", fetch=self.fake_preview)
        self.assertEqual(len(db.rows["commerce_trend_items"]), 1)
        self.assertEqual(db.rows["commerce_trend_items"][0]["share_count"], 2)
        self.assertEqual(first["kind"], "link")
        self.assertEqual(first["link"]["title"], "Body wave lace front wig 24 inch")
        self.assertIsNone(first["exact"])
        self.assertEqual(first["alternatives"][0]["id"], "p-wig")  # closest, in stock, buyable today
        self.assertTrue(first["source_it"]["trend_item_id"])
        self.assertEqual(db.rows["commerce_intent_events"][0]["event_type"], "paste_link")

    def test_linked_trend_returns_exact_match(self):
        db = self.use(seeded_db())
        service.find_it(MEMBER, "https://tiktok.com/@a/video/9", session_id="s1", fetch=self.fake_preview)
        db.rows["commerce_trend_items"][0]["linked_product_id"] = "p-wig2"
        again = service.find_it(OTHER, "https://tiktok.com/@a/video/9", session_id="s2", fetch=self.fake_preview)
        self.assertEqual(again["exact"]["id"], "p-wig2")
        self.assertNotIn("p-wig2", [a["id"] for a in again["alternatives"]])

    def test_words_search_finds_exact_and_alternatives(self):
        self.use(seeded_db())
        result = service.find_it(MEMBER, "ionic hair dryer", session_id="s1")
        self.assertEqual(result["kind"], "words")
        self.assertEqual(result["exact"]["id"], "p-dryer")

    def test_source_it_joins_pool_once_and_opens_one_request(self):
        db = self.use(seeded_db())
        found = service.find_it(MEMBER, "https://shop.example/p/1", session_id="s1", fetch=self.fake_preview)
        trend_id = found["source_it"]["trend_item_id"]
        first = service.want_trend_item(MEMBER, trend_id, session_id="s1")
        second = service.want_trend_item(MEMBER, trend_id, session_id="s1")
        self.assertEqual(first["request_id"], "req-1")
        self.assertEqual(second["want_count"], 1)
        self.assertEqual([name for name, _ in db.rpcs].count("create_member_purchase_request"), 1)
        params = db.rpcs[0][1]
        self.assertEqual((params["p_source_type"], params["p_source_url"]), ("url", "https://shop.example/p/1"))


class RailsAndCartTests(DbCase):
    def test_rails_show_trending_ending_soon_back_in_stock_and_pools(self):
        db = self.use(seeded_db(
            commerce_flash_sales=[{"id": "sale1", "title": "Weekend drop", "discount_type": "percentage", "value": 20,
                                   "product_ids": ["p-wig"], "starts_at": ago(hours=1), "ends_at": ahead(hours=10),
                                   "code": None, "status": "scheduled"}],
            commerce_trend_items=[
                {"id": "t1", "canonical_url": "https://tiktok.com/@a/video/1", "platform": "tiktok", "title": "Viral wig",
                 "status": "pooling", "pool_target": 10, "pool_price": 60, "pool_currency": "USD", "share_count": 8,
                 "want_count": 7, "last_shared_at": ago(hours=1)}],
            commerce_giveaways=[{"id": "g1", "title": "Wig giveaway", "description": "", "prize_text": "A wig",
                                 "starts_at": ago(days=1), "ends_at": ahead(days=1), "winner_count": 1, "status": "open"}],
        ))
        db.rows["directory_products"][2]["restocked_at"] = ago(days=1)
        result = service.rails(MEMBER)
        keys = [rail["key"] for rail in result["rails"]]
        for key in ("trending", "ending_soon", "back_in_stock", "almost_sourced", "under_price"):
            self.assertIn(key, keys)
        ending = next(r for r in result["rails"] if r["key"] == "ending_soon")["items"][0]
        self.assertEqual(ending["sale"]["sale_price"], 96.0)
        pool = next(r for r in result["rails"] if r["key"] == "almost_sourced")["items"][0]
        self.assertAlmostEqual(pool["pool"]["progress"], 0.7)
        self.assertEqual(result["giveaways"][0]["id"], "g1")
        self.assertFalse(result["intent"]["active"])

    def test_for_you_rail_appears_once_member_shows_intent(self):
        self.use(seeded_db())
        service.record_events(MEMBER, "s1", [{"event_type": "add_to_cart", "product_id": "p-wig"},
                                             {"event_type": "search", "query": "wig"}])
        result = service.rails(MEMBER)
        self.assertEqual(result["rails"][0]["key"], "for_you")
        self.assertEqual(result["rails"][0]["items"][0]["category_ref"], "hair-wigs")


class ApiTests(DbCase):
    def client(self, db: Db) -> TestClient:
        self.use(db)
        app = FastAPI()
        app.include_router(create_member_commerce_router())
        app.include_router(create_admin_commerce_router())
        app.include_router(create_shopify_webhook_router())
        for target in ("app.commerce.member_router.trusted_user_id",):
            patcher = patch(target, side_effect=lambda auth: {"Bearer member": MEMBER, "Bearer other": OTHER,
                                                              "Bearer admin": ADMIN}.get(auth))
            patcher.start()
            self.addCleanup(patcher.stop)
        admin = patch("app.commerce.admin_router.trusted_platform_admin",
                      side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None)
        admin.start()
        self.addCleanup(admin.stop)
        return TestClient(app)

    def test_member_endpoints_require_sign_in(self):
        client = self.client(seeded_db())
        self.assertEqual(client.get("/members/shop/home").status_code, 401)
        self.assertEqual(client.get("/platform/commerce/overview", headers={"Authorization": "Bearer member"}).status_code, 403)

    def test_cart_add_rejects_sold_out_and_returns_impulse(self):
        client = self.client(seeded_db())
        auth = {"Authorization": "Bearer member"}
        sold_out = client.put("/members/cart/lines", json={"variant_id": str(uuid.UUID(int=1)), "quantity": 1}, headers=auth)
        self.assertEqual(sold_out.status_code, 404)
        self.db.rows["commerce_variants"][0]["id"] = str(uuid.UUID(int=2))
        self.db.rows["commerce_variants"][1]["id"] = str(uuid.UUID(int=3))
        gone = client.put("/members/cart/lines", json={"variant_id": str(uuid.UUID(int=3)), "quantity": 1}, headers=auth)
        self.assertEqual(gone.status_code, 409)
        added = client.put("/members/cart/lines", json={"variant_id": str(uuid.UUID(int=2)), "quantity": 2,
                                                         "session_id": "s1"}, headers=auth)
        self.assertEqual(added.status_code, 200, added.text)
        body = added.json()
        self.assertEqual(body["subtotal"], 240.0)
        self.assertTrue(body["impulse"]["pairs_with"])
        self.assertNotIn("p-wig", [c["id"] for c in body["impulse"]["pairs_with"]])
        self.assertEqual(self.db.rows["commerce_intent_events"][-1]["event_type"], "add_to_cart")

    def test_checkout_records_and_returns_shopify_link(self):
        db = seeded_db()
        db.rows["commerce_variants"][0]["id"] = str(uuid.UUID(int=2))
        db.rows["commerce_cart_lines"] = [{"member_id": MEMBER, "variant_id": str(uuid.UUID(int=2)), "quantity": 1,
                                           "added_at": ago(minutes=1)}]
        client = self.client(db)
        with patch("app.commerce.member_router.shopify.create_checkout",
                   return_value=("gid://shopify/Cart/1", "https://fayfort.myshopify.com/cart/c/1")) as create:
            response = client.post("/members/cart/checkout", headers={"Authorization": "Bearer member"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["checkout_url"], "https://fayfort.myshopify.com/cart/c/1")
        self.assertEqual(create.call_args.kwargs["lines"], [("gid://shopify/ProductVariant/11", 1)])
        self.assertEqual(create.call_args.kwargs["member_id"], MEMBER)
        self.assertEqual(len(db.rows["commerce_checkouts"]), 1)

    def test_intent_events_reject_server_only_types(self):
        client = self.client(seeded_db())
        bad = client.post("/members/shop/events", json={"session_id": "s", "events": [{"event_type": "paste_link"}]},
                          headers={"Authorization": "Bearer member"})
        self.assertEqual(bad.status_code, 422)

    def test_giveaway_entry_once_and_draw_is_reproducible(self):
        db = seeded_db(commerce_giveaways=[{"id": str(uuid.UUID(int=9)), "title": "Wig giveaway", "prize_text": "A wig",
                                            "starts_at": ago(days=2), "ends_at": ahead(days=1), "winner_count": 1,
                                            "status": "open"}])
        client = self.client(db)
        gid = str(uuid.UUID(int=9))
        for token in ("member", "member", "other"):
            ok = client.post(f"/members/giveaways/{gid}/enter", headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(ok.status_code, 201)
        self.assertEqual(len(db.rows["commerce_giveaway_entries"]), 2)
        early = client.post(f"/platform/commerce/giveaways/{gid}/draw", headers={"Authorization": "Bearer admin"})
        self.assertEqual(early.status_code, 409)
        db.rows["commerce_giveaways"][0]["ends_at"] = ago(minutes=1)
        drawn = client.post(f"/platform/commerce/giveaways/{gid}/draw", headers={"Authorization": "Bearer admin"})
        self.assertEqual(drawn.status_code, 200, drawn.text)
        result = drawn.json()
        self.assertEqual(result["entries"], 2)
        self.assertEqual(result["winners"][0]["member_id"], service.draw_order(result["seed"], [MEMBER, OTHER])[0])
        self.assertEqual(db.rows["email_outbox"][0]["template"], "commerce_giveaway_won")
        again = client.post(f"/platform/commerce/giveaways/{gid}/draw", headers={"Authorization": "Bearer admin"})
        self.assertEqual(again.status_code, 409)

    def test_pool_needs_target_and_price_and_linking_notifies_wanters(self):
        tid = str(uuid.UUID(int=5))
        db = seeded_db(commerce_trend_items=[{"id": tid, "canonical_url": "https://shop.example/p/1", "platform": "web",
                                              "status": "open", "share_count": 3, "want_count": 2,
                                              "last_shared_at": ago(hours=1)}],
                       commerce_pool_members=[{"trend_item_id": tid, "member_id": MEMBER},
                                              {"trend_item_id": tid, "member_id": OTHER}])
        db.rows["directory_products"][0]["id"] = str(uuid.UUID(int=7))
        client = self.client(db)
        auth = {"Authorization": "Bearer admin"}
        bad = client.put(f"/platform/commerce/trends/{tid}", json={"status": "pooling"}, headers=auth)
        self.assertEqual(bad.status_code, 422)
        ok = client.put(f"/platform/commerce/trends/{tid}", json={"status": "pooling", "pool_target": 10, "pool_price": "55.00",
                                                                 "pool_currency": "USD"}, headers=auth)
        self.assertEqual(ok.status_code, 200, ok.text)
        linked = client.put(f"/platform/commerce/trends/{tid}", json={"linked_product_id": str(uuid.UUID(int=7))}, headers=auth)
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(sorted(e["member_id"] for e in db.rows["email_outbox"]), sorted([MEMBER, OTHER]))
        queue = client.get("/platform/commerce/trends", headers=auth).json()["trends"]
        self.assertEqual(queue[0]["linked_product"]["id"], str(uuid.UUID(int=7)))

    def test_request_invoice_uses_selected_option_price(self):
        rid = str(uuid.UUID(int=4))
        db = seeded_db(member_purchase_requests=[{"id": rid, "member_id": MEMBER, "request_title": "Wig"}],
                       operations_sourcing_member_options=[{"id": "o1", "request_id": rid, "product_name": "Wig 22in",
                                                            "price_amount": 130, "currency": "USD", "status": "selected",
                                                            "selected_at": ago(hours=1)}])
        client = self.client(db)
        with patch("app.commerce.admin_router.shopify.admin_configured", return_value=True), \
                patch("app.commerce.service.shopify.create_invoice",
                      return_value=("gid://shopify/DraftOrder/1", "https://fayfort.myshopify.com/i/1")) as create:
            ready = client.get("/platform/commerce/invoices", headers={"Authorization": "Bearer admin"}).json()
            self.assertTrue(ready["ready_to_invoice"][0]["can_invoice"])
            response = client.post("/platform/commerce/invoices", json={"request_id": rid},
                                   headers={"Authorization": "Bearer admin"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(create.call_args.kwargs["unit_price"], 130.0)
        self.assertEqual(create.call_args.kwargs["email"], "c1@example.com")
        invoice = db.rows["commerce_invoices"][0]
        self.assertEqual((invoice["status"], invoice["invoice_url"]), ("sent", "https://fayfort.myshopify.com/i/1"))

    def test_sale_validation(self):
        client = self.client(seeded_db())
        with patch("app.commerce.admin_router.shopify.admin_configured", return_value=True):
            too_big = client.post("/platform/commerce/sales", json={
                "title": "Drop", "discount_type": "percentage", "value": "95", "product_ids": [str(uuid.UUID(int=1))],
                "starts_at": ahead(hours=1), "ends_at": ahead(hours=5)}, headers={"Authorization": "Bearer admin"})
        self.assertEqual(too_big.status_code, 422)

    def test_webhook_signature_dedupe_and_order_paid_invoice(self):
        iid = str(uuid.UUID(int=8))
        db = seeded_db(commerce_invoices=[{"id": iid, "member_id": MEMBER, "status": "sent", "request_id": "r1",
                                           "title": "Wig", "amount": 130, "currency": "USD"}])
        client = self.client(db)
        order = {"id": 555, "admin_graphql_api_id": "gid://shopify/Order/555", "name": "#1001", "email": "m@example.com",
                 "financial_status": "paid", "fulfillment_status": None, "total_price": "130.00", "currency": "USD",
                 "note_attributes": [{"name": "fayfort_invoice_id", "value": iid}],
                 "line_items": [{"title": "Wig", "quantity": 1, "price": "130.00", "product_id": None}],
                 "fulfillments": [], "order_status_url": "https://fayfort.myshopify.com/s/1",
                 "created_at": NOW.isoformat()}
        body = json.dumps(order).encode()
        with patch.object(shopify.settings, "SHOPIFY_CLIENT_SECRET", "s3cret"), \
                patch.object(shopify.settings, "SHOPIFY_WEBHOOK_SECRET", ""):
            sig = base64.b64encode(hmac.new(b"s3cret", body, hashlib.sha256).digest()).decode()
            headers = {"X-Shopify-Hmac-Sha256": sig, "X-Shopify-Topic": "orders/updated", "X-Shopify-Webhook-Id": "w1",
                       "Content-Type": "application/json"}
            unsigned = client.post("/commerce/shopify/webhooks", content=body, headers={**headers, "X-Shopify-Hmac-Sha256": "x"})
            self.assertEqual(unsigned.status_code, 401)
            first = client.post("/commerce/shopify/webhooks", content=body, headers=headers)
            second = client.post("/commerce/shopify/webhooks", content=body, headers=headers)
        self.assertEqual(first.json(), {"ok": True})
        self.assertTrue(second.json()["duplicate"])
        stored = db.rows["commerce_orders"][0]
        self.assertEqual((stored["member_id"], stored["source"], stored["order_name"]), (MEMBER, "invoice", "#1001"))
        self.assertEqual(db.rows["commerce_invoices"][0]["status"], "paid")
        self.assertIn("record_commerce_invoice_paid", [name for name, _ in db.rpcs])
        self.assertEqual(db.rows["commerce_webhook_events"][0]["status"], "processed")

    def test_storefront_order_clears_cart_and_feeds_heat(self):
        db = seeded_db(commerce_cart_lines=[{"member_id": MEMBER, "variant_id": "v-wig", "quantity": 1}])
        self.use(db)
        db.rows["commerce_webhook_events"] = [{"webhook_id": "w2", "topic": "orders/create", "status": "received"}]
        order = {"id": 556, "name": "#1002", "financial_status": "paid", "currency": "USD", "total_price": "120.00",
                 "note_attributes": [{"name": "fayfort_member_id", "value": MEMBER}],
                 "line_items": [{"title": "Wig", "quantity": 1, "price": "120.00", "product_id": "p-wig"}]}
        self.assertEqual(process("orders/create", order, "w2"), "processed")
        self.assertEqual(db.rows["commerce_cart_lines"], [])
        self.assertEqual(db.rows["commerce_intent_events"][0]["event_type"], "checkout")
        self.assertEqual(db.rows["commerce_orders"][0]["source"], "storefront")


class CommerceEmailTests(unittest.TestCase):
    def test_commerce_template_renders_from_payload(self):
        from app.mailer import sender
        row = {"category": "notifications", "template": "commerce_giveaway_won", "member_id": MEMBER,
               "payload": {"title": "You won: Wig giveaway", "body": "Congratulations!", "href": "/member/chat"}}
        email = sender.build_member_email(row, {"unsubscribe_token": "t"})
        self.assertIn("You won: Wig giveaway", email.subject)
        self.assertIn("Congratulations!", email.html)
        self.assertIn("/member/chat", email.text)
        self.assertIsNone(sender.build_member_email({**row, "payload": {}}, {}))


if __name__ == "__main__":
    unittest.main()
