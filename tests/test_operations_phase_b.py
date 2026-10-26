"""Operations fixes phase B (docs/OPERATIONS_FIXES_PLAN.md): administrators claim like workers, sharing moves the
request on by itself, batches are worked once, invoices can be withdrawn or declined, member-app chats in Conversations."""
from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router
from app.commerce import db as commerce_db

ADMIN = "00000000-0000-0000-0000-0000000000a1"
WORKER = "00000000-0000-0000-0000-0000000000b1"
MEMBER = "00000000-0000-0000-0000-0000000000c1"
ITEM_A, ITEM_B = "00000000-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000000b"
REQ_A, REQ_B = "00000000-0000-0000-0000-0000000000ea", "00000000-0000-0000-0000-0000000000eb"
BATCH = "00000000-0000-0000-0000-0000000000ba"
CHAT = "00000000-0000-0000-0000-0000000000cc"


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.values, self.single, self.cap = db, table, [], "select", None, False, None

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self

    def limit(self, n):
        self.cap = n
        return self

    def range(self, a, b):
        self.cap = b - a + 1
        return self

    def eq(self, c, v):
        self.filters.append((c, lambda x, v=v: str(x) == str(v)))
        return self

    def in_(self, c, vs):
        vs = [str(v) for v in vs]
        self.filters.append((c, lambda x, vs=vs: str(x) in vs))
        return self

    def ilike(self, c, pattern):
        needle = pattern.strip("%").lower()
        self.filters.append((c, lambda x, n=needle: n in str(x or "").lower()))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def upsert(self, values, **_k):
        self.op, self.values = "insert", values
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            made = []
            for item in self.values if isinstance(self.values, list) else [self.values]:
                row = {"id": str(uuid.uuid4()), **item}
                rows.append(row)
                made.append(row)
            return SimpleNamespace(data=made)
        found = [r for r in rows if all(c in r and f(r[c]) for c, f in self.filters)]
        if self.op == "update":
            for r in found:
                r.update(self.values)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in found]
        found = found[: self.cap] if self.cap else found
        if self.single:
            return SimpleNamespace(data=found[0] if found else None)
        return SimpleNamespace(data=found)


class Db:
    def __init__(self):
        self.tables = {}
        self.rpcs = []

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpcs.append((name, params))

        def run():
            if name == "claim_operations_work_item":
                item = next(i for i in self.tables["operations_work_items"] if i["id"] == params["p_work_item_id"])
                if item.get("assigned_worker_id") not in (None, params["p_worker_id"]):
                    raise RuntimeError("work item is currently claimed")
                item.update({"assigned_worker_id": params["p_worker_id"], "status": "claimed"})
                return SimpleNamespace(data=item)
            if name == "append_member_request_milestone":
                self.tables.setdefault("member_request_events", []).append(
                    {"request_id": params["p_request_id"], "stage": params["p_stage"],
                     "sequence_no": len(self.tables.get("member_request_events", [])) + 1})
                return SimpleNamespace(data=1)
            if name == "set_operations_work_due":
                item = next(i for i in self.tables["operations_work_items"] if i["id"] == params["p_work_item_id"])
                for request in self.tables["member_purchase_requests"]:
                    if request["id"] == item["member_request_id"]:
                        request["eta_at"] = params["p_due_at"]
                return SimpleNamespace(data=item)
            if name == "share_operations_sourcing_options":
                return SimpleNamespace(data=[{"id": "o1"}])
            if name == "set_operations_worker_departments":
                for dep in params["p_departments"]:
                    self.tables.setdefault("operations_worker_departments", []).append(
                        {"worker_id": params["p_worker_id"], "department": dep, "can_claim": True})
                return SimpleNamespace(data=[])
            if name == "request_member_conversation_support":
                item = {"id": str(uuid.uuid4()), "member_conversation_id": params["p_conversation_id"], "status": "open",
                        "department": "member_support", "assigned_worker_id": None}
                self.tables["operations_work_items"].append(item)
                return SimpleNamespace(data=[item])
            return SimpleNamespace(data=[])
        return SimpleNamespace(execute=run)


class PhaseBTests(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.db.tables.update({
            "fayfort_workers": [{"user_id": WORKER, "status": "active"}],
            "operations_worker_departments": [{"worker_id": WORKER, "department": "sourcing", "can_claim": True},
                                              {"worker_id": WORKER, "department": "member_support", "can_claim": True}],
            "operations_work_items": [
                {"id": ITEM_A, "department": "sourcing", "status": "open", "assigned_worker_id": None, "member_request_id": REQ_A,
                 "summary": "Lace wig for Ada", "version": 1, "work_type": "member_request"},
                {"id": ITEM_B, "department": "sourcing", "status": "open", "assigned_worker_id": None, "member_request_id": REQ_B,
                 "summary": "Lace wig for Bola", "version": 1, "work_type": "member_request"},
            ],
            "member_purchase_requests": [{"id": REQ_A, "eta_at": None}, {"id": REQ_B, "eta_at": "2026-12-01T00:00:00Z"}],
            "member_request_events": [{"request_id": REQ_A, "stage": "submitted", "sequence_no": 1},
                                      {"request_id": REQ_B, "stage": "under_review", "sequence_no": 1}],
            "operations_sourcing_batch_items": [{"batch_id": BATCH, "work_item_id": ITEM_A, "member_request_id": REQ_A},
                                                {"batch_id": BATCH, "work_item_id": ITEM_B, "member_request_id": REQ_B}],
            "operations_sourcing_candidates": [
                {"id": "cand1", "work_item_id": ITEM_A, "member_request_id": REQ_A, "product_name": "Body wave wig",
                 "supplier_name": "Xuchang Hair", "product_url": "https://example.cn/wig", "price_amount": 80, "currency": "USD",
                 "availability": "In stock", "evidence_note": "Checked video"}],
            "operations_work_events": [],
            "worker_shifts": [{"worker_id": WORKER, "ended_at": None, "started_at": "2026-10-26T00:00:00Z"}],
            "commerce_invoices": [],
            "member_conversations": [{"id": CHAT, "member_id": MEMBER, "title": "Need a supplier", "last_activity_at": "2026-10-26T09:00:00Z",
                                      "linked_request_id": None, "staff_takeover_at": None, "created_at": "2026-10-26T08:00:00Z"}],
            "member_messages": [{"conversation_id": CHAT, "sender_type": "member", "content": "Hi, anyone?", "created_at": "2026-10-26T09:00:00Z", "id": "m1"}],
            "member_profiles": [{"user_id": MEMBER, "display_name": "Ada Obi"}],
            "operations_worker_notifications": [],
            "email_outbox": [],
        })
        self.who = {"Bearer admin": {"user_id": ADMIN, "role": "platform_admin"}, "Bearer worker": {"user_id": WORKER, "role": "worker"}}
        self.old = commerce_db.client
        commerce_db.client = self.db
        self.patches = [patch("app.accounts.operations.supabase", self.db),
                        patch("app.accounts.router.trusted_fayfort_staff", side_effect=lambda h: self.who.get(h)),
                        patch("app.accounts.operations.worker_on_shift", side_effect=lambda w: w == WORKER),
                        patch("app.handoffs.window._db", return_value=self.db)]
        for p in self.patches:
            p.start()
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        commerce_db.client = self.old

    def h(self, who):
        return {"Authorization": f"Bearer {who}"}

    def item(self, item_id):
        return next(i for i in self.db.tables["operations_work_items"] if i["id"] == item_id)

    def test_admin_must_claim_and_claiming_gives_a_worker_profile(self):
        refused = self.client.post(f"/operations/work-items/{ITEM_A}/sourcing-options", headers=self.h("admin"),
                                   json={"candidate_ids": ["00000000-0000-0000-0000-000000000c01"]})
        self.assertEqual(refused.status_code, 403)
        claimed = self.client.post(f"/operations/work-items/{ITEM_A}/claim", headers=self.h("admin"))
        self.assertEqual(claimed.status_code, 200, claimed.text)
        worker = next(w for w in self.db.tables["fayfort_workers"] if w["user_id"] == ADMIN)
        self.assertEqual((worker["status"], worker["job_title"]), ("active", "Administrator"))
        self.assertEqual({d["department"] for d in self.db.tables["operations_worker_departments"] if d["worker_id"] == ADMIN},
                         {"conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team"})
        self.assertEqual(self.item(ITEM_A)["assigned_worker_id"], ADMIN)

    def test_sharing_moves_an_early_request_into_sourcing_and_asks_for_the_delivery_date(self):
        self.client.post(f"/operations/work-items/{ITEM_A}/claim", headers=self.h("worker"))
        self.db.tables["operations_sourcing_candidates"][0]["id"] = "00000000-0000-0000-0000-000000000c01"
        body = {"candidate_ids": ["00000000-0000-0000-0000-000000000c01"]}
        missing = self.client.post(f"/operations/work-items/{ITEM_A}/sourcing-options", headers=self.h("worker"), json=body)
        self.assertEqual(missing.status_code, 409)
        self.assertIn("estimated delivery date", missing.json()["detail"])
        shared = self.client.post(f"/operations/work-items/{ITEM_A}/sourcing-options", headers=self.h("worker"),
                                  json={**body, "eta_at": "2026-12-20T10:00:00Z"})
        self.assertEqual(shared.status_code, 201, shared.text)
        stages = [e["stage"] for e in self.db.tables["member_request_events"] if e["request_id"] == REQ_A]
        self.assertEqual(stages, ["submitted", "under_review", "sourcing"])
        self.assertIn("share_operations_sourcing_options", [name for name, _ in self.db.rpcs])

    def test_batch_claim_copy_and_share(self):
        claimed = self.client.post(f"/operations/sourcing/batches/{BATCH}/claim", headers=self.h("worker")).json()
        self.assertEqual(sorted(claimed["claimed"]), sorted([ITEM_A, ITEM_B]))
        copied = self.client.post(f"/operations/sourcing/batches/{BATCH}/copy-research", headers=self.h("worker"),
                                  json={"from_work_item_id": ITEM_A}).json()
        self.assertEqual(copied["copied_to"], [ITEM_B])
        on_b = [c for c in self.db.tables["operations_sourcing_candidates"] if c["work_item_id"] == ITEM_B]
        self.assertEqual((len(on_b), on_b[0]["product_url"], on_b[0]["member_request_id"]), (1, "https://example.cn/wig", REQ_B))
        again = self.client.post(f"/operations/sourcing/batches/{BATCH}/copy-research", headers=self.h("worker"),
                                 json={"from_work_item_id": ITEM_A}).json()
        self.assertEqual(again["copied_to"], [ITEM_B])
        self.assertEqual(len([c for c in self.db.tables["operations_sourcing_candidates"] if c["work_item_id"] == ITEM_B]), 1)
        self.db.tables["operations_sourcing_candidates"][0]["id"] = "00000000-0000-0000-0000-000000000c01"
        shared = self.client.post(f"/operations/sourcing/batches/{BATCH}/share", headers=self.h("worker"), json={
            "from_work_item_id": ITEM_A, "candidate_ids": ["00000000-0000-0000-0000-000000000c01"], "eta_at": "2026-12-20T10:00:00Z"}).json()
        self.assertEqual([r["shared"] for r in shared["results"]], [True, True])
        shares = [p for name, p in self.db.rpcs if name == "share_operations_sourcing_options"]
        self.assertEqual({p["p_work_item_id"] for p in shares}, {ITEM_A, ITEM_B})
        b_share = next(p for p in shares if p["p_work_item_id"] == ITEM_B)
        self.assertEqual(b_share["p_candidate_ids"], [on_b[0]["id"]])

    def test_withdraw_and_decline(self):
        self.db.tables["commerce_invoices"] += [
            {"id": "00000000-0000-0000-0000-0000000000d1", "request_id": REQ_A, "member_id": MEMBER, "kind": "deposit", "status": "sent",
             "title": "Sourcing deposit", "amount": 20, "currency": "USD", "shopify_draft_order_id": "gid://shopify/DraftOrder/9"},
            {"id": "00000000-0000-0000-0000-0000000000d2", "request_id": REQ_A, "member_id": MEMBER, "kind": "order", "status": "sent",
             "title": "Wig order", "amount": 80, "currency": "USD", "shopify_draft_order_id": None},
        ]
        self.client.post(f"/operations/work-items/{ITEM_A}/claim", headers=self.h("worker"))
        with patch("app.accounts.operations_flow.withdraw_draft_orders") as withdraw_drafts:
            done = self.client.post(f"/operations/work-items/{ITEM_A}/invoices/00000000-0000-0000-0000-0000000000d1/withdraw",
                                    headers=self.h("worker"), json={"reason": "Price changed"})
        self.assertEqual(done.status_code, 200, done.text)
        withdraw_drafts.assert_called_once_with(REQ_A, ["gid://shopify/DraftOrder/9"])
        deposit = self.db.tables["commerce_invoices"][0]
        self.assertEqual((deposit["status"], deposit["error"]), ("cancelled", "Withdrawn by FayFort: Price changed"))
        self.assertEqual(self.db.tables["email_outbox"][-1]["template"], "commerce_invoice_withdrawn")
        again = self.client.post(f"/operations/work-items/{ITEM_A}/invoices/00000000-0000-0000-0000-0000000000d1/withdraw",
                                 headers=self.h("worker"), json={"reason": "x"})
        self.assertEqual(again.status_code, 409)

        from app.commerce import withdraw
        self.item(ITEM_A).update({"status": "waiting", "waiting_on": "customer"})
        withdraw.decline(MEMBER, "00000000-0000-0000-0000-0000000000d2", "Too expensive")
        self.assertEqual(self.db.tables["commerce_invoices"][1]["status"], "cancelled")
        self.assertEqual(self.item(ITEM_A)["status"], "open")
        self.assertIn("declined the invoice: Too expensive", self.item(ITEM_A)["next_action"])
        notice = self.db.tables["operations_worker_notifications"][-1]
        self.assertEqual((notice["worker_id"], notice["notification_type"]), (WORKER, "quote_declined"))
        with self.assertRaises(LookupError):
            withdraw.decline("00000000-0000-0000-0000-0000000000ff", "00000000-0000-0000-0000-0000000000d2", "")

    def test_member_app_chats_listed_and_taken_over(self):
        listed = self.client.get("/operations/member-chats", headers=self.h("worker")).json()["chats"]
        self.assertEqual((listed[0]["member_name"], listed[0]["handled_by"]), ("Ada Obi", "ai"))
        self.who["Bearer outsider"] = {"user_id": "00000000-0000-0000-0000-0000000000e9", "role": "worker"}
        self.assertEqual(self.client.get("/operations/member-chats", headers=self.h("outsider")).status_code, 403)
        took = self.client.post(f"/operations/member-chats/{CHAT}/take-over", headers=self.h("worker"))
        self.assertEqual(took.status_code, 200, took.text)
        item = self.item(took.json()["work_item_id"])
        self.assertEqual((item["assigned_worker_id"], item["status"]), (WORKER, "claimed"))
        self.assertIsNotNone(self.db.tables["member_conversations"][0]["staff_takeover_at"])


if __name__ == "__main__":
    unittest.main()
