"""FayFort Finds (docs/FINDS_PLAN.md): the Store team's find desk, weekly drops, plan access, watches, alerts and the
public teaser."""
from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.commerce import store_team
from app.finds import service as finds
from app.finds import shipping
from app.finds.router import create_finds_router
from tests.test_store_team import ADMIN, WORKER, Db

FREE, STANDARD, PRO = ("00000000-0000-0000-0000-0000000000f1", "00000000-0000-0000-0000-0000000000f2",
                       "00000000-0000-0000-0000-0000000000f3")
# Wednesday 4 Nov 2026, 02:00 UTC (10:00 China).
NOW = datetime(2026, 11, 4, 2, 0, tzinfo=timezone.utc)


class FindsCase(unittest.TestCase):
    def setUp(self):
        self.db = Db({
            "member_profiles": [{"user_id": FREE, "member_tier": "free", "rank_level": 1},
                                {"user_id": STANDARD, "member_tier": "standard", "rank_level": 1},
                                {"user_id": PRO, "member_tier": "pro", "rank_level": 1}],
            "directory_categories": [{"source_ref": "HAIR-WIG", "category": "Wigs"}],
        })
        self.previous = commerce_db.client
        commerce_db.client = self.db
        self.clock = patch.object(finds, "now_utc", return_value=NOW)
        self.clock.start()

    def tearDown(self):
        self.clock.stop()
        commerce_db.client = self.previous

    def emails(self):
        return [(r["member_id"], r["payload"]["title"]) for r in self.db.rows.get("email_outbox", [])]

    def ready_find(self, lane="trending", title="Heatless curling ribbon"):
        """Scouted, checked, listed and published by an administrator: a scheduled find."""
        find, listing, _item = finds.open_find(lane, ADMIN, "platform_admin")
        finds.update(find, {"signal_platforms": ["tiktok_shop", "instagram"], "signal_regions": ["US", "UK"],
                            "why": "Sales on TikTok Shop US doubled this month; few sellers ship to Africa yet.",
                            "stage": "rising", "competition": "low", "china_check": "in_person",
                            "china_place": "Baiyun market, Guangzhou", "unit_cost_min": 6.5, "unit_cost_max": 8,
                            "supplier_moq": 50, "sample_available": True, "sell_price_min": 14, "sell_price_max": 20,
                            "price_breaks": [{"min_qty": 50, "price": 2.4}, {"min_qty": 1, "price": 4.5},
                                             {"min_qty": 10, "price": 3.2}], "unit_weight_kg": 0.2}, ADMIN)
        finds.mark_checked(finds.get(find["id"]), ADMIN)
        listing = store_team.update_listing(store_team.get_listing(listing["id"]), {
            "title": title, "category_ref": "HAIR-WIG",
            "media": [{"media_type": "image", "url": "https://cdn.shopify.com/ribbon.jpg", "source": "url"}]})
        listing = store_team.submit(store_team.get_listing(listing["id"]), ADMIN)
        store_team.publish(store_team.get_listing(listing["id"]), ADMIN)
        return finds.get(find["id"])


class DeskTests(FindsCase):
    def test_a_find_goes_from_scouting_to_a_hidden_product_in_the_next_drop(self):
        find, listing, item = finds.open_find("trending", ADMIN, "platform_admin")
        self.assertEqual((find["status"], item["work_type"] if item else None), ("scouted", None) if not item else ("scouted", item["work_type"]))
        self.assertEqual(self.db.rows["operations_work_items"][0]["work_type"], "list_find")
        listing = store_team.update_listing(store_team.get_listing(listing["id"]), {
            "title": "Ribbon", "category_ref": "HAIR-WIG", "media": [{"media_type": "image", "url": "https://x/1.jpg"}]})
        missing = store_team.missing_details(store_team.get_listing(listing["id"]))
        self.assertIn("the China check", missing)
        self.assertIn("at least one price break", missing)
        with self.assertRaises(store_team.ListingError):
            store_team.submit(store_team.get_listing(listing["id"]), ADMIN)
        with self.assertRaises(finds.FindError):
            finds.mark_checked(finds.get(find["id"]), ADMIN)

        ready = self.ready_find()
        self.assertEqual(ready["status"], "scheduled")
        self.assertEqual([b["min_qty"] for b in ready["price_breaks"]], [1, 10, 50])
        product = next(p for p in self.db.rows["directory_products"] if p["id"] == ready["product_id"])
        self.assertFalse(product["active"])
        drop = finds._drop(ready["drop_id"])
        # Next Monday 9 Nov 09:00 China = 01:00 UTC; Pro from Saturday 7 Nov.
        self.assertEqual(drop["release_at"], "2026-11-09T01:00:00+00:00")
        self.assertEqual(drop["early_at"], "2026-11-07T01:00:00+00:00")
        self.assertEqual(drop["title"], "Finds of 9 Nov 2026")

    def test_not_obtainable_cancels_the_listing_and_is_kept(self):
        find, listing, _item = finds.open_find("rare", ADMIN, "platform_admin")
        closed = finds.mark_not_obtainable(find, ADMIN, "Factory stopped making it")
        self.assertEqual(closed["status"], "not_obtainable")
        self.assertEqual(store_team.get_listing(listing["id"])["status"], "cancelled")
        self.assertIn("Factory stopped making it", closed["china_note"])

    def test_bad_research_is_refused(self):
        find, _listing, _item = finds.open_find("trending", ADMIN, "platform_admin")
        for bad in ({"stage": "viral"}, {"price_breaks": [{"min_qty": 0, "price": 2}]}, {"unit_weight_kg": -1},
                    {"unit_cost_min": 10, "unit_cost_max": 5}, {"china_check": "phone"}):
            with self.assertRaises(finds.FindError):
                finds.update(finds.get(find["id"]), bad, ADMIN)

    def test_a_full_drop_sends_the_next_find_to_the_following_week(self):
        first = finds.place_in_drop()
        self.db.rows["find_drops"][0]["target_count"] = 1
        self.db.rows.setdefault("finds", []).append({"id": "f-full", "drop_id": first["id"], "status": "scheduled", "lane": "trending"})
        second = finds.place_in_drop()
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(second["release_at"], "2026-11-16T01:00:00+00:00")


class AccessTests(FindsCase):
    def open_drop(self, find, *, early=True, release=False, catalog=False):
        drop = next(d for d in self.db.rows["find_drops"] if d["id"] == find["drop_id"])
        drop["early_at"] = (NOW - timedelta(hours=1) if early else NOW + timedelta(days=1)).isoformat()
        drop["release_at"] = (NOW - timedelta(minutes=30) if release else NOW + timedelta(days=2)).isoformat()
        drop["catalog_at"] = (NOW - timedelta(minutes=10) if catalog else NOW + timedelta(days=9)).isoformat()

    def test_pro_sees_it_early_with_landed_maths_standard_on_release_free_a_week_later(self):
        find = self.ready_find()
        self.open_drop(find, early=True)
        self.assertEqual(len(finds.member_finds(PRO)["finds"]), 1)
        self.assertEqual(finds.member_finds(STANDARD)["finds"], [])
        self.assertEqual(finds.member_finds(STANDARD)["next_drop"]["title"], "Finds of 9 Nov 2026")
        with self.assertRaises(LookupError):
            finds.member_detail(STANDARD, find["id"])
        self.assertIsNone(finds.visible_product(STANDARD, find["product_id"]))
        self.assertIsNotNone(finds.visible_product(PRO, find["product_id"]))

        self.db.rows["find_shipping_rates"] = [{"zone": "west_africa", "label": "West Africa", "air_per_kg": 12.0,
                                                "handling_per_unit": 0.1}]
        pro = finds.member_detail(PRO, find["id"], "NG")["find"]
        self.assertEqual(pro["research"]["china_check"], "Checked in person")
        self.assertEqual(pro["zone"], "West Africa")
        # 50+ units: 2.40 + 0.2 kg x 12 + 0.10 = 4.90 landed; usual price 17 -> 12.10 margin.
        self.assertEqual(pro["landed"][-1], {"min_qty": 50, "unit_price": 2.4, "freight_per_unit": 2.5,
                                             "landed_per_unit": 4.9, "margin_per_unit": 12.1})

        self.open_drop(find, early=True, release=True)
        standard = finds.member_detail(STANDARD, find["id"], "NG")["find"]
        self.assertIn("research", standard)
        self.assertIn("price_breaks", standard)
        self.assertNotIn("landed", standard)
        self.assertEqual(finds.member_finds(FREE)["finds"], [])

        self.open_drop(find, early=True, release=True, catalog=True)
        free = finds.member_finds(FREE)["finds"][0]
        self.assertNotIn("research", free)
        self.assertNotIn("price_breaks", free)

    def test_free_sees_three_featured_and_the_rest_locked(self):
        made = [self.ready_find(title=f"Find {n}") for n in range(5)]
        for find in made:
            self.open_drop(find, early=True, release=True, catalog=True)
        cards = finds.member_finds(FREE)["finds"]
        self.assertEqual([c["locked"] for c in cards], [False, False, False, True, True])
        self.assertNotIn("check", cards[4])

    def test_a_pro_in_the_first_paid_month_gets_standard_access(self):
        with patch("app.membership.plans.in_first_month", return_value=True):
            self.assertFalse(finds.access_for(PRO)["early"])
        self.assertTrue(finds.access_for(PRO)["early"])

    def test_effort_stats_count_what_did_not_make_it(self):
        find = self.ready_find()
        extra, _l, _i = finds.open_find("rare", ADMIN, "platform_admin")
        finds.mark_not_obtainable(extra, ADMIN, "No supplier")
        finds.open_find("trending", ADMIN, "platform_admin")
        stats = finds.drop_stats(finds._drop(find["drop_id"]))
        self.assertEqual(stats, {"scouted": 3, "checked": 2, "made_it": 1})


class WatchAndReleaseTests(FindsCase):
    def test_watch_limits_and_price_drop_alerts_follow_the_plan(self):
        find = self.ready_find()
        drop = next(d for d in self.db.rows["find_drops"] if d["id"] == find["drop_id"])
        for key in ("early_at", "release_at", "catalog_at"):
            drop[key] = (NOW - timedelta(minutes=5)).isoformat()
        finds.watch(STANDARD, find["id"])
        finds.watch(FREE, find["id"])
        self.db.rows["member_find_watches"] += [{"member_id": FREE, "find_id": f"x{n}"} for n in range(4)]
        others = self.ready_find(title="Other")
        drop2 = next(d for d in self.db.rows["find_drops"] if d["id"] == others["drop_id"])
        for key in ("early_at", "release_at", "catalog_at"):
            drop2[key] = (NOW - timedelta(minutes=5)).isoformat()
        with self.assertRaises(finds.FindError):
            finds.watch(FREE, others["id"])
        live = finds.get(find["id"])
        live["status"] = "released"
        finds.update(live, {"price_breaks": [{"min_qty": 1, "price": 4.5}, {"min_qty": 50, "price": 1.9}]}, ADMIN)
        alerted = [m for m, title in self.emails() if title.startswith("Price drop")]
        self.assertEqual(alerted, [STANDARD])
        finds.update(finds.get(find["id"]), {"price_breaks": [{"min_qty": 1, "price": 4.5}, {"min_qty": 50, "price": 1.9}]}, ADMIN)
        self.assertEqual(len([t for _m, t in self.emails() if t.startswith("Price drop")]), 1)

    def test_sweep_opens_for_pro_then_standard_then_the_catalog(self):
        find = self.ready_find()
        drop = finds._drop(find["drop_id"])
        with patch.object(finds, "now_utc", return_value=datetime(2026, 11, 7, 1, 5, tzinfo=timezone.utc)):
            counts = finds.sweep(datetime(2026, 11, 7, 1, 5, tzinfo=timezone.utc))
        self.assertEqual(counts["opened"], 1)
        self.assertEqual(finds.get(find["id"])["status"], "released")
        self.assertEqual([m for m, _t in self.emails()], [PRO])
        later = datetime(2026, 11, 9, 1, 5, tzinfo=timezone.utc)
        with patch.object(finds, "now_utc", return_value=later):
            finds.sweep(later)
        self.assertEqual(sorted(m for m, _t in self.emails()), sorted([PRO, STANDARD]))
        product = next(p for p in self.db.rows["directory_products"] if p["id"] == find["product_id"])
        self.assertFalse(product["active"])
        week = datetime(2026, 11, 16, 1, 5, tzinfo=timezone.utc)
        with patch.object(finds, "now_utc", return_value=week):
            counts = finds.sweep(week)
        self.assertEqual(counts["catalog"], 1)
        self.assertTrue(product["active"])
        self.assertTrue(finds._drop(drop["id"])["notified"].get("catalog"))

    def test_the_drop_bell_lets_free_opt_in_and_paid_opt_out(self):
        self.assertFalse(finds.member_finds(FREE)["drop_alerts"])
        self.assertTrue(finds.member_finds(STANDARD)["drop_alerts"])
        finds.set_drop_alerts(FREE, True)
        finds.set_drop_alerts(PRO, False)
        self.assertTrue(finds.member_finds(FREE)["drop_alerts"])
        self.assertFalse(finds.member_finds(PRO)["drop_alerts"])
        self.ready_find()
        for moment in (datetime(2026, 11, 7, 1, 5, tzinfo=timezone.utc), datetime(2026, 11, 9, 1, 5, tzinfo=timezone.utc),
                       datetime(2026, 11, 16, 1, 5, tzinfo=timezone.utc)):
            with patch.object(finds, "now_utc", return_value=moment):
                finds.sweep(moment)
        drop_emails = [(m, t) for m, t in self.emails() if not t.startswith("Price drop")]
        self.assertEqual(sorted(m for m, _t in drop_emails), sorted([STANDARD, FREE]))
        self.assertTrue(any(m == FREE and t.startswith("Now open for you") for m, t in drop_emails))

    def test_the_drop_bell_endpoint(self):
        app = FastAPI()
        app.include_router(create_finds_router(lambda _a: FREE, lambda _a: None))
        client = TestClient(app)
        response = client.put("/members/finds/alerts", json={"on": True}, headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"drop_alerts": True})
        self.assertTrue(finds.drop_alerts_on(FREE))

    def test_sweep_plans_ahead_and_asks_to_fill_a_short_drop(self):
        finds.sweep(NOW)
        releases = sorted(d["release_at"] for d in self.db.rows["find_drops"])
        self.assertEqual(releases[:2], ["2026-11-09T01:00:00+00:00", "2026-11-16T01:00:00+00:00"])
        tasks = [i for i in self.db.rows.get("operations_work_items", []) if i["work_type"] == "fill_finds_drop"]
        self.assertEqual(len(tasks), 1)
        self.assertIn("0 of 10", tasks[0]["summary"])

    def test_niche_requests_are_pro_only_and_limited(self):
        self.clock.stop()  # work items carry the real creation time
        self.clock = patch.object(finds, "now_utc", return_value=datetime.now(timezone.utc))
        self.clock.start()
        with self.assertRaises(finds.FindError):
            finds.niche_request(STANDARD, "Satin bonnets for braids, sold in Lagos")
        for _ in range(2):
            finds.niche_request(PRO, "Satin bonnets for braids, sold in Lagos")
        with self.assertRaises(finds.FindError):
            finds.niche_request(PRO, "Another niche worth checking please")


class ShippingAndApiTests(FindsCase):
    def test_every_country_has_a_zone(self):
        self.assertEqual(shipping.zone_for("ng"), "west_africa")
        self.assertEqual(shipping.zone_for("GB"), "uk_europe")
        self.assertEqual(shipping.zone_for("JP"), "asia_pacific")
        self.assertIsNone(shipping.zone_for("Nigeria"))
        self.assertEqual(shipping.landed([{"min_qty": 1, "price": 3}], 0.5, {"air_per_kg": None}), [])
        self.assertEqual(shipping.unit_price_for([{"min_qty": 1, "price": 5}, {"min_qty": 10, "price": 4}], 12), 4)

    def test_api_needs_the_store_team_and_shows_members_their_access(self):
        self.db.rows["operations_worker_departments"] = [{"worker_id": WORKER, "department": "sourcing", "can_claim": True}]
        who = {"Bearer w": {"user_id": WORKER, "role": "worker"}, "Bearer a": {"user_id": ADMIN, "role": "platform_admin"}}
        app = FastAPI()
        app.include_router(create_finds_router(lambda h: {"Bearer s": STANDARD, "Bearer p": PRO}.get(h or "", FREE),
                                               lambda h: who.get(h or "")))
        client = TestClient(app)
        self.assertEqual(client.post("/operations/finds", json={"lane": "rare"}, headers={"Authorization": "Bearer w"}).status_code, 403)
        made = client.post("/operations/finds", json={"lane": "rare"}, headers={"Authorization": "Bearer a"})
        self.assertEqual(made.status_code, 201, made.text)
        self.assertEqual(made.json()["find"]["status"], "scouted")
        listed = client.get("/operations/finds", headers={"Authorization": "Bearer a"}).json()
        self.assertEqual(len(listed["finds"]), 1)
        self.assertEqual(client.put("/operations/finds/shipping-rates", json={"rates": []},
                                    headers={"Authorization": "Bearer w"}).status_code, 403)
        body = client.get("/members/finds", headers={"Authorization": "Bearer p"}).json()
        self.assertTrue(body["access"]["maths"])
        self.assertEqual(len(body["process"]), 4)
        teaser = client.get("/public/finds/teaser").json()
        self.assertEqual(teaser["items"], [])


if __name__ == "__main__":
    unittest.main()
