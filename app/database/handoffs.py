from __future__ import annotations
from typing import Any
from datetime import datetime, timezone
from uuid import uuid4
from app.database.client import supabase
from app.database.events import publish_business_event

HANDOFF_FIELDS = "id,business_id,conversation_id,requested_by,assigned_to,status,reason,requested_at,updated_at,closed_at"
ACTIVE_STATUSES = ("requested", "assigned", "active")

def list_handoffs(business_id: str, status: str | None = None) -> list[dict[str, Any]]:
    query = supabase.table("conversation_handoffs").select(HANDOFF_FIELDS).eq("business_id", business_id)
    if status:
        query = query.eq("status", status)
    return query.order("requested_at", desc=True).limit(200).execute().data or []

def get_handoff(business_id: str, handoff_id: str) -> dict[str, Any] | None:
    response = supabase.table("conversation_handoffs").select(HANDOFF_FIELDS).eq("business_id", business_id).eq("id", handoff_id).limit(1).execute()
    return response.data[0] if response.data else None

def conversation_belongs_to_business(business_id: str, conversation_id: str) -> bool:
    response = supabase.table("conversations").select("id").eq("business_id", business_id).eq("id", conversation_id).limit(1).execute()
    return bool(response.data)

def active_handoff_for_conversation(business_id: str, conversation_id: str) -> dict[str, Any] | None:
    response = (supabase.table("conversation_handoffs").select(HANDOFF_FIELDS).eq("business_id", business_id).eq("conversation_id", conversation_id).in_("status", list(ACTIVE_STATUSES)).limit(1).execute())
    return response.data[0] if response.data else None

def create_handoff(business_id: str, conversation_id: str, requester_id: str, reason: str) -> dict[str, Any]:
    response = supabase.table("conversation_handoffs").insert({"business_id": business_id, "conversation_id": conversation_id, "requested_by": requester_id, "status":"requested", "reason":reason}).execute()
    if not response.data:
        raise RuntimeError("Handoff was not created")
    handoff = response.data[0]
    record_handoff_event(handoff["id"], business_id, requester_id, "requested", {"reason": reason})
    return handoff

def record_handoff_event(handoff_id: str, business_id: str, actor_id: str, event_type: str, details: dict[str, Any] | None = None) -> None:
    supabase.table("conversation_handoff_events").insert({"handoff_id":handoff_id, "business_id":business_id, "actor_id":actor_id, "event_type":event_type, "details":details or {}}).execute()
    event_map = {"requested":"handoff.requested", "assigned":"handoff.assigned", "taken_over":"handoff.taken_over", "returned_to_automation":"handoff.returned_to_automation"}
    safe_details = {key:value for key,value in (details or {}).items() if key == "agent_id" and isinstance(value, str)}
    publish_business_event(business_id, event_map[event_type], "conversation_handoff", handoff_id, {"handoff_id":handoff_id, **safe_details})

def assign_handoff(business_id: str, handoff_id: str, agent_id: str, actor_id: str) -> tuple[str, dict[str, Any] | None]:
    handoff = get_handoff(business_id, handoff_id)
    if handoff is None: return "not_found", None
    if handoff["status"] not in {"requested", "assigned"}: return "conflict", handoff
    response = (supabase.table("conversation_handoffs").update({"assigned_to":agent_id, "status":"assigned"}).eq("business_id", business_id).eq("id", handoff_id).in_("status", ["requested", "assigned"]).select(HANDOFF_FIELDS).execute())
    if not response.data: return "conflict", None
    record_handoff_event(handoff_id, business_id, actor_id, "assigned", {"agent_id": agent_id})
    return "ok", response.data[0]

def take_over_handoff(business_id: str, handoff_id: str, actor_id: str) -> tuple[str, dict[str, Any] | None]:
    handoff = get_handoff(business_id, handoff_id)
    if handoff is None: return "not_found", None
    if handoff["status"] == "active" and handoff.get("assigned_to") == actor_id: return "ok", handoff
    if handoff["status"] not in {"requested", "assigned"}: return "conflict", handoff
    if handoff.get("assigned_to") and handoff["assigned_to"] != actor_id: return "not_assignee", handoff
    response = (supabase.table("conversation_handoffs").update({"assigned_to":actor_id, "status":"active"}).eq("business_id", business_id).eq("id", handoff_id).in_("status", ["requested", "assigned"]).select(HANDOFF_FIELDS).execute())
    if not response.data: return "conflict", None
    record_handoff_event(handoff_id, business_id, actor_id, "taken_over")
    return "ok", response.data[0]

def return_to_automation(business_id: str, handoff_id: str, actor_id: str) -> tuple[str, dict[str, Any] | None]:
    handoff = get_handoff(business_id, handoff_id)
    if handoff is None: return "not_found", None
    if handoff["status"] != "active": return "conflict", handoff
    if handoff.get("assigned_to") != actor_id: return "not_assignee", handoff
    response = (supabase.table("conversation_handoffs").update({"status":"returned", "closed_at":datetime.now(timezone.utc).isoformat()}).eq("business_id", business_id).eq("id", handoff_id).eq("status", "active").eq("assigned_to", actor_id).select(HANDOFF_FIELDS).execute())
    if not response.data: return "conflict", None
    record_handoff_event(handoff_id, business_id, actor_id, "returned_to_automation")
    return "ok", response.data[0]

def send_human_reply(business_id: str, handoff_id: str, actor_id: str, content: str) -> dict[str, Any] | None:
    handoff = get_handoff(business_id, handoff_id)
    if not handoff or handoff["status"] != "active" or handoff.get("assigned_to") != actor_id: return None
    response = supabase.table("messages").insert({"conversation_id":handoff["conversation_id"], "external_message_id":str(uuid4()), "sender_type":"agent", "agent_id":actor_id, "content":content}).execute()
    return response.data[0] if response.data else None
