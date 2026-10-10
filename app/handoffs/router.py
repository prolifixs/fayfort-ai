from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Header, HTTPException, Query
from app.database.business_members import get_business_member, list_active_business_members, update_handoff_availability
from app.database.handoffs import assign_handoff, conversation_belongs_to_business, create_handoff, get_handoff, handoff_capacity_summary, list_handoff_events, list_handoffs, return_to_automation, send_human_reply, take_over_handoff
from app.database.conversations import get_conversation
from app.database.connections import get_connection, get_connection_credentials
from app.channels.outbound import deliver_instagram_text
from app.channels.messenger_outbound import deliver_messenger_text
from app.database.messages import create_message
from app.database.events import publish_business_event
from app.directory.identity import trusted_business_member
from app.schemas.handoff import HandoffAssign, HandoffAvailabilityUpdate, HandoffCreate, HumanReply
from app.handoffs.capacity import estimate_handoff_wait

logger = logging.getLogger(__name__)


def create_handoffs_router() -> APIRouter:
    router = APIRouter(prefix="/businesses/{business_id}/handoffs", tags=["human-handoff"])
    def identity(business_id: str, authorization: str | None) -> dict:
        member = trusted_business_member(authorization, business_id)
        if not member: raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        return member
    def respond(outcome, handoff):
        if outcome == "not_found": raise HTTPException(status_code=404, detail="Handoff not found.")
        if outcome == "not_assignee": raise HTTPException(status_code=403, detail="Only the assigned agent can perform this action.")
        if outcome == "conflict": raise HTTPException(status_code=409, detail="That handoff transition is not allowed.")
        return {"handoff": handoff}

    @router.get("")
    def get_handoffs(business_id: str, status: str | None = None, limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0, le=100000), with_estimates: bool = False, authorization: str | None = Header(default=None)):
        identity(business_id, authorization)
        try:
            handoffs, total = list_handoffs(business_id, status, limit=limit, offset=offset)
            if with_estimates and status == "waiting":
                capacity = handoff_capacity_summary(business_id)
                handoffs = [{**item, "queue_position": offset + index + 1, "wait_estimate": estimate_handoff_wait(offset + index + 1, capacity["available_slots"], capacity["response_latency_samples"])} for index, item in enumerate(handoffs)]
            return {"handoffs": handoffs, "total": total, "has_more": offset + len(handoffs) < total, "next_offset": offset + len(handoffs) if offset + len(handoffs) < total else None}
        except Exception: raise HTTPException(status_code=503, detail="Handoffs could not be loaded.")

    @router.get("/agents")
    def list_agents(business_id: str, authorization: str | None = Header(default=None)):
        identity(business_id, authorization)
        try: return {"agents": list_active_business_members(business_id)}
        except Exception: raise HTTPException(status_code=503, detail="Active business agents could not be loaded.")

    @router.get("/availability")
    def get_availability(business_id: str, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        try:
            current = get_business_member(business_id, member["user_id"])
            if not current or current.get("status") != "active": raise HTTPException(status_code=403, detail="An active business membership is required.")
            return {"availability": current.get("handoff_availability", "offline"), "available_until": current.get("handoff_available_until"), "max_active_handoffs": current.get("handoff_max_active", 3), "updated_at": current.get("handoff_availability_updated_at")}
        except HTTPException: raise
        except Exception: raise HTTPException(status_code=503, detail="Agent availability could not be loaded.")

    @router.patch("/availability")
    def set_availability(business_id: str, payload: HandoffAvailabilityUpdate, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        until = payload.available_until
        if until is not None:
            if until.tzinfo is None: raise HTTPException(status_code=422, detail="available_until must include a timezone.")
            now = datetime.now(timezone.utc)
            until = until.astimezone(timezone.utc)
            if until <= now or until > now + timedelta(hours=16): raise HTTPException(status_code=422, detail="Availability must end within the next 16 hours.")
        try:
            result = update_handoff_availability(business_id, member["user_id"], payload.availability, until.isoformat() if until else None, payload.max_active_handoffs)
            if not result: raise HTTPException(status_code=403, detail="An active business membership is required.")
            publish_business_event(business_id, "handoff.agent_availability_changed", "business_member", member["user_id"], {"agent_id": member["user_id"], "status": payload.availability, "available_until": until.isoformat() if until else None, "max_active_handoffs": payload.max_active_handoffs})
            return {"availability": result.get("handoff_availability"), "available_until": result.get("handoff_available_until"), "max_active_handoffs": result.get("handoff_max_active"), "updated_at": result.get("handoff_availability_updated_at")}
        except HTTPException: raise
        except Exception: raise HTTPException(status_code=503, detail="Agent availability could not be saved.")

    @router.get("/{handoff_id}/events")
    def get_handoff_history(business_id: str, handoff_id: str, authorization: str | None = Header(default=None)):
        identity(business_id, authorization)
        try:
            if get_handoff(business_id, handoff_id) is None:
                raise HTTPException(status_code=404, detail="Handoff not found.")
            return {"events": list_handoff_events(business_id, handoff_id)}
        except HTTPException: raise
        except Exception: raise HTTPException(status_code=503, detail="Handoff history could not be loaded.")

    @router.post("")
    def request_handoff(business_id: str, conversation_id: str, payload: HandoffCreate, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        try:
            if not conversation_belongs_to_business(business_id, conversation_id): raise HTTPException(status_code=404, detail="Conversation not found.")
            handoff = create_handoff(business_id, conversation_id, member["user_id"], payload.reason)
            return {"handoff": handoff}
        except HTTPException: raise
        except Exception: raise HTTPException(status_code=409, detail="An active handoff may already exist for this conversation.")

    @router.post("/{handoff_id}/assign")
    def assign(business_id: str, handoff_id: str, payload: HandoffAssign, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        target = get_business_member(business_id, payload.agent_id)
        if not target or target.get("status") != "active": raise HTTPException(status_code=422, detail="The assigned agent must be an active member of this business.")
        try: outcome, handoff = assign_handoff(business_id, handoff_id, payload.agent_id, member["user_id"])
        except Exception: raise HTTPException(status_code=503, detail="The handoff could not be assigned.")
        return respond(outcome, handoff)

    @router.post("/{handoff_id}/take-over")
    def take_over(business_id: str, handoff_id: str, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        try: outcome, handoff = take_over_handoff(business_id, handoff_id, member["user_id"])
        except Exception: raise HTTPException(status_code=503, detail="The handoff could not be taken over.")
        return respond(outcome, handoff)

    @router.post("/{handoff_id}/return-to-automation")
    def return_to_auto(business_id: str, handoff_id: str, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        try: outcome, handoff = return_to_automation(business_id, handoff_id, member["user_id"])
        except Exception: raise HTTPException(status_code=503, detail="The handoff could not be returned.")
        return respond(outcome, handoff)

    @router.post("/{handoff_id}/messages")
    def human_message(business_id: str, handoff_id: str, payload: HumanReply, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        try: message = send_human_reply(business_id, handoff_id, member["user_id"], payload.content)
        except Exception: raise HTTPException(status_code=503, detail="The human message could not be recorded.")
        if message is None: raise HTTPException(status_code=403, detail="An active handoff assigned to you is required to reply.")
        delivery = {"status": "recorded_not_delivered"}
        try:
            handoff = get_handoff(business_id, handoff_id)
            conversation = get_conversation(handoff["conversation_id"]) if handoff else None
            if conversation and str(conversation.get("business_id")) == business_id:
                connection_id = conversation.get("business_connection_id")
                connection = get_connection(business_id, str(connection_id)) if connection_id else None
                if connection and connection.get("provider") in {"instagram", "messenger"}:
                    credentials = get_connection_credentials(business_id, connection["id"])
                    if credentials:
                        sender = deliver_instagram_text if connection["provider"] == "instagram" else deliver_messenger_text
                        delivery = sender(
                            connection=connection, credentials=credentials,
                            conversation=conversation, message=message,
                        )
        except Exception:
            # The human message is already durable. Return its delivery state
            # separately so a provider outage cannot erase the operator's work.
            logger.exception("Human message saved but outbound delivery could not be completed")
            delivery = {"status": "unknown", "safe_error_code": "delivery_state_unavailable"}
        return {"message": message, "delivery_status": delivery.get("status"), "delivery": delivery}

    return router
