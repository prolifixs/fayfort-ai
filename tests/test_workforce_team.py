"""Worker hours, ratings with the fresh start, revenue and Connect Stripe (docs/WORKFORCE_AND_REVENUE_PLAN.md)."""
from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.commerce import revenue
from app.workforce import team
from tests.test_commerce import ADMIN, MEMBER
from tests.test_customer_reviews import ReviewDb

WORKER = "00000000-0000-0000-0000-0000000000b7"
ADMIN_AUTH = {"Authorization": "Bearer admin"}
WORKER_AUTH = {"Authorization": "Bearer worker"}
MEMBER_AUTH = {"Authorization": "Bearer member"}
NOW = datetime(2026, 10, 19, 6, 0, tzinfo=timezone.utc)  # Monday 14:00 China time


def at(hours_ago: float) -> str:
    return (NOW - timedelta(hours=hours_ago)).isoformat()


def verified(authorization):
    if authorization == "Bearer member":
        return MEMBER
    raise HTTPException(status_code=401, detail="A valid signed-in member is required.")


def staff(authorization):
    return {"Bearer worker": {"user_id": WORKER, "role": "worker"},
            "Bearer admin": {"user_id": ADMIN, "role": "platform_admin"}}.get(authorization)


class TeamCase(unittest.TestCase):
    def client(self, rows=None):
        self.db = ReviewDb(rows or {})
        for patcher in (
            patch.object(commerce_db, "client", self.db),
            patch.object(team, "now_utc", return_value=NOW),
            patch("app.workforce.team.trusted_fayfort_staff", side_effect=staff),
            patch("app.workforce.team.trusted_platform_admin",
                  side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(team.create_team_router(verified))
        return TestClient(app)


class ShiftTests(TeamCase):
    def test_clock_in_break_and_out(self):
        client = self.client({"member_profiles": [{"user_id": WORKER, "display_name": "Ada Okafor"}]})
        state = client.post("/workers/me/shift/clock-in", headers=WORKER_AUTH).json()
        self.assertIsNotNone(state["shift"])
        self.assertEqual(self.db.rows["operations_worker_presence"][0]["worker_id"], WORKER)
        # Clocking in twice keeps one shift.
        client.post("/workers/me/shift/clock-in", headers=WORKER_AUTH)
        self.assertEqual(len(self.db.rows["worker_shifts"]), 1)
        self.db.rows["worker_shifts"][0]["started_at"] = at(3)
        self.db.rows["worker_shifts"][0]["on_break_since"] = at(0.5)
        state = client.post("/workers/me/shift/break", headers=WORKER_AUTH).json()
        self.assertFalse(state["shift"]["on_break"])
        self.assertEqual(self.db.rows["worker_shifts"][0]["break_seconds"], 1800)
        done = client.post("/workers/me/shift/clock-out", headers=WORKER_AUTH, json={"note": "Packed 6 orders"}).json()
        self.assertIsNone(done["shift"])
        shift = self.db.rows["worker_shifts"][0]
        self.assertEqual((shift["ended_by"], shift["note"]), ("worker", "Packed 6 orders"))
        self.assertEqual(team.worked_seconds(shift, NOW), 2.5 * 3600)
        self.assertEqual(done["today_seconds"], 2.5 * 3600)

    def test_only_staff(self):
        client = self.client()
        self.assertEqual(client.post("/workers/me/shift/clock-in", headers=MEMBER_AUTH).status_code, 403)

    def test_gone_workers_are_clocked_out_at_their_last_heartbeat(self):
        self.client({
            "worker_shifts": [
                {"id": "s1", "worker_id": WORKER, "started_at": at(4), "ended_at": None, "break_seconds": 0},
                {"id": "s2", "worker_id": ADMIN, "started_at": at(20), "ended_at": None, "break_seconds": 0},
            ],
            "operations_worker_presence": [{"worker_id": WORKER, "last_seen_at": at(1)},
                                           {"worker_id": ADMIN, "last_seen_at": at(0)}],
        })
        self.assertEqual(team.end_stale_shifts(NOW), {"auto_ended": 1, "capped": 1})
        first, second = self.db.rows["worker_shifts"]
        self.assertEqual((first["ended_at"], first["flag"], first["ended_by"]), (at(1), "auto_ended", "auto"))
        self.assertEqual(second["flag"], "capped")
        self.assertEqual(team.worked_seconds(second, NOW), 16 * 3600)

    def test_days_split_at_china_midnight_and_coverage_finds_gaps(self):
        shift = {"started_at": "2026-10-18T14:00:00+00:00", "ended_at": "2026-10-18T18:00:00+00:00", "break_seconds": 0}
        self.assertEqual(team.day_seconds(shift, NOW), {"2026-10-18": 2 * 3600, "2026-10-19": 2 * 3600})
        morning = {"started_at": "2026-10-19T01:30:00+00:00", "ended_at": "2026-10-19T04:00:00+00:00"}  # 9:30-12:00 China
        grid = {(c["weekday"], c["hour"]): c["covered"] for c in team.coverage([morning], date(2026, 10, 19), 1, NOW)}
        self.assertEqual(grid[(0, 10)], 1.0)
        self.assertEqual(grid[(0, 12)], 0.0)
        self.assertNotIn((0, 15), grid)  # later today hasn't happened yet

    def test_corrections_need_a_reason_and_admins_decide(self):
        client = self.client({
            "member_profiles": [{"user_id": WORKER, "display_name": "Ada Okafor"}],
            "worker_shifts": [{"id": "00000000-0000-0000-0000-00000000aa01", "worker_id": WORKER, "started_at": at(10),
                               "ended_at": at(9), "ended_by": "auto", "flag": "auto_ended", "break_seconds": 0}],
        })
        body = {"started_at": at(10), "ended_at": at(6), "reason": "Forgot to clock out after the market visit"}
        self.assertEqual(client.post("/workers/me/shifts/00000000-0000-0000-0000-00000000aa01/correction",
                                     headers=WORKER_AUTH, json=body).status_code, 201)
        request = self.db.rows["worker_shift_corrections"][0]
        self.assertEqual(request["status"], "pending")
        self.assertEqual(self.db.rpcs[-1][0], "notify_platform_admins")
        request["id"] = "00000000-0000-0000-0000-00000000cc01"
        client.post("/platform/workforce/corrections/00000000-0000-0000-0000-00000000cc01", headers=ADMIN_AUTH,
                    json={"decision": "approve"})
        shift = self.db.rows["worker_shifts"][0]
        self.assertEqual((shift["ended_at"], shift["flag"]), (at(6), "edited"))
        too_long = {"started_at": at(30), "ended_at": at(6), "reason": "Long day"}
        self.assertEqual(client.put("/platform/workforce/shifts/00000000-0000-0000-0000-00000000aa01",
                                    headers=ADMIN_AUTH, json=too_long).status_code, 422)

    def test_timesheet_and_export(self):
        client = self.client({
            "fayfort_workers": [{"user_id": WORKER, "status": "active"}],
            "member_profiles": [{"user_id": WORKER, "display_name": "Ada Okafor"}],
            "worker_shifts": [{"id": "s1", "worker_id": WORKER, "started_at": "2026-10-19T01:30:00+00:00",
                               "ended_at": "2026-10-19T04:00:00+00:00", "ended_by": "worker", "break_seconds": 0}],
        })
        sheet = client.get("/platform/workforce/timesheets?start=2026-10-19&days=7", headers=ADMIN_AUTH).json()
        row = sheet["workers"][0]
        self.assertEqual((row["name"], row["total_seconds"], row["days"]["2026-10-19"]), ("Ada Okafor", 9000, 9000))
        csv_text = client.get("/platform/workforce/shifts.csv?start=2026-10-19&days=7", headers=ADMIN_AUTH).text
        self.assertIn("Ada Okafor,2026-10-19 09:30,2026-10-19 12:00,0,2.5,worker", csv_text)
        self.assertEqual(client.get("/platform/workforce/timesheets", headers=WORKER_AUTH).status_code, 403)


class RatingTests(TeamCase):
    def ratings(self, *stars_hours):
        return [{"id": f"r{i}", "worker_id": WORKER, "prompt_id": f"p{i}", "stars": s, "source": "chat", "created_at": at(h)}
                for i, (s, h) in enumerate(stars_hours)]

    def test_fresh_start_after_n_completed_tasks(self):
        completed = [NOW - timedelta(hours=h) for h in (50, 40, 30)]
        ratings = self.ratings((2, 45), (3, 35), (4, 20), (5, 10))
        summary = team.rating_summary(ratings, completed, every=2, now=NOW)
        # The 2nd completed task (40h ago) started a fresh period: only the ratings after it count now.
        self.assertEqual(summary["current"], 4.0)
        self.assertEqual(summary["current_count"], 3)
        self.assertEqual(summary["fresh_start"]["tasks_to_go"], 1)
        none_since = team.rating_summary(self.ratings((1, 45)), completed, every=2, now=NOW)
        self.assertEqual(none_since["current"], 5.0)
        off = team.rating_summary(ratings, completed, every=0, now=NOW)
        self.assertEqual(off["current"], 3.5)
        self.assertIsNone(off["fresh_start"]["tasks_to_go"])
        self.assertIsNone(summary["average"])  # fewer than 5 ratings: "New"

    def test_admin_sets_the_reset_count(self):
        client = self.client({"workforce_settings": [{"key": "rating_reset_tasks", "value": 20}]})
        self.assertEqual(client.get("/platform/workforce/settings", headers=ADMIN_AUTH).json(), {"rating_reset_tasks": 20})
        client.put("/platform/workforce/settings", headers=ADMIN_AUTH, json={"rating_reset_tasks": 10})
        self.assertEqual(team.reset_every(), 10)
        self.assertEqual(client.put("/platform/workforce/settings", headers=WORKER_AUTH,
                                    json={"rating_reset_tasks": 1}).status_code, 403)

    def test_members_rate_available_help_and_low_ratings_alert_admins(self):
        prompt_id = "00000000-0000-0000-0000-00000000dd01"
        client = self.client({
            "member_profiles": [{"user_id": WORKER, "display_name": "Ada Okafor"}],
            "worker_rating_prompts": [
                {"id": prompt_id, "worker_id": WORKER, "member_id": MEMBER, "conversation_id": "c1", "request_id": None,
                 "title": "Wig question", "available_after": at(1), "rated_at": None, "dismissed_at": None},
                {"id": "later", "worker_id": WORKER, "member_id": MEMBER, "conversation_id": "c2", "request_id": None,
                 "title": "Still chatting", "available_after": at(-1), "rated_at": None, "dismissed_at": None},
            ],
        })
        listing = client.get("/members/worker-ratings", headers=MEMBER_AUTH).json()["prompts"]
        self.assertEqual([p["title"] for p in listing], ["Wig question"])
        self.assertEqual(listing[0]["worker"]["first_name"], "Ada")
        self.assertNotIn("worker_id", listing[0])
        self.assertEqual(client.post("/members/worker-ratings", headers=MEMBER_AUTH,
                                     json={"prompt_id": prompt_id, "stars": 2, "comment": "Slow replies"}).status_code, 201)
        self.assertEqual(self.db.rows["worker_ratings"][0]["stars"], 2)
        self.assertEqual(self.db.rpcs[-1][1]["p_title"], "Ada got a 2-star rating")
        # Changing it within 7 days updates the same rating.
        client.post("/members/worker-ratings", headers=MEMBER_AUTH, json={"prompt_id": prompt_id, "stars": 4})
        self.assertEqual(len(self.db.rows["worker_ratings"]), 1)
        self.assertEqual(self.db.rows["worker_ratings"][0]["stars"], 4)


class RevenueTests(unittest.TestCase):
    def setUp(self):
        entries = [
            {"stream": "shop", "source": "shopify", "occurred_at": "2026-10-10T03:00:00+00:00", "gross": 120, "refunded": 20,
             "currency": "USD", "member_id": "m1", "country": "Nigeria", "reference": "#1001",
             "line_items": [{"title": "Body wave wig", "quantity": 1, "price": "120.00"}]},
            {"stream": "sourcing", "source": "shopify", "occurred_at": "2026-10-12T03:00:00+00:00", "gross": 400, "refunded": 0,
             "currency": "USD", "member_id": "m2", "country": "Ghana", "reference": "#1002", "line_items": []},
            {"stream": "memberships", "source": "stripe", "occurred_at": "2026-10-15T03:00:00+00:00", "gross": 49, "refunded": 0,
             "currency": "USD", "member_id": "m1", "country": None, "reference": "Pro plan", "line_items": []},
            {"stream": "shop", "source": "shopify", "occurred_at": "2026-10-15T03:00:00+00:00", "gross": 30, "refunded": 0,
             "currency": "GBP", "member_id": "m3", "country": "UK", "reference": "#1003", "line_items": []},
            {"stream": "shop", "source": "shopify", "occurred_at": "2026-09-20T03:00:00+00:00", "gross": 100, "refunded": 0,
             "currency": "USD", "member_id": "m4", "country": "Nigeria", "reference": "#900", "line_items": []},
        ]
        self.db = ReviewDb({"revenue_entries": entries, "member_subscriptions": [{"plan": "pro", "status": "active"}]})
        patcher = patch.object(commerce_db, "client", self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_report_counts_net_by_stream_and_keeps_other_currencies_apart(self):
        report = revenue.report(date(2026, 10, 1), date(2026, 10, 18))
        tiles = report["tiles"]
        self.assertEqual((tiles["gross"], tiles["refunds"], tiles["net"], tiles["sales"]), (569.0, 20.0, 549.0, 3))
        self.assertEqual(tiles["paying_customers"], 2)
        self.assertEqual(tiles["previous_net"], 100.0)
        self.assertEqual(report["other_currencies"], {"GBP": 30.0})
        self.assertEqual(report["sources"], {"shopify": 500.0, "stripe": 49.0})
        self.assertEqual(report["range"]["bucket"], "day")
        day = next(row for row in report["series"] if row["bucket"] == "2026-10-10")
        self.assertEqual(day["shop"], 100.0)
        self.assertEqual(report["top_products"][0], {"title": "Body wave wig", "revenue": 120.0, "quantity": 1})
        self.assertEqual(report["countries"][0], {"country": "Ghana", "net": 400.0})
        self.assertEqual(tiles["mrr"]["members"], {"standard": 0, "pro": 1})

    def test_ranges_pick_sensible_buckets(self):
        today = date(2026, 10, 18)
        self.assertEqual(revenue.period("7d", None, None, today), (date(2026, 10, 12), today))
        self.assertEqual(revenue.bucket_for(*revenue.period("90d", None, None, today)), "week")
        self.assertEqual(revenue.bucket_for(*revenue.period("12m", None, None, today)), "month")
        with self.assertRaises(HTTPException):
            revenue.period("custom", date(2026, 10, 5), date(2026, 10, 1), today)


class RefundCaptureTests(unittest.TestCase):
    def test_shopify_refund_transactions_and_full_refunds(self):
        from app.commerce.service import refunded_total
        order = {"total_price": "100.00", "financial_status": "partially_refunded",
                 "refunds": [{"transactions": [{"kind": "refund", "status": "success", "amount": "25.50"},
                                               {"kind": "refund", "status": "failure", "amount": "10.00"}]}]}
        self.assertEqual(refunded_total(order), 25.5)
        self.assertEqual(refunded_total({"total_price": "80.00", "financial_status": "refunded"}), 80.0)
        self.assertEqual(refunded_total({"total_price": "80.00", "financial_status": "paid"}), 0.0)

    def test_stripe_refund_updates_the_membership_payment(self):
        from app.billing import service as billing
        db = ReviewDb({"member_subscription_payments": [{"stripe_invoice_id": "in_1", "amount": 49, "refunded_amount": 0}]})
        with patch.object(commerce_db, "client", db), patch.object(billing, "db", lambda: db):
            self.assertTrue(billing.record_refund({"invoice": "in_1", "amount_refunded": 4900}))
        self.assertEqual(db.rows["member_subscription_payments"][0]["refunded_amount"], 49.0)


class ConnectionsTests(unittest.TestCase):
    def client(self):
        from app.infrastructure import connections
        for patcher in (
            patch("app.infrastructure.connections.trusted_platform_admin",
                  side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None),
            patch("app.infrastructure.connections.connections_status", return_value={"stripe": {"connected": True}}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(connections.create_connections_router())
        return TestClient(app)

    def test_a_working_key_is_checked_then_saved_encrypted_with_only_a_hint(self):
        client = self.client()
        key = "sk_test_" + "a1B2" * 6
        with patch("app.billing.stripe_api.check_key", return_value="test") as check, \
                patch("app.infrastructure.connections.store") as store, \
                patch("app.billing.service.ensure_setup") as setup:
            store.save_integration_credentials.return_value = True
            response = client.put("/platform/connections/stripe", headers=ADMIN_AUTH, json={"secret_key": key})
        self.assertEqual(response.status_code, 200)
        check.assert_called_once_with(key)
        provider, secret, safe, actor = store.save_integration_credentials.call_args.args
        self.assertEqual((provider, secret, actor), ("stripe", {"secret_key": key}, ADMIN))
        self.assertEqual(safe, {"mode": "test", "key_hint": "sk_test_…a1B2"})
        setup.assert_called_once()
        self.assertNotIn(key, response.text)

    def test_wrong_keys_are_refused_before_saving(self):
        client = self.client()
        from app.billing.stripe_api import StripeError
        with patch("app.infrastructure.connections.store") as store:
            publishable = client.put("/platform/connections/stripe", headers=ADMIN_AUTH, json={"secret_key": "pk_test_" + "x" * 24})
            self.assertEqual(publishable.status_code, 422)
            self.assertIn("publishable", publishable.text)
            with patch("app.billing.stripe_api.check_key", side_effect=StripeError("Stripe didn't accept that key.", 401)):
                rejected = client.put("/platform/connections/stripe", headers=ADMIN_AUTH, json={"secret_key": "sk_live_" + "x" * 24})
            self.assertEqual(rejected.status_code, 422)
            store.save_integration_credentials.assert_not_called()
        self.assertEqual(client.put("/platform/connections/stripe", headers=WORKER_AUTH,
                                    json={"secret_key": "sk_test_" + "x" * 24}).status_code, 403)

    def test_server_key_wins(self):
        from app.billing import stripe_api
        with patch.object(stripe_api.settings, "STRIPE_SECRET_KEY", "sk_test_server"), \
                patch("app.infrastructure.store.get_integration_credentials") as stored:
            self.assertEqual(stripe_api.secret_key(), "sk_test_server")
            self.assertEqual(stripe_api.key_source(), "server")
            stored.assert_not_called()
        with patch.object(stripe_api.settings, "STRIPE_SECRET_KEY", ""), \
                patch("app.infrastructure.store.get_integration_credentials", return_value={"secret_key": "sk_test_saved"}):
            stripe_api.forget_stored_key()
            self.assertEqual(stripe_api.secret_key(), "sk_test_saved")
            self.assertEqual(stripe_api.key_source(), "connections")
        stripe_api.forget_stored_key()


if __name__ == "__main__":
    unittest.main()
