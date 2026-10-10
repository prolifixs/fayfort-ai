from __future__ import annotations

from typing import Any

from app.database.client import supabase


def list_business_faqs(business_id: str) -> list[dict[str, Any]]:
    response = (
        supabase.table("business_faqs")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    return response.data or []


def get_business_faq(business_id: str, faq_id: str) -> dict[str, Any] | None:
    response = (
        supabase.table("business_faqs")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", faq_id)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def list_business_faq_events(business_id: str, faq_id: str) -> list[dict[str, Any]]:
    response = (
        supabase.table("business_faq_events")
        .select("id,faq_id,actor_id,event_type,created_at")
        .eq("business_id", business_id)
        .eq("faq_id", faq_id)
        .order("id", desc=True)
        .limit(100)
        .execute()
    )
    return response.data or []


def find_approved_faq(business_id: str, question_key: str) -> dict[str, Any] | None:
    response = (
        supabase.table("business_faqs")
        .select("id,question,question_key,answer,version,approved_at")
        .eq("business_id", business_id)
        .eq("question_key", question_key)
        .eq("status", "approved")
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def _rpc_row(result: Any) -> dict[str, Any] | None:
    if isinstance(result, list):
        result = result[0] if result else None
    return result if isinstance(result, dict) else None


def create_business_faq_version(
    *,
    faq_id: str | None,
    business_id: str,
    actor_id: str,
    question: str,
    question_key: str,
    answer: str,
) -> dict[str, Any] | None:
    result = supabase.rpc("create_business_faq_version", {
        "p_faq_id": faq_id,
        "p_business_id": business_id,
        "p_actor_id": actor_id,
        "p_question": question,
        "p_question_key": question_key,
        "p_answer": answer,
    }).execute().data
    return _rpc_row(result)


def review_business_faq(
    *,
    faq_id: str,
    business_id: str,
    actor_id: str,
    decision: str,
) -> dict[str, Any] | None:
    result = supabase.rpc("review_business_faq", {
        "p_faq_id": faq_id,
        "p_business_id": business_id,
        "p_actor_id": actor_id,
        "p_decision": decision,
    }).execute().data
    return _rpc_row(result)
