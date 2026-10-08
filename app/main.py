from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
import uuid
import logging
import requests

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

from app.services.rag import build_business_context
from app.services.intent_engine import analyze_intent
from app.services.action_handler import prepare_action
from app.services.customer_state import update_customer_state
from app.schemas.intent import ClassificationStatus, NextAction
from app.services.ai_responder import (
    generate_ai_response,
    generate_conversation_summary,
)

app = FastAPI(
    title="FayFort AI",
    description="AI-powered social media customer service platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

@app.get("/businesses/{business_id}/knowledge")
def business_knowledge(business_id: str):
    return {
        "business_id": business_id,
        "documents": list_knowledge_documents(business_id),
    }

@app.post("/businesses/{business_id}/knowledge")
def add_knowledge(
    business_id: str,
    payload: dict,
):
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
def knowledge_document(document_id: str):
    document = get_knowledge_document(document_id)

    if document is None:
        return {
            "error": "Knowledge document not found"
        }

    return {
        "document": document,
        "chunks": list_knowledge_chunks(document_id),
    }

@app.get("/knowledge/{document_id}/context")
def knowledge_context(document_id: str):
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

@app.get("/conversations/{conversation_id}/messages")
def conversation_messages(conversation_id: str):
    conversation = get_conversation(conversation_id)

    if conversation is None:
        return {
            "error": "Conversation not found"
        }

    return {
        "conversation_id": conversation_id,
        "messages": list_messages(conversation_id),
    }

@app.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: str,
    payload: dict,
    authorization: str | None = Header(default=None),
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

    # 5. Keep directory output faithful to the gateway's authorized field set.
    # The model can add unsupported claims even when given a constrained result.
    if directory_result:
        ai_response = format_directory_response(directory_result)
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
            )
        except requests.RequestException as exc:
            logger.warning("AI response provider request failed: %s", type(exc).__name__)
            ai_response = (
                "I’m having trouble responding right now. Please try again in a moment."
            )

    # 6. Save AI response
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
    summary_history = conversation_history + [
        {
            "sender_type": "ai",
            "content": ai_response,
        }
    ]

    try:
        updated_summary = generate_conversation_summary(
            previous_summary=conversation_summary,
            conversation_history=summary_history,
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
    }

from app.channels.router import create_manual_channel_router
from app.channels.instagram import create_instagram_webhook_router
from app.channels.outbound import deliver_instagram_text
app.include_router(create_manual_channel_router(send_message))
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

@app.post("/ai/respond")
def ai_respond(payload: dict):
    customer_message = payload.get("message", "")
    business_id = payload.get("business_id")
    conversation_history = payload.get("conversation_history", [])

    if not customer_message:
        return {
            "error": "message is required"
        }

    if not business_id:
        return {
            "error": "business_id is required"
        }

    knowledge_context = build_business_context(business_id)

    response = generate_ai_response(
        customer_message=customer_message,
        knowledge_context=knowledge_context,
        conversation_history=conversation_history,
    )

    return {
        "response": response
    }

@app.put("/knowledge/{document_id}")
def update_knowledge(
    document_id: str,
    payload: dict,
):
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

    document = get_knowledge_document(document_id)

    if document is None:
        return {
            "error": "Knowledge document not found"
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

app.include_router(create_instagram_webhook_router(send_message, deliver_instagram_text))
