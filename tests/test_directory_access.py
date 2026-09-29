from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from app.directory.access_gateway import lookup_directory
from app.directory.contracts import DirectoryContext, DirectoryTool
from app.directory.registry import REGISTRY
from app.directory.selection import select_directory_tool
from app.schemas.directory import DirectoryOutcome


def sample_tool(**overrides):
    values = {
        "tool_id": "provider_search",
        "family": "service_provider",
        "description": "test tool",
        "visibility": "public_with_premium_fields",
        "entitlement_key": "provider_search",
        "required_context": ("service",),
        "verification_policy": "verified_records_only",
        "public_fields": ("service",),
        "premium_fields": ("company", "phone"),
        "blocked_fields": ("notes", "source"),
        "premium_terms": ("phone", "contact"),
        "requires_verified_record": True,
        "human_on_unverified": True,
        "search": Mock(return_value=[]),
    }
    values.update(overrides)
    return DirectoryTool(**values)


class DirectoryAccessTests(unittest.TestCase):
    def setUp(self):
        self.context = DirectoryContext(
            business_id="business-1",
            conversation_id="conversation-1",
            customer_id="customer-1",
            identity_verified=True,
        )
        self.audit = Mock()
        self.tool = sample_tool()
        self.registry_patch = patch(
            "app.directory.access_gateway.get_tool",
            side_effect=lambda tool_id: self.tool if tool_id == self.tool.tool_id else None,
        )
        self.registry_patch.start()
        self.addCleanup(self.registry_patch.stop)

    def lookup(self, query="find freight service", **kwargs):
        return lookup_directory(
            tool_id=self.tool.tool_id,
            query=query,
            context=kwargs.pop("context", self.context),
            entitlement_check=kwargs.pop("entitlement_check", Mock(return_value=False)),
            audit_writer=kwargs.pop("audit_writer", self.audit),
        )

    def test_registry_has_stable_independent_tool_families(self):
        self.assertEqual(
            set(REGISTRY),
            {
                "category_market_search", "service_provider_search", "hotel_search",
                "restaurant_search", "city_area_guide_search",
            },
        )
        for tool in REGISTRY.values():
            self.assertFalse(set(tool.blocked_fields) & set(tool.public_fields))
            self.assertFalse(set(tool.blocked_fields) & set(tool.premium_fields))

    def test_tool_selection_is_deterministic(self):
        self.assertEqual(select_directory_tool("Find a halal restaurant", "general_information"), "restaurant_search")
        self.assertEqual(select_directory_tool("Need a freight forwarder", "shipping"), "service_provider_search")
        self.assertEqual(select_directory_tool("Where can I buy bags?", "product_sourcing"), "category_market_search")
        self.assertIsNone(select_directory_tool("Hello there", "greeting"))

    def test_premium_request_without_trusted_identity_returns_auth_required(self):
        search = Mock(return_value=[{"service": "freight", "phone": "+1", "verification_status": "verified"}])
        self.tool = sample_tool(search=search)
        context = DirectoryContext("business-1", "conversation-1")
        result = self.lookup("show the phone number", context=context)
        self.assertEqual(result.outcome, DirectoryOutcome.AUTH_REQUIRED)
        self.assertEqual(result.records, [])
        search.assert_not_called()

    def test_premium_data_is_not_searched_without_entitlement(self):
        search = Mock(return_value=[{"service": "freight", "phone": "+1", "verification_status": "verified"}])
        self.tool = sample_tool(search=search)
        result = self.lookup("show the phone number", entitlement_check=Mock(return_value=False))
        self.assertEqual(result.outcome, DirectoryOutcome.UPGRADE_REQUIRED)
        self.assertEqual(result.records, [])
        search.assert_not_called()

    def test_entitled_lookup_returns_only_allowed_verified_fields(self):
        self.tool = sample_tool(search=Mock(return_value=[{
            "service": "freight", "company": "FayFort Provider", "phone": "+1",
            "notes": "staff only", "source": "private source", "verification_status": "verified",
        }]))
        result = self.lookup("show the phone number", entitlement_check=Mock(return_value=True))
        self.assertEqual(result.outcome, DirectoryOutcome.ALLOW)
        self.assertEqual(result.records, [{"service": "freight", "company": "FayFort Provider", "phone": "+1"}])
        self.assertNotIn("notes", result.records[0])
        self.assertNotIn("source", result.records[0])

    def test_unverified_match_returns_human_outcome_without_record(self):
        self.tool = sample_tool(search=Mock(return_value=[{
            "service": "freight", "company": "Unverified provider", "verification_status": "unknown",
        }]))
        result = self.lookup()
        self.assertEqual(result.outcome, DirectoryOutcome.HUMAN_REQUIRED)
        self.assertTrue(result.requires_human)
        self.assertEqual(result.records, [])

    def test_unknown_location_keeps_taxonomy_but_hides_location_and_address(self):
        self.tool = sample_tool(
            tool_id="category_market_search",
            requires_verified_record=False,
            human_on_unverified=False,
            public_fields=("category", "product_type", "place_name", "city"),
            premium_fields=("address_cn",),
            premium_terms=("address",),
            search=Mock(return_value=[{
                "category": "Bags", "product_type": "Totes", "place_name": "Market A",
                "city": "Guangzhou", "address_cn": "private exact address",
                "verification_status": "unknown",
            }]),
        )
        result = self.lookup("find tote bags")
        self.assertEqual(result.outcome, DirectoryOutcome.ALLOW)
        self.assertEqual(result.records, [{
            "category": "Bags", "product_type": "Totes",
        }])

    def test_audit_failure_fails_closed(self):
        self.tool = sample_tool(search=Mock(return_value=[{"service": "freight", "verification_status": "verified"}]))
        result = self.lookup(audit_writer=Mock(side_effect=RuntimeError("audit unavailable")))
        self.assertEqual(result.outcome, DirectoryOutcome.HUMAN_REQUIRED)
        self.assertEqual(result.records, [])


if __name__ == "__main__":
    unittest.main()
