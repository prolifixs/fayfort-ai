from __future__ import annotations

from app.directory.access_gateway import disabled_directory_result, lookup_directory
from app.directory.contracts import DirectoryContext
from app.directory.identity import has_trusted_business_identity
from app.directory.registry import get_tool
from app.directory.selection import select_directory_tool
from app.directory.selection import requests_premium_data
from app.schemas.directory import DirectoryToolResult


def lookup_for_message(
    *,
    message: str,
    intent: str,
    conversation: dict,
    customer_state=None,
    enabled: bool,
    authorization: str | None = None,
) -> DirectoryToolResult | None:
    tool_id = select_directory_tool(message, intent)
    if not tool_id:
        return None
    if not enabled:
        return disabled_directory_result(tool_id)
    tool = get_tool(tool_id)
    identity_verified = bool(
        tool
        and requests_premium_data(message, tool.premium_terms)
        and has_trusted_business_identity(authorization, str(conversation["business_id"]))
    )
    context = DirectoryContext(
        business_id=str(conversation["business_id"]),
        conversation_id=str(conversation["id"]),
        customer_id=getattr(customer_state, "customer_id", None),
        request_id=(
            customer_state.request.id
            if customer_state is not None and customer_state.request is not None
            else None
        ),
        identity_verified=identity_verified,
    )
    return lookup_directory(tool_id=tool_id, query=message, context=context)
