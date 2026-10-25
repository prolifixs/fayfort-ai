"""LANDED owners: Shopify buyers see the snapshot's addresses free, claim by order number, and get the notice emails."""
from __future__ import annotations

import uuid
from unittest.mock import patch

from app.membership import landed
from tests.test_membership import AUTH, MARKET, MEMBER, PROVIDER, Case, MDb, MQuery, membership_db

ADMIN_AUTH = {"Authorization": "Bearer admin"}
NEW_MARKET = str(uuid.UUID(int=111))


class LQuery(MQuery):
    def is_(self, c, v): self.filters.append((c, "is", v)); return self

    def _match(self, row):
        nulls = [f for f in self.filters if f[1] == "is"]
        saved, self.filters = self.filters, [f for f in self.filters if f[1] != "is"]
        try:
            if not super()._match(row):
                return False
        finally:
            self.filters = saved
        return all(row.get(c) is None for c, _op, v in nulls if v == "null")


class LDb(MDb):
    def table(self, name):
        return LQuery(self, name)


def landed_db(**extra) -> LDb:
    base = membership_db("free")
    base.rows["directory_markets"][0]["source_key"] = "market:wig"
    base.rows["directory_markets"].append({"id": NEW_MARKET, "source_key": "market:new", "place_name": "New Wig Plaza",
                                           "city": "Guangzhou", "address_en": "1 New Road", "address_cn": "新路1号",
                                           "verification_status": "unknown"})
    base.rows["directory_service_providers"][0].update({"source_key": "svc:fast", "address_en": "8 Port Road"})
    base.rows["landed_snapshot"] = [{"record_type": "market", "source_key": "market:wig"},
                                    {"record_type": "service_provider", "source_key": "svc:fast"}]
    db = LDb(base.rows)
    db.rows.update(extra)
    return db


def order(order_id=5001, email="Buyer@Example.com", name="#1001", status="paid", title="LANDED: The Guangzhou Directory"):
    return {"id": order_id, "name": name, "email": email, "financial_status": status, "created_at": "2026-08-01T10:00:00Z",
            "line_items": [{"title": title, "product_id": 42}]}


class LandedCase(Case):
    def setUp(self):
        landed._owner_cache.clear()
        landed._snapshot_cache.clear()
        landed._product_cache.clear()
        landed._product_cache[landed.PRODUCT_HANDLE] = None  # match by title in tests
        for target, value in (("app.membership.router.trusted_platform_admin",
                               lambda auth: {"user_id": "admin"} if auth == "Bearer admin" else None),):
            patcher = patch(target, side_effect=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def member_email(self, email):
        patcher = patch.object(landed, "_member_email", return_value=email)
        patcher.start()
        self.addCleanup(patcher.stop)


class OrderTests(LandedCase):
    def test_landed_orders_become_owners_and_others_are_ignored(self):
        self.use(landed_db())
        self.assertEqual(landed.record_from_order(order()), "created")
        self.assertEqual(landed.record_from_order(order(order_id=5002, title="Lace wig")), "ignored")
        self.assertEqual(landed.record_from_order(order(order_id=5003, status="pending")), "ignored")
        self.assertEqual(landed.record_from_order(order()), "updated")
        [owner] = self.db.rows["landed_owners"]
        self.assertEqual((owner["email"], owner["order_name"], owner["status"]), ("buyer@example.com", "#1001", "active"))

    def test_refund_ends_ownership(self):
        self.use(landed_db())
        landed.record_from_order(order())
        self.assertEqual(landed.record_from_order(order(status="refunded")), "refunded")
        self.assertEqual(self.db.rows["landed_owners"][0]["status"], "refunded")

    def test_sync_reads_shopify_orders(self):
        self.use(landed_db())
        with patch.object(landed.shopify, "iter_orders", return_value=iter([order(), order(order_id=2, title="Wig")])):
            result = landed.sync_from_shopify()
        self.assertEqual((result["orders_scanned"], result["created"], result["ignored"]), (2, 1, 1))
        self.assertEqual(result["earliest_order"], "2026-08-01T10:00:00Z")


class DirectoryTests(LandedCase):
    def search(self, client, record_type="market", q=""):
        return client.get("/members/directory", params={"type": record_type, "q": q}, headers=AUTH).json()["results"]

    def test_owner_sees_snapshot_addresses_but_not_contacts_or_new_records(self):
        db = landed_db(landed_owners=[{"id": "o1", "email": "buyer@example.com", "order_name": "#1001", "status": "active",
                                       "member_id": None, "purchased_at": "2026-08-01"}])
        client = self.client(db)
        self.member_email("buyer@example.com")
        results = {r["id"]: r for r in self.search(client)}
        wig, new = results[MARKET], results[NEW_MARKET]
        self.assertTrue(wig["landed"])
        self.assertFalse(wig["unlocked"])
        self.assertEqual(wig["private"], {"address_en": "12 Wig Road", "address_cn": "假发路12号"})
        self.assertNotIn("contacts", wig["private"])
        self.assertNotIn("wx-li", str(results))
        self.assertFalse(new["landed"])
        self.assertNotIn("private", new)
        provider = self.search(client, "service_provider")[0]
        self.assertEqual(provider["private"], {"address_en": "8 Port Road"})
        self.assertNotIn("wx-fast", str(provider))
        self.assertEqual(db.rows["landed_owners"][0]["member_id"], MEMBER)  # linked by email

    def test_non_owner_sees_no_addresses_and_unconfirmed_records_are_listed(self):
        client = self.client(landed_db())
        self.member_email("someone@example.com")
        results = self.search(client)
        self.assertEqual({r["id"] for r in results}, {MARKET, NEW_MARKET})
        self.assertTrue(all("private" not in r for r in results))
        self.assertEqual([r["verification"] for r in results], ["verified", "unknown"])  # verified first


class ClaimTests(LandedCase):
    def test_claim_with_order_number_and_purchase_email(self):
        db = landed_db(landed_owners=[{"id": "o1", "email": "old@example.com", "order_name": "#1001", "status": "active",
                                       "member_id": None}])
        client = self.client(db)
        self.member_email("new@example.com")
        self.assertFalse(client.get("/members/landed", headers=AUTH).json()["owner"])
        wrong = client.post("/members/landed/claim", json={"order_name": "1002", "email": "old@example.com"}, headers=AUTH)
        self.assertEqual(wrong.status_code, 404)
        claimed = client.post("/members/landed/claim", json={"order_name": "1001", "email": " OLD@example.com "}, headers=AUTH)
        self.assertEqual(claimed.status_code, 200, claimed.text)
        self.assertTrue(claimed.json()["owner"])
        self.assertEqual((db.rows["landed_owners"][0]["member_id"], db.rows["landed_owners"][0]["linked_by"]), (MEMBER, "claim"))

    def test_order_linked_to_someone_else_is_refused(self):
        client = self.client(landed_db(landed_owners=[{"id": "o1", "email": "old@example.com", "order_name": "#1001",
                                                       "status": "active", "member_id": str(uuid.UUID(int=999))}]))
        self.member_email(None)
        refused = client.post("/members/landed/claim", json={"order_name": "#1001", "email": "old@example.com"}, headers=AUTH)
        self.assertEqual(refused.status_code, 409)


class NoticeTests(LandedCase):
    def owners(self):
        return [{"id": "o1", "email": "a@example.com", "order_name": "#1001", "status": "active", "member_id": None,
                 "purchased_at": "2026-08-01"},
                {"id": "o2", "email": "a@example.com", "order_name": "#1004", "status": "active", "member_id": None,
                 "purchased_at": "2026-08-03"},
                {"id": "o3", "email": "b@example.com", "order_name": "#1002", "status": "active", "member_id": None,
                 "purchased_at": "2026-08-02"},
                {"id": "o4", "email": "c@example.com", "order_name": "#1003", "status": "refunded", "member_id": None,
                 "purchased_at": "2026-08-02"}]

    def test_dry_run_counts_then_queues_once_per_person(self):
        db = landed_db(landed_owners=self.owners())
        client = self.client(db)
        self.assertEqual(client.post("/platform/landed/send", json={"kind": "notice"}, headers=AUTH).status_code, 403)
        dry = client.post("/platform/landed/send", json={"kind": "notice"}, headers=ADMIN_AUTH).json()
        self.assertEqual((dry["dry_run"], dry["waiting"]), (True, 2))
        self.assertNotIn("email_outbox", db.rows)
        sent = client.post("/platform/landed/send", json={"kind": "notice", "dry_run": False}, headers=ADMIN_AUTH).json()
        self.assertEqual(sent["queued"], 2)
        outbox = db.rows["email_outbox"]
        self.assertEqual(sorted(r["to_email"] for r in outbox), ["a@example.com", "b@example.com"])
        self.assertEqual(outbox[0]["template"], "landed_notice")
        self.assertIn("30 November 2026", outbox[0]["payload"]["text"])
        self.assertIn("/member/signup?from=landed", outbox[0]["payload"]["html"])
        again = client.post("/platform/landed/send", json={"kind": "notice", "dry_run": False}, headers=ADMIN_AUTH).json()
        self.assertEqual(again["queued"], 0)

    def test_reminder_skips_people_who_signed_up(self):
        owners = self.owners()
        for row in owners:
            row["notice_sent_at"] = "2026-10-26T00:00:00Z"
        owners[2]["member_id"] = MEMBER
        db = landed_db(landed_owners=owners)
        client = self.client(db)
        sent = client.post("/platform/landed/send", json={"kind": "reminder", "dry_run": False}, headers=ADMIN_AUTH).json()
        self.assertEqual(sent["queued"], 1)
        self.assertEqual(db.rows["email_outbox"][0]["to_email"], "a@example.com")
        summary = client.get("/platform/landed", headers=ADMIN_AUTH).json()
        self.assertEqual((summary["buyers"], summary["signed_up"], summary["refunded_orders"]), (2, 1, 1))


if __name__ == "__main__":
    import unittest
    unittest.main()
