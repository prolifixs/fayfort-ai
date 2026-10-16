"""What the AI reads: business facts plus approved FAQs; conversation guides are kept apart as tone instructions."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.services import ai_responder, rag

DOCS = [
    {"id": "facts", "source_type": "manual", "content": "Standard costs $19 a month."},
    {"id": "tone", "source_type": "guide", "content": "Warm, one question at a time."},
]
CHUNKS = {"facts": [{"content": "Standard costs $19 a month."}], "tone": [{"content": "Warm, one question at a time."}]}
FAQS = [
    {"status": "approved", "question": "Do you ship to Ghana?", "answer": "Yes, we ship to Ghana."},
    {"status": "draft", "question": "Draft question", "answer": "Not live."},
]


class KnowledgeContextTests(unittest.TestCase):
    @patch("app.services.rag.list_knowledge_chunks", side_effect=lambda doc_id: CHUNKS[doc_id])
    @patch("app.services.rag.list_knowledge_documents", return_value=DOCS)
    @patch("app.database.business_faqs.list_business_faqs", return_value=FAQS)
    def test_facts_and_approved_faqs_feed_the_ai_but_not_guides_or_drafts(self, faqs, docs, chunks):
        context = rag.build_business_context("biz")
        self.assertIn("Standard costs $19 a month.", context)
        self.assertIn("Q: Do you ship to Ghana?\nA: Yes, we ship to Ghana.", context)
        self.assertNotIn("Warm, one question", context)
        self.assertNotIn("Not live", context)
        self.assertEqual(rag.build_business_guide("biz"), "Warm, one question at a time.")

    def test_guide_and_hours_are_separate_instructions_not_facts(self):
        messages = ai_responder.build_messages(customer_message="Hi", knowledge_context="Facts.",
                                               business_guide="Warm, one question at a time.",
                                               time_context="Now in China: Friday 14:00.")
        joined = [m["content"] for m in messages]
        self.assertEqual(joined[1], "BUSINESS KNOWLEDGE:\nFacts.")
        self.assertTrue(any(text.startswith("CONVERSATION GUIDE FROM THE BUSINESS") and "Warm" in text for text in joined))
        self.assertTrue(any(text.startswith("SUPPORT HOURS:") for text in joined))
        self.assertIn("never use \"love\", \"honey\"".lower(), messages[0]["content"].lower())


class KnowledgeDeleteTests(unittest.TestCase):
    def setUp(self):
        from app.main import app
        self.client = TestClient(app)

    @patch("app.main.delete_knowledge_document")
    @patch("app.main.delete_knowledge_chunks")
    @patch("app.main.get_knowledge_document", return_value={"id": "doc-a", "business_id": "business-a"})
    @patch("app.main.trusted_business_member", return_value={"role": "member", "user_id": "u"})
    def test_only_owner_or_admin_can_remove_knowledge(self, member, get_doc, chunks, delete):
        response = self.client.delete("/knowledge/doc-a", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 403)
        delete.assert_not_called()

    @patch("app.main.delete_knowledge_document")
    @patch("app.main.delete_knowledge_chunks")
    @patch("app.main.get_knowledge_document", return_value={"id": "doc-a", "business_id": "business-a"})
    @patch("app.main.trusted_business_member", return_value={"role": "owner", "user_id": "u"})
    def test_owner_removes_a_document_and_its_chunks(self, member, get_doc, chunks, delete):
        response = self.client.delete("/knowledge/doc-a", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200)
        chunks.assert_called_once_with("doc-a")
        delete.assert_called_once_with("doc-a")


if __name__ == "__main__":
    unittest.main()
