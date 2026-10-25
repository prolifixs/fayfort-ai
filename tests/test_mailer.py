from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.mailer import render, resend_client, sender
from app.mailer.router import create_email_router
from app.mailer.subscribers import create_public_newsletter_router

ADMIN = "00000000-0000-0000-0000-0000000000a1"
MEMBER = "00000000-0000-0000-0000-0000000000c1"
OTHER = "00000000-0000-0000-0000-0000000000c2"
WORKER = "00000000-0000-0000-0000-0000000000b1"
TOKEN = "11111111-2222-3333-4444-555555555555"
AUTH = {"Authorization": "Bearer admin-token"}


class Query:
    def __init__(self, db: "Db", table: str):
        self.db, self.table, self.filters, self.single, self.op, self.values = db, table, [], False, "select", None
        self.on_conflict = None

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, c, v): self.filters.append((c, "eq", v)); return self
    def neq(self, c, v): self.filters.append((c, "neq", v)); return self
    def gte(self, c, v): self.filters.append((c, "gte", v)); return self
    def in_(self, c, v): self.filters.append((c, "in", list(v))); return self
    def maybe_single(self): self.single = True; return self

    def update(self, values): self.op, self.values = "update", values; return self
    def insert(self, values): self.op, self.values = "insert", values; return self

    def upsert(self, values, on_conflict=None, ignore_duplicates=False):
        self.op, self.values, self.on_conflict = "upsert", values, on_conflict
        return self

    def _match(self, row):
        for c, op, v in self.filters:
            value = row.get(c)
            if op == "eq" and str(value) != str(v): return False
            if op == "neq" and str(value) == str(v): return False
            if op == "gte" and (value is None or str(value) < str(v)): return False
            if op == "in" and str(value) not in [str(x) for x in v]: return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == "select":
            found = [r for r in rows if self._match(r)]
            return SimpleNamespace(data=(found[0] if found else None) if self.single else found)
        if self.op == "update":
            changed = [r for r in rows if self._match(r)]
            for r in changed:
                r.update(self.values)
            self.db.writes.append((self.table, "update", self.values))
            return SimpleNamespace(data=changed)
        items = self.values if isinstance(self.values, list) else [self.values]
        out = []
        for item in items:
            item = dict(item)
            key = self.on_conflict.split(",") if self.on_conflict else None
            existing = next((r for r in rows if key and all(str(r.get(k)) == str(item.get(k)) for k in key)), None)
            if existing:
                if self.op == "upsert" and self.table != "email_outbox":
                    existing.update(item)
                out.append(existing)
                continue
            item.setdefault("id", str(uuid.uuid4()))
            if self.table == "member_email_preferences":
                for c in ("conversations", "fulfillment", "notifications", "newsletter"):
                    item.setdefault(c, True)
                item.setdefault("unsubscribe_token", TOKEN)
            if self.table == "newsletters":
                item.setdefault("status", "draft")
            if self.table == "newsletter_subscribers":
                item.setdefault("status", "pending")
                item.setdefault("confirm_token", str(uuid.uuid4()))
                item.setdefault("unsubscribe_token", str(uuid.uuid4()))
            if self.table == "email_outbox":
                item.setdefault("status", "queued")
            rows.append(item)
            out.append(item)
        self.db.writes.append((self.table, self.op, self.values))
        return SimpleNamespace(data=out)


class Db:
    def __init__(self, rows=None):
        self.rows, self.writes = rows or {}, []
        self.client = MagicMock()
        self.client.table.side_effect = lambda name: Query(self, name)

    def audit(self):
        return [v["action"] for t, op, v in self.writes if t == "email_admin_audit"]


def user(uid, email, confirmed=True, admin=False):
    return SimpleNamespace(id=uid, email=email, email_confirmed_at="2026-10-01T00:00:00Z" if confirmed else None,
                           app_metadata={"platform_admin": True} if admin else {})


class RenderTests(unittest.TestCase):
    def test_newsletter_body_is_escaped_paragraphed_and_linked(self):
        html = render.text_to_html_paragraphs("Hello <b>team</b>\nline two\n\nVisit https://fayfort.com/ebook/landed now")
        self.assertIn("&lt;b&gt;team&lt;/b&gt;", html)
        self.assertIn("line two", html)
        self.assertIn("<br>", html)
        self.assertEqual(html.count("<p "), 2)
        self.assertIn('<a href="https://fayfort.com/ebook/landed"', html)

    def test_notification_emails_have_subject_button_and_unsubscribe(self):
        email = render.notification_email(category="fulfillment", title="Desk lamp", body="Item shipped — tracking soon",
                                          url="https://app.fayfort.com/member/products", unsubscribe_url="https://u/x")
        self.assertEqual(email.subject, "Update on your request: Desk lamp")
        self.assertIn("Item shipped", email.html)
        self.assertIn("View your request", email.html)
        self.assertIn("Unsubscribe", email.html)
        self.assertIn("https://app.fayfort.com/member/products", email.text)
        reply = render.notification_email(category="conversations", title="A FayFort worker replied", body="Lamp chat",
                                          url="https://a/member/chat", unsubscribe_url=None)
        self.assertEqual(reply.subject, "FayFort replied to you")
        self.assertNotIn("Unsubscribe", reply.html)


class ResendClientTests(unittest.TestCase):
    def client(self, status, body):
        return httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)))

    def test_success_returns_message_id_and_sends_expected_payload(self):
        seen = {}

        def handler(request):
            seen["auth"] = request.headers["Authorization"]
            seen["body"] = request.read()
            seen["idem"] = request.headers.get("Idempotency-Key")
            return httpx.Response(200, json={"id": "msg_1"})

        with patch.object(resend_client.settings, "RESEND_API_KEY", "re_test"):
            message = resend_client.send_email(to="a@b.c", subject="S", html="<p>h</p>", text="h",
                                               idempotency_key="k1", client=httpx.Client(transport=httpx.MockTransport(handler)))
        self.assertEqual(message, "msg_1")
        self.assertEqual(seen["auth"], "Bearer re_test")
        self.assertEqual(seen["idem"], "k1")
        self.assertIn(b'"to":["a@b.c"]', seen["body"].replace(b" ", b""))

    def test_rate_limits_retry_but_validation_errors_do_not(self):
        with patch.object(resend_client.settings, "RESEND_API_KEY", "re_test"):
            with self.assertRaises(resend_client.EmailSendError) as limited:
                resend_client.send_email(to="a@b.c", subject="S", html="h", text="h", client=self.client(429, {"message": "slow"}))
            self.assertTrue(limited.exception.retryable)
            with self.assertRaises(resend_client.EmailSendError) as invalid:
                resend_client.send_email(to="a@b.c", subject="S", html="h", text="h", client=self.client(422, {"message": "bad from"}))
            self.assertFalse(invalid.exception.retryable)

    def test_nothing_is_sent_without_a_key(self):
        with patch.object(resend_client.settings, "RESEND_API_KEY", ""):
            with self.assertRaises(resend_client.EmailSendError) as missing:
                resend_client.send_email(to="a@b.c", subject="S", html="h", text="h")
        self.assertFalse(missing.exception.retryable)


class SenderTests(unittest.TestCase):
    def setUp(self):
        self.db = Db({
            "member_email_preferences": [],
            "email_outbox": [],
            "email_category_settings": [{"category": c, "enabled": True} for c in sender.CATEGORIES],
        })
        self.db.client.auth.admin.get_user_by_id.side_effect = lambda uid: SimpleNamespace(
            user=user(uid, "member@example.com", confirmed=uid == MEMBER))
        self.patch = patch("app.mailer.sender.supabase", self.db.client)
        self.patch.start()
        self.project = patch("app.mailer.sender._project_notifications", return_value=[{
            "title": "Desk lamp", "body": "Item shipped", "href": "/member/products#request-1"}])
        self.project.start()
        self.sent = []

    def tearDown(self):
        self.patch.stop()
        self.project.stop()

    def send(self, **kwargs):
        self.sent.append(kwargs)
        return "msg_1"

    def row(self, **overrides):
        row = {"id": str(uuid.uuid4()), "category": "fulfillment", "template": "request_milestone", "member_id": MEMBER,
               "notification_id": "n1", "attempts": 1, "status": "sending"}
        row.update(overrides)
        self.db.rows["email_outbox"].append(row)
        self.db.rows.setdefault("member_notifications", []).append({"id": "n1", "member_id": MEMBER})
        return row

    def switches(self, **off):
        return {c: off.get(c, True) for c in sender.CATEGORIES}

    def test_sends_with_unsubscribe_headers_and_records_the_result(self):
        row = self.row()
        with patch.object(sender.settings, "PUBLIC_API_URL", "https://api.fayfort.com"):
            status = sender.deliver(row, switches=self.switches(), send=self.send)
        self.assertEqual(status, "sent")
        self.assertEqual(self.sent[0]["to"], "member@example.com")
        self.assertEqual(self.sent[0]["subject"], "Update on your request: Desk lamp")
        self.assertIn("List-Unsubscribe", self.sent[0]["headers"])
        self.assertIn(f"token={TOKEN}", self.sent[0]["headers"]["List-Unsubscribe"])
        self.assertEqual(row["status"], "sent")
        self.assertEqual(row["provider_message_id"], "msg_1")

    def test_category_switch_and_member_preference_skip_without_sending(self):
        row = self.row()
        self.assertEqual(sender.deliver(row, switches=self.switches(fulfillment=False), send=self.send), "skipped")
        self.assertIn("switched off", row["skip_reason"])
        self.db.rows["member_email_preferences"].append({"member_id": MEMBER, "fulfillment": False, "unsubscribe_token": TOKEN})
        row2 = self.row()
        self.assertEqual(sender.deliver(row2, switches=self.switches(), send=self.send), "skipped")
        self.assertIn("member turned", row2["skip_reason"])
        self.assertEqual(self.sent, [])

    def test_alerts_that_waited_over_a_day_are_not_sent_late(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
        row = self.row(created_at=old)
        self.assertEqual(sender.deliver(row, switches=self.switches(), send=self.send), "skipped")
        self.assertIn("older than 24 hours", row["skip_reason"])
        self.assertEqual(self.sent, [])

    def test_unconfirmed_member_is_never_emailed(self):
        row = self.row(member_id=OTHER)
        self.assertEqual(sender.deliver(row, switches=self.switches(), send=self.send), "skipped")
        self.assertEqual(row["skip_reason"], "no confirmed email address")

    def test_conversation_emails_are_coalesced_for_15_minutes(self):
        recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        self.db.rows["email_outbox"].append({"id": "earlier", "member_id": MEMBER, "category": "conversations",
                                             "status": "sent", "sent_at": recent})
        row = self.row(category="conversations", template="worker_reply")
        self.assertEqual(sender.deliver(row, switches=self.switches(), send=self.send), "skipped")
        self.assertTrue(row["skip_reason"].startswith("coalesced"))

    def test_retryable_errors_back_off_then_fail(self):
        def fail(**_k):
            raise resend_client.EmailSendError("Resend 429", retryable=True)

        row = self.row(attempts=1)
        self.assertEqual(sender.deliver(row, switches=self.switches(), send=fail), "queued")
        self.assertEqual(row["status"], "queued")
        self.assertGreater(row["next_attempt_at"], datetime.now(timezone.utc).isoformat())
        last = self.row(attempts=sender.MAX_ATTEMPTS)
        self.assertEqual(sender.deliver(last, switches=self.switches(), send=fail), "failed")

    def test_security_email_sends_now_and_drops_the_secret_link(self):
        rendered = render.staff_password_reset_email(action_link="https://x/verify?token=secret")
        sender.send_immediately(to="w@example.com", rendered=rendered, send=self.send)
        row = self.db.rows["email_outbox"][0]
        self.assertEqual(row["status"], "sent")
        self.assertEqual(row["payload"], {})
        self.assertIn("token=secret", self.sent[0]["html"])


class EmailApiTests(unittest.TestCase):
    def setUp(self):
        self.db = Db({
            "email_category_settings": [{"category": c, "enabled": True} for c in sender.CATEGORIES],
            "email_outbox": [{"id": "e1", "category": "fulfillment", "status": "failed", "member_id": MEMBER,
                              "created_at": datetime.now(timezone.utc).isoformat()}],
            "newsletters": [], "member_email_preferences": [],
            "fayfort_workers": [{"user_id": WORKER}],
            "newsletter_subscribers": [],
        })
        users = [user(ADMIN, "admin@example.com", admin=True), user(MEMBER, "m@example.com"),
                 user(OTHER, "o@example.com"), user(WORKER, "w@example.com"),
                 user("00000000-0000-0000-0000-0000000000c3", "new@example.com", confirmed=False)]
        self.db.client.auth.admin.list_users.return_value = users
        self.db.client.auth.admin.get_user_by_id.side_effect = lambda uid: SimpleNamespace(
            user=next((u for u in users if u.id == uid), None))
        self.patches = [
            patch("app.mailer.router.supabase", self.db.client),
            patch("app.mailer.sender.supabase", self.db.client),
            patch("app.mailer.subscribers.supabase", self.db.client),
            patch("app.mailer.router.trusted_platform_admin",
                  side_effect=lambda h: {"user_id": ADMIN} if h == "Bearer admin-token" else None),
        ]
        for p in self.patches:
            p.start()
        app = FastAPI()
        app.include_router(create_email_router())
        app.include_router(create_public_newsletter_router())
        self.client = TestClient(app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_admin_routes_reject_non_admins(self):
        for method, path, body in [("get", "/platform/email/overview", None), ("get", "/platform/email/log", None),
                                   ("put", "/platform/email/categories/newsletter", {"enabled": False}),
                                   ("post", "/platform/newsletters", {"subject": "s", "body_text": "b"})]:
            response = getattr(self.client, method)(path, headers={"Authorization": "Bearer member"},
                                                     **({"json": body} if body else {}))
            self.assertEqual(response.status_code, 403, path)

    def test_overview_shows_switches_counts_and_delivery_status(self):
        body = self.client.get("/platform/email/overview", headers=AUTH).json()
        categories = {c["category"]: c for c in body["categories"]}
        self.assertTrue(categories["account_security"]["locked"])
        self.assertEqual(categories["fulfillment"]["last_7_days"]["failed"], 1)
        self.assertIn("configured", body["delivery"])

    def test_switching_a_category_is_saved_and_audited_but_security_is_locked(self):
        response = self.client.put("/platform/email/categories/newsletter", headers=AUTH, json={"enabled": False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(next(r for r in self.db.rows["email_category_settings"] if r["category"] == "newsletter")["enabled"])
        self.assertEqual(self.db.audit(), ["category_disabled"])
        self.assertEqual(self.client.put("/platform/email/categories/account_security", headers=AUTH,
                                         json={"enabled": False}).status_code, 409)

    def test_log_lists_recipients_and_retries_only_failed_emails(self):
        emails = self.client.get("/platform/email/log", headers=AUTH).json()["emails"]
        self.assertEqual(emails[0]["recipient"], "m@example.com")
        self.assertEqual(self.client.post("/platform/email/log/00000000-0000-0000-0000-0000000000e1/retry",
                                          headers=AUTH).status_code, 404)
        self.db.rows["email_outbox"][0]["id"] = "00000000-0000-0000-0000-0000000000e1"
        self.assertEqual(self.client.post("/platform/email/log/00000000-0000-0000-0000-0000000000e1/retry",
                                          headers=AUTH).status_code, 200)
        self.assertEqual(self.db.rows["email_outbox"][0]["status"], "queued")
        self.assertEqual(self.client.post("/platform/email/log/00000000-0000-0000-0000-0000000000e1/retry",
                                          headers=AUTH).status_code, 409)

    def test_newsletter_goes_once_to_confirmed_non_staff_subscribers(self):
        letter = self.client.post("/platform/newsletters", headers=AUTH,
                                  json={"subject": "October update", "body_text": "Hello members"}).json()["newsletter"]
        self.db.rows["member_email_preferences"].append({"member_id": OTHER, "newsletter": False, "unsubscribe_token": TOKEN})
        with patch("app.mailer.router.settings.EMAIL_DELIVERY_ENABLED", False):
            self.assertEqual(self.client.post(f"/platform/newsletters/{letter['id']}/send", headers=AUTH).status_code, 409)
        with patch("app.mailer.router.settings.EMAIL_DELIVERY_ENABLED", True), \
                patch("app.mailer.router.delivery_configured", return_value=True):
            sent = self.client.post(f"/platform/newsletters/{letter['id']}/send", headers=AUTH)
            self.assertEqual(sent.status_code, 200)
            self.assertEqual(sent.json(), {"recipients": 1, "members": 1, "visitors": 0})
            queued = [r for r in self.db.rows["email_outbox"] if r.get("newsletter_id") == letter["id"]]
            self.assertEqual([r["member_id"] for r in queued], [MEMBER])
            self.assertEqual(self.client.post(f"/platform/newsletters/{letter['id']}/send", headers=AUTH).status_code, 409)
        self.assertEqual(self.client.put(f"/platform/newsletters/{letter['id']}", headers=AUTH,
                                         json={"subject": "x", "body_text": "y"}).status_code, 409)
        self.assertIn("newsletter_sent", self.db.audit())

    def test_visitor_signs_up_confirms_gets_the_newsletter_and_unsubscribes(self):
        signed = self.client.post("/public/newsletter/subscribe", json={"email": " Visitor@Example.com ", "source": "site_popup"})
        self.assertEqual(signed.status_code, 202, signed.text)
        [subscriber] = self.db.rows["newsletter_subscribers"]
        self.assertEqual((subscriber["email"], subscriber["status"], subscriber["source"]), ("visitor@example.com", "pending", "site_popup"))
        [confirm_mail] = [r for r in self.db.rows["email_outbox"] if r.get("template") == "newsletter_confirm"]
        self.assertEqual(confirm_mail["to_email"], "visitor@example.com")
        self.assertIn(f"newsletter?confirm={subscriber['confirm_token']}", confirm_mail["payload"]["html"])
        # Signing up again within minutes doesn't send a second confirmation, and the answer is the same.
        self.assertEqual(self.client.post("/public/newsletter/subscribe", json={"email": "visitor@example.com"}).status_code, 202)
        self.assertEqual(len([r for r in self.db.rows["email_outbox"] if r.get("template") == "newsletter_confirm"]), 1)
        self.assertEqual(self.client.post("/public/newsletter/subscribe", json={"email": "not-an-email"}).status_code, 422)
        self.assertEqual(self.client.post("/public/newsletter/confirm", json={"token": str(uuid.uuid4())}).status_code, 404)
        self.assertEqual(self.client.post("/public/newsletter/confirm", json={"token": subscriber["confirm_token"]}).status_code, 200)
        self.assertEqual(subscriber["status"], "confirmed")
        # A member who also subscribed as a visitor gets the member copy only.
        self.db.rows["newsletter_subscribers"].append({"id": "s2", "email": "m@example.com", "status": "confirmed",
                                                       "unsubscribe_token": str(uuid.uuid4())})
        letter = self.client.post("/platform/newsletters", headers=AUTH,
                                  json={"subject": "Finds", "body_text": "New this week"}).json()["newsletter"]
        preview = self.client.get(f"/platform/newsletters/{letter['id']}/preview", headers=AUTH).json()
        self.assertEqual((preview["members"], preview["visitors"]), (2, 1))
        with patch("app.mailer.router.settings.EMAIL_DELIVERY_ENABLED", True), \
                patch("app.mailer.router.delivery_configured", return_value=True), \
                patch("app.mailer.subscribers.settings.PUBLIC_API_URL", "https://api.fayfort.com"):
            sent = self.client.post(f"/platform/newsletters/{letter['id']}/send", headers=AUTH).json()
        self.assertEqual(sent, {"recipients": 3, "members": 2, "visitors": 1})
        [visitor_copy] = [r for r in self.db.rows["email_outbox"] if r.get("template") == "newsletter_visitor"]
        self.assertEqual(visitor_copy["to_email"], "visitor@example.com")
        self.assertIn(f"newsletter?unsubscribe={subscriber['unsubscribe_token']}", visitor_copy["payload"]["html"])
        self.assertIn("subscribed to the FayFort newsletter", visitor_copy["payload"]["text"])
        self.assertTrue(visitor_copy["payload"]["headers"]["List-Unsubscribe"].startswith("<https://api.fayfort.com/public/newsletter/unsubscribe/one-click?token="))
        listed = self.client.get("/platform/newsletters", headers=AUTH).json()
        self.assertEqual(listed["visitor_subscribers"]["confirmed"], 2)
        self.assertEqual(self.client.post("/public/newsletter/unsubscribe", json={"token": subscriber["unsubscribe_token"]}).status_code, 200)
        self.assertEqual(subscriber["status"], "unsubscribed")

    def test_visitor_newsletter_rows_carry_their_unsubscribe_headers(self):
        sent = []
        row = {"id": "v1", "category": "newsletter", "to_email": "v@example.com", "attempts": 1,
               "payload": {"subject": "S", "html": "<p>x</p>", "text": "x",
                           "headers": {"List-Unsubscribe": "<https://a/b>", "X-Evil": "1"}}}
        self.db.rows["email_outbox"].append(row)
        sender.deliver(row, switches={c: True for c in sender.CATEGORIES},
                       send=lambda **kw: sent.append(kw) or "msg")
        self.assertEqual(sent[0]["headers"], {"List-Unsubscribe": "<https://a/b>"})

    def test_newsletter_test_goes_to_the_admin_only(self):
        letter = self.client.post("/platform/newsletters", headers=AUTH,
                                  json={"subject": "Hi", "body_text": "Body"}).json()["newsletter"]
        with patch("app.mailer.router.send_email", return_value="msg") as send:
            response = self.client.post(f"/platform/newsletters/{letter['id']}/test", headers=AUTH)
        self.assertEqual(response.json(), {"sent_to": "admin@example.com"})
        self.assertEqual(send.call_args.kwargs["to"], "admin@example.com")
        self.assertTrue(send.call_args.kwargs["subject"].startswith("[Test]"))

    def test_member_preferences_and_unsubscribe_links(self):
        with patch("app.directory.identity.trusted_user_id", return_value=MEMBER):
            prefs = self.client.get("/members/me/email-preferences", headers={"Authorization": "Bearer m"}).json()
            self.assertEqual(prefs["preferences"], {"conversations": True, "fulfillment": True, "notifications": True, "newsletter": True})
            changed = self.client.put("/members/me/email-preferences", headers={"Authorization": "Bearer m"},
                                      json={"conversations": False}).json()
            self.assertFalse(changed["preferences"]["conversations"])
        response = self.client.post("/email/unsubscribe", json={"token": TOKEN, "category": "newsletter"})
        self.assertEqual(response.json(), {"unsubscribed": ["newsletter"]})
        self.assertFalse(self.db.rows["member_email_preferences"][0]["newsletter"])
        unknown = self.client.post("/email/unsubscribe", json={"token": str(uuid.uuid4()), "category": "all"})
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(self.client.post(f"/email/unsubscribe/one-click?token={TOKEN}&category=fulfillment").status_code, 200)
        self.assertFalse(self.db.rows["member_email_preferences"][0]["fulfillment"])
        self.assertEqual(self.client.post("/email/unsubscribe", json={"token": "not-a-token", "category": "all"}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
