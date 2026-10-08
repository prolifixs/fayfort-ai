from __future__ import annotations
import logging
from fastapi import APIRouter, Header, HTTPException
from app.database.business_members import get_business_member
from app.database.handoffs import assign_handoff, conversation_belongs_to_business, create_handoff, get_handoff, list_handoffs, return_to_automation, send_human_reply, take_over_handoff
from app.database.conversations import get_conversation
from app.database.connections import get_connection, get_connection_credentials
from app.channels.outbound import deliver_instagram_text
from app.database.messages import create_message
from app.directory.identity import trusted_business_member
from app.schemas.handoff import HandoffAssign, HandoffCreate, HumanReply

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
    def get_handoffs(business_id: str, status: str | None = None, authorization: str | None = Header(default=None)):
        identity(business_id, authorization)
        try: return {"handoffs": list_handoffs(business_id, status)}
        except Exception: raise HTTPException(status_code=503, detail="Handoffs could not be loaded.")

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
                if connection and connection.get("provider") == "instagram":
                    credentials = get_connection_credentials(business_id, connection["id"])
                    if credentials:
                        delivery = deliver_instagram_text(
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
