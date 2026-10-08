from typing import Any

from app.database.client import supabase


def list_conversations(
    business_id: str,
    status: str | None = None,
) -> list[dict[str, Any]]:
    query = (
        supabase
        .table("conversations")
        .select("*")
        .eq("business_id", business_id)
    )

    if status:
        query = query.eq("status", status)

    response = (
        query
        .order("last_message_at", desc=True)
        .execute()
    )

    return response.data or []


def get_conversation(
    conversation_id: str,
) -> dict[str, Any] | None:
    response = (
        supabase
        .table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


def create_conversation(
    business_id: str,
    customer_external_id: str,
    channel: str,
    business_connection_id: str | None = None,
) -> dict[str, Any]:
    payload = {
        "business_id": business_id,
        "customer_external_id": customer_external_id,
        "channel": channel,
    }
    if business_connection_id:
        payload["business_connection_id"] = business_connection_id

    response = (
        supabase
        .table("conversations")
        .insert(payload)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Conversation was not created")

    return response.data[0]

def find_conversation(
    business_id: str,
    customer_external_id: str,
    channel: str,
    business_connection_id: str | None = None,
) -> dict[str, Any] | None:
    query = (
        supabase
        .table("conversations")
        .select("*")
        .eq("business_id", business_id)
        .eq("customer_external_id", customer_external_id)
        .eq("channel", channel)
        .eq("status", "open")
        .order("created_at", desc=True)
        .limit(1)
    )

    if business_connection_id:
        query = query.eq("business_connection_id", business_connection_id)

    response = query.execute()

    if not response.data:
        return None

    return response.data[0]

def get_or_create_conversation(
    business_id: str,
    customer_external_id: str,
    channel: str,
    business_connection_id: str | None = None,
) -> dict[str, Any]:
    conversation = find_conversation(
        business_id=business_id,
        customer_external_id=customer_external_id,
        channel=channel,
        business_connection_id=business_connection_id,
    )

    if conversation:
        return conversation

    return create_conversation(
        business_id=business_id,
        customer_external_id=customer_external_id,
        channel=channel,
        business_connection_id=business_connection_id,
    )


def update_conversation_status(
    conversation_id: str,
    status: str,
) -> dict[str, Any]:
    response = (
        supabase
        .table("conversations")
        .update({"status": status})
        .eq("id", conversation_id)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Conversation was not updated")

    return response.data[0]

def update_conversation_summary(
    conversation_id: str,
    summary: str,
) -> dict[str, Any]:
    response = (
        supabase
        .table("conversations")
        .update({"summary": summary})
        .eq("id", conversation_id)
        .execute()
    )

    if not response.data:
        raise RuntimeError("Conversation summary was not updated")

    return response.data[0]
