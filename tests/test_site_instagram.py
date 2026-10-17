from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.site.router import create_site_router, parse_instagram_link
from tests.test_commerce import ADMIN, Db

ADMIN_AUTH = {"Authorization": "Bearer admin"}


class LinkTests(unittest.TestCase):
    def test_post_and_reel_links(self):
        self.assertEqual(parse_instagram_link("https://www.instagram.com/p/C1abcDEF23/"), ("p", "C1abcDEF23"))
        self.assertEqual(parse_instagram_link("https://instagram.com/reel/DAbc_12-x/?igsh=xyz"), ("reel", "DAbc_12-x"))
        self.assertEqual(parse_instagram_link("https://www.instagram.com/fayfort_international_trading/reels/DAbc12345/"), ("reel", "DAbc12345"))
        for bad in ("https://www.instagram.com/fayfort_international_trading/", "https://evil.example/p/ABCDE/", "javascript:alert(1)"):
            with self.assertRaises(ValueError):
                parse_instagram_link(bad)


class SiteRouterTests(unittest.TestCase):
    def client(self, rows=None):
        db = Db(rows or {})
        for patcher in (
            patch.object(commerce_db, "client", db),
            patch("app.site.router.trusted_platform_admin", side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(create_site_router())
        return TestClient(app), db

    def test_staff_add_hide_reorder_remove_and_public_list(self):
        client, db = self.client()
        self.assertEqual(client.post("/platform/site/instagram", json={"url": "https://www.instagram.com/p/AAAAA1/"}).status_code, 403)
        first = client.post("/platform/site/instagram", headers=ADMIN_AUTH,
                            json={"url": "https://www.instagram.com/p/AAAAA1/", "label": " Market day "}).json()["post"]
        second = client.post("/platform/site/instagram", headers=ADMIN_AUTH,
                             json={"url": "https://www.instagram.com/reel/BBBBB2/"}).json()["post"]
        self.assertEqual(first["label"], "Market day")
        duplicate = client.post("/platform/site/instagram", headers=ADMIN_AUTH, json={"url": "https://instagram.com/p/AAAAA1"})
        self.assertEqual(duplicate.status_code, 409)
        bad = client.post("/platform/site/instagram", headers=ADMIN_AUTH, json={"url": "https://www.instagram.com/someone/"})
        self.assertEqual(bad.status_code, 422)

        client.put("/platform/site/instagram-order", headers=ADMIN_AUTH, json={"ids": [second["id"], first["id"]]})
        public = client.get("/public/site/instagram").json()["posts"]
        self.assertEqual([p["shortcode"] for p in public], ["BBBBB2", "AAAAA1"])
        self.assertEqual(set(public[0]), {"id", "kind", "shortcode", "label"})

        client.put(f"/platform/site/instagram/{second['id']}", headers=ADMIN_AUTH, json={"label": None, "active": False})
        self.assertEqual([p["shortcode"] for p in client.get("/public/site/instagram").json()["posts"]], ["AAAAA1"])
        self.assertEqual(client.delete(f"/platform/site/instagram/{first['id']}", headers=ADMIN_AUTH).status_code, 200)
        self.assertEqual(client.get("/public/site/instagram").json()["posts"], [])

    def test_public_list_survives_a_database_error(self):
        client, db = self.client()
        with patch.object(db, "table", side_effect=RuntimeError("down")):
            response = client.get("/public/site/instagram")
        self.assertEqual(response.json(), {"posts": []})


if __name__ == "__main__":
    unittest.main()
