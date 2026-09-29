from fastapi import FastAPI

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

from app.services.rag import build_business_context
from app.services.ai_responder import generate_ai_response

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