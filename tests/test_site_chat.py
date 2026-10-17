from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.commerce import db as commerce_db
from app.services import ai_responder
from app.site import chat
from tests.test_commerce import ADMIN, MEMBER, Db

ADMIN_AUTH = {"Authorization": "Bearer admin"}
MEMBER_AUTH = {"Authorization": "Bearer member"}


def verified(authorization):
    if authorization == "Bearer member":
        return MEMBER
    raise HTTPException(status_code=401, detail="A valid signed-in member is required.")


class SiteChatTests(unittest.TestCase):
    def client(self, rows=None, answer="FayFort finds factories, checks the goods and ships them to you."):
        db = Db(rows or {})
        self.model_calls = []

        def model(messages):
            self.model_calls.append(messages)
            return answer, 120, 30

        for patcher in (
            patch.object(commerce_db, "client", db),
            patch("app.site.chat.trusted_platform_admin",
                  side_effect=lambda auth: {"user_id": ADMIN} if auth == "Bearer admin" else None),
            patch("app.site.chat.invoke_model", side_effect=model),
            patch("app.site.chat._knowledge", return_value=("FayFort sources from China and ships worldwide.", "")),
            patch("app.site.chat._today_start", return_value=""),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(chat.create_site_chat_router(verified))
        return TestClient(app), db

    def send(self, client, text, token=None):
        headers = {"X-Visitor-Token": token} if token else {}
        return client.post("/public/site-chat/messages", json={"content": text, "page": "/"}, headers=headers)

    def test_first_message_starts_a_conversation_and_keeps_only_the_token_hash(self):
        client, db = self.client()
        body = self.send(client, "How does FayFort work?").json()
        token = body["visitor_token"]
        self.assertRegex(token, r"^[A-Za-z0-9_-]{32,64}$")
        self.assertIn("ships them to you", body["reply"]["content"])
        stored = db.rows["site_chat_conversations"][0]
        self.assertEqual(stored["visitor_token_hash"], chat._hash(token))
        self.assertNotIn(token, str(db.rows["site_chat_conversations"]))
        # The same browser continues the same conversation, and the model sees the history.
        self.send(client, "And shipping to Ghana?", token)
        self.assertEqual(len(db.rows["site_chat_conversations"]), 1)
        self.assertEqual([m["role"] for m in self.model_calls[-1]], ["system", "user", "assistant", "user"])
        history = client.get("/public/site-chat", headers={"X-Visitor-Token": token}).json()
        self.assertEqual([m["sender_type"] for m in history["messages"]], ["visitor", "assistant", "visitor", "assistant"])
        self.assertTrue(history["enabled"])
        # A made-up token gets a fresh, empty conversation rather than someone else's.
        self.assertEqual(client.get("/public/site-chat", headers={"X-Visitor-Token": "x" * 40}).json()["messages"], [])

    def test_asking_for_a_person_offers_join_free_and_whatsapp_without_the_model(self):
        client, _ = self.client()
        reply = self.send(client, "Can I talk to a person?").json()["reply"]
        self.assertEqual(reply["actions"], ["join", "whatsapp"])
        self.assertIn("join free", reply["content"].lower())
        self.assertEqual(self.model_calls, [])

    def test_next_steps_in_the_account_get_a_join_button(self):
        client, _ = self.client(answer="To get a quote, join free and send a sourcing request from your dashboard.")
        self.assertEqual(self.send(client, "I want a quote for 500 chairs").json()["reply"]["actions"], ["join"])

    def test_held_back_answers_point_to_joining_not_to_this_chat(self):
        client, _ = self.client(answer="Shipping costs exactly $412 and takes 9 days.")
        content = self.send(client, "How much is shipping?").json()["reply"]["content"]
        self.assertNotIn("$412", content)
        self.assertNotIn("join this chat", content)
        self.assertNotIn("dear", content)

    def test_daily_limit_stops_the_model_and_offers_the_account(self):
        client, db = self.client({"site_chat_settings": [{"id": 1, "enabled": True, "visitor_daily_limit": 2,
                                                          "network_daily_limit": 60, "daily_reply_cap": 400}]})
        token = self.send(client, "one").json()["visitor_token"]
        self.send(client, "two", token)
        limited = self.send(client, "three", token).json()
        self.assertTrue(limited["limited"])
        self.assertEqual(limited["reply"]["actions"], ["join", "whatsapp"])
        self.assertEqual(len(self.model_calls), 2)

    def test_switched_off_chat_answers_without_the_model(self):
        client, _ = self.client({"site_chat_settings": [{"id": 1, "enabled": False, "visitor_daily_limit": 20,
                                                          "network_daily_limit": 60, "daily_reply_cap": 400}]})
        self.assertTrue(self.send(client, "hello").json()["limited"])
        self.assertEqual(self.model_calls, [])

    def test_handoff_code_claims_into_the_member_chat(self):
        client, db = self.client()
        token = self.send(client, "I need hair products").json()["visitor_token"]
        self.assertEqual(client.post("/public/site-chat/handoff").json(), {"code": None})
        code = client.post("/public/site-chat/handoff", headers={"X-Visitor-Token": token}).json()["code"]
        self.assertRegex(code, r"^[A-Za-z0-9_-]{16,64}$")
        self.assertEqual(db.rows["site_chat_conversations"][0]["claim_code_hash"], chat._hash(code))

        self.assertEqual(client.post("/members/site-chat/claim", json={"code": code}).status_code, 401)
        with patch.object(db, "rpc", return_value=SimpleNamespace(execute=lambda: SimpleNamespace(data="conv-1"))) as rpc:
            claimed = client.post("/members/site-chat/claim", headers=MEMBER_AUTH, json={"code": code}).json()
        self.assertEqual(claimed, {"conversation_id": "conv-1"})
        rpc.assert_called_once_with("claim_site_chat", {"p_member_id": MEMBER, "p_claim_code_hash": chat._hash(code)})

    def test_claim_reads_the_code_saved_at_sign_up_and_then_clears_it(self):
        client, db = self.client()
        db.auth.get_user.side_effect = lambda token: SimpleNamespace(user=SimpleNamespace(
            id=MEMBER, email_confirmed_at="2026-10-01", user_metadata={"site_chat_code": "c" * 24}))
        with patch.object(db, "rpc", return_value=SimpleNamespace(execute=lambda: SimpleNamespace(data="conv-2"))) as rpc:
            self.assertEqual(client.post("/members/site-chat/claim", headers=MEMBER_AUTH, json={}).json(),
                             {"conversation_id": "conv-2"})
        self.assertEqual(rpc.call_args.args[1]["p_claim_code_hash"], chat._hash("c" * 24))
        db.auth.admin.update_user_by_id.assert_called_once_with(MEMBER, {"user_metadata": {"site_chat_code": None}})

    def test_claim_without_any_code_does_nothing(self):
        client, db = self.client()
        db.auth.get_user.side_effect = lambda token: SimpleNamespace(user=SimpleNamespace(id=MEMBER, user_metadata={}))
        self.assertEqual(client.post("/members/site-chat/claim", headers=MEMBER_AUTH, json={}).json(), {"conversation_id": None})

    def test_control_center_sees_conversations_and_changes_limits(self):
        client, _ = self.client()
        self.send(client, "What do you sell?")
        self.assertEqual(client.get("/platform/site/chat").status_code, 403)
        overview = client.get("/platform/site/chat", headers=ADMIN_AUTH).json()
        self.assertEqual(overview["conversations"][0]["first_message"], "What do you sell?")
        self.assertEqual(overview["today"]["replies"], 1)
        conversation_id = overview["conversations"][0]["id"]
        messages = client.get(f"/platform/site/chat/{'0' * 8}-0000-0000-0000-{'0' * 12}", headers=ADMIN_AUTH).json()
        self.assertEqual(messages, {"messages": []})
        saved = client.put("/platform/site/chat/settings", headers=ADMIN_AUTH, json={
            "enabled": False, "visitor_daily_limit": 10, "network_daily_limit": 30, "daily_reply_cap": 200}).json()
        self.assertFalse(saved["settings"]["enabled"])
        self.assertEqual(saved["settings"]["visitor_daily_limit"], 10)
        self.assertTrue(conversation_id)


class ReplyTextTests(unittest.TestCase):
    def test_fallbacks_are_rewritten_for_the_website(self):
        for fallback in (ai_responder.FALLBACK_UNKNOWN, ai_responder.FALLBACK_NO_ACTION, ai_responder.FALLBACK_NEEDS_PERSON):
            text = chat._site_reply_text(fallback)
            self.assertIn("join free", text.lower())
            self.assertNotIn("this chat", text)


if __name__ == "__main__":
    unittest.main()
