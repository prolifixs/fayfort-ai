from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
REQUEST = "request-1"
CUSTOMER = "customer-1"


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, table, current, updated):
        self.name = table
        self.current = current
        self.updated = updated
        self.filters = {}
        self.patch = None
        self.is_update = False

    def select(self, *_args): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def in_(self, key, value): self.filters[key] = value; return self
    def limit(self, *_args): return self
    def order(self, *_args, **_kwargs): return self
    def update(self, patch): self.patch = patch; self.is_update = True; return self

    def execute(self):
        if self.name == "customers":
            return Result([{"id": CUSTOMER}])
        if self.name == "customer_requests" and self.is_update:
            self.updated.update(self.patch)
            return Result([self.updated.copy()])
        if self.name == "customer_requests":
            return Result([self.current.copy()])
        return Result([])


class RequestWorkflowTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)
        self.current = {
            "id": REQUEST, "customer_id": CUSTOMER, "conversation_id": "conversation-1",
            "related_request_id": None, "request_type": "trip", "status": "awaiting_customer",
            "details": {}, "required_information": ["dates", "party_size"],
            "missing_information": ["dates", "party_size"],
        }
        self.updated = self.current.copy()

    def table(self, name):
        return Query(name, self.current, self.updated)

    @patch("app.dashboard.modules.publish_business_event")
    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_correction_updates_details_and_recomputes_missing_information(self, _member, table, publish):
        table.side_effect = self.table
        response = self.client.patch(
            f"/businesses/{BUSINESS}/requests/{REQUEST}",
            headers={"Authorization": "Bearer member"},
            json={"details": {"dates": "June"}},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["request"]["missing_information"], ["party_size"])
        self.assertEqual(response.json()["request"]["details"], {"dates": "June"})
        publish.assert_called_once()
        self.assertEqual(publish.call_args.args[1], "request.updated")

    @patch("app.dashboard.modules.publish_business_event")
    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_request_cannot_be_related_to_itself(self, _member, table, publish):
        table.side_effect = self.table
        response = self.client.patch(
            f"/businesses/{BUSINESS}/requests/{REQUEST}",
            headers={"Authorization": "Bearer member"},
            json={"related_request_id": REQUEST},
        )
        self.assertEqual(response.status_code, 422)
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
