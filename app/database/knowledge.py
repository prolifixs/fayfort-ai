from typing import Any

from app.database.client import supabase


def list_knowledge_documents(
    business_id: str,
) -> list[dict[str, Any]]:
    response = (
        supabase
        .table("knowledge_documents")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .execute()
    )

    return response.data or []


def get_knowledge_document(
    document_id: str,
) -> dict[str, Any] | None:
    response = (
        supabase
        .table("knowledge_documents")
        .select("*")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


def create_knowledge_document(
    business_id: str,
    title: str,
    source_type: str,
    content: str = "",
    source_url: str | None = None,
) -> dict[str, Any]:
    payload = {
        "business_id": business_id,
        "title": title,
        "source_type": source_type,
        "content": content,
    }

    if source_url:
        payload["source_url"] = source_url

    response = (
        supabase
        .table("knowledge_documents")
        .insert(payload)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Knowledge document was not created")

    return response.data[0]


def delete_knowledge_document(
    document_id: str,
) -> bool:
    response = (
        supabase
        .table("knowledge_documents")
        .delete()
        .eq("id", document_id)
        .execute()
    )

    return bool(response.data)

def update_knowledge_document(
    document_id: str,
    title: str,
    content: str,
    source_type: str = "manual",
    source_url: str | None = None,
) -> dict[str, Any]:
    payload = {
        "title": title,
        "content": content,
        "source_type": source_type,
    }

    if source_url is not None:
        payload["source_url"] = source_url

    response = (
        supabase
        .table("knowledge_documents")
        .update(payload)
        .eq("id", document_id)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Knowledge document was not updated")

    return response.data[0]


def list_knowledge_chunks(
    document_id: str,
) -> list[dict[str, Any]]:
    response = (
        supabase
        .table("knowledge_chunks")
        .select("*")
        .eq("document_id", document_id)
        .order("chunk_index", desc=False)
        .execute()
    )

    return response.data or []

def create_knowledge_chunks(
    document_id: str,
    chunks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not chunks:
        return []

    payload = []

    for index, chunk in enumerate(chunks):
        content = chunk.get("content", "").strip()

        if not content:
            continue

        payload.append(
            {
                "document_id": document_id,
                "chunk_index": index,
                "content": content,
                "metadata": chunk.get("metadata", {}),
            }
        )

    if not payload:
        return []

    response = (
        supabase
        .table("knowledge_chunks")
        .insert(payload)
        .execute()
    )

    return response.data or []


def delete_knowledge_chunks(
    document_id: str,
) -> bool:
    response = (
        supabase
        .table("knowledge_chunks")
        .delete()
        .eq("document_id", document_id)
        .execute()
    )

    return bool(response.data)