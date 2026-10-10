from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, model_validator
import asyncio
import uuid
import logging
import requests
from typing import Any

from app.database.client import supabase
from app.database.businesses import list_businesses
from app.database.business_members import list_business_members
from app.services.knowledge_ingestion import ingest_knowledge

from app.database.knowledge import (
    list_knowledge_documents,
    get_knowledge_document,
    list_knowledge_chunks,
    create_knowledge_document,
    update_knowledge_document,
    delete_knowledge_chunks,
)
from app.knowledge.router import create_business_faq_router
from app.database.conversations import (
    list_conversations,
    get_conversation,
    create_conversation,
    get_or_create_conversation,
    update_conversation_summary,
)
from app.database.handoffs import active_handoff_for_conversation
from app.database.messages import (
    list_messages,
    create_message,
)
from app.database.intents import (
    close_intent,
    create_intent,
    get_active_intent,
    update_intent,
)
from app.database.actions import create_action
from app.directory.service import lookup_for_message
from app.directory.response import format_directory_response
from app.config.settings import settings
from app.directory.identity import trusted_business_member

from app.services.rag import build_business_context
from app.services.intent_engine import analyze_intent
from app.services.action_handler import prepare_action
from app.services.customer_state import update_customer_state
from app.schemas.intent import ClassificationStatus, NextAction
from app.services.ai_responder import (
    generate_ai_response,
    generate_conversation_summary,
)
from app.services.ai_budget import AIBudgetExceeded, AIBudgetUnavailable
from app.services.faq_matching import match_approved_faq

app = FastAPI(
    title="FayFort AI",
    description="AI-powered social media customer service platform",
    version="0.1.0",
)


class AiRespondHistoryMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sender_type: str = Field(default="customer", max_length=30)
    content: str = Field(min_length=1, max_length=4000)


class AiRespondPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    business_id: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=4000)
    conversation_history: list[AiRespondHistoryMessage] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def limit_total_prompt_input(self):
        total_chars = len(self.message) + sum(len(item.content) for item in self.conversation_history)
        if total_chars > 16000:
            raise ValueError("message and conversation history may contain at most 16000 characters")
        return self

_automation_scheduler_task: asyncio.Task | None = None
_inbound_reconciliation_task: asyncio.Task | None = None


@app.on_event("startup")
async def start_automation_scheduler() -> None:
    global _automation_scheduler_task, _inbound_reconciliation_task
    if not settings.AUTOMATION_SCHEDULER_ENABLED:
        logger.info("Automation scheduler is disabled by configuration")
    else:
        from app.automations.scheduler import scheduler_loop
        if _automation_scheduler_task is None or _automation_scheduler_task.done():
            _automation_scheduler_task = asyncio.create_task(
                scheduler_loop(), name="fayfort-automation-scheduler"
            )
            logger.info("Automation scheduler started; polling every 15 seconds")
    if settings.INBOUND_RECONCILIATION_ENABLED:
        from app.automations.reconciliation import reconciliation_loop
        if _inbound_reconciliation_task is None or _inbound_reconciliation_task.done():
            _inbound_reconciliation_task = asyncio.create_task(
                reconciliation_loop(), name="fayfort-inbound-reconciliation"
            )
            logger.info("Inbound ledger reconciliation started; polling every 15 seconds")


@app.on_event("shutdown")
async def stop_automation_scheduler() -> None:
    global _automation_scheduler_task, _inbound_reconciliation_task
    tasks = [task for task in (_automation_scheduler_task, _inbound_reconciliation_task) if task is not None]
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    _automation_scheduler_task = None
    _inbound_reconciliation_task = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
)
logger = logging.getLogger(__name__)


def _persist_intent_and_action(
    conversation_id: str,
    source_message_id: str,
    intent_result,
    action_decision,
    customer_id: str | None = None,
    customer_request_id: str | None = None,
) -> None:
    """Store the latest intent snapshot and proposed (non-executing) action."""
    if intent_result.classification_status in {
        ClassificationStatus.PROVIDER_ERROR,
        ClassificationStatus.INVALID_OUTPUT,
    }:
        return

    intent_key = str(intent_result.intent)
    active_intent = get_active_intent(conversation_id)
    intent_fields = {
        "goal": intent_key,
        "entities": intent_result.known_information,
        "required_information": intent_result.required_information,
        "missing_information": intent_result.missing_information,
        "confidence": intent_result.confidence,
        "source_message_id": source_message_id,
        "metadata": {
            **intent_result.metadata,
            "language": intent_result.language,
            "clarification_needed": intent_result.clarification_needed,
            "can_handle_automatically": intent_result.can_handle_automatically,
            "classification_status": str(intent_result.classification_status),
            "request_relationship": str(intent_result.request_relationship),
        },
        "customer_id": customer_id,
        "customer_request_id": customer_request_id,
    }

    if (
        active_intent
        and active_intent.get("intent_key") == intent_key
        and str(intent_result.request_relationship) == "continue"
    ):
        stored_intent = update_intent(active_intent["id"], **intent_fields)
        if stored_intent is None:
            raise RuntimeError("Active intent could not be updated")
    else:
        if active_intent:
            close_intent(active_intent["id"])
        stored_intent = create_intent(
            conversation_id=conversation_id,
            intent_key=intent_key,
            **intent_fields,
        )

    create_action(
        conversation_id=conversation_id,
        intent_id=stored_intent["id"],
        action_key=str(action_decision.action),
        status="pending",
        input_data={
            "known_information": intent_result.known_information,
            "missing_information": intent_result.missing_information,
            "response_guidance": action_decision.response_guidance,
            "needs_human": action_decision.needs_human,
            "should_execute": action_decision.should_execute,
        },
        requires_confirmation=False,
    )


@app.get("/")
def root():
    return {
        "message": "FayFort AI is running",
        "version": "0.1.0",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
    }

@app.get("/health/database")
def database_health():
    try:
        response = (
            supabase
            .table("businesses")
            .select("id")
            .limit(1)
            .execute()
        )

        return {
            "status": "ok",
            "database": "connected",
            "rows_checked": len(response.data),
        }

    except Exception as e:
        return {
            "status": "error",
            "database": "connection_failed",
            "error": str(e),
        }

@app.get("/businesses")
def businesses():
    return {
        "businesses": list_businesses()
    }

@app.get("/businesses/{business_id}/members")
def business_members(business_id: str):
    return {
        "business_id": business_id,
        "members": list_business_members(business_id),
    }

def _authorize_knowledge_access(
    business_id: str,
    authorization: str | None,
    *,
    manage: bool = False,
) -> dict[str, Any]:
    member = trusted_business_member(authorization, business_id)
    if not member:
        raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
    if manage and member.get("role") not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="An active business owner or admin is required to change business knowledge.")
    return member

@app.get("/businesses/{business_id}/knowledge")
def business_knowledge(business_id: str, authorization: str | None = Header(default=None)):
    _authorize_knowledge_access(business_id, authorization)
    return {
        "business_id": business_id,
        "documents": list_knowledge_documents(business_id),
    }

@app.post("/businesses/{business_id}/knowledge")
def add_knowledge(
    business_id: str,
    payload: dict,
    authorization: str | None = Header(default=None),
):
    _authorize_knowledge_access(business_id, authorization, manage=True)
    title = payload.get("title", "")
    content = payload.get("content", "")
    source_type = payload.get("source_type", "manual")

    if not title:
        return {
            "error": "title is required"
        }

    if not content:
        return {
            "error": "content is required"
        }

    document = create_knowledge_document(
        business_id=business_id,
        title=title,
        source_type=source_type,
        content=content,
    )

    chunks = ingest_knowledge(
        document["id"],
        content,
    )

    return {
        "document": document,
        "chunks": chunks,
    }


@app.get("/knowledge/{document_id}")
def knowledge_document(document_id: str, authorization: str | None = Header(default=None)):
    document = get_knowledge_document(document_id)

    if document is None:
        raise HTTPException(status_code=404, detail="Knowledge document not found.")
    _authorize_knowledge_access(document["business_id"], authorization)

    return {
        "document": document,
        "chunks": list_knowledge_chunks(document_id),
    }

@app.get("/knowledge/{document_id}/context")
def knowledge_context(document_id: str, authorization: str | None = Header(default=None)):
    document = get_knowledge_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Knowledge document not found.")
    _authorize_knowledge_access(document["business_id"], authorization)
    chunks = list_knowledge_chunks(document_id)

    context_parts = []

    for chunk in chunks:
        content = chunk.get("content")

        if content:
            context_parts.append(content)

    return {
        "document_id": document_id,
        "context": "\n\n".join(context_parts),
    }

@app.post("/conversations")
def create_or_get_conversation(payload: dict):
    business_id = payload.get("business_id")
    customer_external_id = payload.get("customer_external_id")
    channel = payload.get("channel")

    if not business_id:
        return {
            "error": "business_id is required"
        }

    if not customer_external_id:
        return {
            "error": "customer_external_id is required"
        }

    if not channel:
        return {
            "error": "channel is required"
        }

    conversation = get_or_create_conversation(
        business_id=business_id,
        customer_external_id=customer_external_id,
        channel=channel,
    )

    return {
        "conversation": conversation
    }

def _authorized_legacy_conversation(conversation_id: str, authorization: str | None) -> dict[str, Any]:
    try:
        conversation = get_conversation(conversation_id)
    except Exception as exc:
        logger.exception("Could not load conversation for legacy message route")
        raise HTTPException(status_code=503, detail="Conversation could not be loaded.") from exc
    business_id = str(conversation.get("business_id") or "") if conversation else ""
    # Use the same not-found response for unknown and cross-business IDs to avoid
    # exposing whether another business owns a conversation.
    if not business_id or not trusted_business_member(authorization, business_id):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conversation


@app.get("/conversations/{conversation_id}/messages")
def conversation_messages(conversation_id: str, authorization: str | None = Header(default=None)):
    _authorized_legacy_conversation(conversation_id, authorization)
    try:
        messages = list_messages(conversation_id, limit=100)
    except Exception as exc:
        logger.exception("Could not load legacy conversation messages")
        raise HTTPException(status_code=503, detail="Messages could not be loaded.") from exc
    return {
        "conversation_id": conversation_id,
        "messages": [{key: message.get(key) for key in ("id", "sender_type", "content", "created_at")} for message in messages],
    }

def _send_message_core(
    conversation_id: str,
    payload: dict,
    authorization: str | None = None,
    *,
    inbound_context: dict[str, Any] | None = None,
):
    content = payload.get("content", "")

    if not content:
        return {
            "error": "content is required"
        }

    conversation = get_conversation(conversation_id)

    if conversation is None:
        return {
            "error": "Conversation not found"
        }

    business_id = conversation["business_id"]

    # 1. Save customer message
    customer_message = create_message(
        conversation_id=conversation_id,
        external_message_id=str(uuid.uuid4()),
        sender_type="customer",
        content=content,
    )

    active_handoff = active_handoff_for_conversation(business_id, conversation_id)
    if active_handoff:
        return {
            "conversation_id": conversation_id,
            "customer_message": customer_message,
            "ai_message": None,
            "response": "Your message has been added to the conversation for the assigned human agent.",
            "handoff": {"id": active_handoff["id"], "status": active_handoff["status"]},
            "automation_paused": True,
        }
    # 2. Get conversation history
    messages = list_messages(
    conversation_id,
    limit=20,
    )

    conversation_history = [
        {
            "sender_type": message.get("sender_type"),
            "content": message.get("content"),
        }
        for message in messages
    ]

    # 3. Get business knowledge
    knowledge_context = build_business_context(business_id)

    # 4. Analyze intent and choose a conversational next step.
    conversation_summary = conversation.get("summary") or ""
    intent_result = analyze_intent(
        customer_message=content,
        knowledge_context=knowledge_context,
        conversation_history=conversation_history,
        conversation_summary=conversation_summary,
        business_id=business_id,
        conversation_id=conversation_id,
        source_message_id=str(customer_message.get("id") or "") or None,
    )

    try:
        customer_state = update_customer_state(conversation, intent_result)
    except Exception:
        logger.exception("Could not update customer/request state for conversation %s", conversation_id)
        customer_state = None

    response_intent = intent_result
    if (
        customer_state is not None
        and customer_state.request is not None
        and intent_result.classification_status == ClassificationStatus.CLASSIFIED
        and not customer_state.request_relationship_unclear
    ):
        response_intent = intent_result.model_copy(update={
            "known_information": customer_state.request.details,
            "required_information": customer_state.request.required_information,
            "missing_information": customer_state.request.missing_information,
            "customer_information": customer_state.profile.model_dump(exclude_none=True),
        })
    elif customer_state is not None and customer_state.request_relationship_unclear:
        response_intent = intent_result.model_copy(update={
            "action": NextAction.CLARIFY_INTENT,
            "clarification_needed": True,
            "known_information": customer_state.request.details,
            "required_information": customer_state.request.required_information,
            "missing_information": customer_state.request.missing_information,
        })

    directory_result = lookup_for_message(
        message=content,
        intent=str(response_intent.intent),
        conversation=conversation,
        customer_state=customer_state,
        enabled=settings.DIRECTORY_TOOLS_ENABLED,
        authorization=authorization,
    )
    if directory_result and directory_result.requires_human:
        response_intent = response_intent.model_copy(update={
            "action": NextAction.REQUEST_HUMAN_REVIEW,
            "clarification_needed": False,
            "can_handle_automatically": False,
        })
        action_decision = prepare_action(response_intent)
    if not directory_result or not directory_result.requires_human:
        action_decision = prepare_action(response_intent)

    response_generation_enabled = not (
        inbound_context is not None
        and inbound_context.get("channel") in {"instagram", "messenger"}
        and inbound_context.get("automation_reply_enabled") is not True
    )
    approved_faq = None
    if (
        response_generation_enabled
        and not directory_result
        and not action_decision.needs_human
        and response_intent.action in {NextAction.ANSWER_QUESTION, NextAction.SEARCH_KNOWLEDGE}
    ):
        try:
            approved_faq = match_approved_faq(business_id, content)
        except Exception as exc:
            logger.warning("Approved FAQ lookup unavailable: error=%s", type(exc).__name__)

    # 5. Keep directory output faithful to the gateway's authorized field set.
    # A static approved reply can be used only on an authenticated inbound path,
    # with explicit connection auto-reply opt-in, and when no directory/human gate
    # requires a different answer.
    approved_reply = None
    if (
        inbound_context
        and inbound_context.get("automation_reply_enabled") is True
        and inbound_context.get("provider_event_id")
        and not directory_result
        and not action_decision.needs_human
    ):
        from app.automations.service import select_approved_reply_automation
        approved_reply = select_approved_reply_automation(
            business_id,
            channel=str(inbound_context.get("channel") or ""),
            intent=str(response_intent.intent),
            language=str(response_intent.language or "und"),
        )

    # Persist and classify every inbound message, but do not call the response
    # or summary models for provider messaging when auto-reply is disabled.
    # This preserves the conversation/automation ledger without generating a
    # reply that cannot be sent.
    if not response_generation_enabled:
        ai_response = None
        logger.info(
            "Skipping AI response generation because provider auto-reply is disabled"
        )
    elif approved_reply:
        ai_response = approved_reply["response_text"]
    elif directory_result:
        ai_response = format_directory_response(directory_result)
    elif approved_faq:
        ai_response = approved_faq["answer"]
    else:
        try:
            ai_response = generate_ai_response(
                customer_message=content,
                knowledge_context=knowledge_context,
                conversation_history=conversation_history,
                conversation_summary=conversation_summary,
                intent_result=response_intent,
                action_decision=action_decision,
                customer_state=customer_state,
                business_id=business_id,
                conversation_id=conversation_id,
                source_message_id=str(customer_message.get("id") or "") or None,
            )
        except requests.RequestException as exc:
            logger.warning("AI response provider request failed: %s", type(exc).__name__)
            ai_response = (
                "I’m having trouble responding right now. Please try again in a moment."
            )
        except (AIBudgetExceeded, AIBudgetUnavailable) as exc:
            logger.warning("AI response skipped by budget control: %s", type(exc).__name__)
            ai_response = (
                "Automated replies are temporarily unavailable. Please use the business’s listed contact options for help."
            )

    # 6. Save AI response
    ai_message = None
    if ai_response is not None:
        ai_message = create_message(
            conversation_id=conversation_id,
            external_message_id=str(uuid.uuid4()),
            sender_type="ai",
            content=ai_response,
        )

    # Intent/action persistence is operational metadata. A DB write failure
    # should be logged without withholding the already generated customer reply.
    try:
        _persist_intent_and_action(
            conversation_id=conversation_id,
            source_message_id=customer_message["id"],
            intent_result=response_intent,
            action_decision=action_decision,
            customer_id=customer_state.customer_id if customer_state else None,
            customer_request_id=(
                customer_state.request.id
                if customer_state and customer_state.request else None
            ),
        )
    except Exception:
        logger.exception("Could not persist intent/action for conversation %s", conversation_id)

    # 7. Update long-term conversation memory
    summary_history = conversation_history
    if ai_response is not None:
        summary_history = summary_history + [
            {
                "sender_type": "ai",
                "content": ai_response,
            }
        ]

    try:
        if ai_response is not None and not approved_reply:
            updated_summary = generate_conversation_summary(
                previous_summary=conversation_summary,
                conversation_history=summary_history,
                business_id=business_id,
                conversation_id=conversation_id,
                source_message_id=str(customer_message.get("id") or "") or None,
            )
            update_conversation_summary(
                conversation_id=conversation_id,
                summary=updated_summary,
            )

    except Exception as exc:
        # Summary failure should never prevent the customer
        # from receiving the AI response.
        print(
            f"Warning: conversation summary update failed: {exc}"
        )

    return {
        "conversation_id": conversation_id,
        "customer_message": customer_message,
        "ai_message": ai_message,
        "response": ai_response,
        "approved_reply_automation_id": approved_reply.get("automation_id") if approved_reply else None,
    }

from app.channels.router import create_manual_channel_router
from app.channels.instagram import create_instagram_webhook_router
from app.channels.messenger import create_messenger_webhook_router
from app.channels.outbound import deliver_instagram_text
from app.channels.messenger_outbound import deliver_messenger_text
from app.connections.router import create_connections_router
app.include_router(create_connections_router())
from app.automations.router import create_automations_router
app.include_router(create_automations_router())
from app.handoffs.router import create_handoffs_router
app.include_router(create_handoffs_router())
from app.events.router import create_events_router
app.include_router(create_events_router())
from app.dashboard.router import create_dashboard_router
from app.dashboard.modules import create_workspace_modules_router
app.include_router(create_dashboard_router())
app.include_router(create_workspace_modules_router())
app.include_router(create_business_faq_router())

@app.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: str,
    payload: dict,
    authorization: str | None = Header(default=None),
):
    # Direct API calls cannot activate internal inbound automation context.
    _authorized_legacy_conversation(conversation_id, authorization)
    return _send_message_core(conversation_id, payload, authorization)


def send_inbound_message(
    conversation_id: str,
    payload: dict[str, str],
    authorization: str | None,
    *,
    channel: str,
    provider_event_id: str,
    automation_reply_enabled: bool,
) -> dict[str, Any]:
    return _send_message_core(
        conversation_id,
        payload,
        authorization,
        inbound_context={
            "channel": channel,
            "provider_event_id": provider_event_id,
            "automation_reply_enabled": automation_reply_enabled,
        },
    )


app.include_router(create_manual_channel_router(send_message, send_inbound_message))


@app.post("/ai/respond")
def ai_respond(payload: AiRespondPayload, authorization: str | None = Header(default=None)):
    business_id = payload.business_id
    if not trusted_business_member(authorization, business_id):
        raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
    try:
        approved_faq = match_approved_faq(business_id, payload.message)
    except Exception as exc:
        logger.warning("Approved FAQ lookup unavailable: error=%s", type(exc).__name__)
        approved_faq = None
    if approved_faq:
        return {"response": approved_faq["answer"]}
    knowledge_context = build_business_context(business_id)

    try:
        response = generate_ai_response(
            customer_message=payload.message,
            knowledge_context=knowledge_context,
            conversation_history=[item.model_dump() for item in payload.conversation_history],
            business_id=business_id,
        )
    except AIBudgetExceeded as exc:
        raise HTTPException(status_code=429, detail="The business monthly AI budget has been reached.") from exc
    except AIBudgetUnavailable as exc:
        raise HTTPException(status_code=503, detail="AI usage pricing or budget controls are unavailable.") from exc

    return {
        "response": response
    }

@app.put("/knowledge/{document_id}")
def update_knowledge(
    document_id: str,
    payload: dict,
    authorization: str | None = Header(default=None),
):
    document = get_knowledge_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Knowledge document not found.")
    _authorize_knowledge_access(document["business_id"], authorization, manage=True)

    title = payload.get("title")
    content = payload.get("content")
    source_type = payload.get("source_type", "manual")

    if not title:
        return {
            "error": "title is required"
        }

    if not content:
        return {
            "error": "content is required"
        }

    updated_document = update_knowledge_document(
        document_id=document_id,
        title=title,
        content=content,
        source_type=source_type,
    )

    if updated_document is None:
        return {
            "error": "Knowledge document could not be updated"
        }

    # Remove old chunks
    delete_knowledge_chunks(document_id)

    # Create new chunks from updated content
    chunks = ingest_knowledge(
        document_id=document_id,
        content=content,
    )

    return {
        "document": updated_document,
        "chunks": chunks,
    }

app.include_router(create_instagram_webhook_router(send_message, deliver_instagram_text, send_inbound_message))
app.include_router(create_messenger_webhook_router(settings.META_VERIFY_TOKEN, send_message, deliver_messenger_text, send_inbound_message))
