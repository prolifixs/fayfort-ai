from __future__ import annotations

import unittest

from scripts.evaluate_ai_models import _meets_promotion_threshold


class ModelEvaluationTests(unittest.TestCase):
    def test_two_repeat_comparison_uses_repeat_scaled_case_totals(self):
        baseline = {
            "passed_critical_cases": 18,
            "total_actual_cost_micro_usd": 1113,
        }
        candidate = {
            "total_cases": 20,
            "passed_cases": 20,
            "passed_critical_cases": 18,
            "total_critical_cases": 18,
            "valid_response_count": 20,
            "total_actual_cost_micro_usd": 898,
        }
        self.assertTrue(_meets_promotion_threshold(
            baseline, candidate, expected_total=20, expected_critical=18,
        ))

    def test_candidate_with_empty_response_does_not_pass_reliability_threshold(self):
        baseline = {"passed_critical_cases": 18, "total_actual_cost_micro_usd": 1113}
        candidate = {
            "total_cases": 20,
            "passed_cases": 20,
            "passed_critical_cases": 18,
            "total_critical_cases": 18,
            "valid_response_count": 19,
            "total_actual_cost_micro_usd": 898,
        }
        self.assertFalse(_meets_promotion_threshold(
            baseline, candidate, expected_total=20, expected_critical=18,
        ))

    def test_candidate_without_lower_cost_does_not_pass_promotion_threshold(self):
        baseline = {"passed_critical_cases": 18, "total_actual_cost_micro_usd": 1113}
        candidate = {
            "total_cases": 20,
            "passed_cases": 20,
            "passed_critical_cases": 18,
            "total_critical_cases": 18,
            "valid_response_count": 20,
            "total_actual_cost_micro_usd": 1113,
        }
        self.assertFalse(_meets_promotion_threshold(
            baseline, candidate, expected_total=20, expected_critical=18,
        ))
