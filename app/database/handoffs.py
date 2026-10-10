from __future__ import annotations
from typing import Any
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from app.database.client import supabase
from app.database.events import publish_business_event

HANDOFF_FIELDS = "id,business_id,conversation_id,requested_by,assigned_to,status,reason,requested_at,updated_at,closed_at"
ACTIVE_STATUSES = ("requested", "assigned", "active")

def list_handoffs(business_id: str, status: str | None = None, *, limit: int = 50, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
    query = supabase.table("conversation_handoffs").select(HANDOFF_FIELDS, count="exact").eq("business_id", business_id)
    if status == "waiting":
        query = query.in_("status", ["requested", "assigned"])
    elif status:
        query = query.eq("status", status)
    response = query.order("requested_at").order("id").range(offset, offset + limit - 1).execute()
    return response.data or [], int(response.count or 0)

def handoff_capacity_summary(business_id: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    active_members = (supabase.table("business_members")
        .select("user_id,handoff_max_active").eq("business_id", business_id).eq("status", "active")
        .eq("handoff_availability", "available").gt("handoff_available_until", now.isoformat()).execute().data or [])
    assigned_rows = (supabase.table("conversation_handoffs").select("assigned_to")
        .eq("business_id", business_id).in_("status", ["assigned", "active"]).execute().data or [])
    active_by_agent: dict[str, int] = {}
    for row in assigned_rows:
        if row.get("assigned_to"):
            key = str(row["assigned_to"])
            active_by_agent[key] = active_by_agent.get(key, 0) + 1
    available_slots = sum(max(0, int(agent.get("handoff_max_active") or 3) - active_by_agent.get(str(agent["user_id"]), 0)) for agent in active_members)

    since = (now - timedelta(days=30)).isoformat()
    recent_handoffs = (supabase.table("conversation_handoffs").select("conversation_id,requested_at")
        .eq("business_id", business_id).gte("requested_at", since).order("requested_at", desc=True).limit(200).execute().data or [])
    latencies: list[float] = []
    if recent_handoffs:
        conversation_ids = list({str(row["conversation_id"]) for row in recent_handoffs})
        agent_messages = (supabase.table("messages").select("conversation_id,created_at")
            .in_("conversation_id", conversation_ids).eq("sender_type", "agent").gte("created_at", since)
            .order("created_at").limit(1000).execute().data or [])
        first_by_conversation: dict[str, list[datetime]] = {}
        for message in agent_messages:
            try:
                sent_at = datetime.fromisoformat(str(message["created_at"]).replace("Z", "+00:00"))
                first_by_conversation.setdefault(str(message["conversation_id"]), []).append(sent_at)
            except (KeyError, TypeError, ValueError):
                continue
        for handoff in recent_handoffs:
            try:
                requested_at = datetime.fromisoformat(str(handoff["requested_at"]).replace("Z", "+00:00"))
                first_reply = next((sent for sent in first_by_conversation.get(str(handoff["conversation_id"]), []) if sent >= requested_at), None)
                if first_reply:
                    minutes = (first_reply - requested_at).total_seconds() / 60
                    if 0 <= minutes <= 24 * 60:
                        latencies.append(minutes)
            except (KeyError, TypeError, ValueError):
                continue
    return {"available_agents": len(active_members), "available_slots": available_slots, "response_latency_samples": latencies}

def get_handoff(business_id: str, handoff_id: str) -> dict[str, Any] | None:
    response = supabase.table("conversation_handoffs").select(HANDOFF_FIELDS).eq("business_id", business_id).eq("id", handoff_id).limit(1).execute()
    return response.data[0] if response.data else None

def list_handoff_events(business_id: str, handoff_id: str) -> list[dict[str, Any]]:
    response = (supabase.table("conversation_handoff_events")
        .select("id,handoff_id,actor_id,event_type,details,created_at")
        .eq("business_id", business_id).eq("handoff_id", handoff_id)
        .order("created_at", desc=True).limit(100).execute())
    if response.data:
        return response.data
    # Older deployments may have only the sanitized business-event projection.
    events = (supabase.table("business_events")
        .select("id,event_type,payload,created_at")
        .eq("business_id", business_id).eq("entity_type", "conversation_handoff")
        .eq("entity_id", handoff_id)
        .in_("event_type", ["handoff.requested", "handoff.assigned", "handoff.taken_over", "handoff.returned_to_automation"])
        .order("id", desc=True).limit(100).execute()).data or []
    return [{
        "id": event["id"], "handoff_id": handoff_id,
        "actor_id": (event.get("payload") or {}).get("actor_id") or (event.get("payload") or {}).get("agent_id") or "",
        "event_type": str(event.get("event_type", "")).removeprefix("handoff."),
        "details": event.get("payload") or {}, "created_at": event["created_at"],
    } for event in events]

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
    publish_business_event(business_id, event_map[event_type], "conversation_handoff", handoff_id, {"handoff_id":handoff_id, "actor_id":actor_id, **safe_details})

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
