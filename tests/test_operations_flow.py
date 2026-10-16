"""Operations flow: outside events become work items and close themselves (docs/OPERATIONS_CENTER_PLAN.md)."""
from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.accounts import operations_flow as flow
from app.commerce import db as commerce_db

NOW = datetime.now(timezone.utc)
ADMIN = "00000000-0000-0000-0000-0000000000a1"
WORKER = "00000000-0000-0000-0000-0000000000b1"
MEMBER = "00000000-0000-0000-0000-0000000000c1"
REQUEST = "00000000-0000-0000-0000-0000000000d1"


class Query:
    def __init__(self, db: "Db", table: str):
        self.db, self.table, self.filters, self.op, self.values = db, table, [], "select", None
        self._order, self._limit, self.single = None, None, False

    def select(self, *_a, **_k): return self
    def order(self, column, desc=False): self._order = (column, desc); return self
    def limit(self, n): self._limit = n; return self
    def maybe_single(self): self.single = True; return self
    def eq(self, c, v): self.filters.append((c, "eq", v)); return self
    def gte(self, c, v): self.filters.append((c, "gte", v)); return self
    def lt(self, c, v): self.filters.append((c, "lt", v)); return self
    def in_(self, c, v): self.filters.append((c, "in", list(v))); return self
    def is_(self, c, v): self.filters.append((c, "is", v)); return self
    def insert(self, values): self.op, self.values = "insert", values; return self
    def update(self, values): self.op, self.values = "update", values; return self

    @staticmethod
    def _value(row, column):
        if "->>" in column:
            field, key = column.split("->>", 1)
            return (row.get(field) or {}).get(key)
        return row.get(column)

    def _match(self, row):
        for column, op, value in self.filters:
            current = self._value(row, column)
            if op == "eq" and str(current) != str(value): return False
            if op == "gte" and (current is None or str(current) < str(value)): return False
            if op == "lt" and (current is None or str(current) >= str(value)): return False
            if op == "in" and str(current) not in [str(x) for x in value]: return False
            if op == "is" and value == "null" and current is not None: return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == "select":
            found = [dict(r) for r in rows if self._match(r)]
            if self._order:
                column, desc = self._order
                found.sort(key=lambda r: str(r.get(column) or ""), reverse=desc)
            if self._limit:
                found = found[: self._limit]
            return SimpleNamespace(data=(found[0] if found else None) if self.single else found)
        if self.op == "update":
            changed = [r for r in rows if self._match(r)]
            for r in changed:
                r.update(self.values)
            return SimpleNamespace(data=[dict(r) for r in changed])
        items = self.values if isinstance(self.values, list) else [self.values]
        out = []
        for item in items:
            item = {"id": str(uuid.uuid4()), "created_at": NOW.isoformat(), "version": 1, **item}
            rows.append(item)
            out.append(dict(item))
        return SimpleNamespace(data=out)


class Db:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.rpc_calls = []

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=0))


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.previous = commerce_db.client
        commerce_db.client = self.db

    def tearDown(self):
        commerce_db.client = self.previous

    def items(self, work_type=None):
        return [r for r in self.db.rows.get("operations_work_items", []) if not work_type or r["work_type"] == work_type]

    def test_paid_shop_order_becomes_packing_work_and_closes_when_fulfilled(self):
        order = {"source": "storefront", "shopify_order_id": "gid://shopify/Order/5001", "order_name": "#1001",
                 "financial_status": "paid", "fulfillment_status": None, "member_id": MEMBER,
                 "line_items": [{"title": "Wig", "quantity": 2}], "total": "96.00", "currency": "USD"}
        with patch("app.commerce.shopify.shop_domain", return_value="fayfort.myshopify.com"):
            flow.sync_store_order(order)
            flow.sync_store_order(order)  # webhooks repeat; still one item
        [item] = self.items("store_order")
        self.assertEqual(item["department"], "fulfillment")
        self.assertIn("2 items", item["summary"])
        self.assertEqual(item["metadata"]["admin_url"], "https://fayfort.myshopify.com/admin/orders/5001")
        flow.sync_store_order({**order, "fulfillment_status": "fulfilled"})
        self.assertEqual(self.items("store_order")[0]["status"], "completed")
        history = [e["event_type"] for e in self.db.rows["operations_work_events"]]
        self.assertEqual(history, ["created", "completed"])

    def test_invoice_orders_and_unpaid_orders_are_not_packing_work(self):
        flow.sync_store_order({"source": "invoice", "shopify_order_id": "gid://shopify/Order/1", "financial_status": "paid"})
        flow.sync_store_order({"source": "storefront", "shopify_order_id": "gid://shopify/Order/2", "financial_status": "pending"})
        self.assertEqual(self.items(), [])

    def test_group_buy_opens_once_target_is_reached_and_holds_buyers_requests(self):
        self.db.rows["commerce_pool_members"] = [{"trend_item_id": "t1", "member_id": MEMBER, "request_id": REQUEST}]
        self.db.rows["operations_work_items"] = [{"id": "w1", "member_request_id": REQUEST, "status": "open",
                                                   "department": "sourcing", "work_type": "member_request", "version": 1}]
        trend = {"id": "t1", "title": "Viral bob wig", "status": "pooling", "pool_target": 2, "want_count": 1}
        flow.sync_group_buy(trend)
        self.assertEqual(self.items("group_buy"), [])
        flow.sync_group_buy({**trend, "want_count": 2})
        [group] = self.items("group_buy")
        self.assertEqual(group["department"], "sourcing")
        held = self.items("member_request")[0]
        self.assertEqual((held["status"], held["waiting_on"]), ("waiting", "internal"))
        self.db.rows["commerce_invoices"] = [{"trend_item_id": "t1", "status": "paid"}]
        flow.group_buy_paid_check("t1")
        self.assertEqual(self.items("group_buy")[0]["status"], "completed")

    def test_ended_giveaway_needs_a_draw_and_codeless_winners_need_a_prize_arranged(self):
        self.db.rows["commerce_giveaways"] = [{"id": "g1", "title": "Win a wig", "status": "open",
                                               "ends_at": (NOW - timedelta(hours=1)).isoformat()}]
        self.assertEqual(flow.sync_giveaways(NOW), 1)
        self.assertEqual(flow.sync_giveaways(NOW), 0)
        flow.after_giveaway_draw({"id": "g1", "title": "Win a wig"},
                                 [{"member_id": MEMBER, "prize_code": None, "prize_error": "no product"},
                                  {"member_id": WORKER, "prize_code": "WIN-1"}])
        self.assertEqual(self.items("giveaway_draw")[0]["status"], "completed")
        [prize] = self.items("giveaway_prize")
        self.assertEqual(prize["metadata"]["member_id"], MEMBER)

    def test_member_choice_and_payments_reach_the_request_item(self):
        self.db.rows["operations_work_items"] = [{"id": "w1", "member_request_id": REQUEST, "status": "waiting",
                                                   "waiting_on": "member", "waiting_reason": "x", "department": "sourcing",
                                                   "work_type": "member_request", "version": 3}]
        flow.note_on_request_item(REQUEST, "The member chose X. Send the invoice.", "Option chosen.")
        item = self.items()[0]
        self.assertEqual((item["status"], item["waiting_on"]), ("open", None))
        self.assertIn("Send the invoice", item["next_action"])
        self.assertEqual(item["version"], 4)

    def test_staff_can_message_a_member_from_work_without_a_chat(self):
        self.db.rows["member_conversations"] = [
            {"id": "c-request", "member_id": MEMBER, "linked_request_id": REQUEST, "retention_hold": False, "last_activity_at": "2026-10-10"},
        ]
        item = {"id": "w9", "department": "member_support", "status": "claimed", "metadata": {"member_id": MEMBER}}
        sent = flow.send_member_message(item, WORKER, "worker", "  You won! What's your address?  ")
        self.assertNotEqual(sent["conversation_id"], "c-request")  # never in a request's own chat
        [message] = self.db.rows["member_messages"]
        self.assertEqual((message["sender_type"], message["content"]), ("worker", "You won! What's your address?"))
        self.assertEqual(flow.member_chat(MEMBER)["id"], sent["conversation_id"])
        [event] = self.db.rows["operations_work_events"]
        self.assertEqual((event["actor_type"], event["actor_user_id"]), ("worker", WORKER))

    def test_billing_issue_opens_while_payment_fails_and_closes_when_it_recovers(self):
        self.db.rows["member_subscriptions"] = [{"member_id": MEMBER, "plan": "pro", "status": "past_due"}]
        flow.sync_billing_issues()
        self.assertEqual(self.items("billing_issue")[0]["status"], "open")
        self.db.rows["member_subscriptions"][0]["status"] = "active"
        flow.sync_billing_issues()
        self.assertEqual(self.items("billing_issue")[0]["status"], "completed")

    def test_sweep_leaves_recurring_orders_to_the_database_scheduler(self):
        summary = flow.sweep()
        self.assertEqual(set(summary), {"giveaways", "billing", "group_buys"})
        self.assertEqual(self.db.rpc_calls, [])


class FlowApiTests(unittest.TestCase):
    @property
    def client(self):
        from fastapi import FastAPI
        from app.accounts.router import create_accounts_router
        app = FastAPI()
        app.include_router(create_accounts_router())
        return TestClient(app)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_archive_lists_finished_work_newest_first(self, table, identity):
        query = MagicMock()
        for name in ("select", "eq", "in_", "gte", "order", "range", "limit"):
            getattr(query, name).return_value = query
        query.execute.return_value.data = [{"id": "w1", "status": "completed", "summary": "Packed order #1001"},
                                           {"id": "w2", "status": "cancelled", "summary": "Other"}]
        table.return_value = query
        response = self.client.get("/operations/work-items?scope=all&view=archive&q=1001")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([i["id"] for i in response.json()["work_items"]], ["w1"])
        query.in_.assert_any_call("status", ["completed", "cancelled"])
        query.order.assert_any_call("completed_at", desc=True)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_queue_shows_only_live_work(self, table, identity):
        query = MagicMock()
        for name in ("select", "eq", "in_", "order", "limit"):
            getattr(query, name).return_value = query
        query.execute.return_value.data = []
        table.return_value = query
        self.assertEqual(self.client.get("/operations/work-items?scope=all").status_code, 200)
        query.in_.assert_any_call("status", ["open", "claimed", "waiting", "blocked"])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"})
    @patch("app.accounts.operations.supabase.table")
    def test_queue_puts_urgent_and_movable_work_first(self, table, identity):
        query = MagicMock()
        for name in ("select", "eq", "in_", "order", "limit"):
            getattr(query, name).return_value = query
        query.execute.return_value.data = [
            {"id": "normal-waiting", "priority": "normal", "status": "waiting", "created_at": "2026-10-01"},
            {"id": "normal-open", "priority": "normal", "status": "open", "created_at": "2026-10-02"},
            {"id": "urgent", "priority": "urgent", "status": "open", "created_at": "2026-10-03"},
            {"id": "high", "priority": "high", "status": "claimed", "created_at": "2026-10-04"}]
        table.return_value = query
        ids = [i["id"] for i in self.client.get("/operations/work-items?scope=all").json()["work_items"]]
        self.assertEqual(ids, ["urgent", "high", "normal-open", "normal-waiting"])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_workers_see_finished_work_from_their_departments(self, table, identity):
        access = MagicMock()
        access.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"department": "fulfillment"}]
        query = MagicMock()
        for name in ("select", "eq", "in_", "gte", "order", "range", "limit"):
            getattr(query, name).return_value = query
        query.execute.return_value.data = [{"id": "w1", "status": "completed", "summary": "Packed"}]
        table.side_effect = lambda name: access if name == "operations_worker_departments" else query
        response = self.client.get("/operations/work-items?scope=available&view=archive")
        self.assertEqual([i["id"] for i in response.json()["work_items"]], ["w1"])
        query.in_.assert_any_call("department", ["fulfillment"])

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    @patch("app.accounts.operations.supabase.table")
    def test_group_price_needs_the_worker_to_own_the_group_buy(self, table, identity):
        item_query = MagicMock()
        item_query.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "w1", "department": "sourcing", "status": "open", "assigned_worker_id": None,
            "metadata": {"source_kind": "trend_pool", "source_id": "t1"}}
        access = MagicMock()
        access.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"department": "sourcing"}]
        table.side_effect = lambda name: access if name == "operations_worker_departments" else item_query
        response = self.client.post("/operations/work-items/00000000-0000-0000-0000-000000000099/group-price",
                                    json={"price": 45, "currency": "usd"})
        self.assertEqual(response.status_code, 403)

    @patch("app.accounts.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"})
    def test_only_admins_reopen_archived_work(self, identity):
        response = self.client.post(f"/operations/work-items/{REQUEST}/reopen", json={"reason": "Customer came back"})
        self.assertEqual(response.status_code, 403)

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_answer_resumes_sourcing(self, identity, get_user, rpc):
        rpc.return_value.execute.return_value.data = 5
        response = self.client.post(f"/members/requests/{REQUEST}/answer", json={"message": "Size 22 inch, black"},
                                    headers={"Authorization": "Bearer member"})
        self.assertEqual(response.status_code, 200)
        rpc.assert_called_with("member_answer_request_input", {"p_request_id": REQUEST, "p_member_id": MEMBER,
                                                               "p_message": "Size 22 inch, black"})

    @patch("app.accounts.router.supabase.rpc")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_answer_after_staff_moved_on_is_a_conflict(self, identity, get_user, rpc):
        rpc.return_value.execute.side_effect = Exception("request is not waiting for member input")
        response = self.client.post(f"/members/requests/{REQUEST}/answer", json={"message": "Black"},
                                    headers={"Authorization": "Bearer member"})
        self.assertEqual(response.status_code, 409)

if __name__ == "__main__":
    unittest.main()
