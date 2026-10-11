from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.accounts.member_chat import _invoke_member_model, create_member_chat_router

MEMBER = "00000000-0000-0000-0000-000000000010"
OTHER = "00000000-0000-0000-0000-000000000011"
CONVERSATION = "00000000-0000-0000-0000-000000000020"


class Layer8MemberChatTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        def verified_member(authorization: str | None) -> str:
            if authorization != "Bearer member-token":
                raise HTTPException(status_code=401, detail="Sign in required.")
            return MEMBER

        app.include_router(create_member_chat_router(verified_member))
        self.client = TestClient(app)

    @patch("app.accounts.member_chat.supabase.table")
    def test_conversation_list_is_filtered_to_verified_member(self, table):
        query = MagicMock()
        query.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": CONVERSATION, "title": "Shoes", "retention_hold": False}
        ]
        table.return_value = query
        response = self.client.get("/members/conversations", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["conversations"][0]["id"], CONVERSATION)
        query.select.return_value.eq.assert_called_once_with("member_id", MEMBER)

    @patch("app.accounts.member_chat.supabase.table")
    def test_cross_member_message_read_is_not_found(self, table):
        owner = MagicMock()
        owner.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        table.return_value = owner
        response = self.client.get(f"/members/conversations/{CONVERSATION}/messages", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.member_chat.supabase.table")
    def test_linked_request_chat_rejects_new_member_messages(self, table):
        owner = MagicMock()
        owner.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": CONVERSATION, "retention_hold": True, "linked_request_id": "00000000-0000-0000-0000-000000000040",
        }
        table.return_value = owner
        response = self.client.post(
            f"/members/conversations/{CONVERSATION}/messages",
            headers={"Authorization": "Bearer member-token"},
            json={"content": "Any update?"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.member_chat.supabase.rpc")
    @patch("app.accounts.member_chat.fetch_pinned_provider_prices", return_value=(1000, 2000))
    @patch("app.accounts.member_chat._configured_model_route", return_value=("model-a", "provider-a"))
    def test_member_ai_rate_limit_fails_closed_before_provider_call(self, route, prices, rpc):
        rpc.return_value.execute.return_value.data = {"allowed": False, "reason": "rate_limit", "retry_at": "2026-10-10T19:00:00Z"}
        with patch("app.accounts.member_chat.requests.post") as provider:
            with self.assertRaises(HTTPException) as raised:
                _invoke_member_model(member_id=MEMBER, messages=[{"role": "user", "content": "find a tool"}])
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail["code"], "member_ai_rate_limited")
        provider.assert_not_called()
        self.assertEqual(rpc.call_args.args[0], "reserve_member_ai_turn")

    @patch("app.accounts.member_chat.supabase.rpc")
    @patch("app.accounts.member_chat.requests.post")
    @patch("app.accounts.member_chat.fetch_pinned_provider_prices", return_value=(1000, 2000))
    @patch("app.accounts.member_chat._configured_model_route", return_value=("model-a", "provider-a"))
    def test_member_ai_reserves_then_settles_without_writing_prompt_to_ledger(self, route, prices, provider, rpc):
        rpc.side_effect = [
            SimpleNamespace(execute=lambda: SimpleNamespace(data={"allowed": True})),
            SimpleNamespace(execute=MagicMock()),
        ]
        result = MagicMock()
        result.raise_for_status.return_value = None
        result.json.return_value = {"model": "model-a", "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            "choices": [{"message": {"content": "Here are a few options."}}]}
        provider.return_value = result
        answer, reserved, actual, model, name = _invoke_member_model(
            member_id=MEMBER, messages=[{"role": "user", "content": "find a tool"}])
        self.assertEqual(answer, "Here are a few options.")
        self.assertGreaterEqual(reserved, actual)
        self.assertEqual((model, name), ("model-a", "provider-a"))
        reservation = rpc.call_args_list[0].args[1]
        self.assertNotIn("messages", reservation)
        self.assertNotIn("find a tool", str(reservation))
        self.assertEqual(rpc.call_args_list[1].args[0], "settle_member_ai_turn")


class MemberChatRetentionTests(unittest.TestCase):
    @patch("app.accounts.member_chat_retention.supabase.rpc")
    def test_prune_uses_exact_30_day_cutoff(self, rpc):
        rpc.return_value.execute.return_value.data = 3
        from app.accounts.member_chat_retention import prune_expired_member_conversations

        deleted = prune_expired_member_conversations(now=datetime(2026, 10, 10, tzinfo=timezone.utc))
        self.assertEqual(deleted, 3)
        self.assertEqual(rpc.call_args.args[0], "prune_expired_member_conversations")
        self.assertEqual(rpc.call_args.args[1]["p_before"], "2026-09-10T00:00:00+00:00")

    @patch("app.accounts.member_chat_retention.supabase.rpc")
    def test_prune_rejects_naive_clock(self, rpc):
        from app.accounts.member_chat_retention import prune_expired_member_conversations

        with self.assertRaises(ValueError):
            prune_expired_member_conversations(now=datetime(2026, 10, 10))
        rpc.assert_not_called()

