from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.faq_matching import match_approved_faq, normalize_faq_question


class KnowledgeAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-token"}

    @patch("app.main.list_knowledge_documents")
    @patch("app.main.trusted_business_member", return_value=None)
    def test_business_knowledge_requires_active_member_before_read(self, member, list_documents):
        response = self.client.get("/businesses/business-a/knowledge")

        self.assertEqual(response.status_code, 401)
        list_documents.assert_not_called()
        member.assert_called_once()

    @patch("app.main.list_knowledge_chunks")
    @patch("app.main.get_knowledge_document", return_value={"id": "doc-a", "business_id": "business-a"})
    @patch("app.main.trusted_business_member", return_value=None)
    def test_document_content_requires_membership_of_owning_business(self, member, get_document, list_chunks):
        response = self.client.get("/knowledge/doc-a", headers=self.headers)

        self.assertEqual(response.status_code, 401)
        list_chunks.assert_not_called()
        member.assert_called_once_with(self.headers["Authorization"], "business-a")

    @patch("app.main.create_knowledge_document")
    @patch("app.main.trusted_business_member", return_value={"role": "member", "user_id": "user-a"})
    def test_only_owner_or_admin_can_create_business_knowledge(self, member, create_document):
        response = self.client.post(
            "/businesses/business-a/knowledge",
            headers=self.headers,
            json={"title": "Policies", "content": "Cancellation notice is 24 hours."},
        )

        self.assertEqual(response.status_code, 403)
        create_document.assert_not_called()
        member.assert_called_once_with(self.headers["Authorization"], "business-a")

    @patch("app.main.update_knowledge_document")
    @patch("app.main.get_knowledge_document", return_value={"id": "doc-a", "business_id": "business-a"})
    @patch("app.main.trusted_business_member", return_value=None)
    def test_only_owner_or_admin_can_update_knowledge(self, member, get_document, update_document):
        response = self.client.put(
            "/knowledge/doc-a",
            headers=self.headers,
            json={"title": "Policies", "content": "Changed content."},
        )

        self.assertEqual(response.status_code, 401)
        update_document.assert_not_called()

    @patch("app.main.list_knowledge_chunks", return_value=[{"content": "Cancellation notice is 24 hours."}])
    @patch("app.main.get_knowledge_document", return_value={"id": "doc-a", "business_id": "business-a"})
    @patch("app.main.trusted_business_member", return_value={"role": "member", "user_id": "user-a"})
    def test_business_member_can_read_context_for_owned_document(self, member, get_document, list_chunks):
        response = self.client.get("/knowledge/doc-a/context", headers=self.headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["context"], "Cancellation notice is 24 hours.")
        member.assert_called_once_with(self.headers["Authorization"], "business-a")
        list_chunks.assert_called_once_with("doc-a")


class ApprovedFaqWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-token"}

    def test_normalized_matching_is_case_punctuation_and_whitespace_exact(self):
        self.assertEqual(normalize_faq_question("  WHAT are our hours?! "), "what are our hours")
        self.assertNotEqual(
            normalize_faq_question("When do you close?"),
            normalize_faq_question("What are your hours?"),
        )

    @patch("app.services.faq_matching.find_approved_faq", return_value={"answer": "We close at 6 PM."})
    def test_faq_lookup_uses_normalized_question_key(self, find):
        result = match_approved_faq("business-a", "WHAT are our hours?!")
        self.assertEqual(result["answer"], "We close at 6 PM.")
        find.assert_called_once_with("business-a", "what are our hours")

    @patch("app.knowledge.router.list_business_faqs")
    @patch("app.knowledge.router.trusted_business_member", return_value={"role": "member", "user_id": "user-a"})
    def test_member_can_read_faqs(self, member, list_faqs):
        list_faqs.return_value = [{"id": "faq-a", "status": "draft"}]
        response = self.client.get("/businesses/business-a/faqs", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["faqs"][0]["status"], "draft")
        member.assert_called_once_with(self.headers["Authorization"], "business-a")

    @patch("app.knowledge.router.create_business_faq_version")
    @patch("app.knowledge.router.trusted_business_member", return_value={"role": "member", "user_id": "user-a"})
    def test_only_owner_or_admin_can_create_faq(self, member, create_version):
        response = self.client.post(
            "/businesses/business-a/faqs",
            headers=self.headers,
            json={"question": "What are our hours?", "answer": "We close at 6 PM."},
        )
        self.assertEqual(response.status_code, 403)
        create_version.assert_not_called()

    @patch("app.knowledge.router.create_business_faq_version", return_value={"id": "faq-a", "status": "draft"})
    @patch("app.knowledge.router.trusted_business_member", return_value={"role": "owner", "user_id": "owner-a"})
    def test_owner_creation_creates_a_draft_with_server_normalized_key(self, member, create_version):
        response = self.client.post(
            "/businesses/business-a/faqs",
            headers=self.headers,
            json={"question": "What are our hours?!", "answer": "We close at 6 PM."},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["faq"]["status"], "draft")
        self.assertEqual(create_version.call_args.kwargs["question_key"], "what are our hours")
        self.assertEqual(create_version.call_args.kwargs["actor_id"], "owner-a")

    @patch("app.main.generate_ai_response")
    @patch("app.main.build_business_context")
    @patch("app.main.match_approved_faq", return_value={"answer": "We close at 6 PM."})
    @patch("app.main.trusted_business_member", return_value={"role": "member", "user_id": "user-a"})
    def test_direct_ai_endpoint_returns_exact_approved_faq_without_model_call(
        self, member, match_faq, build_context, generate_response,
    ):
        response = self.client.post(
            "/ai/respond",
            headers=self.headers,
            json={"business_id": "business-a", "message": "What are our hours?"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"response": "We close at 6 PM."})
        generate_response.assert_not_called()
        build_context.assert_not_called()


if __name__ == "__main__":
    unittest.main()
