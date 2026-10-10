from __future__ import annotations

import unittest

from app.handoffs.capacity import estimate_handoff_wait


class HandoffWaitEstimateTests(unittest.TestCase):
    def test_estimates_range_from_recent_samples_and_capacity_waves(self):
        estimate = estimate_handoff_wait(5, 2, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        self.assertEqual(estimate["status"], "estimated")
        self.assertEqual(estimate["lower_minutes"], 15)
        self.assertEqual(estimate["upper_minutes"], 27)
        self.assertEqual(estimate["sample_size"], 10)

    def test_withholds_estimate_when_capacity_or_sample_size_is_unknown(self):
        self.assertEqual(estimate_handoff_wait(1, 0, [1] * 10)["status"], "unavailable")
        self.assertEqual(estimate_handoff_wait(1, 1, [1] * 4)["status"], "unavailable")

    def test_ignores_invalid_or_implausible_samples(self):
        estimate = estimate_handoff_wait(1, 1, [None, "bad", float("nan"), -1, 1441, 3, 4, 5, 6, 7])
        self.assertEqual(estimate["status"], "estimated")
        self.assertEqual(estimate["sample_size"], 5)


if __name__ == "__main__":
    unittest.main()
