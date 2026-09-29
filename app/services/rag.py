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


def build_business_context(
    business_id: str,
) -> str:
    documents = list_knowledge_documents(business_id)

    if not documents:
        return ""

    all_chunks: list[dict[str, Any]] = []

    for document in documents:
        document_id = document.get("id")

        if not document_id:
            continue

        chunks = list_knowledge_chunks(document_id)
        all_chunks.extend(chunks)

    return build_context_from_chunks(all_chunks)