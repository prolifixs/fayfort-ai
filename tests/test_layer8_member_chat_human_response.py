from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.accounts.member_chat_review import create_member_chat_review_router

WORKER = "00000000-0000-0000-0000-000000000030"
REVIEW = "00000000-0000-0000-0000-000000000040"
CONVERSATION = "00000000-0000-0000-0000-000000000020"
PRODUCT = "00000000-0000-0000-0000-000000000050"


class Layer8MemberChatHumanResponseTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        def member(authorization: str | None) -> str:
            if authorization != "Bearer member-token":
                raise HTTPException(status_code=401)
            return "00000000-0000-0000-0000-000000000010"

        def worker(authorization: str | None) -> str:
            if authorization != "Bearer worker-token":
                raise HTTPException(status_code=401)
            return WORKER

        app.include_router(create_member_chat_review_router(member, worker))
        self.client = TestClient(app)

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_only_assigned_worker_can_reply(self, table):
        review = MagicMock()
        review.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        table.return_value = review
        response = self.client.post(
            f"/workers/member-reviews/{REVIEW}/reply",
            headers={"Authorization": "Bearer worker-token"},
            json={"content": "This appears to be a hand tool."},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_worker_must_complete_review_before_reply(self, table):
        review = MagicMock()
        review.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REVIEW, "conversation_id": CONVERSATION, "member_id": "member-1", "status": "under_review",
        }
        table.return_value = review
        response = self.client.post(
            f"/workers/member-reviews/{REVIEW}/reply",
            headers={"Authorization": "Bearer worker-token"},
            json={"content": "This appears to be a hand tool."},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_worker_chat_context_is_limited_to_assigned_review(self, table):
        review = MagicMock()
        review.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REVIEW, "conversation_id": CONVERSATION,
        }
        messages = MagicMock()
        messages.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "member-message", "sender_type": "member", "content": "I need a small wrench.",
             "related_product_ids": [], "created_at": "2026-10-10T12:00:00Z"},
        ]
        table.side_effect = [review, messages]
        response = self.client.get(
            f"/workers/member-reviews/{REVIEW}/messages",
            headers={"Authorization": "Bearer worker-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["messages"][0]["content"], "I need a small wrench.")
        self.assertNotIn("actor_user_id", response.json()["messages"][0])

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_reply_is_attributed_and_suggestions_are_active_catalog_grounded(self, table):
        review = MagicMock()
        review.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": REVIEW, "conversation_id": CONVERSATION, "member_id": "member-1", "status": "reviewed",
        }
        products = MagicMock()
        products.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = [
            {"id": PRODUCT, "name": "Sample wrench", "active": True, "availability_status": "listed"},
        ]
        messages = MagicMock()
        messages.insert.return_value.execute.return_value.data = [{
            "id": "message-1", "sender_type": "worker", "actor_user_id": WORKER,
            "content": "This looks like a small wrench. Here is a similar catalog item.",
            "related_product_ids": [PRODUCT], "created_at": "2026-10-10T12:00:00Z",
        }]
        table.side_effect = [review, products, messages]

        response = self.client.post(
            f"/workers/member-reviews/{REVIEW}/reply",
            headers={"Authorization": "Bearer worker-token"},
            json={"content": "This looks like a small wrench. Here is a similar catalog item.", "product_ids": [PRODUCT]},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["message"]["sender_type"], "worker")
        self.assertEqual(response.json()["message"]["related_product_ids"], [PRODUCT])
        self.assertNotIn("actor_user_id", response.json()["message"])
        messages.insert.assert_called_once_with({
            "conversation_id": CONVERSATION, "sender_type": "worker", "actor_user_id": WORKER,
            "content": "This looks like a small wrench. Here is a similar catalog item.",
            "related_product_ids": [PRODUCT],
        })

    def test_worker_reply_requires_active_worker_authentication(self):
        response = self.client.post(
            f"/workers/member-reviews/{REVIEW}/reply",
            headers={"Authorization": "Bearer member-token"},
            json={"content": "This appears to be a hand tool."},
        )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
