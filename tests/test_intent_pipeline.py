from __future__ import annotations

import json
import unittest
from unittest.mock import Mock, patch

import requests

from app.schemas.intent import ActionDecision, IntentName, IntentResult, NextAction
from app.services import intent_engine
from app.services.action_handler import prepare_action
from app.services.ai_responder import build_messages
from app.services.ai_budget import AIBudgetReservation


class FakeResponse:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


def provider_response(result: dict[str, object]) -> FakeResponse:
    return FakeResponse({"choices": [{"message": {"content": json.dumps(result)}}]})


def test_budget_reservation(operation: str = "intent") -> AIBudgetReservation:
    return AIBudgetReservation(
        request_id="test-request", business_id="test-business", operation=operation,
        model="openai/gpt-oss-120b", provider="deepinfra",
        input_price_micro_usd_per_million=40_000,
        output_price_micro_usd_per_million=170_000,
        max_input_tokens=1000, max_output_tokens=700, reserved_micro_usd=200,
    )


class IntentPipelineTests(unittest.TestCase):
    def test_parse_model_result_normalizes_language_tag(self) -> None:
        result = intent_engine._parse_model_result(
            json.dumps({
                "intent": "greeting",
                "action": "answer_question",
                "confidence": 0.9,
                "language": " zh_Hant ",
                "missing_information": [],
            })
        )
        self.assertEqual(result.language, "zh-hant")

    def test_parse_model_result_defaults_missing_language_to_unknown(self) -> None:
        result = intent_engine._parse_model_result(
            json.dumps({
                "intent": "greeting",
                "action": "answer_question",
                "confidence": 0.9,
                "missing_information": [],
            })
        )
        self.assertEqual(result.language, "und")
    def test_dict_missing_information_is_normalized_and_valid_facts_survive(self) -> None:
        result = intent_engine._parse_model_result(
            json.dumps(
                {
                    "intent": "product_sourcing",
                    "action": "update_requirements",
                    "confidence": 0.98,
                    "known_information": {"product": "handbags", "quantity": 1000},
                    "missing_information": {"style": None, "target_price": None},
                }
            )
        )
        self.assertEqual(result.known_information["quantity"], 1000)
        self.assertEqual(result.missing_information, ["style", "target_price"])

    def test_multi_turn_intent_updates_and_switches_to_shipping(self) -> None:
        model_results = [
            {
                "intent": "product_sourcing",
                "action": "collect_product_requirements",
                "confidence": 0.97,
                "known_information": {"product_type": "handbags", "source_country": "China"},
                "missing_information": ["quantity", "style"],
            },
            {
                "intent": "product_sourcing",
                "action": "update_requirements",
                "confidence": 0.97,
                "known_information": {"product_type": "handbags", "source_country": "China", "quantity": 500},
                "missing_information": ["style"],
            },
            {
                "intent": "product_sourcing",
                "action": "update_requirements",
                "confidence": 0.98,
                "known_information": {"product": "handbags", "source_country": "China", "quantity": 1000},
                "missing_information": {"style": None, "target_price": None},
            },
            {
                "intent": "shipping_quote",
                "action": "collect_shipping_details",
                "confidence": 0.96,
                "known_information": {"product": "handbags", "quantity": 1000, "destination_country": "Nigeria"},
                "missing_information": ["shipping_method"],
            },
        ]
        post = Mock(side_effect=[provider_response(item) for item in model_results])
        history: list[dict[str, str]] = []
        summary = ""
        messages = [
            "I want to source handbags from China.",
            "About 500 pieces.",
            "Actually, make it 1,000.",
            "How much would shipping to Nigeria cost?",
        ]

        with (
            patch.object(intent_engine.requests, "post", post),
            patch.object(intent_engine, "reserve_ai_usage_budget", return_value=test_budget_reservation()),
            patch.object(intent_engine, "settle_ai_usage_budget"),
            patch.object(intent_engine, "record_ai_usage"),
        ):
            results = []
            for message in messages:
                result = intent_engine.analyze_intent(
                    customer_message=message,
                    conversation_history=history,
                    conversation_summary=summary,
                    knowledge_context="Sourcing and shipping support; do not invent quotes.",
                    business_id="test-business",
                )
                results.append(result)
                history.extend(
                    [
                        {"sender_type": "customer", "content": message},
                        {"sender_type": "ai", "content": "Thanks, I have that noted."},
                    ]
                )
                summary = f"Known facts: {result.known_information}"

        self.assertEqual(results[0].intent, IntentName.PRODUCT_SOURCING)
        self.assertEqual(results[1].known_information["quantity"], 500)
        self.assertEqual(results[2].known_information["quantity"], 1000)
        self.assertEqual(results[2].missing_information, ["style", "target_price"])
        self.assertEqual(results[3].intent, IntentName.SHIPPING_QUOTE)
        self.assertEqual(results[3].known_information["quantity"], 1000)
        self.assertEqual(results[3].known_information["destination_country"], "Nigeria")

    def test_provider_request_uses_shared_endpoint_and_model(self) -> None:
        payload = {"intent": "general_information", "action": "answer_question", "confidence": 0.9}
        post = Mock(return_value=provider_response(payload))
        with (
            patch.object(intent_engine.requests, "post", post),
            patch.object(intent_engine, "reserve_ai_usage_budget", return_value=test_budget_reservation()),
            patch.object(intent_engine, "settle_ai_usage_budget"),
            patch.object(intent_engine, "record_ai_usage"),
        ):
            intent_engine.analyze_intent("What services do you offer?", business_id="test-business")
        self.assertEqual(post.call_args.args[0], intent_engine.settings.HF_CHAT_COMPLETIONS_URL)
        self.assertEqual(post.call_args.kwargs["json"]["model"], intent_engine.settings.HF_MODEL)

    def test_provider_failure_returns_safe_fallback(self) -> None:
        with (
            patch.object(intent_engine.requests, "post", side_effect=requests.ConnectionError),
            patch.object(intent_engine, "reserve_ai_usage_budget", return_value=test_budget_reservation()),
            patch.object(intent_engine, "settle_ai_usage_budget"),
            patch.object(intent_engine, "record_ai_usage"),
        ):
            result = intent_engine.analyze_intent("Can you help me?", business_id="test-business")
        self.assertEqual(result.intent, IntentName.UNKNOWN)
        self.assertTrue(result.clarification_needed)
        self.assertEqual(result.metadata["fallback_reason"], "provider_error")

    def test_response_messages_include_internal_intent_guidance(self) -> None:
        intent = IntentResult(
            intent="product_sourcing",
            action="collect_product_requirements",
            confidence=0.95,
            known_information={"product": "handbags", "quantity": 500},
            missing_information=["style"],
        )
        decision = prepare_action(intent)
        self.assertFalse(decision.should_execute)
        messages = build_messages(
            customer_message="I want handbags",
            intent_result=intent,
            action_decision=decision,
        )
        guidance = next(
            message["content"] for message in messages
            if "INTERNAL CONVERSATION HANDLING GUIDANCE" in message["content"]
        )
        self.assertIn("handbags", guidance)
        self.assertIn("style", guidance)
        self.assertIn("do not claim an operation", guidance)

    def test_message_route_passes_analysis_to_response_generator(self) -> None:
        from app import main

        intent = IntentResult(
            intent="product_sourcing",
            action="collect_product_requirements",
            confidence=0.95,
            known_information={"product": "handbags"},
            missing_information=["quantity"],
        )
        decision = ActionDecision(
            action=NextAction.COLLECT_PRODUCT_REQUIREMENTS,
            requirements_to_collect=["quantity"],
            response_guidance="Ask for quantity.",
            should_execute=False,
        )
        with (
            patch.object(main, "get_conversation", return_value={"business_id": "business-1", "summary": ""}),
            patch.object(main, "create_message", side_effect=lambda **kwargs: {"content": kwargs["content"]}),
            patch.object(main, "active_handoff_for_conversation", return_value=None),
            patch.object(main, "list_messages", return_value=[{"sender_type": "customer", "content": "I want handbags"}]),
            patch.object(main, "build_business_context", return_value="Sourcing services"),
            patch.object(main, "analyze_intent", return_value=intent) as analyze,
            patch.object(main, "update_customer_state", return_value=None),
            patch.object(main, "lookup_for_message", return_value=None),
            patch.object(main, "prepare_action", return_value=decision),
            patch.object(main, "match_approved_faq", return_value=None),
            patch.object(main, "_persist_intent_and_action"),
            patch.object(main, "generate_ai_response", return_value="What quantity do you need?") as respond,
            patch.object(main, "generate_conversation_summary", return_value="Sourcing handbags"),
            patch.object(main, "update_conversation_summary"),
        ):
            result = main._send_message_core("conversation-1", {"content": "I want handbags"})

        analyze.assert_called_once()
        self.assertEqual(respond.call_args.kwargs["intent_result"], intent)
        self.assertEqual(respond.call_args.kwargs["action_decision"], decision)
        self.assertEqual(result["response"], "What quantity do you need?")

    def test_instagram_inbound_without_auto_reply_skips_response_and_summary_models(self) -> None:
        from app import main

        intent = IntentResult(
            intent="general_information",
            action="answer_question",
            confidence=0.9,
        )
        decision = ActionDecision(
            action=NextAction.ANSWER_QUESTION,
            response_guidance="Answer from saved business knowledge.",
            should_execute=False,
        )
        with (
            patch.object(main, "get_conversation", return_value={"business_id": "business-1", "summary": ""}),
            patch.object(main, "create_message", side_effect=lambda **kwargs: {"id": "customer-message", **kwargs}) as create,
            patch.object(main, "active_handoff_for_conversation", return_value=None),
            patch.object(main, "list_messages", return_value=[{"sender_type": "customer", "content": "What do you offer?"}]),
            patch.object(main, "build_business_context", return_value="Saved business information"),
            patch.object(main, "analyze_intent", return_value=intent) as analyze,
            patch.object(main, "update_customer_state", return_value=None),
            patch.object(main, "lookup_for_message", return_value=None),
            patch.object(main, "prepare_action", return_value=decision),
            patch.object(main, "match_approved_faq") as faq_lookup,
            patch.object(main, "_persist_intent_and_action"),
            patch.object(main, "generate_ai_response") as respond,
            patch.object(main, "generate_conversation_summary") as summarize,
            patch.object(main, "update_conversation_summary") as save_summary,
        ):
            result = main._send_message_core(
                "conversation-1",
                {"content": "What do you offer?"},
                inbound_context={
                    "channel": "instagram",
                    "provider_event_id": "provider-event-1",
                    "automation_reply_enabled": False,
                },
            )

        analyze.assert_called_once()
        faq_lookup.assert_not_called()
        respond.assert_not_called()
        summarize.assert_not_called()
        save_summary.assert_not_called()
        create.assert_called_once()
        self.assertIsNone(result["ai_message"])
        self.assertIsNone(result["response"])


if __name__ == "__main__":
    unittest.main()
