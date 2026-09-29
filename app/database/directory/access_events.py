from app.database.client import supabase


def create_access_event(
    *, business_id: str, conversation_id: str, customer_request_id: str | None,
    tool_id: str, outcome: str, verification_state: str | None,
    returned_fields: list[str], reason_code: str,
) -> None:
    # Do not store customer prompts or protected directory values in the audit log.
    supabase.table("tool_access_events").insert({
        "business_id": business_id,
        "conversation_id": conversation_id,
        "customer_request_id": customer_request_id,
        "tool_id": tool_id,
        "outcome": outcome,
        "verification_state": verification_state,
        "returned_fields": returned_fields,
        "reason_code": reason_code,
    }).execute()
