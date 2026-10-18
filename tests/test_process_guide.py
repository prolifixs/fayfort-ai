"""Walk-throughs (docs/KNOWLEDGE_AND_AI_PLAN.md, "Walking customers through a process")."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.directory.selection import select_directory_tool
from app.schemas.intent import ActionDecision, IntentResult, NextAction
from app.services.ai_responder import _guard_response_grounding, build_messages
from app.services.process_guide import asks_for_process, meaningful_terms

BUSINESS = "00000000-0000-0000-0000-000000000001"
CONVERSATION = "00000000-0000-0000-0000-000000000002"
SCREENSHOT = "I want to buy furniture, walk me through the purchase process"


class ProcessQuestionTests(unittest.TestCase):
    def test_process_questions_are_recognised_whatever_the_product(self):
        for text in (
            SCREENSHOT,
            "How does it work?",
            "how do I order wigs from you",
            "What is the process for importing a container of tiles?",
            "Can you explain the process step by step",
            "what happens after I pay the deposit",
            "How will you handle my order from start to finish?",
            "how to buy from china with fayfort",
            "How does a group buy work",
        ):
            with self.subTest(text=text):
                self.assertTrue(asks_for_process(text))

    def test_plain_requests_are_not_process_questions(self):
        for text in ("I want to buy furniture", "where can I buy wigs in Guangzhou", "hotel near Canton Fair",
                     "how much is the lace wig", "Ghana", "Thanks dear"):
            with self.subTest(text=text):
                self.assertFalse(asks_for_process(text))

    def test_filler_and_process_words_never_become_search_terms(self):
        self.assertEqual(meaningful_terms(SCREENSHOT), ["furniture"])
        self.assertEqual(meaningful_terms("Restaurant furnishing packages for 3 villas"),
                         ["restaurant", "furnishing", "package", "villa"])
        self.assertEqual(meaningful_terms("广州 假发 wigs"), ["广州", "假发", "wig"])
        self.assertEqual(meaningful_terms("walk me through it please"), [])


class DirectoryRoutingTests(unittest.TestCase):
    def test_process_questions_skip_the_directory(self):
        self.assertIsNone(select_directory_tool(SCREENSHOT, "product_sourcing"))
        self.assertIsNone(select_directory_tool("how does sourcing from a market work", "general_information"))

    def test_directory_requests_still_route(self):
        self.assertEqual(select_directory_tool("where can I buy wigs", "general_information"), "category_market_search")
        self.assertEqual(select_directory_tool("halal food in Guangzhou", "general_information"), "restaurant_search")
        self.assertEqual(select_directory_tool("freight forwarder to Lagos", "general_information"),
                         "service_provider_search")

    def test_whole_words_only(self):
        # "great" contains "eat", "resources" contains "source": neither is a directory request.
        self.assertIsNone(select_directory_tool("That sounds great", "general_information"))
        self.assertIsNone(select_directory_tool("any resources to read?", "general_information"))


class DirectorySearchRankingTests(unittest.TestCase):
    def test_only_rows_matching_the_most_words_come_back(self):
        from app.database.directory import common

        rows = [
            {"category": "Embroidery fabric", "group_name": "Fabrics & Garment Production", "product_type": "Fabrics"},
            {"category": "Villa furnishing packages", "group_name": "Home, Furniture & Interior", "product_type": "Furniture"},
            {"category": "Office chairs", "group_name": "Home, Furniture & Interior", "product_type": "Furniture"},
        ]
        client = MagicMock()
        client.table.return_value.select.return_value.or_.return_value.limit.return_value.execute.return_value = MagicMock(data=rows)
        with patch.object(common, "supabase", client):
            found = common.search_rows("directory_categories", "villa furniture walk me through it",
                                       ("category", "group_name", "product_type"), limit=20)
        self.assertEqual([row["category"] for row in found], ["Villa furnishing packages"])
        clauses = client.table.return_value.select.return_value.or_.call_args.args[0]
        self.assertIn("category.ilike.%villa%", clauses)
        self.assertNotIn("%me%", clauses)
        self.assertNotIn("%through%", clauses)

    def test_nothing_to_search_returns_nothing(self):
        from app.database.directory import common

        client = MagicMock()
        with patch.object(common, "supabase", client):
            self.assertEqual(common.search_rows("directory_categories", "walk me through it", ("category",)), [])
        client.table.assert_not_called()


class WalkthroughReplyTests(unittest.TestCase):
    def test_walkthrough_adds_the_guidance(self):
        messages = build_messages(SCREENSHOT, knowledge_context="Facts", walkthrough=True)
        self.assertTrue(any(m["content"].startswith("THIS REPLY:") for m in messages))
        plain = build_messages(SCREENSHOT, knowledge_context="Facts")
        self.assertFalse(any(m["content"].startswith("THIS REPLY:") for m in plain))

    def test_numbered_steps_are_not_treated_as_promises(self):
        answer = ("Here's how it works for your furniture, dear:\n"
                  "1. Sign up free and send a sourcing request.\n"
                  "2. We will send you options with prices and notes.\n"
                  "3. We'll ship it with a tracking number.\n"
                  "Where will it be shipped to?")
        self.assertEqual(_guard_response_grounding(answer=answer, customer_message=SCREENSHOT,
                                                   knowledge_context="Facts", action_decision=None), answer)

    def test_a_bare_promise_outside_the_steps_is_still_caught(self):
        answer = "I'll forward this to the team right now."
        self.assertNotEqual(_guard_response_grounding(answer=answer, customer_message="hello",
                                                      knowledge_context="Facts", action_decision=None), answer)


class PipelineWalkthroughTests(unittest.TestCase):
    def test_a_process_question_gets_the_ai_walkthrough_not_a_directory_list(self):
        from app import main

        intent = IntentResult(intent="product_sourcing", action="collect_product_requirements", confidence=0.9)
        decision = ActionDecision(action=NextAction.COLLECT_PRODUCT_REQUIREMENTS, needs_human=False,
                                  response_guidance="", should_execute=False)
        with (
            patch.object(main, "get_conversation", return_value={"id": CONVERSATION, "business_id": BUSINESS, "summary": ""}),
            patch.object(main, "create_message", side_effect=lambda **kwargs: {"id": "m", **kwargs}),
            patch.object(main, "active_handoff_for_conversation", return_value=None),
            patch.object(main, "list_messages", return_value=[]),
            patch.object(main, "build_business_context", return_value="How sourcing works: ..."),
            patch.object(main, "analyze_intent", return_value=intent),
            patch.object(main, "update_customer_state", return_value=None),
            patch.object(main.settings, "DIRECTORY_TOOLS_ENABLED", True),
            patch("app.directory.service.lookup_directory") as directory,
            patch("app.automations.service.select_approved_reply_automation") as canned,
            patch.object(main, "match_approved_faq") as faq,
            patch.object(main, "prepare_action", return_value=decision),
            patch.object(main, "request_customer_handoff", return_value=None),
            patch.object(main, "_persist_intent_and_action"),
            patch.object(main, "generate_ai_response", return_value="1. Sign up free...") as respond,
            patch.object(main, "generate_conversation_summary", return_value=""),
            patch.object(main, "update_conversation_summary"),
        ):
            result = main._send_message_core(
                CONVERSATION, {"content": SCREENSHOT},
                inbound_context={"channel": "instagram", "provider_event_id": "evt-1", "automation_reply_enabled": True},
            )
        directory.assert_not_called()
        canned.assert_not_called()
        faq.assert_not_called()
        self.assertTrue(respond.call_args.kwargs["walkthrough"])
        self.assertEqual(result["response"], "1. Sign up free...")


if __name__ == "__main__":
    unittest.main()
