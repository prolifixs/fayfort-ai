"""Store team, store sections, campaigns and the Schedule (docs/CATALOG_MERCHANDISING_PLAN.md)."""
from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts import operations_flow as flow
from app.accounts.schedule import build_schedule
from app.commerce import campaigns, merch_sections, service, store_team
from app.commerce import db as commerce_db

NOW = datetime.now(timezone.utc)
ADMIN = "00000000-0000-0000-0000-0000000000a1"
WORKER = "00000000-0000-0000-0000-0000000000b1"
OTHER = "00000000-0000-0000-0000-0000000000b2"
MEMBER = "00000000-0000-0000-0000-0000000000c1"


def ago(**kwargs) -> str:
    return (NOW - timedelta(**kwargs)).isoformat()


def ahead(**kwargs) -> str:
    return (NOW + timedelta(**kwargs)).isoformat()


class Query:
    def __init__(self, db: "Db", table: str):
        self.db, self.table, self.filters, self.op, self.values = db, table, [], "select", None
        self._order, self._limit, self.single, self.conflict, self.ignore = None, None, False, None, False

    def select(self, *_a, **_k): return self
    def order(self, column, desc=False, **_k): self._order = (column, desc); return self
    def limit(self, n): self._limit = n; return self
    def range(self, a, b): self._limit = b - a + 1; return self
    def maybe_single(self): self.single = True; return self
    def eq(self, c, v): self.filters.append((c, "eq", v)); return self
    def neq(self, c, v): self.filters.append((c, "neq", v)); return self
    def gte(self, c, v): self.filters.append((c, "gte", v)); return self
    def gt(self, c, v): self.filters.append((c, "gt", v)); return self
    def lte(self, c, v): self.filters.append((c, "lte", v)); return self
    def lt(self, c, v): self.filters.append((c, "lt", v)); return self
    def in_(self, c, v): self.filters.append((c, "in", list(v))); return self
    def is_(self, c, v): self.filters.append((c, "is", v)); return self
    def insert(self, values): self.op, self.values = "insert", values; return self
    def update(self, values): self.op, self.values = "update", values; return self
    def upsert(self, values, on_conflict=None, ignore_duplicates=False):
        self.op, self.values, self.conflict, self.ignore = "upsert", values, on_conflict, ignore_duplicates
        return self
    def delete(self): self.op = "delete"; return self

    @staticmethod
    def _value(row, column):
        if "->>" in column:
            field, key = column.split("->>", 1)
            return (row.get(field) or {}).get(key)
        return row.get(column)

    def _match(self, row):
        for column, op, value in self.filters:
            current = self._value(row, column)
            if op == "eq" and str(current) != str(value): return False
            if op == "neq" and str(current) == str(value): return False
            if op == "gte" and (current is None or str(current) < str(value)): return False
            if op == "gt" and (current is None or str(current) <= str(value)): return False
            if op == "lte" and (current is None or str(current) > str(value)): return False
            if op == "lt" and (current is None or str(current) >= str(value)): return False
            if op == "in" and str(current) not in [str(x) for x in value]: return False
            if op == "is" and value == "null" and current is not None: return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == "select":
            found = [dict(r) for r in rows if self._match(r)]
            if self._order:
                column, desc = self._order
                found.sort(key=lambda r: str(r.get(column) or ""), reverse=desc)
            if self._limit:
                found = found[: self._limit]
            return SimpleNamespace(data=(found[0] if found else None) if self.single else found)
        if self.op == "delete":
            gone = [r for r in rows if self._match(r)]
            self.db.rows[self.table] = [r for r in rows if not self._match(r)]
            return SimpleNamespace(data=[dict(r) for r in gone])
        if self.op == "update":
            changed = [r for r in rows if self._match(r)]
            for r in changed:
                r.update(self.values)
            return SimpleNamespace(data=[dict(r) for r in changed])
        items = self.values if isinstance(self.values, list) else [self.values]
        out = []
        for item in items:
            if self.op == "upsert" and self.conflict:
                keys = [k.strip() for k in self.conflict.split(",")]
                existing = next((r for r in rows if all(str(r.get(k)) == str(item.get(k)) for k in keys)), None)
                if existing:
                    if not self.ignore:
                        existing.update(item)
                    out.append(dict(existing))
                    continue
            item = {"id": str(uuid.uuid4()), "created_at": NOW.isoformat(), "version": 1, **item}
            rows.append(item)
            out.append(dict(item))
        return SimpleNamespace(data=out)


class Db:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.rpc_calls = []
        self.uploads = []

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if name == "claim_operations_work_item":
            def claim():
                item = next(r for r in self.rows["operations_work_items"] if r["id"] == params["p_work_item_id"])
                item.update({"status": "claimed", "assigned_worker_id": params["p_worker_id"], "claimed_until": ahead(minutes=15)})
                return SimpleNamespace(data=dict(item))
            return SimpleNamespace(execute=claim)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=1))

    @property
    def storage(self):
        db = self

        class Bucket:
            def upload(self, path, content, options):
                db.uploads.append((path, len(content), options))

            def get_public_url(self, path):
                return f"https://lirauxdhnknfiqjnulxb.supabase.co/storage/v1/object/public/product-media/{path}?"

            def remove(self, paths):
                db.uploads = [u for u in db.uploads if u[0] not in paths]

        return SimpleNamespace(from_=lambda _bucket: Bucket())


class Base(unittest.TestCase):
    def setUp(self):
        self.db = Db({"directory_categories": [{"source_ref": "HAIR-WIG", "category": "Wigs", "group_name": "Hair",
                                                 "product_type": "Wig"}]})
        self.previous = commerce_db.client
        commerce_db.client = self.db
        service.clear_cache()

    def tearDown(self):
        commerce_db.client = self.previous
        service.clear_cache()

    def items(self, work_type=None):
        return [r for r in self.db.rows.get("operations_work_items", []) if not work_type or r["work_type"] == work_type]

    def product(self, **values):
        row = {"id": str(uuid.uuid4()), "name": "Body wave wig", "source": "fayfort", "active": True,
               "category_ref": "HAIR-WIG", "created_at": ago(days=1), "availability_status": "sourcing", **values}
        self.db.rows.setdefault("directory_products", []).append(row)
        return row


class ListingTests(Base):
    def start(self, kind="store_product", **values):
        return store_team.open_listing(kind=kind, actor_id=WORKER, actor_role="worker", values=values)

    def test_worker_starts_a_listing_and_has_it_claimed_in_the_store_team(self):
        listing, item = self.start(title="Ankara set")
        self.assertEqual(listing["status"], "draft")
        self.assertEqual(item["department"], "store_team")
        self.assertEqual(item["work_type"], "list_store_product")
        self.assertEqual(item["status"], "claimed")
        self.assertEqual(item["assigned_worker_id"], WORKER)
        self.assertEqual(item["summary"], "List a store product: Ankara set")

    def test_submit_needs_every_detail(self):
        listing, _ = self.start(title="Ankara set")
        with self.assertRaises(store_team.ListingError) as error:
            store_team.submit(listing, WORKER)
        self.assertIn("a category", str(error.exception))
        self.assertIn("a price", str(error.exception))
        self.assertIn("at least one photo", str(error.exception))

    def ready(self, kind="store_product", **extra):
        values = {"title": "Ankara set", "category_ref": "HAIR-WIG",
                  "media": [{"media_type": "image", "url": "https://cdn.example.com/a.jpg", "source": "upload"}], **extra}
        values.update({"price": 40.0} if kind == "store_product" else {"price_guide_min": 12.0, "price_guide_max": 18.0})
        listing, item = self.start(kind, **values)
        return store_team.get_listing(listing["id"]), item

    def test_submitting_a_store_product_creates_a_shopify_draft_and_waits_for_an_admin(self):
        listing, item = self.ready()
        with patch("app.commerce.shopify.admin_configured", return_value=True), \
             patch("app.commerce.shopify.create_listing_product", return_value="gid://shopify/Product/9") as create:
            submitted = store_team.submit(listing, WORKER)
        create.assert_called_once()
        self.assertEqual(submitted["status"], "in_review")
        self.assertEqual(submitted["shopify_product_id"], "gid://shopify/Product/9")
        work = self.items("list_store_product")[0]
        self.assertEqual((work["status"], work["waiting_on"]), ("waiting", "internal"))
        self.assertIn(("notify_platform_admins"), [name for name, _ in self.db.rpc_calls])

    def test_send_back_returns_the_work_to_the_worker_with_the_note(self):
        listing, _ = self.ready()
        with patch("app.commerce.shopify.admin_configured", return_value=True), \
             patch("app.commerce.shopify.create_listing_product", return_value="gid://shopify/Product/9"):
            listing = store_team.submit(listing, WORKER)
        store_team.send_back(listing, ADMIN, "Use a brighter photo")
        work = self.items("list_store_product")[0]
        self.assertEqual(work["status"], "open")
        self.assertEqual(work["assigned_worker_id"], WORKER)
        self.assertIn("brighter photo", work["next_action"])
        self.assertEqual(store_team.get_listing(listing["id"])["status"], "changes_requested")
        notices = self.db.rows["operations_worker_notifications"]
        self.assertEqual(notices[0]["worker_id"], WORKER)

    def test_admin_publish_sets_the_product_active_and_closes_the_work(self):
        trend = {"id": str(uuid.uuid4()), "title": "Viral wig", "linked_product_id": None}
        self.db.rows["commerce_trend_items"] = [trend]
        listing, _ = self.ready(trend_item_id=None)
        self.db.rows["store_listings"][0]["trend_item_id"] = trend["id"]
        with patch("app.commerce.shopify.admin_configured", return_value=True), \
             patch("app.commerce.shopify.create_listing_product", return_value="gid://shopify/Product/9"):
            listing = store_team.submit(store_team.get_listing(listing["id"]), WORKER)
        self.product(id="p-shop", source="shopify", shopify_product_id="gid://shopify/Product/9")
        with patch("app.commerce.shopify.admin_configured", return_value=True), \
             patch("app.commerce.shopify.set_product_status") as status, \
             patch("app.commerce.shopify.publish_to_sales_channels", return_value=False), \
             patch("app.commerce.catalog.sync_one"):
            published = store_team.publish(listing, ADMIN)
        status.assert_called_once_with("gid://shopify/Product/9", "ACTIVE")
        self.assertEqual(published["status"], "published")
        self.assertEqual(published["product_id"], "p-shop")
        self.assertEqual(trend["linked_product_id"], "p-shop")
        work = self.items("list_store_product")[0]
        self.assertEqual(work["status"], "completed")
        reasons = [e["reason"] for e in self.db.rows["operations_work_events"]]
        self.assertTrue(any("sales channels" in r for r in reasons))

    def test_publishing_a_sourcing_item_saves_the_price_guide_and_gallery(self):
        listing, _ = self.ready("sourcing_item", min_order=50, lead_time_min_days=10, lead_time_max_days=20)
        listing = store_team.submit(listing, WORKER)
        store_team.publish(listing, ADMIN)
        [product] = self.db.rows["directory_products"]
        self.assertEqual((product["price_min"], product["price_max"], product["min_order"]), (12.0, 18.0, 50))
        self.assertEqual((product["lead_time_min_days"], product["lead_time_max_days"]), (10, 20))
        self.assertTrue(product["active"])
        self.assertEqual(len(self.db.rows["commerce_media"]), 1)
        self.assertEqual(self.items("list_sourcing_item")[0]["status"], "completed")

    def test_a_listing_with_an_admin_cant_be_edited(self):
        listing, _ = self.ready("sourcing_item")
        listing = store_team.submit(listing, WORKER)
        with self.assertRaises(store_team.ListingError):
            store_team.update_listing(listing, {"title": "Changed"})


class RetireAndMapTests(Base):
    def test_retire_rules(self):
        idle = self.product(name="Old fabric", created_at=ago(days=90))
        wanted = self.product(name="Popular fabric", created_at=ago(days=90))
        young = self.product(name="New fabric", created_at=ago(days=10))
        snoozed = self.product(name="Kept fabric", created_at=ago(days=90), retire_snoozed_until=ahead(days=5))
        sold_out = self.product(name="Sold out wig", source="shopify", shopify_product_id="gid://shopify/Product/1",
                                in_stock=False, sold_out_since=ago(days=31))
        recent_sold_out = self.product(name="Just sold out", source="shopify", shopify_product_id="gid://shopify/Product/2",
                                       in_stock=False, sold_out_since=ago(days=3))
        self.db.rows["commerce_intent_events"] = [{"product_id": wanted["id"], "created_at": ago(days=2)}]
        flagged = {p["name"] for p, _ in store_team.retire_candidates()}
        self.assertEqual(flagged, {"Old fabric", "Sold out wig"})
        self.assertEqual(store_team.sync_retire_candidates(), 2)
        self.assertEqual(store_team.sync_retire_candidates(), 0)  # not twice
        del young, snoozed, recent_sold_out, idle, sold_out

    def test_keep_snoozes_and_worker_retire_of_a_store_product_waits_for_an_admin(self):
        self.product(name="Old fabric", created_at=ago(days=90))
        shop = self.product(name="Sold out wig", source="shopify", shopify_product_id="gid://shopify/Product/1",
                            in_stock=False, sold_out_since=ago(days=40))
        store_team.sync_retire_candidates()
        fabric_item = next(i for i in self.items("retire_listing") if i["metadata"]["product_name"] == "Old fabric")
        store_team.keep_listing(fabric_item, WORKER, "worker", "Wedding season soon")
        fabric = next(p for p in self.db.rows["directory_products"] if p["name"] == "Old fabric")
        self.assertGreater(fabric["retire_snoozed_until"], NOW.isoformat())
        wig_item = next(i for i in self.items("retire_listing") if i["metadata"]["product_name"] == "Sold out wig")
        result = store_team.retire_listing(wig_item, WORKER, "worker", "Supplier stopped making it")
        self.assertEqual(result["status"], "waiting_for_admin")
        self.assertTrue(shop["active"])
        with patch("app.commerce.shopify.admin_configured", return_value=True), \
             patch("app.commerce.shopify.set_product_status") as status:
            store_team.retire_listing(wig_item, ADMIN, "platform_admin", "Confirmed")
        status.assert_called_once_with("gid://shopify/Product/1", "ARCHIVED")
        self.assertFalse(shop["active"])

    def test_unmapped_products_get_a_category_task_that_closes_when_mapped(self):
        product = self.product(name="New lace", source="shopify", shopify_product_id="gid://shopify/Product/5",
                               category_ref=None, category_needs_mapping=True)
        self.assertEqual(store_team.sync_unmapped_products(), 1)
        [item] = self.items("map_product")
        self.assertEqual(item["department"], "store_team")
        with patch("app.commerce.shopify.admin_configured", return_value=True), \
             patch("app.commerce.shopify.set_product_category") as write_back:
            store_team.map_category(product["id"], "HAIR-WIG", WORKER)
        write_back.assert_called_once()
        self.assertEqual(self.items("map_product")[0]["status"], "completed")

    def test_trends_shared_by_three_members_become_one_sourcing_listing(self):
        self.db.rows["commerce_trend_items"] = [
            {"id": "t1", "title": "Viral bonnet", "share_count": 3, "status": "open", "linked_product_id": None,
             "image_url": "https://p16.tiktokcdn.com/a.jpg", "canonical_url": "https://www.tiktok.com/@a/video/1"},
            {"id": "t2", "title": "Barely shared", "share_count": 2, "status": "open", "linked_product_id": None}]
        self.assertEqual(store_team.sync_trend_listings(), 1)
        self.assertEqual(store_team.sync_trend_listings(), 0)
        [listing] = self.db.rows["store_listings"]
        self.assertEqual((listing["kind"], listing["trend_item_id"]), ("sourcing_item", "t1"))
        self.assertEqual(listing["media"][0]["source"], "trend")
        [item] = self.items("list_sourcing_item")
        self.assertEqual(item["status"], "open")
        self.assertIn("3 members shared it", item["summary"])


class SectionTests(Base):
    def test_sections_need_their_minimum_and_hide_when_products_drop_out(self):
        live = [self.product(name=f"Wig {i}", source="shopify", shopify_product_id=f"gid://shopify/Product/{i}",
                             in_stock=True, price_min=10.0 + i) for i in range(3)]
        with self.assertRaises(merch_sections.SectionError):
            merch_sections.save_section({"title": "Dollar deals"}, [live[0]["id"]], WORKER)
        section = merch_sections.save_section({"title": "Dollar deals", "hook": "3 from $10"}, [p["id"] for p in live], WORKER)
        tiles = merch_sections.member_sections(lambda found: service.cards(found))
        self.assertEqual([t["title"] for t in tiles if not t.get("built_in")], ["Dollar deals"])
        self.assertEqual(len(tiles[0]["items"]), 3)
        live[2]["in_stock"] = False  # sold out: drops out, the section is now under its minimum
        tiles = merch_sections.member_sections(lambda found: service.cards(found))
        self.assertEqual([t for t in tiles if not t.get("built_in")], [])
        self.assertEqual(merch_sections.sync_section_refresh(), 1)
        [item] = self.items("refresh_section")
        self.assertEqual(item["department"], "store_team")
        replacement = self.product(name="Wig 9", source="shopify", shopify_product_id="gid://shopify/Product/9", in_stock=True)
        merch_sections.save_section({"title": "Dollar deals"}, [live[0]["id"], live[1]["id"], replacement["id"]],
                                    WORKER, section["id"])
        self.assertEqual(self.items("refresh_section")[0]["status"], "completed")

    def test_a_section_ending_within_two_days_asks_for_a_refresh(self):
        live = [self.product(name=f"Fabric {i}") for i in range(3)]
        merch_sections.save_section({"title": "Wedding fabrics", "ends_at": ahead(hours=30)}, [p["id"] for p in live], WORKER)
        self.assertEqual(merch_sections.sync_section_refresh(), 1)
        self.assertEqual(merch_sections.sync_section_refresh(), 0)

    def test_suggested_hook(self):
        self.assertEqual(merch_sections.suggested_hook([{"price_min": 6, "compare_at_max": 10}]), "Up to 40% off")
        self.assertEqual(merch_sections.suggested_hook([{"price_min": 0.99}, {"price_min": 3}]), "From $0.99")


class CardTests(Base):
    def test_badges_and_price_guide(self):
        shop = self.product(source="shopify", shopify_product_id="gid://shopify/Product/1", in_stock=True,
                            price_min=60.0, compare_at_max=100.0, created_at=ago(days=1))
        sourcing = self.product(price_min=12.0, price_max=18.0, created_at=ago(days=30), min_order=50)
        [a, b] = service.cards([shop, sourcing])
        self.assertEqual([x["label"] for x in a["badges"]], ["-40%", "Ships now", "New"])
        self.assertEqual([x["label"] for x in b["badges"]], ["Sourced on request"])
        self.assertTrue(b["price_guide"])
        self.assertFalse(b["buyable"])
        self.assertEqual(b["min_order"], 50)

    def test_a_prize_is_held_back_except_for_its_winner(self):
        shop = self.product(source="shopify", shopify_product_id="gid://shopify/Product/1", in_stock=True,
                            price_min=60.0, total_inventory=1)
        self.db.rows["commerce_giveaways"] = [{"id": "g1", "prize_product_id": shop["id"], "winner_count": 1,
                                               "status": "drawn", "wrapped_up_at": None}]
        self.db.rows["commerce_giveaway_winners"] = [{"giveaway_id": "g1", "member_id": MEMBER}]
        [everyone] = service.cards([shop])
        self.assertFalse(everyone["buyable"])
        self.assertTrue(everyone["held_for_giveaway"])
        [winner] = service.cards([shop], member_id=MEMBER)
        self.assertTrue(winner["buyable"])


class CampaignTests(Base):
    def test_prepare_task_is_due_a_day_before_and_closes_when_everything_is_ready(self):
        giveaway = {"id": "g1", "title": "Wig week", "starts_at": ahead(days=3), "ends_at": ahead(days=10)}
        item = campaigns.ensure_campaign("giveaway", giveaway)
        self.assertEqual(item["department"], "store_team")
        due = datetime.fromisoformat(item["due_at"])
        self.assertAlmostEqual((due - NOW).total_seconds(), timedelta(days=2).total_seconds(), delta=120)
        self.assertIsNone(campaigns.ensure_campaign("giveaway", {**giveaway, "id": "g0", "starts_at": ago(days=2)}))
        result = campaigns.update_prep(item, prize_ready=True, section_ready=True, announcement=None,
                                       actor_id=WORKER, actor_type="worker")
        self.assertFalse(result["ready"])
        result = campaigns.update_prep(item, prize_ready=None, section_ready=None, announcement="Win a wig this week!",
                                       actor_id=WORKER, actor_type="worker")
        self.assertTrue(result["ready"])
        self.assertEqual(self.items("prepare_campaign")[0]["status"], "completed")

    def test_giveaway_wraps_up_a_week_after_the_draw_with_results(self):
        self.db.rows["commerce_giveaways"] = [{"id": "g1", "title": "Wig week", "status": "drawn", "drawn_at": ago(days=8),
                                               "wrapped_up_at": None, "starts_at": ago(days=20), "ends_at": ago(days=8)}]
        self.db.rows["commerce_giveaway_entries"] = [{"giveaway_id": "g1", "member_id": MEMBER}, {"giveaway_id": "g1", "member_id": OTHER}]
        self.db.rows["commerce_orders"] = [{"total": "30.00", "currency": "USD", "placed_at": ago(days=10), "cancelled_at": None}]
        summary = campaigns.sync_campaigns()
        self.assertEqual(summary["wrapped_up"], 1)
        results = self.db.rows["commerce_giveaways"][0]["results"]
        self.assertEqual((results["entries"], results["orders"], results["order_total"]), (2, 1, 30.0))

    def test_a_cancelled_giveaway_closes_its_prepare_task(self):
        self.db.rows["commerce_giveaways"] = [{"id": "g1", "title": "Wig week", "status": "open",
                                               "starts_at": ahead(days=3), "ends_at": ahead(days=10)}]
        campaigns.sync_campaigns()
        self.assertEqual(len(self.items("prepare_campaign")), 1)
        self.db.rows["commerce_giveaways"][0]["status"] = "cancelled"
        campaigns.sync_campaigns()
        self.assertEqual(self.items("prepare_campaign")[0]["status"], "cancelled")


class ScheduleTests(Base):
    def setUp(self):
        super().setUp()
        self.db.rows["operations_work_items"] = [
            {"id": "w-mine", "summary": "Mine", "department": "sourcing", "status": "claimed", "due_at": ahead(days=1), "assigned_worker_id": WORKER},
            {"id": "w-dept", "summary": "Open in my department", "department": "store_team", "status": "open", "due_at": ahead(days=2), "assigned_worker_id": None},
            {"id": "w-other", "summary": "Someone else's", "department": "store_team", "status": "claimed", "due_at": ahead(days=2), "assigned_worker_id": OTHER},
            {"id": "w-late", "summary": "Late", "department": "store_team", "status": "open", "due_at": ago(hours=2), "assigned_worker_id": None},
        ]
        self.db.rows["commerce_giveaways"] = [{"id": "g1", "title": "Wig week", "status": "open", "starts_at": ahead(days=1),
                                               "ends_at": ahead(days=5), "drawn_at": None}]
        self.db.rows["member_request_schedules"] = [{"id": "s1", "status": "active", "next_due_at": ahead(days=3), "cadence": "monthly"}]

    def window(self):
        return NOW - timedelta(days=1), NOW + timedelta(days=7)

    def test_worker_sees_their_work_open_department_work_and_the_shop_calendar(self):
        start, end = self.window()
        entries = build_schedule(start=start, end=end, admin=False, user_id=WORKER, departments=["store_team"])
        ids = {e["id"] for e in entries}
        self.assertIn("deadline:w-mine", ids)
        self.assertIn("deadline:w-dept", ids)
        self.assertNotIn("deadline:w-other", ids)
        self.assertIn("giveaway:g1:start", ids)
        self.assertIn("giveaway:g1:draw", ids)
        self.assertNotIn("recurring:s1", ids)  # recurring orders are Sourcing's
        late = next(e for e in entries if e["id"] == "deadline:w-late")
        self.assertEqual(late["status"], "overdue")

    def test_admin_sees_everything_and_can_filter_by_person(self):
        start, end = self.window()
        everything = {e["id"] for e in build_schedule(start=start, end=end, admin=True, user_id=ADMIN, departments=[])}
        self.assertTrue({"deadline:w-other", "recurring:s1"} <= everything)
        theirs = build_schedule(start=start, end=end, admin=True, user_id=ADMIN, departments=[], worker_id=OTHER,
                                types={"deadline"})
        self.assertEqual([e["id"] for e in theirs], ["deadline:w-other"])

    def test_windows_are_limited(self):
        with self.assertRaises(ValueError):
            build_schedule(start=NOW, end=NOW + timedelta(days=90), admin=True, user_id=ADMIN, departments=[])


class RouterTests(Base):
    def client(self, role="worker", departments=("store_team",)):
        from app.accounts.store_team_router import create_store_team_router
        self.db.rows["operations_worker_departments"] = [
            {"worker_id": WORKER, "department": d, "can_claim": True} for d in departments]
        staff = {"user_id": ADMIN if role == "platform_admin" else WORKER, "role": role}
        app = FastAPI()
        app.include_router(create_store_team_router(lambda _auth: staff))
        return TestClient(app)

    def test_store_work_needs_the_store_team(self):
        response = self.client(departments=("sourcing",)).get("/operations/store/products", headers={"Authorization": "Bearer x"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Store team", response.json()["detail"])
        response = self.client().get("/operations/store/products", headers={"Authorization": "Bearer x"})
        self.assertEqual(response.status_code, 200)

    def test_only_an_admin_publishes(self):
        client = self.client()
        created = client.post("/operations/store/listings", json={"kind": "sourcing_item", "title": "Lace front"},
                              headers={"Authorization": "Bearer x"})
        self.assertEqual(created.status_code, 201)
        listing_id = created.json()["listing"]["id"]
        self.assertEqual(client.post(f"/operations/store/listings/{listing_id}/publish",
                                     headers={"Authorization": "Bearer x"}).status_code, 403)

    def test_upload_checks_the_file_and_adds_it_to_the_gallery(self):
        client = self.client()
        listing_id = client.post("/operations/store/listings", json={"kind": "store_product"},
                                 headers={"Authorization": "Bearer x"}).json()["listing"]["id"]
        bad = client.post(f"/operations/store/listings/{listing_id}/media?filename=a.png", content=b"not a png",
                          headers={"Authorization": "Bearer x", "Content-Type": "image/png"})
        self.assertEqual(bad.status_code, 415)
        good = client.post(f"/operations/store/listings/{listing_id}/media?filename=front.png",
                           content=b"\x89PNG\r\n\x1a\n" + b"0" * 32,
                           headers={"Authorization": "Bearer x", "Content-Type": "image/png"})
        self.assertEqual(good.status_code, 201)
        media = good.json()["listing"]["media"]
        self.assertEqual(media[0]["source"], "upload")
        self.assertTrue(media[0]["url"].endswith(".png"))
        self.assertEqual(media[0]["alt"], "front")

    def test_instagram_links_are_for_sourcing_items_only(self):
        client = self.client()
        listing_id = client.post("/operations/store/listings", json={"kind": "store_product"},
                                 headers={"Authorization": "Bearer x"}).json()["listing"]["id"]
        response = client.post(f"/operations/store/listings/{listing_id}/media-url",
                               json={"url": "https://www.instagram.com/p/abc/"}, headers={"Authorization": "Bearer x"})
        self.assertEqual(response.status_code, 422)

    def test_schedule_endpoint(self):
        response = self.client().get("/operations/schedule", params={"start": NOW.isoformat(), "end": ahead(days=7)},
                                     headers={"Authorization": "Bearer x"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["can_plan"])


if __name__ == "__main__":
    unittest.main()
