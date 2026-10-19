"""Customer reviews: screenshot import, member reviews and the public feed (app/site/reviews.py)."""
from __future__ import annotations

import io
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.site import review_import, reviews
from tests.test_commerce import ADMIN, MEMBER, Db, Query

ADMIN_AUTH = {"Authorization": "Bearer admin"}
MEMBER_AUTH = {"Authorization": "Bearer member"}
OTHER = "00000000-0000-0000-0000-0000000000d9"


class ReviewQuery(Query):
    def is_(self, column, value):
        self.filters.append((column, "is", value))
        return self

    def _match(self, row):
        for column, op, value in self.filters:
            if op == "is" and value == "null" and row.get(column) is not None:
                return False
        return super()._match({**row, **{c: None for c, op, _ in self.filters if op == "is"}}) if any(
            op == "is" for _, op, _ in self.filters) else super()._match(row)

    def execute(self):
        if self.op == "delete":
            rows = self.db.rows.setdefault(self.table, [])
            removed = [dict(r) for r in rows if self._match(r)]
            rows[:] = [r for r in rows if not self._match(r)]
            return SimpleNamespace(data=removed)
        return super().execute()


class ReviewDb(Db):
    def __init__(self, rows=None):
        super().__init__(rows)
        self.storage = MagicMock()
        self.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://storage.example/signed"}

    def table(self, name):
        return ReviewQuery(self, name)


def verified(authorization):
    if authorization == "Bearer member":
        return MEMBER
    if authorization == "Bearer other":
        return OTHER
    raise HTTPException(status_code=401, detail="A valid signed-in member is required.")


def png() -> bytes:
    from PIL import Image
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buffer, format="PNG")
    return buffer.getvalue()


class ReviewsCase(unittest.TestCase):
    def client(self, rows=None):
        self.db = ReviewDb(rows or {})
        for patcher in (
            patch.object(commerce_db, "client", self.db),
            patch("app.site.reviews.trusted_platform_admin",
                  side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(reviews.create_reviews_router(verified))
        return TestClient(app)


class ScreenshotImportTests(ReviewsCase):
    def test_a_screenshot_becomes_a_pending_review_with_the_read_fields(self):
        client = self.client()
        found = {"body": "My wig arrived in 9 days and it's exactly like the video. Thank you FayFort!",
                 "display_name": "Amaka Obi", "country": "Nigeria", "product": "Body wave wig", "rating": None,
                 "source": "instagram", "reviewed_on": "2026-10-12", "note": None}
        with patch.object(reviews, "read_screenshot_text", return_value="text"), \
                patch.object(reviews, "extract_review", return_value=found):
            response = client.post("/platform/site/reviews/screenshot", content=png(),
                                   headers={**ADMIN_AUTH, "Content-Type": "image/png"})
        self.assertEqual(response.status_code, 201)
        review = response.json()["review"]
        self.assertEqual(review["status"], "pending")
        self.assertEqual(review["display_name"], "Amaka O.")
        self.assertEqual(review["country"], "Nigeria")
        self.assertEqual(review["screenshot_url"], "https://storage.example/signed")
        self.assertNotIn("screenshot_path", review)
        stored = self.db.rows["customer_reviews"][0]
        self.assertTrue(stored["screenshot_path"].startswith("imports/"))
        self.db.storage.from_.assert_called_with("review-screenshots")

    def test_only_admins_and_real_images(self):
        client = self.client()
        self.assertEqual(client.post("/platform/site/reviews/screenshot", content=png(),
                                     headers={**MEMBER_AUTH, "Content-Type": "image/png"}).status_code, 403)
        self.assertEqual(client.post("/platform/site/reviews/screenshot", content=b"not an image",
                                     headers={**ADMIN_AUTH, "Content-Type": "image/png"}).status_code, 415)
        self.assertEqual(client.post("/platform/site/reviews/screenshot", content=b"%PDF",
                                     headers={**ADMIN_AUTH, "Content-Type": "application/pdf"}).status_code, 415)


class PublishingTests(ReviewsCase):
    def test_publishing_needs_words_and_a_name_and_feeds_the_website(self):
        client = self.client({"customer_reviews": [
            {"id": "00000000-0000-0000-0000-0000000000f1", "source": "whatsapp", "status": "pending", "body": "", "display_name": None, "featured": False},
            {"id": "00000000-0000-0000-0000-0000000000f2", "source": "member", "status": "published", "body": "Great service, fast shipping.",
             "display_name": "Kofi A.", "rating": 4, "featured": False, "published_at": "2026-10-10T00:00:00Z"},
        ]})
        blocked = client.put("/platform/site/reviews/00000000-0000-0000-0000-0000000000f1", json={"source": "whatsapp", "status": "published"},
                             headers=ADMIN_AUTH)
        self.assertEqual(blocked.status_code, 422)
        ok = client.put("/platform/site/reviews/00000000-0000-0000-0000-0000000000f1", headers=ADMIN_AUTH, json={
            "source": "whatsapp", "status": "published", "featured": True, "body": "They found my supplier in 2 days!",
            "display_name": "Tolu A.", "country": "Nigeria", "rating": 5})
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.json()["review"]["published_at"])
        public = client.get("/public/site/reviews").json()
        self.assertEqual([r["id"] for r in public["reviews"]], ["00000000-0000-0000-0000-0000000000f1", "00000000-0000-0000-0000-0000000000f2"])  # featured first
        self.assertEqual(public["summary"]["average"], 4.5)
        self.assertEqual(public["summary"]["rated_count"], 2)
        self.assertTrue(public["reviews"][1]["verified_order"])
        self.assertNotIn("ocr_text", public["reviews"][0])

    def test_staff_cannot_rewrite_a_members_words_or_stars(self):
        client = self.client({"customer_reviews": [
            {"id": "00000000-0000-0000-0000-0000000000f2", "source": "member", "status": "pending", "body": "It was okay, slow shipping.",
             "display_name": "Kofi A.", "rating": 3, "featured": False}]})
        client.put("/platform/site/reviews/00000000-0000-0000-0000-0000000000f2", headers=ADMIN_AUTH, json={
            "source": "instagram", "status": "published", "body": "Amazing!", "rating": 5, "display_name": "Kofi A."})
        stored = self.db.rows["customer_reviews"][0]
        self.assertEqual(stored["body"], "It was okay, slow shipping.")
        self.assertEqual(stored["rating"], 3)
        self.assertEqual(stored["source"], "member")
        self.assertEqual(stored["status"], "published")

    def test_hidden_and_pending_reviews_stay_off_the_website(self):
        client = self.client({"customer_reviews": [
            {"id": "a", "source": "other", "status": "hidden", "body": "Spam", "display_name": "X"},
            {"id": "b", "source": "other", "status": "pending", "body": "Waiting", "display_name": "Y"}]})
        public = client.get("/public/site/reviews").json()
        self.assertEqual(public["reviews"], [])
        self.assertIsNone(public["summary"]["average"])


class MemberReviewTests(ReviewsCase):
    def rows(self):
        return {
            "customer_review_invites": [
                {"id": "i1", "member_id": MEMBER, "title": "Body wave wig 22 inch", "request_id": "req-1",
                 "order_id": None, "reviewed_at": None, "dismissed_at": None, "created_at": "2026-10-18T00:00:00Z"},
                {"id": "i2", "member_id": OTHER, "title": "Someone else's order", "request_id": None, "order_id": "o1",
                 "reviewed_at": None, "dismissed_at": None, "created_at": "2026-10-18T00:00:00Z"},
            ],
            "member_profiles": [{"user_id": MEMBER, "display_name": "Amaka Obi"}],
            "member_addresses": [{"member_id": MEMBER, "country": "Nigeria", "created_at": "2026-10-01"}],
        }

    def test_members_see_their_shipped_orders_and_review_them(self):
        client = self.client(self.rows())
        listing = client.get("/members/reviews", headers=MEMBER_AUTH).json()
        self.assertEqual([i["id"] for i in listing["invites"]], ["i1"])
        self.assertEqual(listing["defaults"], {"display_name": "Amaka O.", "country": "Nigeria"})
        created = client.post("/members/reviews", headers=MEMBER_AUTH, json={
            "invite_id": "00000000-0000-0000-0000-000000000000", "rating": 5,
            "body": "Exactly what I ordered", "display_name": "Amaka O."})
        self.assertEqual(created.status_code, 404)
        self.db.rows["customer_review_invites"][0]["id"] = "00000000-0000-0000-0000-0000000000e1"
        created = client.post("/members/reviews", headers=MEMBER_AUTH, json={
            "invite_id": "00000000-0000-0000-0000-0000000000e1", "rating": 5,
            "body": "Exactly what I ordered, packed well.", "display_name": "Amaka O.", "country": "Nigeria"})
        self.assertEqual(created.status_code, 201)
        review = self.db.rows["customer_reviews"][0]
        self.assertEqual((review["source"], review["status"], review["rating"], review["product"]),
                         ("member", "pending", 5, "Body wave wig 22 inch"))
        self.assertTrue(self.db.rows["customer_review_invites"][0]["reviewed_at"])
        self.assertEqual(self.db.rpcs[-1][0], "notify_platform_admins")
        self.assertEqual(self.db.rpcs[-1][1]["p_href"], "/?page=website#reviews")
        again = client.post("/members/reviews", headers=MEMBER_AUTH, json={
            "invite_id": "00000000-0000-0000-0000-0000000000e1", "rating": 1,
            "body": "Changing my mind here.", "display_name": "Amaka O."})
        self.assertEqual(again.status_code, 409)

    def test_a_member_cannot_review_someone_elses_order(self):
        client = self.client(self.rows())
        self.db.rows["customer_review_invites"][1]["id"] = "00000000-0000-0000-0000-0000000000e2"
        response = client.post("/members/reviews", headers=MEMBER_AUTH, json={
            "invite_id": "00000000-0000-0000-0000-0000000000e2", "rating": 5,
            "body": "Great great great service", "display_name": "Me"})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("customer_reviews", {k for k, v in self.db.rows.items() if v})

    def test_dismissed_invites_disappear(self):
        client = self.client(self.rows())
        self.db.rows["customer_review_invites"][0]["id"] = "00000000-0000-0000-0000-0000000000e1"
        self.assertEqual(client.post("/members/reviews/invites/00000000-0000-0000-0000-0000000000e1/dismiss",
                                     headers=MEMBER_AUTH).status_code, 200)
        self.assertEqual(client.get("/members/reviews", headers=MEMBER_AUTH).json()["invites"], [])


class ExtractionTests(unittest.TestCase):
    OCR = ("23:18 Business chat\nAmaka Obi\nMy wig arrived in 9 days and it's exactly\nlike the video. Thank you FayFort!\n"
           "FayFort: You're welcome dear\nMessage...")

    def test_the_model_only_tidies_words_that_were_read(self):
        def model(messages, max_tokens):
            return ('{"review_text": "My wig arrived in 9 days and it\'s exactly like the video. Thank you FayFort!", '
                    '"customer_name": "Amaka Obi", "country": "", "product": "", "rating": null, "source": "instagram", '
                    '"date": ""}', 1, 1)
        found = review_import.extract_review(self.OCR, invoke=model)
        self.assertEqual(found["display_name"], "Amaka Obi")
        self.assertTrue(found["body"].startswith("My wig arrived"))
        self.assertIsNone(found["note"])
        self.assertIsNone(found["country"])

    def test_invented_text_is_rejected_and_staff_are_warned(self):
        def model(messages, max_tokens):
            return ('{"review_text": "Best sourcing company in the world, highly recommended to everyone!", '
                    '"customer_name": "", "rating": 5, "source": "instagram"}', 1, 1)
        found = review_import.extract_review(self.OCR, invoke=model)
        self.assertIn("didn't match", found["note"])
        self.assertIn("My wig arrived", found["body"])

    def test_nothing_read_asks_staff_to_type_it(self):
        found = review_import.extract_review("", invoke=lambda *a: ("{}", 0, 0))
        self.assertEqual(found["body"], "")
        self.assertIn("Type the review", found["note"])

    def test_short_names(self):
        self.assertEqual(review_import.short_name("Amaka Obi"), "Amaka O.")
        self.assertEqual(review_import.short_name("@amaka.styles"), "@amaka.styles")
        self.assertEqual(review_import.short_name("Kofi"), "Kofi")
        self.assertIsNone(review_import.short_name("  "))

    @unittest.skipUnless(__import__("shutil").which("tesseract"), "tesseract not installed")
    def test_reads_a_dark_mode_screenshot(self):
        from PIL import Image, ImageDraw, ImageFont
        image = Image.new("RGB", (900, 260), (12, 12, 14))
        draw = ImageDraw.Draw(image)
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", 34)
        except OSError:
            font = ImageFont.load_default()
        draw.text((30, 60), "Thank you FayFort, my order arrived", fill=(235, 235, 235), font=font)
        draw.text((30, 130), "safely and on time.", fill=(235, 235, 235), font=font)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        text = review_import.read_screenshot_text(buffer.getvalue()).casefold()
        self.assertIn("order arrived", text)
        self.assertIn("on time", text)


if __name__ == "__main__":
    unittest.main()
