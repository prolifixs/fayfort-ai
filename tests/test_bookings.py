"""Booking engine and API (app/bookings): slots, holds, no double booking, moves, cancellations, sweep, consultations."""
from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.bookings import engine
from app.bookings.router import create_bookings_router
from app.commerce import db as commerce_db

CEO = "00000000-0000-0000-0000-00000000ce00"
ASSISTANT = "00000000-0000-0000-0000-00000000a551"
STAFF = "00000000-0000-0000-0000-00000000005f"
ADMIN = "00000000-0000-0000-0000-00000000ad00"
MEMBER = "00000000-0000-0000-0000-00000000be01"
OTHER_MEMBER = "00000000-0000-0000-0000-00000000be02"
# Monday 2 November 2026, 00:00 UTC. China is UTC+8.
NOW = datetime(2026, 11, 2, 0, 0, tzinfo=timezone.utc)


def _cmp(value):
    parsed = engine.parse(value) if isinstance(value, str) and len(value) >= 19 and value[4] == "-" else None
    return parsed or value


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.values, self.orders, self.cap = db, table, [], "select", None, [], None

    def select(self, *_a, **_k): return self

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def limit(self, n):
        self.cap = n
        return self

    def _add(self, column, op, value):
        self.filters.append((column, op, value))
        return self

    def eq(self, c, v): return self._add(c, "eq", v)
    def neq(self, c, v): return self._add(c, "neq", v)
    def gt(self, c, v): return self._add(c, "gt", v)
    def gte(self, c, v): return self._add(c, "gte", v)
    def lt(self, c, v): return self._add(c, "lt", v)
    def in_(self, c, v): return self._add(c, "in", list(v))
    def maybe_single(self): return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def delete(self):
        self.op = "delete"
        return self

    def _match(self, row):
        for column, op, value in self.filters:
            have = row.get(column)
            if op == "eq" and str(have) != str(value):
                return False
            if op == "neq" and str(have) == str(value):
                return False
            if op == "in" and str(have) not in [str(v) for v in value]:
                return False
            if op in ("gt", "gte", "lt"):
                if have is None:
                    return False
                a, b = _cmp(have), _cmp(value)
                if op == "gt" and not a > b or op == "gte" and not a >= b or op == "lt" and not a < b:
                    return False
        return True

    def execute(self):
        table = self.db.rows.setdefault(self.table, [])
        if self.op == "insert":
            items = self.values if isinstance(self.values, list) else [self.values]
            made = []
            for item in items:
                row = {"id": str(uuid.uuid4()), "reminders": {}, "reschedule_count": 0, **item}
                if self.table == "bookings":
                    self.db.check_overlap(row)
                table.append(row)
                made.append(row)
            return SimpleNamespace(data=made)
        matched = [row for row in table if self._match(row)]
        if self.op == "update":
            for row in matched:
                if self.table == "bookings":
                    self.db.check_overlap({**row, **self.values})
                row.update(self.values)
            return SimpleNamespace(data=matched)
        if self.op == "delete":
            self.db.rows[self.table] = [row for row in table if row not in matched]
            return SimpleNamespace(data=matched)
        for column, desc in reversed(self.orders):
            matched.sort(key=lambda r: str(r.get(column) or ""), reverse=desc)
        return SimpleNamespace(data=[dict(r) for r in matched[: self.cap or None]])


class Db:
    def __init__(self):
        self.rows = {
            "fayfort_workers": [
                {"user_id": CEO, "status": "active", "staff_role": "ceo", "job_title": "Founder & CEO"},
                {"user_id": ASSISTANT, "status": "active", "staff_role": "assistant", "job_title": None},
                {"user_id": STAFF, "status": "active", "staff_role": "staff", "job_title": None},
            ],
            "booking_settings": [{"id": 1, **engine.DEFAULTS}],
            "staff_availability": [],
            "staff_time_off": [],
            "bookings": [],
            "member_profiles": [{"user_id": MEMBER, "display_name": "Ada"}],
            "email_outbox": [],
            "commerce_invoices": [],
            "member_consultations": [],
            "operations_work_items": [],
        }

    def check_overlap(self, row):
        if row.get("status") not in ("held", "confirmed"):
            return
        start, end = engine.parse(row["starts_at"]), engine.parse(row["blocked_until"])
        for other in self.rows["bookings"]:
            if other["id"] == row["id"] or other.get("status") not in ("held", "confirmed") or str(other["host_id"]) != str(row["host_id"]):
                continue
            if start < engine.parse(other["blocked_until"]) and engine.parse(other["starts_at"]) < end:
                raise RuntimeError('conflicting key value violates exclusion constraint "bookings_no_double_booking"')

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[]))

    def emails(self):
        return [r["template"] for r in self.rows["email_outbox"]]


def weekly(host, weekday, start, end, kinds=("consultation", "session")):
    return {"id": str(uuid.uuid4()), "worker_id": host, "weekday": weekday, "start_time": start, "end_time": end,
            "time_zone": "Asia/Shanghai", "kinds": list(kinds)}


class BookingTestCase(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.db.rows["staff_availability"] = [weekly(CEO, 2, "14:00", "18:00"), weekly(CEO, 3, "14:00", "16:00")]
        self.old_client = commerce_db.client
        commerce_db.client = self.db
        self.clock = patch("app.bookings.engine.now_utc", return_value=NOW)
        self.clock.start()
        self.people = patch("app.bookings.router._people", side_effect=lambda ids: {i: {"name": {CEO: "Fay", ASSISTANT: "Amaka"}.get(i, "Worker"), "photo_url": None, "first_name": "F"} for i in ids})
        self.people.start()

    def tearDown(self):
        self.clock.stop()
        self.people.stop()
        commerce_db.client = self.old_client

    def at(self, text):
        return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


class SlotTests(BookingTestCase):
    def test_slots_follow_hours_notice_and_gap(self):
        slots = engine.free_slots(CEO, "consultation", NOW, NOW + timedelta(days=7))
        starts = [s["starts_at"] for s in slots]
        # Wednesday 4 Nov 14:00-18:00 China = 06:00-10:00 UTC, 60 min sessions on the half hour.
        self.assertEqual(starts[:7], [f"2026-11-04T{t}:00+00:00" for t in ("06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00")])
        # Thursday 14:00-16:00 China: 06:00, 06:30, 07:00 UTC.
        self.assertIn("2026-11-05T07:00:00+00:00", starts)
        self.assertNotIn("2026-11-05T07:30:00+00:00", starts)
        self.assertEqual(len(slots), 10)

    def test_minimum_notice_hides_close_times(self):
        with patch("app.bookings.engine.now_utc", return_value=self.at("2026-11-03T08:00:00")):
            slots = engine.free_slots(CEO, "consultation", NOW, NOW + timedelta(days=3))
        self.assertEqual(slots[0]["starts_at"], "2026-11-04T08:00:00+00:00")

    def test_bookings_time_off_and_kinds_block_times(self):
        engine.hold(host_id=CEO, kind="consultation", member_id=MEMBER, starts=self.at("2026-11-04T07:00:00"))
        self.db.rows["staff_time_off"].append({"id": "t", "worker_id": CEO, "starts_at": "2026-11-05T00:00:00+00:00",
                                               "ends_at": "2026-11-06T00:00:00+00:00", "reason": "Travel"})
        starts = [s["starts_at"] for s in engine.free_slots(CEO, "consultation", NOW, NOW + timedelta(days=7))]
        # 07:00-08:00 booked plus a 15 min gap: 06:00 (ends 07:00 + gap overlaps) and 06:30, 07:30, 08:00 are blocked.
        self.assertEqual(starts, ["2026-11-04T08:30:00+00:00", "2026-11-04T09:00:00+00:00"])
        self.assertEqual(engine.free_slots(CEO, "tour", NOW, NOW + timedelta(days=7)), [])

    def test_save_availability_rejects_overlaps_and_bad_zone(self):
        with self.assertRaises(engine.BookingError):
            engine.save_availability(CEO, ASSISTANT, [{"weekday": 0, "start_time": "10:00", "end_time": "12:00"},
                                                      {"weekday": 0, "start_time": "11:00", "end_time": "13:00"}], "Asia/Shanghai")
        with self.assertRaises(engine.BookingError):
            engine.save_availability(CEO, ASSISTANT, [], "Mars/Base")
        saved = engine.save_availability(CEO, ASSISTANT, [{"weekday": 0, "start_time": "09:00", "end_time": "12:00"}], "Africa/Lagos")
        self.assertEqual([(r["weekday"], r["time_zone"]) for r in saved], [(0, "Africa/Lagos")])


class LifecycleTests(BookingTestCase):
    def hold(self, when="2026-11-04T07:00:00", member=MEMBER, **kw):
        return engine.hold(host_id=CEO, kind="consultation", member_id=member, starts=self.at(when),
                           member_time_zone="Africa/Lagos", **kw)

    def test_hold_then_double_booking_refused(self):
        booking = self.hold()
        self.assertEqual(booking["status"], "held")
        self.assertEqual(booking["hold_expires_at"], (NOW + timedelta(hours=24)).isoformat())
        with self.assertRaises(engine.SlotTaken):
            self.hold("2026-11-04T07:30:00", member=OTHER_MEMBER)
        with self.assertRaises(engine.BookingError):
            self.hold("2026-11-05T06:00:00")  # one hold per member
        with self.assertRaises(engine.SlotTaken):
            self.hold("2026-11-04T07:10:00", member=OTHER_MEMBER)  # not a listed slot

    def test_database_refusal_is_reported_as_taken(self):
        with patch("app.bookings.engine.is_free", return_value=True):
            self.hold()
            with self.assertRaises(engine.SlotTaken):
                self.hold(member=OTHER_MEMBER)

    def test_confirm_emails_with_both_time_zones(self):
        booking = engine.confirm(self.hold())
        self.assertEqual(booking["status"], "confirmed")
        payload = self.db.rows["email_outbox"][-1]["payload"]
        self.assertIn("Wed 4 Nov, 08:00 (Africa/Lagos) · 15:00 China time", payload["body"])
        self.assertEqual(engine.confirm(booking)["status"], "confirmed")

    def test_member_move_and_cancel_follow_the_24_hour_rule(self):
        booking = engine.confirm(self.hold())
        moved = engine.move(booking, self.at("2026-11-05T06:00:00"), by="member")
        self.assertEqual((moved["starts_at"], moved["reschedule_count"]), ("2026-11-05T06:00:00+00:00", 1))
        self.assertIn("commerce_booking_moved", self.db.emails())
        with patch("app.bookings.engine.now_utc", return_value=self.at("2026-11-04T08:00:00")):
            with self.assertRaises(engine.BookingError):
                engine.move(moved, self.at("2026-11-04T09:00:00"), by="member")
            with self.assertRaises(engine.BookingError):
                engine.cancel(moved, by="member")
        cancelled = engine.cancel(moved, by="member", reason="Travel")
        self.assertEqual((cancelled["status"], cancelled["refund"]), ("cancelled", "due"))
        self.assertIn("refund", self.db.rows["email_outbox"][-1]["payload"]["body"])
        self.assertEqual(engine.mark_refunded(cancelled)["refund"], "done")

    def test_member_move_limit_and_staff_override(self):
        booking = engine.confirm(self.hold())
        self.db.rows["booking_settings"][0]["max_member_moves"] = 1
        booking = engine.move(booking, self.at("2026-11-05T06:00:00"), by="member")
        with self.assertRaises(engine.BookingError):
            engine.move(booking, self.at("2026-11-04T08:00:00"), by="member")
        # Staff may fit it outside weekly hours, but not over blocked time.
        staff_moved = engine.move(booking, self.at("2026-11-06T02:00:00"), by="staff", reason="CEO asked")
        self.assertEqual(staff_moved["reschedule_count"], 1)
        self.db.rows["staff_time_off"].append({"id": "x", "worker_id": CEO, "starts_at": "2026-11-07T00:00:00+00:00",
                                               "ends_at": "2026-11-08T00:00:00+00:00"})
        with self.assertRaises(engine.SlotTaken):
            engine.move(staff_moved, self.at("2026-11-07T03:00:00"), by="staff")

    def test_staff_cancel_paid_with_or_without_refund(self):
        paid = engine.confirm(self.hold())
        self.assertEqual(engine.cancel(paid, by="staff", reason="CEO ill", refund=False)["refund"], "none")
        unpaid = self.hold("2026-11-05T06:00:00")
        self.assertIsNone(engine.cancel(unpaid, by="staff", reason="Duplicate")["refund"])

    def test_sweep_releases_holds_withdraws_invoice_and_reminds(self):
        self.db.rows["commerce_invoices"].append({"id": "inv1", "status": "sent", "shopify_draft_order_id": "gid://shopify/DraftOrder/1"})
        held = engine.attach(self.hold(), {"invoice_id": "inv1"})
        other = engine.confirm(self.hold("2026-11-05T06:00:00", member=OTHER_MEMBER))
        with patch("app.commerce.shopify.delete_draft_order") as delete:
            counts = engine.sweep(self.at("2026-11-04T06:30:00"))
        delete.assert_called_once_with("gid://shopify/DraftOrder/1")
        self.assertEqual(counts["expired"], 1)
        self.assertEqual(engine.get(held["id"])["status"], "cancelled")
        self.assertEqual(self.db.rows["commerce_invoices"][0]["status"], "cancelled")
        self.assertIn("commerce_booking_expired", self.db.emails())
        self.assertEqual(counts["reminded"], 1)
        self.assertEqual(engine.sweep(self.at("2026-11-04T06:40:00"))["reminded"], 0)
        self.assertEqual(engine.sweep(self.at("2026-11-05T05:10:00"))["reminded"], 1)  # the 1 hour one
        self.assertEqual(self.db.emails().count("commerce_booking_reminder_24h"), 1)
        self.assertEqual(self.db.emails().count("commerce_booking_reminder_1h"), 1)

    def test_finish_only_after_start(self):
        booking = engine.confirm(self.hold())
        with self.assertRaises(engine.BookingError):
            engine.finish(booking, "completed")
        with patch("app.bookings.engine.now_utc", return_value=self.at("2026-11-04T08:10:00")):
            self.assertEqual(engine.finish(booking, "no_show")["status"], "no_show")

    def test_paid_after_expiry_keeps_free_time_or_flags_refund(self):
        held = self.hold()
        released = engine.cancel(held, by="system")
        self.assertEqual(engine.paid_after_expiry(released)["status"], "confirmed")
        lost = engine.cancel(self.hold("2026-11-05T06:00:00", member=OTHER_MEMBER), by="system")
        self.hold("2026-11-05T06:00:00")
        flagged = engine.paid_after_expiry(lost)
        self.assertEqual((flagged["status"], flagged["refund"]), ("cancelled", "due"))

    def test_call_link_must_be_https_and_is_emailed(self):
        booking = engine.confirm(self.hold())
        with self.assertRaises(engine.BookingError):
            engine.update_details(booking, {"call_link": "http://meet.example"})
        updated = engine.update_details(booking, {"call_link": "https://meet.google.com/abc-defg-hij", "brief": " Wants Yiwu help "})
        self.assertEqual(updated["brief"], "Wants Yiwu help")
        self.assertIn("commerce_booking_link", self.db.emails())


class ApiTests(BookingTestCase):
    def setUp(self):
        super().setUp()
        tokens = {"ceo": {"user_id": CEO, "role": "worker"}, "assistant": {"user_id": ASSISTANT, "role": "worker"},
                  "staff": {"user_id": STAFF, "role": "worker"}, "admin": {"user_id": ADMIN, "role": "platform_admin"}}
        members = {"member": MEMBER, "other": OTHER_MEMBER}

        def member(header):
            token = (header or "").replace("Bearer ", "")
            if token not in members:
                from fastapi import HTTPException
                raise HTTPException(status_code=401, detail="Sign in")
            return members[token]

        app = FastAPI()
        app.include_router(create_bookings_router(member, lambda h: tokens.get((h or "").replace("Bearer ", "")),
                                                  lambda h: tokens.get("admin") if h == "Bearer admin" else None))
        self.client = TestClient(app)

    def h(self, who):
        return {"Authorization": f"Bearer {who}"}

    def test_member_sees_ceo_slots(self):
        body = self.client.get("/members/bookings/slots?from=2026-11-02&days=7", headers=self.h("member")).json()
        self.assertTrue(body["available"])
        self.assertEqual(body["host"]["job_title"], "Founder & CEO")
        self.assertEqual(body["slots"][0]["starts_at"], "2026-11-04T06:00:00+00:00")
        self.db.rows["fayfort_workers"][0]["status"] = "inactive"
        body = self.client.get("/members/bookings/slots", headers=self.h("member")).json()
        self.assertFalse(body["available"])

    def test_assistant_manages_ceo_calendar_staff_cannot(self):
        rules = {"time_zone": "Asia/Shanghai", "weekly": [{"weekday": 0, "start_time": "14:00", "end_time": "18:00", "kinds": ["consultation"]}]}
        self.assertEqual(self.client.put(f"/operations/availability/{CEO}", json=rules, headers=self.h("assistant")).status_code, 200)
        self.assertEqual(self.client.put(f"/operations/availability/{CEO}", json=rules, headers=self.h("staff")).status_code, 403)
        self.assertEqual(self.client.put(f"/operations/availability/{STAFF}", json=rules, headers=self.h("staff")).status_code, 200)
        self.assertEqual(self.client.put(f"/operations/availability/{STAFF}", json=rules, headers=self.h("assistant")).status_code, 403)
        off = self.client.post(f"/operations/availability/{CEO}/time-off", headers=self.h("assistant"),
                               json={"starts_at": "2026-11-09T00:00:00Z", "ends_at": "2026-11-10T00:00:00Z", "reason": "Fair"})
        self.assertEqual(off.status_code, 201, off.text)
        me = self.client.get("/operations/bookings/me", headers=self.h("assistant")).json()
        self.assertEqual([h["user_id"] for h in me["hosts"]], [CEO, ASSISTANT])
        self.assertTrue(me["sees_all"])

    def test_bookings_list_visibility_and_actions(self):
        booking = engine.confirm(engine.hold(host_id=CEO, kind="consultation", member_id=MEMBER, starts=self.at("2026-11-04T07:00:00"), topic="Yiwu"))
        listed = self.client.get("/operations/bookings?view=upcoming", headers=self.h("assistant")).json()["bookings"]
        self.assertEqual(listed[0]["member_name"], "Ada")
        self.assertIn("call_link", listed[0]["needs"])
        self.assertEqual(self.client.get("/operations/bookings?view=upcoming", headers=self.h("staff")).json()["bookings"], [])
        self.assertEqual(self.client.get(f"/operations/bookings/{booking['id']}", headers=self.h("staff")).status_code, 404)
        self.assertEqual(len(self.client.get("/operations/bookings?view=needs_action", headers=self.h("ceo")).json()["bookings"]), 1)
        link = self.client.put(f"/operations/bookings/{booking['id']}/details", headers=self.h("assistant"),
                               json={"call_link": "https://meet.google.com/x", "brief": "First import"})
        self.assertEqual(link.status_code, 200, link.text)
        note = self.client.put(f"/operations/bookings/{booking['id']}/details", headers=self.h("staff"), json={"host_note": "x"})
        self.assertEqual(note.status_code, 404)
        no_choice = self.client.post(f"/operations/bookings/{booking['id']}/cancel", headers=self.h("assistant"), json={"reason": "Ill"})
        self.assertEqual(no_choice.status_code, 409)
        done = self.client.post(f"/operations/bookings/{booking['id']}/cancel", headers=self.h("assistant"), json={"reason": "Ill", "refund": True})
        self.assertEqual(done.json()["booking"]["refund"], "due")
        self.assertEqual(self.client.post(f"/operations/bookings/{booking['id']}/refunded", headers=self.h("ceo")).status_code, 403)
        self.assertEqual(self.client.post(f"/operations/bookings/{booking['id']}/refunded", headers=self.h("assistant")).status_code, 200)

    def test_member_routes_only_touch_own_bookings(self):
        booking = engine.confirm(engine.hold(host_id=CEO, kind="consultation", member_id=MEMBER, starts=self.at("2026-11-04T07:00:00")))
        engine.update_details(booking, {"brief": "internal", "call_link": "https://meet.google.com/x"})
        mine = self.client.get("/members/bookings", headers=self.h("member")).json()["bookings"]
        self.assertEqual(mine[0]["call_link"], "https://meet.google.com/x")
        self.assertNotIn("brief", mine[0])
        self.assertEqual(self.client.post(f"/members/bookings/{booking['id']}/cancel", json={}, headers=self.h("other")).status_code, 404)
        moved = self.client.post(f"/members/bookings/{booking['id']}/move", json={"starts_at": "2026-11-05T06:00:00Z"}, headers=self.h("member"))
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertEqual(moved.json()["booking"]["reschedule_count"], 1)

    def test_settings_admin_only(self):
        self.assertEqual(self.client.put("/platform/bookings/settings", json={"hold_hours": 12}, headers=self.h("assistant")).status_code, 403)
        saved = self.client.put("/platform/bookings/settings", json={"hold_hours": 12}, headers=self.h("admin")).json()
        self.assertEqual(saved["settings"]["hold_hours"], 12)


class ConsultationTests(BookingTestCase):
    def test_book_with_time_holds_then_payment_confirms(self):
        from app.membership import service
        quote = {"tier": "standard", "price": 85.0, "currency": "USD", "included": False, "first_month": False}
        invoice = {"id": "inv9", "invoice_url": "https://pay.example/inv9"}
        with patch("app.membership.service.plans.consultation_quote", return_value=quote), \
                patch("app.membership.service.commerce.send_invoice", return_value=invoice) as send, \
                patch("app.membership.ranks.safe_recompute"):
            booked = service.book_consultation(MEMBER, "Help with Yiwu markets", "2026-11-04T07:00:00Z", "Africa/Lagos")
            self.assertEqual(booked["booking"]["status"], "held")
            self.assertEqual(send.call_args.kwargs["details"]["booking_id"], booked["booking"]["id"])
            booking = engine.get(booked["booking"]["id"])
            self.assertEqual((booking["invoice_id"], booking["source_table"]), ("inv9", "member_consultations"))
            # Someone else can't take that time now.
            with self.assertRaises(service.MembershipError):
                service.book_consultation(OTHER_MEMBER, "Another topic", "2026-11-04T07:00:00Z")
            self.db.rows["member_conversations"] = []
            self.db.rows["member_messages"] = []
            self.db.rows["commerce_invoices"].append({"id": "inv9", "kind": "consultation", "member_id": MEMBER})
            service.invoice_paid({"id": "inv9", "kind": "consultation", "member_id": MEMBER, "details": {}})
        self.assertEqual(engine.get(booked["booking"]["id"])["status"], "confirmed")
        consultation = self.db.rows["member_consultations"][0]
        self.assertEqual(consultation["status"], "scheduled")
        reply = self.db.rows["member_messages"][-1]["content"]
        self.assertIn("booked for Wed 4 Nov, 08:00 (Africa/Lagos)", reply)

    def test_no_ceo_means_no_times(self):
        from app.membership import service
        self.db.rows["fayfort_workers"][0]["staff_role"] = "staff"
        with patch("app.membership.service.plans.consultation_quote", return_value={"tier": "free", "price": 100.0, "currency": "USD", "included": False}):
            with self.assertRaises(service.MembershipError):
                service.book_consultation(MEMBER, "Topic here", "2026-11-04T07:00:00Z")


if __name__ == "__main__":
    unittest.main()
