from __future__ import annotations

import base64
import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.directory import identity
from app.workforce.router import create_workforce_router

ADMIN = "00000000-0000-0000-0000-0000000000a1"
WORKER = "00000000-0000-0000-0000-0000000000b1"
INVITED = "00000000-0000-0000-0000-0000000000b2"
AUTH = {"Authorization": "Bearer admin-token"}


class FakeQuery:
    """Chainable stand-in for a supabase-py table query; records writes and returns canned rows."""

    def __init__(self, db: "FakeDb", table: str):
        self.db, self.table, self.filters, self.single = db, table, [], False

    def select(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self

    def eq(self, column, value):
        self.filters.append((column, "eq", value))
        return self

    def in_(self, column, values):
        self.filters.append((column, "in", list(values)))
        return self

    def maybe_single(self):
        self.single = True
        return self

    def update(self, values):
        self.db.writes.append((self.table, "update", values))
        return self

    def insert(self, values):
        self.db.writes.append((self.table, "insert", values))
        return self

    def execute(self):
        rows = [row for row in self.db.rows.get(self.table, []) if self._matches(row)]
        if self.single:
            return SimpleNamespace(data=rows[0] if rows else None)
        return SimpleNamespace(data=rows)

    def _matches(self, row):
        for column, op, value in self.filters:
            if column not in row:
                continue
            if op == "eq" and str(row[column]) != str(value):
                return False
            if op == "in" and str(row[column]) not in [str(v) for v in value]:
                return False
        return True


class FakeDb:
    def __init__(self, rows):
        self.rows, self.writes, self.rpcs = rows, [], []
        self.client = MagicMock()
        self.client.table.side_effect = lambda name: FakeQuery(self, name)
        self.client.rpc.side_effect = self._rpc

    def _rpc(self, name, params):
        self.rpcs.append((name, params))
        data = {"handoffs": 1, "member_requests": 0, "work_items": 2} if name == "release_workforce_assignments" else []
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=data))


def auth_user(email, confirmed=True, factors=(), last_sign_in=None, banned_until=None):
    return SimpleNamespace(user=SimpleNamespace(
        email=email, user_metadata={"full_name": email.split("@")[0].title()},
        last_sign_in_at=last_sign_in, email_confirmed_at="2026-10-01T00:00:00Z" if confirmed else None,
        factors=[SimpleNamespace(status=status) for status in factors], banned_until=banned_until))


class WorkforceApiTests(unittest.TestCase):
    def setUp(self):
        now = datetime.now(timezone.utc)
        self.now = now
        self.db = FakeDb({
            "fayfort_workers": [
                {"user_id": WORKER, "status": "active", "created_at": "2026-10-01T00:00:00+00:00",
                 "activated_at": "2026-10-01T01:00:00+00:00", "invitation_sent_at": "2026-10-01T00:00:00+00:00",
                 "invitation_count": 1, "handoff_availability": "available"},
                {"user_id": INVITED, "status": "invited", "created_at": (now - timedelta(days=3)).isoformat(),
                 "invitation_sent_at": (now - timedelta(days=3)).isoformat(), "invitation_count": 1,
                 "handoff_availability": "offline"},
            ],
            "operations_worker_presence": [{"worker_id": WORKER, "last_seen_at": (now - timedelta(seconds=20)).isoformat()}],
            "operations_work_items": [{"assigned_worker_id": WORKER, "status": "claimed", "id": "w1", "summary": "Reply"}],
            "operations_worker_departments": [{"worker_id": WORKER, "department": "conversation_intake", "can_claim": True}],
            "operations_work_events": [],
            "workforce_audit": [],
        })
        users = {
            WORKER: auth_user("worker@example.com", factors=("verified",), last_sign_in="2026-10-14T08:00:00Z"),
            INVITED: auth_user("new@example.com", confirmed=False),
        }
        self.db.client.auth.admin.get_user_by_id.side_effect = lambda uid: users.get(uid, SimpleNamespace(user=None))
        self.patches = [
            patch("app.workforce.router.supabase", self.db.client),
            patch("app.workforce.audit.supabase", self.db.client),
            patch("app.workforce.router.trusted_platform_admin", side_effect=lambda h: {"user_id": ADMIN} if h == "Bearer admin-token" else None),
        ]
        for item in self.patches:
            item.start()
        app = FastAPI()
        app.include_router(create_workforce_router())
        self.client = TestClient(app)

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def audit_actions(self):
        return [values["action"] for table, op, values in self.db.writes if table == "workforce_audit"]

    def test_directory_requires_platform_admin(self):
        for method, path in [("get", "/platform/workers"), ("get", f"/platform/workers/{WORKER}"),
                             ("post", f"/platform/workers/{WORKER}/reactivate"),
                             ("post", f"/platform/workers/{WORKER}/mfa-reset")]:
            response = getattr(self.client, method)(path, headers={"Authorization": "Bearer worker-token"})
            self.assertEqual(response.status_code, 403, path)
        self.assertEqual(self.db.writes, [])

    def test_directory_lists_presence_timestamps_and_invitation_state(self):
        response = self.client.get("/platform/workers", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        first, second = body["workers"]
        self.assertEqual(first["user_id"], WORKER)
        self.assertTrue(first["online"])
        self.assertEqual(first["email"], "worker@example.com")
        self.assertEqual(first["display_name"], "Worker")
        self.assertTrue(first["mfa_enrolled"])
        self.assertEqual(first["open_work_count"], 1)
        self.assertIsNone(first["invitation"])
        self.assertEqual(second["status"], "invited")
        self.assertFalse(second["online"])
        self.assertTrue(second["invitation"]["expired"])
        self.assertEqual(body["summary"], {"total": 2, "active": 1, "online": 1, "invited": 1, "inactive": 0, "without_mfa": 0})
        self.assertNotIn("factors", json.dumps(body))

    def test_worker_goes_offline_after_the_presence_window(self):
        self.db.rows["operations_worker_presence"][0]["last_seen_at"] = (self.now - timedelta(seconds=200)).isoformat()
        worker = self.client.get("/platform/workers", headers=AUTH).json()["workers"][0]
        self.assertFalse(worker["online"])
        self.assertIsNotNone(worker["last_seen_at"])

    def test_profile_includes_work_departments_audit_and_sign_ins(self):
        response = self.client.get(f"/platform/workers/{WORKER}", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        worker = response.json()["worker"]
        self.assertEqual(worker["departments"], ["conversation_intake"])
        self.assertEqual(len(worker["current_work"]), 1)
        self.assertIn("audit", worker)
        self.assertIn(("workforce_auth_events", {"p_user_id": WORKER, "p_limit": 25}), self.db.rpcs)
        self.assertEqual(self.client.get("/platform/workers/00000000-0000-0000-0000-000000000999", headers=AUTH).status_code, 404)

    def test_deactivation_blocks_access_releases_work_and_is_audited(self):
        response = self.client.post(f"/platform/workers/{WORKER}/deactivate", headers=AUTH, json={"reason": "Left the team"})
        self.assertEqual(response.status_code, 200)
        update = next(values for table, op, values in self.db.writes if table == "fayfort_workers" and op == "update")
        self.assertEqual(update["status"], "inactive")
        self.assertEqual(update["deactivated_by"], ADMIN)
        self.assertEqual(update["handoff_availability"], "offline")
        self.assertEqual(self.db.rpcs[0][0], "release_workforce_assignments")
        self.assertEqual(self.db.rpcs[0][1]["p_worker_id"], WORKER)
        self.db.client.auth.admin.update_user_by_id.assert_called_once_with(WORKER, {"ban_duration": "876000h"})
        self.assertEqual(response.json()["released"], {"handoffs": 1, "member_requests": 0, "work_items": 2})
        self.assertEqual(self.audit_actions(), ["deactivated"])

    def test_admin_cannot_deactivate_self_or_an_inactive_worker(self):
        self.db.rows["fayfort_workers"].append({"user_id": ADMIN, "status": "active"})
        self.assertEqual(self.client.post(f"/platform/workers/{ADMIN}/deactivate", headers=AUTH, json={"reason": "test"}).status_code, 409)
        self.db.rows["fayfort_workers"][0]["status"] = "inactive"
        self.assertEqual(self.client.post(f"/platform/workers/{WORKER}/deactivate", headers=AUTH, json={"reason": "test"}).status_code, 409)
        self.db.client.auth.admin.update_user_by_id.assert_not_called()

    def test_reactivation_lifts_the_ban(self):
        self.db.rows["fayfort_workers"][0].update({"status": "inactive", "deactivated_at": "2026-10-10T00:00:00+00:00"})
        response = self.client.post(f"/platform/workers/{WORKER}/reactivate", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["worker"]["status"], "active")
        self.db.client.auth.admin.update_user_by_id.assert_called_once_with(WORKER, {"ban_duration": "none"})
        self.assertEqual(self.audit_actions(), ["reactivated"])

    def test_resend_only_for_pending_invitations(self):
        self.assertEqual(self.client.post(f"/platform/workers/{WORKER}/resend-invitation", headers=AUTH).status_code, 409)
        response = self.client.post(f"/platform/workers/{INVITED}/resend-invitation", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["invitation"]["count"], 2)
        self.db.client.auth.admin.invite_user_by_email.assert_called_once()
        self.assertEqual(self.db.client.auth.admin.invite_user_by_email.call_args.args[0], "new@example.com")
        self.assertEqual(self.audit_actions(), ["invitation_resent"])

    def test_revoke_deletes_only_unaccepted_invitations(self):
        self.assertEqual(self.client.delete(f"/platform/workers/{WORKER}/invitation", headers=AUTH).status_code, 409)
        self.db.client.auth.admin.delete_user.assert_not_called()
        response = self.client.delete(f"/platform/workers/{INVITED}/invitation", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        self.db.client.auth.admin.delete_user.assert_called_once_with(INVITED)
        self.assertEqual(self.audit_actions(), ["invitation_revoked"])

    def test_password_reset_goes_to_the_staff_callback(self):
        self.db.client.auth.admin.generate_link.return_value = SimpleNamespace(
            properties=SimpleNamespace(action_link="https://x.supabase.co/auth/v1/verify?token=secret"))
        with patch("app.workforce.router.send_immediately") as send:
            response = self.client.post(f"/platform/workers/{WORKER}/password-reset", headers=AUTH)
        self.assertEqual(response.status_code, 200)
        params = self.db.client.auth.admin.generate_link.call_args.args[0]
        self.assertEqual(params["type"], "recovery")
        self.assertEqual(params["email"], "worker@example.com")
        self.assertTrue(params["options"]["redirect_to"].endswith("/auth/callback?audience=staff&type=recovery"))
        self.assertEqual(send.call_args.kwargs["to"], "worker@example.com")
        self.assertIn("verify?token=secret", send.call_args.kwargs["rendered"].html)
        self.db.client.auth.reset_password_for_email.assert_not_called()
        self.assertEqual(self.audit_actions(), ["password_reset_sent"])

    def test_mfa_reset_removes_every_factor(self):
        self.db.client.auth.admin.mfa.list_factors.return_value = SimpleNamespace(
            factors=[SimpleNamespace(id="11111111-1111-1111-1111-111111111111"), SimpleNamespace(id="22222222-2222-2222-2222-222222222222")])
        response = self.client.post(f"/platform/workers/{WORKER}/mfa-reset", headers=AUTH)
        self.assertEqual(response.json(), {"factors_removed": 2})
        self.assertEqual(self.db.client.auth.admin.mfa.delete_factor.call_count, 2)
        self.assertEqual(self.audit_actions(), ["mfa_reset"])

    def test_admin_actions_are_rate_limited(self):
        statuses = [self.client.post(f"/platform/workers/{WORKER}/mfa-reset", headers=AUTH).status_code for _ in range(31)]
        self.assertEqual(statuses[-1], 429)
        self.assertEqual(statuses.count(429), 1)

    def test_worker_reads_own_profile_only_as_worker(self):
        with patch("app.workforce.router.trusted_fayfort_staff", return_value={"user_id": WORKER, "role": "worker"}):
            response = self.client.get("/workers/me/profile", headers={"Authorization": "Bearer worker-token"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("audit", response.json()["worker"])
        with patch("app.workforce.router.trusted_fayfort_staff", return_value={"user_id": ADMIN, "role": "platform_admin"}):
            self.assertEqual(self.client.get("/workers/me/profile", headers=AUTH).status_code, 403)


def token_with(claims: dict) -> str:
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return f"{encode({'alg': 'HS256'})}.{encode(claims)}.signature"


class StaffMfaEnforcementTests(unittest.TestCase):
    def test_reads_assurance_level_from_token(self):
        self.assertEqual(identity.access_token_aal(token_with({"aal": "aal2"})), "aal2")
        self.assertEqual(identity.access_token_aal(token_with({})), "aal1")
        self.assertEqual(identity.access_token_aal("not-a-jwt"), "aal1")

    def test_platform_admin_needs_aal2_only_when_required(self):
        admin = SimpleNamespace(user=SimpleNamespace(id=ADMIN, app_metadata={"platform_admin": True}))
        aal1 = "Bearer " + token_with({"aal": "aal1"})
        aal2 = "Bearer " + token_with({"aal": "aal2"})
        with patch("app.directory.identity.supabase.auth.get_user", return_value=admin):
            with patch.object(identity.settings, "STAFF_MFA_REQUIRED", False):
                self.assertEqual(identity.trusted_platform_admin(aal1), {"user_id": ADMIN})
            with patch.object(identity.settings, "STAFF_MFA_REQUIRED", True):
                self.assertIsNone(identity.trusted_platform_admin(aal1))
                self.assertEqual(identity.trusted_platform_admin(aal2), {"user_id": ADMIN})
                self.assertIsNone(identity.trusted_fayfort_staff(aal1))
                self.assertEqual(identity.trusted_fayfort_staff(aal2), {"user_id": ADMIN, "role": "platform_admin"})


if __name__ == "__main__":
    unittest.main()
