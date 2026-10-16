from typing import Any

from app.database.knowledge import (
    list_knowledge_documents,
    list_knowledge_chunks,
)


def build_context(
    document_id: str,
) -> str:
    chunks = list_knowledge_chunks(document_id)

    if not chunks:
        return ""

    parts: list[str] = []

    for chunk in chunks:
        content = chunk.get("content")

        if content:
            parts.append(content)

    return "\n\n".join(parts)


def build_context_from_chunks(
    chunks: list[dict[str, Any]],
) -> str:
    parts: list[str] = []

    for chunk in chunks:
        content = chunk.get("content")

        if content:
            parts.append(content)

    return "\n\n".join(parts)


GUIDE_SOURCE_TYPE = "guide"


def _approved_faqs(business_id: str) -> list[dict[str, Any]]:
    from app.database.business_faqs import list_business_faqs
    try:
        return [faq for faq in list_business_faqs(business_id) if faq.get("status") == "approved"]
    except Exception:
        return []


def build_business_context(
    business_id: str,
) -> str:
    """Business facts for the AI: every knowledge document except conversation guides, then approved FAQs."""
    documents = list_knowledge_documents(business_id)
    all_chunks: list[dict[str, Any]] = []
    for document in documents:
        document_id = document.get("id")
        if not document_id or document.get("source_type") == GUIDE_SOURCE_TYPE:
            continue
        all_chunks.extend(list_knowledge_chunks(document_id))
    parts = [build_context_from_chunks(all_chunks)] if all_chunks else []
    faqs = _approved_faqs(business_id)
    if faqs:
        parts.append("Approved answers to common questions:\n" + "\n\n".join(
            f"Q: {faq.get('question', '').strip()}\nA: {faq.get('answer', '').strip()}" for faq in faqs))
    return "\n\n".join(part for part in parts if part)


def build_business_guide(business_id: str) -> str:
    """How the business wants its assistant to talk (tone, order of questions). Instructions, not facts."""
    try:
        documents = list_knowledge_documents(business_id)
    except Exception:
        return ""
    guides = [str(document.get("content") or "").strip() for document in documents
              if document.get("source_type") == GUIDE_SOURCE_TYPE]
    return "\n\n".join(guide for guide in guides if guide)[:6000]
