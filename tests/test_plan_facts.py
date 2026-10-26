"""The AI's plan documents are written from the plan rules, so they always quote the current prices."""
import unittest
from unittest.mock import patch

from app.knowledge import plan_facts


class PlanFactsTests(unittest.TestCase):
    def test_documents_quote_the_current_rules(self):
        docs = plan_facts.documents()
        plans_doc = docs["Membership plans"]
        self.assertIn("$5.99 a month", plans_doc)
        self.assertIn("$14.99 a month", plans_doc)
        self.assertIn("| Consultation (1 hour) | $100 | $85 | $50 |", plans_doc)
        self.assertIn("3 included each paid month", plans_doc)
        self.assertIn("No consultation is included free", docs["Consultations"])
        self.assertIn("Pro +40", docs["Points and ranks"])
        for text in docs.values():
            self.assertNotIn("$19", text)
            self.assertNotIn("$49", text)

    def test_price_change_flows_into_the_documents(self):
        with patch.object(plan_facts.settings, "MEMBER_PRO_MONTHLY_PRICE", 16.5):
            self.assertIn("$16.50 a month", plan_facts.documents()["Membership plans"])


if __name__ == "__main__":
    unittest.main()
