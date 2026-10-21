"""fayfort.com/go public data (app/site/go.py)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.site import go
from tests.test_commerce import DbCase, MEMBER, ago, ahead, product, seeded_db


class GoPageTests(DbCase):
    def setUp(self):
        go._cache.clear()
        self.addCleanup(go._cache.clear)

    def test_go_page_shows_the_live_giveaway_picks_and_prices_without_member_data(self):
        db = seeded_db(
            commerce_giveaways=[{"id": "g1", "title": "Wig week", "description": "", "prize_text": "A body wave wig",
                                 "prize_product_id": "p-wig", "starts_at": ago(days=1), "ends_at": ahead(days=2), "status": "open"}],
            commerce_giveaway_entries=[{"giveaway_id": "g1", "member_id": MEMBER}, {"giveaway_id": "g1", "member_id": "m2"}])
        db.rows["directory_products"].append(product("s-1", "Marble table", "hair-tools", price=None, source="fayfort", in_stock=None))
        self.use(db)
        client = TestClient(FastAPI())
        app = FastAPI()
        app.include_router(go.create_go_router())
        response = TestClient(app).get("/public/site/go")
        self.assertEqual(response.status_code, 200)
        self.assertIn("max-age=300", response.headers["cache-control"])
        body = response.json()
        self.assertEqual((body["giveaway"]["title"], body["giveaway"]["entries"]), ("Wig week", 2))
        self.assertEqual(body["giveaway"]["image_url"], "https://cdn/x.jpg")
        self.assertTrue(1 <= len(body["picks"]) <= 8)
        self.assertNotIn("id", body["picks"][0])
        self.assertIn("Marble table", [p["name"] for p in body["picks"]])
        self.assertEqual(body["consultation"]["free"], 100.0)
        self.assertIn("Guangzhou", body["tour"]["cities"])
        self.assertNotIn(MEMBER, response.text)

    def test_no_live_giveaway_is_null(self):
        self.use(seeded_db(commerce_giveaways=[{"id": "g2", "title": "Old", "prize_text": "x", "starts_at": ago(days=9),
                                                "ends_at": ago(days=2), "status": "open"}]))
        self.assertIsNone(go.go_payload()["giveaway"])
