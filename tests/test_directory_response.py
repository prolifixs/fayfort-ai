from __future__ import annotations

import unittest

from app.directory.response import format_directory_response
from app.schemas.directory import DirectoryOutcome, DirectoryToolResult, VerificationState


class DirectoryResponseTests(unittest.TestCase):
    def test_allow_response_contains_only_approved_record_fields(self):
        result = DirectoryToolResult(
            tool_id="service_provider_search",
            outcome=DirectoryOutcome.ALLOW,
            records=[{
                "service": "Freight forwarder",
                "city": "Guangzhou",
                "ships_to": "Senegal",
                "phone_wechat": "+86 private",
            }],
            message="Use only the returned fields.",
            verification_state=VerificationState.VERIFIED,
            allowed_fields=["city", "service", "ships_to"],
        )
        text = format_directory_response(result)
        self.assertIn("Freight forwarder", text)
        self.assertIn("Guangzhou", text)
        self.assertIn("Senegal", text)
        self.assertNotIn("private", text)
        self.assertNotIn("website", text)

    def test_non_allow_outcome_returns_gateway_message_verbatim(self):
        result = DirectoryToolResult(
            tool_id="service_provider_search",
            outcome=DirectoryOutcome.AUTH_REQUIRED,
            message="Sign-in is required.",
        )
        self.assertEqual(format_directory_response(result), "Sign-in is required.")


if __name__ == "__main__":
    unittest.main()
