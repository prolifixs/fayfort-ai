"""Member addresses, profile completion, paying with a delivery address and cancelling an unpaid consultation."""
from __future__ import annotations

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(__file__))
from test_operations_flow import Db  # noqa: E402

from app.accounts import member_addresses as addr  # noqa: E402
from app.commerce import db as commerce_db  # noqa: E402

MEMBER = "00000000-0000-0000-0000-0000000000c1"
OTHER = "00000000-0000-0000-0000-0000000000c2"


def address(**over):
    return addr.AddressInput(**{"line1": "12 Allen Avenue", "city": "Ikeja", "country": "Nigeria", **over})


class AddressTests(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.previous = commerce_db.client
        commerce_db.client = self.db

    def tearDown(self):
        commerce_db.client = self.previous

    def test_first_address_is_default_and_only_two_are_allowed(self):
        first = addr.add_address(MEMBER, address(label="Home"))
        self.assertTrue(first["is_default"])
        addr.add_address(MEMBER, address(label="Office", make_default=True))
        found = addr.list_addresses(MEMBER)
        self.assertEqual([a["label"] for a in found], ["Office", "Home"])
        self.assertEqual(sum(1 for a in found if a["is_default"]), 1)
        with self.assertRaisesRegex(ValueError, "up to two"):
            addr.add_address(MEMBER, address(label="Third"))

    def test_removing_the_default_promotes_the_other_address(self):
        home = addr.add_address(MEMBER, address(label="Home"))
        addr.add_address(MEMBER, address(label="Office"))
        addr.delete_address(MEMBER, home["id"])
        [left] = addr.list_addresses(MEMBER)
        self.assertEqual((left["label"], left["is_default"]), ("Office", True))

    def test_members_cannot_touch_each_others_addresses(self):
        home = addr.add_address(MEMBER, address())
        with self.assertRaises(LookupError):
            addr.delete_address(OTHER, home["id"])

    def test_phone_must_look_like_a_phone_number(self):
        with self.assertRaises(ValueError):
            address(phone="call me")
        self.assertEqual(address(phone="+234 803 000 0000").phone, "+234 803 000 0000")

    def test_completion_flags_the_missing_shipping_address(self):
        named = {"first_name": "Ada", "last_name": "Obi", "username": "adaobi"}
        empty = addr.profile_completion(named, [])
        self.assertFalse(empty["address_ready"])
        self.assertEqual(empty["percent"], 40)
        full = addr.profile_completion({**named, "profile_photo_url": "x"},
                                       [{"is_default": True, "phone": "+2348030000000"}])
        self.assertEqual(full["percent"], 100)

    def test_order_invoice_needs_an_address_which_goes_to_shopify(self):
        home = addr.add_address(MEMBER, address(recipient_name="Ada Obi", phone="+2348030000000"))
        self.db.rows["commerce_invoices"] = [{"id": "inv-1", "member_id": MEMBER, "kind": "order", "status": "sent",
                                              "invoice_url": "https://shop/inv", "shopify_draft_order_id": "gid://shopify/DraftOrder/5"}]
        with self.assertRaisesRegex(PermissionError, "address"):
            addr.pay_invoice(MEMBER, "inv-1", None)
        with patch("app.commerce.shopify.set_draft_shipping_address") as ship:
            result = addr.pay_invoice(MEMBER, "inv-1", home["id"])
        self.assertEqual(result["invoice_url"], "https://shop/inv")
        ship.assert_called_once()
        self.assertEqual(ship.call_args[0][1]["city"], "Ikeja")
        stored = self.db.rows["commerce_invoices"][0]
        self.assertEqual((stored["ship_to"]["line1"], stored["ship_to_address_id"]), ("12 Allen Avenue", home["id"]))

    def test_deposit_and_consultation_invoices_need_no_address(self):
        self.db.rows["commerce_invoices"] = [{"id": "inv-2", "member_id": MEMBER, "kind": "consultation", "status": "sent",
                                              "invoice_url": "https://shop/c"}]
        self.assertEqual(addr.pay_invoice(MEMBER, "inv-2", None)["invoice_url"], "https://shop/c")

    def test_unpaid_consultation_can_be_cancelled_and_its_shopify_link_is_removed(self):
        self.db.rows["commerce_invoices"] = [{"id": "inv-3", "member_id": MEMBER, "kind": "consultation", "status": "sent",
                                              "invoice_url": "https://shop/c", "shopify_draft_order_id": "gid://shopify/DraftOrder/9"}]
        self.db.rows["member_consultations"] = [{"id": "con-1", "member_id": MEMBER, "invoice_id": "inv-3", "status": "awaiting_payment"}]
        with patch("app.commerce.shopify.delete_draft_order") as delete:
            addr.cancel_consultation_invoice(MEMBER, "inv-3")
        delete.assert_called_once_with("gid://shopify/DraftOrder/9")
        self.assertEqual(self.db.rows["commerce_invoices"][0]["status"], "cancelled")
        self.assertEqual(self.db.rows["member_consultations"][0]["status"], "cancelled")

    def test_order_invoices_and_paid_consultations_cannot_be_cancelled_here(self):
        self.db.rows["commerce_invoices"] = [{"id": "o", "member_id": MEMBER, "kind": "order", "status": "sent"},
                                             {"id": "p", "member_id": MEMBER, "kind": "consultation", "status": "paid"}]
        for invoice_id in ("o", "p"):
            with self.assertRaises(ValueError):
                addr.cancel_consultation_invoice(MEMBER, invoice_id)


class AddressApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app.main import app
        cls.client = TestClient(app)

    def setUp(self):
        self.db = Db()
        self.previous = commerce_db.client
        commerce_db.client = self.db

    def tearDown(self):
        commerce_db.client = self.previous

    @patch("app.accounts.member_addresses.verified_member", return_value=MEMBER)
    def test_address_book_round_trip(self, member):
        body = {"label": "Home", "line1": " 12  Allen Avenue ", "city": "Ikeja", "country": "Nigeria"}
        created = self.client.post("/members/addresses", json=body)
        self.assertEqual(created.status_code, 201)
        [home] = created.json()["addresses"]
        self.assertEqual(home["line1"], "12 Allen Avenue")
        self.client.post("/members/addresses", json={**body, "label": "Office"})
        third = self.client.post("/members/addresses", json={**body, "label": "Third"})
        self.assertEqual(third.status_code, 409)
        self.assertIn("up to two", third.json()["detail"])
        incomplete = self.client.post("/members/addresses", json={"line1": "x", "city": "", "country": "Nigeria"})
        self.assertEqual(incomplete.status_code, 422)

    @patch("app.accounts.member_addresses.verified_member", return_value=MEMBER)
    def test_paying_an_order_without_an_address_is_refused(self, member):
        self.db.rows["commerce_invoices"] = [{"id": "00000000-0000-0000-0000-00000000e001", "member_id": MEMBER,
                                              "kind": "order", "status": "sent", "invoice_url": "https://shop/inv"}]
        response = self.client.post("/members/invoices/00000000-0000-0000-0000-00000000e001/pay", json={})
        self.assertEqual(response.status_code, 409)
        self.assertIn("address", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
