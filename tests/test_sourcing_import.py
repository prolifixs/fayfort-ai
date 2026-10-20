"""Bulk import of sourcing items from FayFort's social posts (app/commerce/sourcing_import.py)."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.commerce import sourcing_import
from tests.test_store_team import ADMIN, Db

IMG = "https://scontent-lhr8-1.cdninstagram.com/v/t51/abc.jpg?stp=1&oe=AA"
VID = "https://instagram.flos1-1.fna.fbcdn.net/o1/v/t16/clip.mp4?oe=BB"


class FakeResponse:
    def __init__(self, status=200, content_type="image/jpeg", body=b"x" * 1000):
        self.status_code, self.headers, self.body = status, {"content-type": content_type}, body

    def iter_content(self, _size):
        yield self.body

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def fake_get(url, **kwargs):
    assert kwargs.get("allow_redirects") is False
    if url.endswith("broken"):
        return FakeResponse(status=403)
    return FakeResponse(content_type="video/mp4" if ".mp4" in url else "image/jpeg")


class SourcingImportTests(unittest.TestCase):
    def setUp(self):
        self.db = Db({"directory_categories": [{"source_ref": "13-004", "category": "Kitchen & Home", "product_type": "Plates"}]})
        self.previous = commerce_db.client
        commerce_db.client = self.db
        app = FastAPI()
        app.include_router(sourcing_import.create_sourcing_import_router())
        self.client = TestClient(app)
        self.admin = patch.object(sourcing_import, "trusted_platform_admin", lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None)
        self.admin.start()
        self.http = patch.object(sourcing_import.requests, "get", side_effect=fake_get)
        self.http.start()

    def tearDown(self):
        self.http.stop()
        self.admin.stop()
        commerce_db.client = self.previous

    def post(self, body, token="admin"):
        return self.client.post("/platform/commerce/sourcing/import", json=body, headers={"Authorization": f"Bearer {token}"})

    def body(self, **extra):
        return {"import_ref": "instagram:DN2ikcMZD0_", "name": "Three-tier cake stand", "category_ref": "13-004",
                "price_min": 7, "media": [{"url": IMG, "media_type": "image"}, {"url": IMG + "2", "media_type": "image"}], **extra}

    def products(self):
        return self.db.rows.get("directory_products", [])

    def test_admin_only(self):
        self.assertEqual(self.post(self.body(), token="worker").status_code, 403)

    def test_creates_a_sourcing_item_with_copied_media(self):
        response = self.post(self.body())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["created"])
        [product] = self.products()
        self.assertEqual((product["source"], product["availability_status"], product["price_min"], product["price_max"]), ("fayfort", "sourcing", 7.0, 7.0))
        self.assertEqual(product["media_source"], "upload")
        self.assertIn("/product-media/imports/instagram-DN2ikcMZD0_/0.jpg", product["media_url"])
        self.assertEqual(len(self.db.rows["commerce_media"]), 2)
        self.assertEqual(len(self.db.uploads), 2)

    def test_no_price_stays_empty(self):
        self.post(self.body(price_min=None))
        self.assertIsNone(self.products()[0]["price_min"])
        self.assertIsNone(self.products()[0]["price_max"])

    def test_media_is_capped_and_videos_bring_their_cover(self):
        media = [{"url": VID, "media_type": "video", "preview_url": IMG}] + [{"url": f"{IMG}{i}", "media_type": "image"} for i in range(7)]
        result = self.post(self.body(media=media)).json()
        self.assertEqual(result["media_copied"], sourcing_import.MAX_MEDIA)
        self.assertEqual(len(result["skipped"]), 3)
        video = self.db.rows["commerce_media"][0]
        self.assertEqual(video["media_type"], "video")
        self.assertIn("0-cover.jpg", video["preview_url"])
        self.assertEqual(self.products()[0]["media_type"], "image")

    def test_only_social_cdn_links_are_fetched(self):
        result = self.post(self.body(media=[{"url": "https://example.com/a.jpg", "media_type": "image"},
                                            {"url": IMG + "broken", "media_type": "image"}])).json()
        self.assertEqual(result["media_copied"], 0)
        self.assertEqual(len(result["skipped"]), 2)
        self.assertIsNone(self.products()[0]["media_url"])

    def test_running_again_updates_and_keeps_media(self):
        self.post(self.body())
        result = self.post(self.body(name="Cake stand, three tier", price_min=8)).json()
        self.assertFalse(result["created"])
        self.assertTrue(result["media_kept"])
        self.assertEqual(len(self.products()), 1)
        self.assertEqual(self.products()[0]["name"], "Cake stand, three tier")
        self.assertEqual(len(self.db.uploads), 2)

    def test_unknown_category_is_refused(self):
        self.assertEqual(self.post(self.body(category_ref="99-999")).status_code, 422)

    def test_ref_shape(self):
        self.assertEqual(self.post(self.body(import_ref="other:abc")).status_code, 422)
