"""Tour guide bookings (app/membership/tours.py)."""
from __future__ import annotations

import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.commerce import db as commerce_db
from app.membership import tours
from tests.test_store_team import ADMIN, MEMBER, Db

SOON = (date.today() + timedelta(days=20)).isoformat()


class ToursTests(unittest.TestCase):
    def setUp(self):
        self.db = Db({"member_profiles": [{"user_id": MEMBER, "display_name": "Jordan Mensah"}]})
        self.previous = commerce_db.client
        commerce_db.client = self.db
        self.emails = patch.object(tours.commerce, "queue_email")
        self.emails.start()

    def tearDown(self):
        self.emails.stop()
        commerce_db.client = self.previous

    def request(self, **values):
        body = {"city": "guangzhou", "arrival_date": SOON, "days": 3, "people": 2, "needs": ["canton_fair", "markets"],
                "hotel_area": "Pazhou", "whatsapp": "+234 800 000 0000", **values}
        return tours.request_tour(MEMBER, tours.TourRequest(**body))

    def messages(self):
        return [m["content"] for m in self.db.rows.get("member_messages", [])]

    def test_a_request_opens_a_chat_with_the_details(self):
        booking = self.request()
        self.assertEqual(booking["status"], "requested")
        self.assertTrue(booking["conversation_id"])
        self.assertIn("Guangzhou, from", booking["summary"])
        self.assertIn("Canton Fair, Wholesale markets", self.messages()[0])
        self.assertIn("send you a quote", self.messages()[1])

    def test_the_form_refuses_past_dates_and_an_unnamed_other_city(self):
        with self.assertRaises(ValidationError):
            tours.TourRequest(city="guangzhou", arrival_date=date.today() - timedelta(days=1), days=1, people=1)
        with self.assertRaises(ValidationError):
            tours.TourRequest(city="other", arrival_date=SOON, days=1, people=1)

    def test_quote_then_payment_then_guide_then_done(self):
        booking = self.request()
        with patch.object(tours.commerce, "send_invoice", return_value={"id": "inv-1", "invoice_url": "https://shop/inv"}) as send:
            quoted = tours.send_quote(tours.get(booking["id"]), ADMIN, tours.QuoteInput(amount="450", note="Includes transport."))
        self.assertEqual(send.call_args.kwargs["kind"], "tour")
        self.assertEqual((quoted["status"], quoted["quote_amount"]), ("quoted", 450.0))
        self.assertIn("450.00 USD", self.messages()[-1])
        with self.assertRaises(tours.TourError):
            tours.assign_guide(tours.get(booking["id"]), ADMIN, tours.GuideInput(guide_name="Ada"))
        tours.invoice_paid({"id": "inv-1"})
        tours.invoice_paid({"id": "inv-1"})  # a retried webhook changes nothing
        self.assertEqual(tours.get(booking["id"])["status"], "confirmed")
        self.assertEqual(sum("Payment received" in m for m in self.messages()), 1)
        guided = tours.assign_guide(tours.get(booking["id"]), ADMIN, tours.GuideInput(guide_name="Ada"))
        self.assertEqual(guided["guide_name"], "Ada")
        self.assertIn("Your guide is Ada", self.messages()[-1])
        done = tours.set_status(tours.get(booking["id"]), tours.StatusInput(status="completed"))
        self.assertEqual(done["status"], "completed")

    def test_cancelling_a_quoted_tour_cancels_its_invoice(self):
        booking = self.request()
        self.db.rows.setdefault("commerce_invoices", []).append({"id": "inv-2", "status": "sent", "invoice_url": "https://shop/i2"})
        with patch.object(tours.commerce, "send_invoice", return_value={"id": "inv-2"}):
            tours.send_quote(tours.get(booking["id"]), ADMIN, tours.QuoteInput(amount="300"))
        tours.set_status(tours.get(booking["id"]), tours.StatusInput(status="cancelled", reason="Dates changed"))
        self.assertEqual(self.db.rows["commerce_invoices"][0]["status"], "cancelled")

    def test_api_needs_a_member_or_staff(self):
        app = FastAPI()
        app.include_router(tours.create_tours_router(lambda auth: MEMBER if auth == "Bearer m" else (_ for _ in ()).throw(
            __import__("fastapi").HTTPException(status_code=401, detail="no")), lambda auth: {"user_id": ADMIN} if auth == "Bearer s" else None))
        client = TestClient(app)
        created = client.post("/members/tours", json={"city": "yiwu", "arrival_date": SOON, "days": 2, "people": 1},
                               headers={"Authorization": "Bearer m"})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(client.get("/operations/tours", headers={"Authorization": "Bearer m"}).status_code, 403)
        staff = client.get("/operations/tours", headers={"Authorization": "Bearer s"}).json()
        self.assertEqual(staff["tours"][0]["member_name"], "Jordan Mensah")
