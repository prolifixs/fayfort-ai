from __future__ import annotations

import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ads import service
from app.ads.router import create_ads_router
from app.commerce import db as commerce_db
from tests.test_commerce import ADMIN, MEMBER, NOW, Db

AUTH = {"Authorization": "Bearer member"}
ADMIN_AUTH = {"Authorization": "Bearer admin"}
CREATIVE = "11111111-1111-1111-1111-111111111111"


class AdsDb(Db):
    def rpc(self, name, params):
        self.rpcs.append((name, params))
        if name == "record_ad_events":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=len(params["p_events"])))
        return super().rpc(name, params)


def seed(tier="free", **settings):
    return {
        "member_profiles": [{"user_id": MEMBER, "member_tier": tier, "rank_level": 1}],
        "ad_settings": [{"id": 1, "enabled": True, "google_enabled": False, "google_client": None,
                         "google_test_mode": False, "max_per_screen": 3, **settings}],
        "ad_placements": [
            {"key": "browse_top", "enabled": True, "source": "google_then_custom", "google_slot_id": "1234567890",
             "google_format": "horizontal", "shape": "banner", "priority": 10},
            {"key": "browse_feed", "enabled": True, "source": "google", "google_slot_id": None,
             "google_format": "fluid", "shape": "feed", "priority": 20},
            {"key": "sidebar", "enabled": False, "source": "custom", "shape": "square", "priority": 60},
        ],
        "ad_creatives": [
            {"id": CREATIVE, "name": "House", "status": "active", "headline": "Go ad-free", "cta_label": "See plans",
             "target_url": "action:plans", "tone": "brand", "placements": ["browse_top", "sidebar"], "weight": 1},
            {"id": "22222222-2222-2222-2222-222222222222", "name": "Later", "status": "active", "headline": "Soon",
             "cta_label": "Go", "target_url": "https://example.com", "tone": "light", "placements": ["browse_top"],
             "weight": 1, "starts_at": (NOW + timedelta(days=3)).isoformat()},
        ],
    }


class AdsCase(unittest.TestCase):
    def client(self, rows) -> tuple[TestClient, AdsDb]:
        db = AdsDb(rows)
        for patcher in (
            patch.object(commerce_db, "client", db),
            patch("app.commerce.member_router.trusted_user_id",
                  side_effect=lambda auth: {"Bearer member": MEMBER, "Bearer admin": ADMIN}.get(auth)),
            patch("app.ads.router.trusted_platform_admin",
                  side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None),
            patch.object(service, "now_utc", return_value=NOW),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        service.clear_cache()
        self.addCleanup(service.clear_cache)
        app = FastAPI()
        app.include_router(create_ads_router())
        return TestClient(app), db


class MemberAdsTests(AdsCase):
    def test_free_member_gets_custom_ads_when_google_is_not_set_up(self):
        client, _ = self.client(seed())
        body = client.get("/members/ads", headers=AUTH).json()
        self.assertTrue(body["show"])
        self.assertIsNone(body["google"])
        self.assertEqual([p["key"] for p in body["placements"]], ["browse_top"])  # feed needs Google, sidebar is off
        creatives = body["placements"][0]["creatives"]
        self.assertEqual([c["id"] for c in creatives], [CREATIVE])  # the scheduled one hasn't started
        self.assertNotIn("name", creatives[0])

    def test_google_placements_when_publisher_is_set(self):
        client, _ = self.client(seed(google_enabled=True, google_client="ca-pub-1234567890123456", google_test_mode=True))
        body = client.get("/members/ads", headers=AUTH).json()
        self.assertEqual(body["google"], {"client": "ca-pub-1234567890123456", "test": True})
        top = body["placements"][0]
        self.assertEqual(top["google"]["slot"], "1234567890")
        self.assertEqual(len(top["creatives"]), 1)

    def test_paid_members_see_no_ads(self):
        for tier in ("standard", "pro"):
            client, _ = self.client(seed(tier=tier, google_enabled=True, google_client="ca-pub-1234567890123456"))
            self.assertEqual(client.get("/members/ads", headers=AUTH).json(), {"show": False, "reason": "paid_plan"})

    def test_master_switch_turns_ads_off(self):
        client, _ = self.client(seed(enabled=False))
        self.assertFalse(client.get("/members/ads", headers=AUTH).json()["show"])

    def test_requires_member(self):
        client, _ = self.client(seed())
        self.assertEqual(client.get("/members/ads").status_code, 401)

    def test_events_are_recorded_and_validated(self):
        client, db = self.client(seed())
        events = [{"placement": "browse_top", "creative_id": CREATIVE, "source": "custom", "kind": "impression"},
                  {"placement": "browse_top", "source": "google", "kind": "click"}]
        response = client.post("/members/ads/events", headers=AUTH, json={"events": events})
        self.assertEqual(response.json(), {"recorded": 2})
        self.assertEqual(db.rpcs[-1][1]["p_events"][1]["creative_id"], None)
        bad = client.post("/members/ads/events", headers=AUTH,
                          json={"events": [{"placement": "browse_top", "creative_id": "x", "source": "custom", "kind": "view"}]})
        self.assertEqual(bad.status_code, 422)

    def test_ads_txt(self):
        client, _ = self.client(seed())
        self.assertEqual(client.get("/ads.txt").status_code, 404)
        client, _ = self.client(seed(google_client="ca-pub-1234567890123456"))
        response = client.get("/ads.txt")
        self.assertEqual(response.text, "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n")


class AdminAdsTests(AdsCase):
    def test_admin_only(self):
        client, _ = self.client(seed())
        self.assertEqual(client.get("/platform/ads", headers=AUTH).status_code, 403)
        overview = client.get("/platform/ads", headers=ADMIN_AUTH).json()
        self.assertEqual(len(overview["placements"]), 3)
        self.assertEqual(len(overview["creatives"]), 2)

    def test_settings_validate_publisher_id(self):
        client, db = self.client(seed())
        bad = client.put("/platform/ads/settings", headers=ADMIN_AUTH,
                         json={"enabled": True, "google_enabled": True, "google_client": ""})
        self.assertEqual(bad.status_code, 422)
        ok = client.put("/platform/ads/settings", headers=ADMIN_AUTH,
                        json={"enabled": True, "google_enabled": True, "google_client": "pub-1234567890123456",
                              "max_per_screen": 2})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(db.rows["ad_settings"][0]["google_client"], "ca-pub-1234567890123456")

    def test_settings_change_reaches_members_right_away(self):
        client, _ = self.client(seed())
        self.assertTrue(client.get("/members/ads", headers=AUTH).json()["show"])
        client.put("/platform/ads/settings", headers=ADMIN_AUTH, json={"enabled": False, "google_enabled": False})
        self.assertFalse(client.get("/members/ads", headers=AUTH).json()["show"])

    def test_placement_update(self):
        client, db = self.client(seed())
        response = client.put("/platform/ads/placements/browse_feed", headers=ADMIN_AUTH,
                              json={"enabled": True, "source": "google", "google_slot_id": "",
                                    "google_format": "fluid"})
        self.assertEqual(response.status_code, 422)
        response = client.put("/platform/ads/placements/browse_feed", headers=ADMIN_AUTH,
                              json={"enabled": True, "source": "google", "google_slot_id": "9876543210",
                                    "google_format": "fluid", "google_layout_key": "-6t+ed+2i-1n-4w"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(db.rows["ad_placements"][1]["google_slot_id"], "9876543210")
        self.assertEqual(client.put("/platform/ads/placements/nope", headers=ADMIN_AUTH,
                                    json={"enabled": False, "source": "custom"}).status_code, 404)

    def test_creative_create_update_archive(self):
        client, db = self.client(seed())
        payload = {"name": "Partner", "status": "active", "headline": "Ship with Acme", "cta_label": "Visit",
                   "target_url": "https://acme.example", "placements": ["browse_top"], "weight": 2}
        created = client.post("/platform/ads/creatives", headers=ADMIN_AUTH, json=payload)
        self.assertEqual(created.status_code, 201)
        creative_id = created.json()["creative"]["id"]
        bad_link = client.post("/platform/ads/creatives", headers=ADMIN_AUTH, json={**payload, "target_url": "javascript:alert(1)"})
        self.assertEqual(bad_link.status_code, 422)
        unknown = client.post("/platform/ads/creatives", headers=ADMIN_AUTH, json={**payload, "placements": ["popup"]})
        self.assertEqual(unknown.status_code, 422)
        updated = client.put(f"/platform/ads/creatives/{creative_id}", headers=ADMIN_AUTH, json={**payload, "status": "paused"})
        self.assertEqual(updated.json()["creative"]["status"], "paused")
        archived = client.delete(f"/platform/ads/creatives/{creative_id}", headers=ADMIN_AUTH)
        self.assertEqual(archived.json()["creative"]["status"], "archived")

    def test_stats_add_up(self):
        rows = seed()
        rows["ad_daily_stats"] = [
            {"day": NOW.date().isoformat(), "placement_key": "browse_top", "creative_id": CREATIVE, "source": "custom",
             "impressions": 10, "clicks": 2},
            {"day": NOW.date().isoformat(), "placement_key": "browse_top", "creative_id": None, "source": "google",
             "impressions": 5, "clicks": 0},
        ]
        client, _ = self.client(rows)
        stats = client.get("/platform/ads", headers=ADMIN_AUTH).json()["stats"]
        self.assertEqual(stats["placements"]["browse_top"]["impressions"], 15)
        self.assertEqual(stats["placements"]["browse_top"]["google_impressions"], 5)
        self.assertEqual(stats["creatives"][CREATIVE]["clicks"], 2)


if __name__ == "__main__":
    unittest.main()
