"""The Conversations desk (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R3).

- customer_card: who is on the other end of a chat work item, what they've asked for (with anything still missing),
  their other chats, and for members their plan, requests and invoices.
- search_answers: read-only search of what the AI knows (FayFort International's knowledge and approved FAQs), so a
  person answering a chat gives the same answers.
- hand_off: send something from a chat to another desk as its own work item ("chat_handoff"), keeping the chat with it.
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from app.config.settings import settings

PROFILE_KEYS = ("display_name", "member_tier", "rank_level", "subrank", "country", "city", "created_at")
HANDOFF_DEPARTMENTS = ("sourcing", "fulfillment", "member_support", "disputes", "store_team", "conversation_intake")
DEPARTMENT_LABEL = {"conversation_intake": "Conversations", "sourcing": "Sourcing", "fulfillment": "Fulfillment",
                    "member_support": "Member support", "disputes": "Disputes", "store_team": "Store team"}


def _rows(result) -> list[dict]:
    return list((result.data if result is not None else None) or [])


def _one(result) -> dict | None:
    data = result.data if result is not None else None
    if isinstance(data, list):
        return data[0] if data else None
    return data


def business_conversation_id(client, item: dict) -> str | None:
    """The customer chat behind a work item: linked directly, or through its handoff."""
    if item.get("business_conversation_id"):
        return str(item["business_conversation_id"])
    if item.get("handoff_id"):
        handoff = _one(client.table("conversation_handoffs").select("conversation_id").eq("id", str(item["handoff_id"]))
                       .limit(1).execute())
        if handoff and handoff.get("conversation_id"):
            return str(handoff["conversation_id"])
    return None


def latest_stages(client, request_ids: list[str]) -> dict[str, str]:
    from app.accounts.desks import latest_request_stages
    return latest_request_stages(client, request_ids)


def member_card(client, member_id: str, current_conversation_id: str | None = None) -> dict:
    profile = _one(client.table("member_profiles").select("*").eq("user_id", member_id).limit(1).execute()) or {}
    chats = _rows(client.table("member_conversations").select("id,title,last_activity_at,created_at")
                  .eq("member_id", member_id).order("last_activity_at", desc=True).limit(8).execute())
    requests = _rows(client.table("member_purchase_requests").select("id,request_title,created_at,eta_at")
                     .eq("member_id", member_id).order("created_at", desc=True).limit(8).execute())
    stages = latest_stages(client, [str(row["id"]) for row in requests])
    invoices = _rows(client.table("commerce_invoices").select("id,title,amount,currency,status,created_at,paid_at")
                     .eq("member_id", member_id).order("created_at", desc=True).limit(6).execute())
    return {
        "kind": "member",
        "member_id": member_id,
        "name": profile.get("display_name") or "Member",
        "profile": {key: profile.get(key) for key in PROFILE_KEYS if profile.get(key) is not None},
        "chats": [{**chat, "current": str(chat["id"]) == str(current_conversation_id or "")} for chat in chats],
        "requests": [{"id": row["id"], "title": row.get("request_title"), "stage": stages.get(str(row["id"])),
                      "eta_at": row.get("eta_at"), "created_at": row.get("created_at"), "missing": []} for row in requests],
        "invoices": invoices,
    }


def customer_card_for_business(client, conversation_id: str) -> dict:
    conversation = _one(client.table("conversations").select(
        "id,business_id,customer_external_id,customer_name,customer_username,channel,platform,summary,last_message_at,created_at")
        .eq("id", conversation_id).limit(1).execute())
    if not conversation:
        return {"kind": "customer", "name": "Customer", "profile": {}, "chats": [], "requests": [], "invoices": []}
    channel = str(conversation.get("channel") or conversation.get("platform") or "")
    customer = None
    if channel and conversation.get("customer_external_id"):
        customer = _one(client.table("customers").select("id,profile,created_at")
                        .eq("business_id", str(conversation["business_id"])).eq("channel", channel)
                        .eq("external_customer_id", str(conversation["customer_external_id"])).limit(1).execute())
    chats = []
    if conversation.get("customer_external_id"):
        chats = _rows(client.table("conversations").select("id,summary,status,last_message_at,created_at")
                      .eq("business_id", str(conversation["business_id"])).eq("channel", channel)
                      .eq("customer_external_id", str(conversation["customer_external_id"]))
                      .order("last_message_at", desc=True).limit(8).execute())
    requests = []
    if customer:
        requests = _rows(client.table("customer_requests").select(
            "id,conversation_id,request_type,status,details,missing_information,created_at,updated_at")
            .eq("customer_id", str(customer["id"])).order("updated_at", desc=True).limit(8).execute())
    profile = (customer or {}).get("profile") or {}
    return {
        "kind": "customer",
        "name": conversation.get("customer_name") or profile.get("name") or conversation.get("customer_username") or "Customer",
        "profile": {
            "channel": channel or None,
            "username": conversation.get("customer_username"),
            "first_seen": (customer or {}).get("created_at") or conversation.get("created_at"),
            "summary": conversation.get("summary"),
        },
        "chats": [{"id": row["id"], "title": row.get("summary") or "Chat", "last_activity_at": row.get("last_message_at"),
                   "status": row.get("status"), "current": str(row["id"]) == conversation_id} for row in chats],
        "requests": [{"id": row["id"], "title": str(row.get("request_type") or "request").replace("_", " "),
                      "stage": row.get("status"), "created_at": row.get("created_at"),
                      "missing": list(row.get("missing_information") or []),
                      "details": {key: value for key, value in (row.get("details") or {}).items()
                                  if isinstance(value, (str, int, float)) and str(value).strip()}} for row in requests],
        "invoices": [],
    }


def customer_card(client, item: dict) -> dict | None:
    """The card for a chat work item, or None when the item isn't a chat."""
    if item.get("member_conversation_id"):
        conversation = _one(client.table("member_conversations").select("id,member_id")
                            .eq("id", str(item["member_conversation_id"])).limit(1).execute())
        if not conversation:
            return None
        return member_card(client, str(conversation["member_id"]), str(conversation["id"]))
    conversation_id = business_conversation_id(client, item)
    if conversation_id:
        return customer_card_for_business(client, conversation_id)
    meta = item.get("metadata") or {}
    if meta.get("source_kind") == "chat_handoff":
        if meta.get("member_id"):
            return member_card(client, str(meta["member_id"]), meta.get("conversation_id"))
        if meta.get("conversation_kind") == "business" and meta.get("conversation_id"):
            return customer_card_for_business(client, str(meta["conversation_id"]))
    return None


# ---------------------------------------------------------------------------------------------
# Answers
# ---------------------------------------------------------------------------------------------
WORD = re.compile(r"[\w']+", re.UNICODE)


def _snippet(text: str, terms: list[str], width: int = 260) -> str:
    plain = re.sub(r"\s+", " ", text or "").strip()
    lower = plain.casefold()
    hits = [lower.find(term) for term in terms if lower.find(term) >= 0]
    start = max(0, min(hits) - 60) if hits else 0
    piece = plain[start:start + width]
    return ("…" if start else "") + piece + ("…" if start + width < len(plain) else "")


def search_answers(client, query: str, limit: int = 8) -> list[dict]:
    """Knowledge documents and approved FAQs of the member knowledge account, ranked by how many search words they
    contain (title and question count double)."""
    terms = [word.casefold() for word in WORD.findall(query or "") if len(word) > 2][:8]
    if not terms:
        return []
    business_id = settings.MEMBER_KNOWLEDGE_BUSINESS_ID
    found: list[tuple[int, dict]] = []
    for doc in _rows(client.table("knowledge_documents").select("id,title,content,source_type,updated_at,created_at")
                     .eq("business_id", business_id).limit(500).execute()):
        title, body = str(doc.get("title") or ""), str(doc.get("content") or "")
        score = sum(2 * title.casefold().count(term) + min(body.casefold().count(term), 5) for term in terms)
        if score:
            found.append((score, {"id": doc["id"], "kind": "knowledge", "title": title or "Untitled",
                                  "text": _snippet(body, terms), "full": body[:4000]}))
    for faq in _rows(client.table("business_faqs").select("id,question,answer,status")
                     .eq("business_id", business_id).eq("status", "approved").limit(500).execute()):
        question, answer = str(faq.get("question") or ""), str(faq.get("answer") or "")
        score = sum(2 * question.casefold().count(term) + min(answer.casefold().count(term), 5) for term in terms)
        if score:
            found.append((score + 1, {"id": faq["id"], "kind": "faq", "title": question, "text": _snippet(answer, terms),
                                      "full": answer[:4000]}))
    found.sort(key=lambda pair: -pair[0])
    return [entry for _, entry in found[:limit]]


# ---------------------------------------------------------------------------------------------
# Hand-offs from a chat
# ---------------------------------------------------------------------------------------------
def chat_reference(client, item: dict) -> dict:
    """What a hand-off keeps of the chat it came from."""
    if item.get("member_conversation_id"):
        conversation = _one(client.table("member_conversations").select("id,member_id,title")
                            .eq("id", str(item["member_conversation_id"])).limit(1).execute()) or {}
        profile = _one(client.table("member_profiles").select("display_name")
                       .eq("user_id", str(conversation.get("member_id") or "")).limit(1).execute()) or {}
        return {"conversation_kind": "member", "conversation_id": str(item["member_conversation_id"]),
                "member_id": str(conversation["member_id"]) if conversation.get("member_id") else None,
                "who": profile.get("display_name") or "a member"}
    conversation_id = business_conversation_id(client, item)
    if conversation_id:
        conversation = _one(client.table("conversations").select("id,business_id,customer_name,customer_username,channel")
                            .eq("id", conversation_id).limit(1).execute()) or {}
        return {"conversation_kind": "business", "conversation_id": conversation_id,
                "business_id": str(conversation.get("business_id") or item.get("business_id") or "") or None,
                "who": conversation.get("customer_name") or conversation.get("customer_username") or "a customer",
                "channel": conversation.get("channel")}
    return {}


def handoff_values(item: dict, reference: dict, department: str, note: str, actor_id: str) -> tuple[str, dict]:
    """The new work item's source id and fields."""
    source_id = str(uuid.uuid4())
    summary = f"From a chat with {reference.get('who') or 'a customer'}: {note}"[:240]
    return source_id, {
        "department": department, "work_type": "chat_handoff", "summary": summary,
        "next_action": f"Read the chat and the note from Conversations, then take it from there: {note}"[:500],
        "metadata": {**{key: value for key, value in reference.items() if value},
                     "from_work_item_id": str(item["id"]), "from_department": item.get("department"),
                     "handed_by": actor_id, "note": note},
    }


def chat_transcript(client, meta: dict, limit: int = 40) -> list[dict[str, Any]]:
    """The last messages of the chat a hand-off came from (oldest first)."""
    if not meta.get("conversation_id"):
        return []
    if meta.get("conversation_kind") == "member":
        rows = _rows(client.table("member_messages").select("id,sender_type,content,created_at")
                     .eq("conversation_id", str(meta["conversation_id"])).order("created_at", desc=True).limit(limit).execute())
    else:
        rows = _rows(client.table("messages").select("id,sender_type,content,created_at")
                     .eq("conversation_id", str(meta["conversation_id"])).order("created_at", desc=True).limit(limit).execute())
    return sorted(rows, key=lambda row: str(row.get("created_at") or ""))
