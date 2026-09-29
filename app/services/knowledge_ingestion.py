from typing import Any

from app.database.knowledge import (
    create_knowledge_chunks,
    delete_knowledge_chunks,
)


def split_text(
    text: str,
    chunk_size: int = 1000,
    chunk_overlap: int = 150,
) -> list[str]:
    text = text.strip()

    if not text:
        return []

    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")

    chunks: list[str] = []

    start = 0
    text_length = len(text)

    while start < text_length:
        end = min(start + chunk_size, text_length)

        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= text_length:
            break

        start = end - chunk_overlap

    return chunks


def ingest_knowledge(
    document_id: str,
    content: str,
) -> list[dict[str, Any]]:
    chunks = split_text(content)

    if not chunks:
        return []

    delete_knowledge_chunks(document_id)

    chunk_payload = [
        {
            "content": chunk,
            "metadata": {
                "source": "manual",
            },
        }
        for chunk in chunks
    ]

    return create_knowledge_chunks(
        document_id=document_id,
        chunks=chunk_payload,
    )