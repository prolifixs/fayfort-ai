"""Staff roles and invitations for existing accounts (app/workforce/onboarding.py)."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.workforce import onboarding
from app.workforce.router import create_workforce_router

ADMIN = "00000000-0000-0000-0000-0000000000a1"
MEMBER = "00000000-0000-0000-0000-0000000000c1"
OTHER = "00000000-0000-0000-0000-0000000000c2"
CEO = "00000000-0000-0000-0000-0000000000c3"
NEW = "00000000-0000-0000-0000-0000000000d1"
AUTH = {"Authorization": "Bearer admin-token"}


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.single, self.op, self.values = db, table, [], False, "select", None

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, column, value):
        self.filters.append((column, [str(value)]))
        return self

    def in_(self, column, values):
        self.filters.append((column, [str(v) for v in values]))
        return self

    def maybe_single(self):
        self.single = True
        return self

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
        return all(str(row.get(column)) in allowed for column, allowed in self.filters)

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == "insert":
            if self.db.fail_insert:
                raise RuntimeError(self.db.fail_insert)
            self.db.writes.append((self.table, "insert", self.values))
            rows.append(dict(self.values))
            return SimpleNamespace(data=[self.values])
        matched = [row for row in rows if self._match(row)]
        if self.op == "update":
            self.db.writes.append((self.table, "update", self.values))
            for row in matched:
                row.update(self.values)
        elif self.op == "delete":
            self.db.writes.append((self.table, "delete", None))
            self.db.rows[self.table] = [row for row in rows if row not in matched]
        if self.single:
            return SimpleNamespace(data=matched[0] if matched else None)
        return SimpleNamespace(data=matched)


class Db:
    def __init__(self):
        self.rows = {"fayfort_workers": [], "workforce_audit": []}
        self.writes, self.rpcs, self.accounts, self.fail_insert, self.accept_error = [], [], [], None, None
        self.client = MagicMock()
        self.client.table.side_effect = lambda name: Query(self, name)
        self.client.rpc.side_effect = self.rpc

    def rpc(self, name, params):
        self.rpcs.append((name, params))

        def run():
            if name == "search_accounts_for_staff":
                needle = params["p_query"].casefold()
                return SimpleNamespace(data=[a for a in self.accounts if needle in a["email"]])
            if name == "accept_staff_invitation":
                if self.accept_error:
                    raise RuntimeError(self.accept_error)
                row = next((r for r in self.rows["fayfort_workers"] if r.get("invite_token_hash") == params["p_token_hash"]), None)
                if not row:
                    raise RuntimeError("invitation_not_found")
                if row["user_id"] != params["p_user_id"]:
                    raise RuntimeError("invitation_other_account")
                row.update({"status": "active", "invite_token_hash": None})
                return SimpleNamespace(data={"staff_role": row["staff_role"], "provisioned_by": row["provisioned_by"]})
            return SimpleNamespace(data=[])
        return SimpleNamespace(execute=run)


def user(email, confirmed=True, name=None):
    return SimpleNamespace(user=SimpleNamespace(id=None, email=email, user_metadata={"full_name": name} if name else {},
                                                email_confirmed_at="2026-10-01T00:00:00Z" if confirmed else None,
                                                banned_until=None, factors=[], last_sign_in_at=None))


class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.db.accounts = [
            {"user_id": MEMBER, "email": "ada@example.com", "display_name": "Ada", "email_confirmed": True, "banned": False,
             "staff_status": None},
            {"user_id": OTHER, "email": "unverified@example.com", "email_confirmed": False, "banned": False, "staff_status": None},
        ]
        self.users = {ADMIN: user("boss@example.com", name="Favour"), MEMBER: user("ada@example.com"),
                      OTHER: user("unverified@example.com", confirmed=False), CEO: user("ceo@example.com", name="Fay")}
        self.db.client.auth.admin.get_user_by_id.side_effect = lambda uid: self.users.get(uid, SimpleNamespace(user=None))
        self.db.client.auth.admin.invite_user_by_email.return_value = SimpleNamespace(user=SimpleNamespace(id=NEW))
        self.sent = []
        self.patches = [
            patch("app.workforce.onboarding.supabase", self.db.client),
            patch("app.workforce.router.supabase", self.db.client),
            patch("app.workforce.audit.supabase", self.db.client),
            patch("app.workforce.onboarding.send_immediately", side_effect=lambda **kw: self.sent.append(kw)),
            patch("app.workforce.onboarding.trusted_platform_admin",
                  side_effect=lambda h: {"user_id": ADMIN} if h == "Bearer admin-token" else None),
            patch("app.workforce.router.trusted_platform_admin",
                  side_effect=lambda h: {"user_id": ADMIN} if h == "Bearer admin-token" else None),
            patch("app.workforce.onboarding.trusted_user_id",
                  side_effect=lambda h: {"Bearer member-token": MEMBER, "Bearer other-token": OTHER}.get(h)),
        ]
        for item in self.patches:
            item.start()
        app = FastAPI()
        app.include_router(onboarding.create_onboarding_router())
        app.include_router(create_workforce_router())
        self.client = TestClient(app)

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def worker(self, user_id):
        return next((r for r in self.db.rows["fayfort_workers"] if r["user_id"] == user_id), None)

    def audits(self):
        return [v["action"] for t, op, v in self.db.writes if t == "workforce_audit" and op == "insert"]

    def token_from_email(self):
        link = self.sent[-1]["rendered"].text.split("/staff/join?token=")[1].split()[0]
        return link

    def test_admin_only(self):
        self.assertEqual(self.client.get("/platform/staff/candidates?q=ada", headers={"Authorization": "Bearer x"}).status_code, 403)
        response = self.client.post("/platform/staff/invitations", json={"email": "ada@example.com"},
                                    headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.db.writes, [])

    def test_search_marks_who_can_be_invited(self):
        self.db.accounts.append({"user_id": CEO, "email": "ada.staff@example.com", "email_confirmed": True, "banned": False,
                                 "staff_status": "active", "staff_role": "ceo"})
        accounts = self.client.get("/platform/staff/candidates?q=ada", headers=AUTH).json()["accounts"]
        by_id = {a["user_id"]: a for a in accounts}
        self.assertTrue(by_id[MEMBER]["eligible"])
        self.assertEqual(by_id[CEO]["reason"], "Already on the team")
        self.assertEqual(self.client.get("/platform/staff/candidates?q=ad", headers=AUTH).status_code, 422)

    def test_existing_account_invited_by_link_then_accepts(self):
        response = self.client.post("/platform/staff/invitations", headers=AUTH, json={
            "user_id": MEMBER, "staff_role": "assistant", "departments": ["member_support", "member_support"]})
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()["invitation"]
        self.assertEqual((body["kind"], body["status"], body["staff_role"]), ("existing_account", "invited", "assistant"))
        row = self.worker(MEMBER)
        self.assertEqual(row["pending_departments"], ["member_support"])
        self.assertEqual(len(row["invite_token_hash"]), 64)
        self.db.client.auth.admin.invite_user_by_email.assert_not_called()
        self.assertEqual(self.sent[-1]["to"], "ada@example.com")
        self.assertIn("personal assistant to the CEO", self.sent[-1]["rendered"].text)
        self.assertIn("Favour invited you", self.sent[-1]["rendered"].text)
        token = self.token_from_email()
        self.assertNotIn(token, str(self.db.writes))  # only the hash is stored

        preview = self.client.get(f"/staff/invitations/{token}").json()["invitation"]
        self.assertEqual(preview["role_label"], "Personal assistant to the CEO")
        self.assertEqual(preview["email_hint"], "a••@example.com")
        self.assertFalse(preview["expired"])

        wrong = self.client.post("/staff/invitations/accept", json={"token": token}, headers={"Authorization": "Bearer other-token"})
        self.assertEqual(wrong.status_code, 403)
        self.assertIn("different account", wrong.json()["detail"])
        self.assertEqual(self.client.post("/staff/invitations/accept", json={"token": token}).status_code, 401)
        accepted = self.client.post("/staff/invitations/accept", json={"token": token}, headers={"Authorization": "Bearer member-token"})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["worker"]["staff_role"], "assistant")
        self.assertEqual(self.worker(MEMBER)["status"], "active")
        self.assertEqual(self.audits(), ["invited", "invitation_accepted"])
        again = self.client.post("/staff/invitations/accept", json={"token": token}, headers={"Authorization": "Bearer member-token"})
        self.assertEqual(again.status_code, 404)

    def test_email_of_existing_account_uses_the_existing_flow(self):
        response = self.client.post("/platform/staff/invitations", headers=AUTH, json={"email": "ADA@example.com"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["invitation"]["kind"], "existing_account")
        self.db.client.auth.admin.invite_user_by_email.assert_not_called()

    def test_new_email_uses_supabase_invitation_with_role_and_departments(self):
        response = self.client.post("/platform/staff/invitations", headers=AUTH, json={
            "email": "new@example.com", "staff_role": "staff", "job_title": "Sourcing agent", "departments": ["sourcing"]})
        self.assertEqual(response.status_code, 201, response.text)
        row = self.worker(NEW)
        self.assertEqual((row["invite_kind"], row["job_title"], row["pending_departments"]), ("new_account", "Sourcing agent", ["sourcing"]))
        self.assertEqual(self.sent, [])

    def test_refusals(self):
        cases = [
            ({"user_id": OTHER}, "verified its email"),
            ({"user_id": ADMIN}, "your own account"),
            ({"user_id": MEMBER, "email": "ada@example.com"}, None),
        ]
        for payload, text in cases:
            response = self.client.post("/platform/staff/invitations", headers=AUTH, json=payload)
            self.assertIn(response.status_code, (409, 422), payload)
            if text:
                self.assertIn(text, response.json()["detail"])
        self.assertIsNone(self.worker(OTHER))
        self.client.post("/platform/staff/invitations", headers=AUTH, json={"user_id": MEMBER})
        twice = self.client.post("/platform/staff/invitations", headers=AUTH, json={"user_id": MEMBER})
        self.assertEqual(twice.status_code, 409)
        self.assertIn("pending invitation", twice.json()["detail"])

    def test_only_one_ceo(self):
        self.db.rows["fayfort_workers"].append({"user_id": CEO, "status": "active", "staff_role": "ceo", "provisioned_by": ADMIN})
        response = self.client.post("/platform/staff/invitations", headers=AUTH, json={"user_id": MEMBER, "staff_role": "ceo"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("Fay is the CEO", response.json()["detail"])
        self.assertIsNone(self.worker(MEMBER))
        self.db.rows["fayfort_workers"].append({"user_id": MEMBER, "status": "active", "staff_role": "staff", "provisioned_by": ADMIN})
        moved = self.client.put(f"/platform/workers/{MEMBER}/role", headers=AUTH, json={"staff_role": "ceo"})
        self.assertEqual(moved.status_code, 409)
        self.client.put(f"/platform/workers/{CEO}/role", headers=AUTH, json={"staff_role": "staff"})
        moved = self.client.put(f"/platform/workers/{MEMBER}/role", headers=AUTH, json={"staff_role": "ceo", "job_title": " Founder "})
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertEqual((self.worker(MEMBER)["staff_role"], self.worker(MEMBER)["job_title"]), ("ceo", "Founder"))
        self.assertIn("role_changed", self.audits())

    def test_email_failure_removes_the_invitation(self):
        from app.mailer.resend_client import EmailSendError
        with patch("app.workforce.onboarding.send_immediately", side_effect=EmailSendError("down", retryable=True)):
            response = self.client.post("/platform/staff/invitations", headers=AUTH, json={"user_id": MEMBER})
        self.assertEqual(response.status_code, 503)
        self.assertIn("Emails", response.json()["detail"])
        self.assertIsNone(self.worker(MEMBER))

    def test_expired_link_and_revoke_keeps_the_account(self):
        self.client.post("/platform/staff/invitations", headers=AUTH, json={"user_id": MEMBER})
        token = self.token_from_email()
        self.worker(MEMBER)["invite_expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        self.assertTrue(self.client.get(f"/staff/invitations/{token}").json()["invitation"]["expired"])
        self.db.accept_error = "invitation_expired"
        expired = self.client.post("/staff/invitations/accept", json={"token": token}, headers={"Authorization": "Bearer member-token"})
        self.assertEqual(expired.status_code, 409)
        self.db.accept_error = None
        self.worker(MEMBER)["created_at"] = "2026-10-20T00:00:00+00:00"
        revoked = self.client.delete(f"/platform/workers/{MEMBER}/invitation", headers=AUTH)
        self.assertEqual(revoked.status_code, 200, revoked.text)
        self.assertTrue(revoked.json()["account_kept"])
        self.db.client.auth.admin.delete_user.assert_not_called()
        self.assertIsNone(self.worker(MEMBER))

    def test_resend_existing_sends_a_new_link(self):
        self.client.post("/platform/staff/invitations", headers=AUTH, json={"user_id": MEMBER})
        first = self.token_from_email()
        self.worker(MEMBER).update({"created_at": "2026-10-20T00:00:00+00:00", "invitation_count": 1})
        response = self.client.post(f"/platform/workers/{MEMBER}/resend-invitation", headers=AUTH)
        self.assertEqual(response.status_code, 200, response.text)
        second = self.token_from_email()
        self.assertNotEqual(first, second)
        self.assertEqual(self.worker(MEMBER)["invite_token_hash"], onboarding.token_hash(second))
        self.assertEqual(response.json()["invitation"]["count"], 2)
        self.db.client.auth.admin.invite_user_by_email.assert_not_called()


class HelperTests(unittest.TestCase):
    def test_mask_email(self):
        self.assertEqual(onboarding.mask_email("favour@fayfort.com"), "fa••••@fayfort.com")
        self.assertEqual(onboarding.mask_email("ab@x.io"), "a••@x.io")
        self.assertIsNone(onboarding.mask_email(None))


if __name__ == "__main__":
    unittest.main()
