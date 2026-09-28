from typing import Any

from app.database.client import supabase


def list_messages(
    conversation_id: str,
) -> list[dict[str, Any]]:
    response = (
        supabase
        .table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("sent_at", desc=False)
        .execute()
    )

    return response.data or []


def get_message(
    message_id: str,
) -> dict[str, Any] | None:
    response = (
        supabase
        .table("messages")
        .select("*")
        .eq("id", message_id)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


def create_message(
    conversation_id: str,
    external_message_id: str,
    sender_type: str,
    content: str,
) -> dict[str, Any]:
    payload = {
        "conversation_id": conversation_id,
        "external_message_id": external_message_id,
        "sender_type": sender_type,
        "content": content,
    }

    response = (
        supabase
        .table("messages")
        .insert(payload)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Message was not created")

    return response.data[0]