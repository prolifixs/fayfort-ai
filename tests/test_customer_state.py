from __future__ import annotations

import unittest
from unittest.mock import patch

from app.schemas.intent import ClassificationStatus, IntentResult
from app.services import customer_state


def request_row(**overrides):
    row = {
        "id": "request-1",
        "customer_id": "customer-1",
        "conversation_id": "conversation-1",
        "related_request_id": None,
        "request_type": "product_sourcing",
        "status": "active",
        "details": {"product": "handbags", "quantity": 500},
        "required_information": ["product", "quantity", "color"],
        "missing_information": ["color"],
    }
    row.update(overrides)
    return row


class CustomerStateTests(unittest.TestCase):
    def setUp(self):
        self.conversation = {
            "id": "conversation-1",
            "business_id": "business-1",
            "channel": "whatsapp",
            "customer_external_id": "external-1",
        }

    def test_continue_applies_correction_and_preserves_omitted_facts(self):
        prior = request_row()
        updated = {**prior}
        with (
            patch.object(customer_state, "get_customer_by_identity", return_value={"id": "customer-1", "profile": {"country": "Nigeria"}}),
            patch.object(customer_state, "upsert_customer", return_value={"id": "customer-1"}),
            patch.object(customer_state, "get_current_customer_request", return_value=prior),
            patch.object(customer_state, "update_customer_request", side_effect=lambda _id, **fields: updated.update(fields) or updated) as save_request,
        ):
            result = customer_state.update_customer_state(
                self.conversation,
                IntentResult(
                    intent="product_sourcing",
                    action="update_requirements",
                    confidence=0.97,
                    known_information={"quantity": 800},
                    required_information=["product", "quantity", "color"],
                    missing_information=["color"],
                    request_relationship="continue",
                ),
            )

        self.assertEqual(result.request.details["product"], "handbags")
        self.assertEqual(result.request.details["quantity"], 800)
        self.assertEqual(result.request.missing_information, ["color"])
        save_request.assert_called_once()

    def test_provider_failure_reads_existing_state_without_writing(self):
        prior = request_row()
        with (
            patch.object(customer_state, "get_customer_by_identity", return_value={"id": "customer-1", "profile": {"country": "Nigeria"}}),
            patch.object(customer_state, "get_current_customer_request", return_value=prior),
            patch.object(customer_state, "upsert_customer") as save_customer,
            patch.object(customer_state, "create_customer_request") as create_request,
            patch.object(customer_state, "update_customer_request") as update_request,
        ):
            result = customer_state.update_customer_state(
                self.conversation,
                IntentResult(
                    intent="unknown",
                    action="clarify_intent",
                    confidence=0,
                    classification_status=ClassificationStatus.PROVIDER_ERROR,
                ),
            )

        self.assertEqual(result.request.id, "request-1")
        self.assertEqual(result.request.details["quantity"], 500)
        save_customer.assert_not_called()
        create_request.assert_not_called()
        update_request.assert_not_called()

    def test_related_request_is_created_without_erasing_the_current_request(self):
        prior = request_row()
        shipping = request_row(
            id="request-2",
            request_type="shipping_quote",
            related_request_id="request-1",
            details={"destination_country": "Nigeria"},
            required_information=["destination_country"],
            missing_information=[],
        )
        with (
            patch.object(customer_state, "get_customer_by_identity", return_value={"id": "customer-1", "profile": {}}),
            patch.object(customer_state, "upsert_customer", return_value={"id": "customer-1"}),
            patch.object(customer_state, "get_current_customer_request", return_value=prior),
            patch.object(customer_state, "create_customer_request", return_value=shipping) as create_request,
        ):
            result = customer_state.update_customer_state(
                self.conversation,
                IntentResult(
                    intent="shipping_quote",
                    action="collect_shipping_details",
                    confidence=0.94,
                    known_information={"destination_country": "Nigeria"},
                    required_information=["destination_country"],
                    request_relationship="related",
                ),
            )

        self.assertEqual(result.request.related_request_id, "request-1")
        self.assertEqual(create_request.call_args.kwargs["related_request_id"], "request-1")

    def test_explicit_clear_removes_value_and_marks_required_field_missing(self):
        prior = request_row()
        updated = {**prior}
        with (
            patch.object(customer_state, "get_customer_by_identity", return_value={"id": "customer-1", "profile": {}}),
            patch.object(customer_state, "upsert_customer", return_value={"id": "customer-1"}),
            patch.object(customer_state, "get_current_customer_request", return_value=prior),
            patch.object(customer_state, "update_customer_request", side_effect=lambda _id, **fields: updated.update(fields) or updated),
        ):
            result = customer_state.update_customer_state(
                self.conversation,
                IntentResult(
                    intent="product_sourcing",
                    action="update_requirements",
                    confidence=0.93,
                    required_information=["product", "quantity"],
                    cleared_information=["quantity"],
                    request_relationship="continue",
                ),
            )

        self.assertNotIn("quantity", result.request.details)
        self.assertIn("quantity", result.request.missing_information)
        self.assertEqual(result.request.status, "awaiting_customer")


if __name__ == "__main__":
    unittest.main()
