"""Fixes from the first scored AI run (docs/KNOWLEDGE_AND_AI_PLAN.md section 7)."""
from __future__ import annotations

import unittest

from app.handoffs.automatic import customer_asked_for_human, explicit_person_request, soften_unrequested_handoff
from app.schemas.intent import IntentResult
from app.services import ai_responder
from app.services.ai_responder import _guard_response_grounding, plain_text
from scripts.load_knowledge import sections

KNOWLEDGE = ("How FayFort is paid: a service commission, calculated into the product invoice. There is no separate "
             "entry or commitment fee. Consultation: Free $100, Standard $50.")


class PlainTextTests(unittest.TestCase):
    def test_markdown_becomes_plain_text(self):
        answer = "Our plans:\n\n- **Free** – $0\n* **Standard** – $19\n## Notes\nSee *Member tier*."
        self.assertEqual(plain_text(answer), "Our plans:\n\n• Free – $0\n• Standard – $19\nNotes\nSee Member tier.")

    def test_plain_text_leaves_prices_and_maths_alone(self):
        self.assertEqual(plain_text("2 * 3 items at $5"), "2 * 3 items at $5")


class GuardTests(unittest.TestCase):
    def guard(self, answer, message):
        return _guard_response_grounding(answer=answer, customer_message=message, knowledge_context=KNOWLEDGE,
                                         action_decision=None)

    def test_denying_the_customers_own_figure_is_allowed(self):
        answer = "No, dear, there is no $40 commitment fee. Our commission is built into the invoice."
        self.assertEqual(self.guard(answer, "Someone told me there's a $40 commitment fee, is that true?"), answer)

    def test_inventing_a_price_is_still_blocked(self):
        answer = "Yes, the commitment fee is $40."
        self.assertIn(ai_responder.FALLBACK_UNKNOWN, self.guard(answer, "Is there a $40 fee?"))

    def test_describing_the_process_is_not_a_promise(self):
        answer = "Once you choose an option, we'll send you an invoice and the deposit is taken off."
        self.assertEqual(self.guard(answer, "Do I have to pay anything before you source for me?"), answer)

    def test_a_bare_promise_is_still_blocked(self):
        answer = "I'll forward your request to the sourcing team now."
        result = self.guard(answer, "Can you help me find a supplier?")
        self.assertEqual(result, ai_responder.FALLBACK_NO_ACTION)

    def test_upset_customer_gets_an_apology_in_the_fallback(self):
        result = self.guard("I'll check on your order right away.", "This is ridiculous, I've waited 3 days!")
        self.assertTrue(result.startswith(ai_responder.FALLBACK_SORRY))
        self.assertIn("ask for a person", result)


class HandoffTests(unittest.TestCase):
    def handoff(self, language="en"):
        return IntentResult(intent="human_handoff", action="handoff_to_agent", confidence=0.8, language=language,
                            can_handle_automatically=False)

    def test_supplier_question_is_answered_not_handed_off(self):
        softened = soften_unrequested_handoff(self.handoff(), "Can you give me the contact of a wig factory in Guangzhou?")
        self.assertFalse(customer_asked_for_human(softened))
        self.assertEqual(softened.action, "answer_question")
        self.assertTrue(softened.can_handle_automatically)

    def test_explicit_requests_still_open_a_handoff(self):
        for message in ("I want to talk to a real person", "Can I speak with someone please", "get me an agent",
                        "转人工"):
            with self.subTest(message=message):
                self.assertTrue(explicit_person_request(message))
                self.assertTrue(customer_asked_for_human(soften_unrequested_handoff(self.handoff(), message)))

    def test_asking_if_its_fayfay_is_not_a_request_for_a_person(self):
        softened = soften_unrequested_handoff(self.handoff(), "Am I talking to Fayfay or a bot?")
        self.assertFalse(customer_asked_for_human(softened))

    def test_other_languages_trust_the_classifier(self):
        self.assertTrue(customer_asked_for_human(soften_unrequested_handoff(self.handoff("fr"), "Je veux de l'aide")))


class KnowledgeLoaderTests(unittest.TestCase):
    def test_sections_split_facts_and_guide(self):
        docs = sections(open("docs/KNOWLEDGE_BASE_DRAFT.md").read())
        self.assertEqual(len(docs), 11)
        self.assertEqual([d["source_type"] for d in docs].count("guide"), 1)
        self.assertEqual(docs[-1]["title"], "Conversation guide")
        self.assertIn("What's moving", next(d for d in docs if d["title"].startswith("Shop"))["content"])


if __name__ == "__main__":
    unittest.main()


class QuantityTests(unittest.TestCase):
    def build(self, history, missing):
        from app.services.action_handler import prepare_action
        from app.services.ai_responder import build_messages
        intent = IntentResult(intent="product_sourcing", action="ask_for_missing_information", confidence=0.9,
                              missing_information=missing)
        messages = build_messages(customer_message=history[-1]["content"], knowledge_context="", conversation_history=history,
                                  intent_result=intent, action_decision=prepare_action(intent))
        return next(m["content"] for m in messages if m["content"].startswith("INTERNAL CONVERSATION HANDLING GUIDANCE"))

    def test_quantity_is_not_asked_twice_and_the_next_step_follows(self):
        history = [
            {"sender_type": "customer", "content": "I want to start a clothing business"},
            {"sender_type": "ai", "content": "How many pieces are you thinking of ordering?"},
            {"sender_type": "customer", "content": "Lagos, Nigeria"},
            {"sender_type": "ai", "content": "Do you have a budget in mind?"},
            {"sender_type": "customer", "content": "Around 2000 dollars"},
        ]
        guidance = self.build(history, ["quantity"])
        self.assertIn(ai_responder.NEXT_STEP_GUIDANCE, guidance)
        self.assertIn("Never ask for quantity again", guidance)
        self.assertNotIn('"quantity"', guidance)

    def test_other_missing_details_are_still_asked(self):
        history = [
            {"sender_type": "customer", "content": "I need wigs"},
            {"sender_type": "ai", "content": "How many wigs do you need?"},
            {"sender_type": "customer", "content": "Not sure yet"},
        ]
        guidance = self.build(history, ["quantity", "destination_country"])
        self.assertNotIn(ai_responder.NEXT_STEP_GUIDANCE, guidance)
        self.assertIn("destination_country", guidance)

    def test_quantity_can_be_asked_the_first_time(self):
        guidance = self.build([{"sender_type": "customer", "content": "I need wigs"}], ["quantity"])
        self.assertIn('"quantity"', guidance)
