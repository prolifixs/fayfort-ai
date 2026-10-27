"""Operations restructure R3 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): the Conversations desk's customer card, Answers and
hand-offs from a chat."""
from __future__ import annotations

import unittest

from app.accounts.conversation_desk import search_answers
from app.config.settings import settings
from tests import test_operations_phase_b as phase_b
from tests.test_operations_phase_b import CHAT, MEMBER, REQ_A, WORKER

CHAT_ITEM = "00000000-0000-0000-0000-0000000000c9"
HANDOFF_ITEM = "00000000-0000-0000-0000-0000000000d9"
BIZ_CHAT = "00000000-0000-0000-0000-0000000000bc"
HANDOFF = "00000000-0000-0000-0000-0000000000f1"
CUSTOMER = "00000000-0000-0000-0000-0000000000f2"
KB = settings.MEMBER_KNOWLEDGE_BUSINESS_ID


class ConversationDeskTests(unittest.TestCase):
    B = phase_b.PhaseBTests
    tearDown, h, item = B.tearDown, B.h, B.item

    def setUp(self):
        self.B.setUp(self)
        self.db.tables["operations_worker_departments"].append(
            {"worker_id": WORKER, "department": "conversation_intake", "can_claim": True})
        self.db.tables["operations_work_items"] += [
            {"id": CHAT_ITEM, "department": "conversation_intake", "status": "open", "assigned_worker_id": None,
             "member_conversation_id": CHAT, "summary": "Ada needs a person", "version": 1, "work_type": "member_conversation"},
            {"id": HANDOFF_ITEM, "department": "conversation_intake", "status": "claimed", "assigned_worker_id": WORKER,
             "handoff_id": HANDOFF, "business_id": KB, "summary": "Instagram customer", "version": 1, "work_type": "human_handoff"},
        ]
        self.db.tables.update({
            "member_profiles": [{"user_id": MEMBER, "display_name": "Ada Obi", "member_tier": "pro", "rank_level": 2, "phone": "+234 000"}],
            "member_purchase_requests": self.db.tables["member_purchase_requests"] + [
                {"id": REQ_A, "member_id": MEMBER, "request_title": "Lace wig", "created_at": "2026-10-20T00:00:00Z"}],
            "commerce_invoices": [{"id": "inv1", "member_id": MEMBER, "title": "Deposit", "amount": 20, "currency": "USD", "status": "sent"}],
            "conversation_handoffs": [{"id": HANDOFF, "conversation_id": BIZ_CHAT, "business_id": KB, "status": "active"}],
            "conversations": [{"id": BIZ_CHAT, "business_id": KB, "customer_external_id": "ig-77", "customer_name": "Chioma",
                               "customer_username": "chioma.styles", "channel": "instagram", "summary": "Split payment",
                               "last_message_at": "2026-10-26T10:00:00Z", "created_at": "2026-10-01T00:00:00Z"}],
            "customers": [{"id": CUSTOMER, "business_id": KB, "channel": "instagram", "external_customer_id": "ig-77",
                           "profile": {"name": "Chioma"}, "created_at": "2026-09-01T00:00:00Z"}],
            "customer_requests": [{"id": "cr1", "customer_id": CUSTOMER, "conversation_id": BIZ_CHAT, "request_type": "product_order",
                                   "status": "awaiting_customer", "details": {"product": "Bob wig", "secret": {"x": 1}},
                                   "missing_information": ["delivery_city"], "created_at": "2026-10-26T09:00:00Z"}],
            "messages": [{"id": "bm1", "conversation_id": BIZ_CHAT, "sender_type": "customer", "content": "Can I pay in two parts?",
                          "created_at": "2026-10-26T10:00:00Z"}],
            "knowledge_documents": [
                {"id": "k1", "business_id": KB, "title": "Payments and deposits", "content": "Members on Free pay a 50% deposit. Split payments are possible on orders over $300."},
                {"id": "k2", "business_id": KB, "title": "Shipping", "content": "Air freight to Lagos takes 7 to 10 days."},
                {"id": "k3", "business_id": "someone-else", "title": "Payments", "content": "Not ours"}],
            "business_faqs": [
                {"id": "f1", "business_id": KB, "question": "Can I split my payment?", "answer": "Yes, in two parts for orders over $300.", "status": "approved"},
                {"id": "f2", "business_id": KB, "question": "Split payment draft", "answer": "draft", "status": "draft"}],
        })

    def test_member_card_is_private_until_claimed(self):
        locked = self.client.get(f"/operations/work-items/{CHAT_ITEM}/customer", headers=self.h("worker")).json()
        self.assertEqual(locked, {"card": None, "locked": True})
        card = self.client.get(f"/operations/work-items/{CHAT_ITEM}/customer", headers=self.h("admin")).json()["card"]
        self.assertEqual((card["kind"], card["name"]), ("member", "Ada Obi"))
        self.assertEqual(card["profile"].get("member_tier"), "pro")
        self.assertNotIn("phone", card["profile"])
        self.assertEqual(card["requests"][0]["stage"], "submitted")
        self.assertEqual(card["invoices"][0]["status"], "sent")
        self.assertTrue(card["chats"][0]["current"])

    def test_customer_card_through_the_handoff(self):
        card = self.client.get(f"/operations/work-items/{HANDOFF_ITEM}/customer", headers=self.h("worker")).json()["card"]
        self.assertEqual((card["kind"], card["name"], card["profile"]["channel"]), ("customer", "Chioma", "instagram"))
        request = card["requests"][0]
        self.assertEqual(request["missing"], ["delivery_city"])
        self.assertEqual(request["details"], {"product": "Bob wig"})  # nested values aren't shown

    def test_answers_search_only_our_knowledge_and_approved_faqs(self):
        answers = search_answers(self.db, "split payment")
        self.assertEqual([a["id"] for a in answers], ["f1", "k1"])
        self.assertIn("Split payments", answers[1]["text"])
        self.assertEqual(search_answers(self.db, "a"), [])
        listed = self.client.get("/operations/answers?q=shipping lagos", headers=self.h("worker")).json()["answers"]
        self.assertEqual(listed[0]["id"], "k2")
        self.who["Bearer nobody"] = None
        self.assertEqual(self.client.get("/operations/answers?q=shipping", headers=self.h("nobody")).status_code, 403)

    def test_hand_off_needs_a_claim_and_makes_a_new_item(self):
        refused = self.client.post(f"/operations/work-items/{CHAT_ITEM}/hand-off", headers=self.h("worker"),
                                   json={"department": "sourcing", "note": "Wants a lace wig sourced"})
        self.assertEqual(refused.status_code, 403)
        made = self.client.post(f"/operations/work-items/{HANDOFF_ITEM}/hand-off", headers=self.h("worker"),
                                json={"department": "sourcing", "note": "Wants a bob wig, 2 units"})
        self.assertEqual(made.status_code, 201, made.text)
        new = made.json()["work_item"]
        self.assertEqual((new["department"], new["work_type"]), ("sourcing", "chat_handoff"))
        self.assertIn("Chioma", new["summary"])
        self.assertEqual(new["metadata"]["conversation_id"], BIZ_CHAT)
        self.assertEqual(new["metadata"]["from_work_item_id"], HANDOFF_ITEM)
        self.assertEqual(self.item(HANDOFF_ITEM)["status"], "claimed")  # the chat stays with Conversations
        history = [e for e in self.db.tables["operations_work_events"] if e["work_item_id"] == HANDOFF_ITEM]
        self.assertIn("Sent to Sourcing", history[-1]["reason"])
        # The receiving desk sees the chat it came from and the customer card.
        context = self.client.get(f"/operations/work-items/{new['id']}/source-context", headers=self.h("admin")).json()
        self.assertEqual(context["flow"]["from_chat"][0]["content"], "Can I pay in two parts?")
        card = self.client.get(f"/operations/work-items/{new['id']}/customer", headers=self.h("admin")).json()["card"]
        self.assertEqual(card["name"], "Chioma")

    def test_hand_off_rules(self):
        same = self.client.post(f"/operations/work-items/{HANDOFF_ITEM}/hand-off", headers=self.h("worker"),
                                json={"department": "conversation_intake", "note": "Same desk"})
        self.assertEqual(same.status_code, 422)
        short = self.client.post(f"/operations/work-items/{HANDOFF_ITEM}/hand-off", headers=self.h("worker"),
                                 json={"department": "sourcing", "note": "  "})
        self.assertEqual(short.status_code, 422)
        not_chat = self.client.post(f"/operations/work-items/{phase_b.ITEM_A}/hand-off", headers=self.h("admin"),
                                    json={"department": "disputes", "note": "Not a chat"})
        self.assertEqual(not_chat.status_code, 409)
        member = self.client.post(f"/operations/work-items/{CHAT_ITEM}/hand-off", headers=self.h("admin"),
                                  json={"department": "member_support", "note": "Refund question"})
        self.assertEqual(member.status_code, 201, member.text)
        self.assertEqual(member.json()["work_item"]["metadata"]["member_id"], MEMBER)


if __name__ == "__main__":
    unittest.main()
