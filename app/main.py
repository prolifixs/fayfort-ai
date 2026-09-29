from fastapi import FastAPI
import uuid

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
from app.database.messages import (
    list_messages,
    create_message,
)

from app.services.rag import build_business_context
from app.services.ai_responder import (
    generate_ai_response,
    generate_conversation_summary,
)

app = FastAPI(
    title="FayFort AI",
    description="AI-powered social media customer service platform",
    version="0.1.0",
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

    # 4. Generate AI response
    # 4. Generate AI response
    conversation_summary = conversation.get("summary") or ""

    ai_response = generate_ai_response(
        customer_message=content,
        knowledge_context=knowledge_context,
        conversation_history=conversation_history,
        conversation_summary=conversation_summary,
    )

        # 5. Save AI response
    ai_message = create_message(
        conversation_id=conversation_id,
        external_message_id=str(uuid.uuid4()),
        sender_type="ai",
        content=ai_response,
    )

    # 6. Update long-term conversation memory
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