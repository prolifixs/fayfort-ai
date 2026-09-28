from typing import Any

from app.database.knowledge import list_knowledge_chunks


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