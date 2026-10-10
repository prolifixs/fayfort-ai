from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from app.services.ai_budget import (
    AIBudgetExceeded,
    AIBudgetUnavailable,
    AIBudgetReservation,
    _calculate_cost_micro_usd,
    estimate_input_token_upper_bound,
    fetch_pinned_provider_prices,
    _micro_usd_per_million,
    reserve_ai_usage_budget,
    settle_ai_usage_budget,
)


class AiBudgetTests(unittest.TestCase):
    def test_provider_float_rate_noise_does_not_overstate_model_cost(self):
        self.assertEqual(_micro_usd_per_million(0.030000000000000002), 30_000)

    def test_cost_rounds_up_to_microdollars(self):
        self.assertEqual(_calculate_cost_micro_usd(1, 1), 1)
        self.assertEqual(_calculate_cost_micro_usd(1_000_000, 40_000), 40_000)
        self.assertEqual(_calculate_cost_micro_usd(0, 40_000), 0)

    def test_input_upper_bound_counts_utf8_bytes_and_chat_framing(self):
        messages = [{"role": "user", "content": "café"}]
        bound = estimate_input_token_upper_bound(messages)
        self.assertGreaterEqual(bound, len('café'.encode("utf-8")) + 16)

    def test_input_over_limit_fails_closed(self):
        with patch("app.services.ai_budget.settings.AI_MAX_INPUT_BYTES", 5):
            with self.assertRaises(AIBudgetUnavailable):
                estimate_input_token_upper_bound([{"role": "user", "content": "too long"}])

    def test_dynamic_provider_policy_is_rejected_for_budgeted_requests(self):
        with patch("app.services.ai_budget.settings.HF_MODEL", "openai/gpt-oss-120b:fastest"):
            with self.assertRaises(AIBudgetUnavailable):
                fetch_pinned_provider_prices()

    @patch("app.services.ai_budget.requests.get")
    def test_live_price_lookup_requires_pinned_provider_and_enforces_ceiling(self, get):
        with (
            patch("app.services.ai_budget.settings.HF_MODEL", "openai/gpt-oss-120b:deepinfra"),
            patch("app.services.ai_budget.settings.HF_TOKEN", "test-token"),
            patch("app.services.ai_budget.settings.HF_CHAT_COMPLETIONS_URL", "https://router.huggingface.co/v1/chat/completions"),
            patch("app.services.ai_budget.settings.AI_MODEL_INPUT_PRICE_USD_PER_MILLION", "0.04"),
            patch("app.services.ai_budget.settings.AI_MODEL_OUTPUT_PRICE_USD_PER_MILLION", "0.17"),
        ):
            get.return_value.json.return_value = {"data": {"providers": [
                {"provider": "deepinfra", "status": "live", "pricing": {"input": 0.04, "output": 0.17}},
            ]}}
            self.assertEqual(fetch_pinned_provider_prices(), (40_000, 170_000))
            self.assertEqual(get.call_args.args[0], "https://router.huggingface.co/v1/models/openai/gpt-oss-120b")
            get.return_value.json.return_value["data"]["providers"][0]["pricing"]["output"] = 0.18
            with self.assertRaises(AIBudgetUnavailable):
                fetch_pinned_provider_prices()

    @patch("app.services.ai_budget.requests.get")
    def test_live_price_lookup_returns_actual_rates_below_the_approved_ceiling(self, get):
        with (
            patch("app.services.ai_budget.settings.HF_MODEL", "openai/gpt-oss-20b:deepinfra"),
            patch("app.services.ai_budget.settings.HF_TOKEN", "test-token"),
            patch("app.services.ai_budget.settings.HF_CHAT_COMPLETIONS_URL", "https://router.huggingface.co/v1/chat/completions"),
            patch("app.services.ai_budget.settings.AI_MODEL_INPUT_PRICE_USD_PER_MILLION", "0.04"),
            patch("app.services.ai_budget.settings.AI_MODEL_OUTPUT_PRICE_USD_PER_MILLION", "0.17"),
        ):
            get.return_value.json.return_value = {"data": {"providers": [
                {"provider": "deepinfra", "status": "live", "pricing": {"input": 0.03, "output": 0.14}},
            ]}}
            self.assertEqual(fetch_pinned_provider_prices(), (30_000, 140_000))

    @patch("app.services.ai_budget.supabase.rpc")
    @patch("app.services.ai_budget.fetch_pinned_provider_prices", return_value=(40_000, 170_000))
    @patch("app.services.ai_budget.settings.HF_MODEL", "openai/gpt-oss-120b:deepinfra")
    def test_reservation_uses_live_approved_rates_and_max_output(self, pricing, rpc):
        rpc.return_value.execute.return_value.data = {"allowed": True}
        with patch("app.services.ai_budget.settings.AI_MAX_INPUT_BYTES", 65536):
            reservation = reserve_ai_usage_budget(
                business_id="business-1", operation="response",
                messages=[{"role": "user", "content": "Hi"}], max_output_tokens=500,
            )
        self.assertEqual(reservation.provider, "deepinfra")
        self.assertEqual(reservation.input_price_micro_usd_per_million, 40_000)
        params = rpc.call_args.args[1]
        self.assertEqual(params["p_max_output_tokens"], 500)
        self.assertEqual(params["p_reserved_micro_usd"], reservation.reserved_micro_usd)

    @patch("app.services.ai_budget.supabase.rpc")
    @patch("app.services.ai_budget.fetch_pinned_provider_prices", return_value=(40_000, 170_000))
    @patch("app.services.ai_budget.settings.HF_MODEL", "openai/gpt-oss-120b:deepinfra")
    def test_denied_atomic_reservation_raises_before_inference(self, pricing, rpc):
        rpc.return_value.execute.return_value.data = {"allowed": False, "reason": "monthly_budget_exceeded"}
        with self.assertRaises(AIBudgetExceeded):
            reserve_ai_usage_budget(
                business_id="business-1", operation="response",
                messages=[{"role": "user", "content": "Hi"}], max_output_tokens=500,
            )

    @patch("app.services.ai_budget.supabase.rpc")
    def test_unknown_provider_result_keeps_full_reservation_held(self, rpc):
        reservation = AIBudgetReservation(
            request_id="request-1", business_id="business-1", operation="response",
            model="openai/gpt-oss-120b", provider="deepinfra",
            input_price_micro_usd_per_million=40_000,
            output_price_micro_usd_per_million=170_000,
            max_input_tokens=100, max_output_tokens=500, reserved_micro_usd=90,
        )
        settle_ai_usage_budget(reservation, None)
        self.assertEqual(rpc.call_args.args[0], "settle_ai_usage_budget")
        self.assertEqual(rpc.call_args.args[1]["p_reservation_status"], "uncertain")
        self.assertIsNone(rpc.call_args.args[1]["p_actual_micro_usd"])

    @patch("app.services.ai_budget.supabase.rpc")
    def test_explicit_rejection_can_release_reservation(self, rpc):
        reservation = AIBudgetReservation(
            request_id="request-rejected", business_id="business-1", operation="response",
            model="openai/gpt-oss-120b", provider="deepinfra",
            input_price_micro_usd_per_million=40_000,
            output_price_micro_usd_per_million=170_000,
            max_input_tokens=100, max_output_tokens=500, reserved_micro_usd=90,
        )
        settle_ai_usage_budget(reservation, None, release=True)
        self.assertEqual(rpc.call_args.args[0], "settle_ai_usage_budget")
        self.assertEqual(rpc.call_args.args[1]["p_reservation_status"], "released")
        self.assertIsNone(rpc.call_args.args[1]["p_actual_micro_usd"])


if __name__ == "__main__":
    unittest.main()
