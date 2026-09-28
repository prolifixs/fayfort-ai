from fastapi import FastAPI
from app.database.client import supabase
from app.database.businesses import list_businesses
from app.database.business_members import list_business_members
from app.services.rag import build_context
from app.database.knowledge import (
    list_knowledge_documents,
    get_knowledge_document,
    list_knowledge_chunks,
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
    context = build_context(document_id)

    return {
        "document_id": document_id,
        "context": context,
    }