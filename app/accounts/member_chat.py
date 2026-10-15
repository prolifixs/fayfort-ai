from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config.settings import settings
from app.database.client import supabase
from app.services.ai_budget import (
    _calculate_cost_micro_usd,
    _configured_model_route,
    estimate_input_token_upper_bound,
    fetch_pinned_provider_prices,
)
from app.services.ai_usage import normalize_provider_usage
from app.services.ai_responder import _guard_response_grounding

logger = logging.getLogger(__name__)
MAX_OUTPUT_TOKENS = 500


class NewMemberMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a message.")
        return value


class LinkMemberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID


def _response_data(value: Any) -> Any:
    return value.data if value is not None else None


def _catalog_matches(text: str) -> list[dict[str, Any]]:
    terms = list(dict.fromkeys(word.strip(".,!?;:'\"()[]{}") for word in text.casefold().split() if len(word.strip(".,!?;:'\"()[]{}")) > 2))[:8]
    if not terms:
        return []
    # Search a bounded safe projection locally so name, description, and
    # category can all contribute without interpolating user text into filters.
    rows = (supabase.table("directory_products")
        .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
        .eq("active", True).order("name").limit(500).execute().data or [])
    scored = []
    for row in rows:
        searchable = " ".join(str(row.get(key) or "") for key in ("name", "description", "category_ref")).casefold()
        score = sum(term in searchable for term in terms)
        if score:
            scored.append((score, row))
    scored.sort(key=lambda item: (-item[0], str(item[1].get("name") or "").casefold()))
    return [row for _, row in scored[:5]]


def _with_commerce_cards(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add price, sale and stock to chat product suggestions (commerce card fields)."""
    if not products:
        return products
    try:
        from app.commerce import service as commerce
        full = {str(p["id"]): p for p in commerce.load_products(ids=[str(p["id"]) for p in products])}
        cards = {c["id"]: c for c in commerce.cards(list(full.values()))}
        return [{**product, **cards.get(str(product["id"]), {})} for product in products]
    except Exception:
        logger.exception("Could not add commerce details to chat products")
        return products


def _find_it_for_message(member_id: str, conversation_id: str, content: str) -> dict[str, Any] | None:
    """A pasted link in the chat composer runs Find It (exact match, alternatives, Source it)."""
    try:
        from app.commerce import links, service as commerce
        if not links.find_url(content):
            return None
        return commerce.find_it(member_id, content, session_id=f"chat:{conversation_id}"[:64])
    except Exception:
        logger.exception("Find It could not resolve a chat link")
        return None


def _invoke_member_model(*, member_id: str, messages: list[dict[str, str]]) -> tuple[str, int, int, str, str]:
    model, provider = _configured_model_route()
    input_price, output_price = fetch_pinned_provider_prices()
    max_input_tokens = estimate_input_token_upper_bound(messages)
    reserved_micro_usd = (
        _calculate_cost_micro_usd(max_input_tokens, input_price)
        + _calculate_cost_micro_usd(MAX_OUTPUT_TOKENS, output_price)
    )
    request_id = str(uuid.uuid4())
    reservation = _response_data(supabase.rpc("reserve_member_ai_turn", {
        "p_request_id": request_id,
        "p_member_id": member_id,
        "p_model": model,
        "p_provider": provider,
        "p_input_price_micro_usd_per_million": input_price,
        "p_output_price_micro_usd_per_million": output_price,
        "p_max_input_tokens": max_input_tokens,
        "p_max_output_tokens": MAX_OUTPUT_TOKENS,
        "p_reserved_micro_usd": reserved_micro_usd,
    }).execute())
    if not isinstance(reservation, dict):
        raise HTTPException(status_code=503, detail="AI access could not be verified safely. Catalog browsing is still available.")
    if reservation.get("allowed") is not True:
        if reservation.get("reason") == "rate_limit":
            retry_at = reservation.get("retry_at")
            raise HTTPException(status_code=429, detail={"code": "member_ai_rate_limited", "retry_at": retry_at,
                "message": "You have reached the current chat limit. Product browsing remains available."})
        if reservation.get("reason") == "monthly_budget_exceeded":
            raise HTTPException(status_code=429, detail={"code": "member_ai_monthly_limit", "message":
                "Your monthly AI chat allowance has been reached. Product browsing remains available."})
        raise HTTPException(status_code=503, detail="AI access is temporarily unavailable. Catalog browsing is still available.")

    def settle(status: str, actual: int | None) -> None:
        try:
            supabase.rpc("settle_member_ai_turn", {"p_request_id": request_id,
                "p_actual_micro_usd": actual, "p_reservation_status": status}).execute()
        except Exception as exc:
            logger.error("Member AI reservation settlement failed; reservation remains held: %s", type(exc).__name__)

    try:
        response = requests.post(settings.HF_CHAT_COMPLETIONS_URL,
            headers={"Authorization": f"Bearer {settings.HF_TOKEN}", "Content-Type": "application/json"},
            json={"model": settings.HF_MODEL, "messages": messages, "temperature": 0.2,
                "max_tokens": MAX_OUTPUT_TOKENS, "stream": False}, timeout=45)
        response.raise_for_status()
        data = response.json()
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else None
        rejected = code is not None and 400 <= code < 500 and code not in {408, 425}
        settle("released" if rejected else "uncertain", None)
        raise HTTPException(status_code=503, detail="AI chat is temporarily unavailable. Your message is saved; product browsing remains available.") from exc
    except (requests.RequestException, ValueError) as exc:
        settle("uncertain", None)
        raise HTTPException(status_code=503, detail="AI chat is temporarily unavailable. Your message is saved; product browsing remains available.") from exc

    usage = normalize_provider_usage(data)
    prompt_tokens, completion_tokens = usage.get("prompt_tokens"), usage.get("completion_tokens")
    actual = None
    if type(prompt_tokens) is int and type(completion_tokens) is int:
        actual = (_calculate_cost_micro_usd(prompt_tokens, input_price)
                  + _calculate_cost_micro_usd(completion_tokens, output_price))
    settle("settled" if actual is not None else "uncertain", actual)
    choices = data.get("choices") if isinstance(data, dict) else None
    answer = choices[0].get("message", {}).get("content") if choices and isinstance(choices[0], dict) else None
    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(status_code=503, detail="AI chat returned no usable answer. Product browsing remains available.")
    return answer.strip()[:8000], reserved_micro_usd, actual or 0, model, provider


def create_member_chat_router(require_verified_member: Callable[[str | None], str]) -> APIRouter:
    router = APIRouter(tags=["member-chat"])

    @router.get("/members/conversations")
    def list_member_conversations(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            rows = (supabase.table("member_conversations")
                .select("id,title,linked_request_id,retention_hold,last_activity_at,created_at")
                .eq("member_id", member_id).order("last_activity_at", desc=True).limit(100).execute().data or [])
            conversation_ids = [str(row["id"]) for row in rows if row.get("id")]
            work_items = (supabase.table("operations_work_items")
                .select("id,member_conversation_id,status")
                .in_("member_conversation_id", conversation_ids).execute().data or []) if conversation_ids else []
            support_by_conversation = {str(item["member_conversation_id"]): item
                for item in work_items if item.get("member_conversation_id")}
            rows = [{**row, "support_work_item_id": support_by_conversation.get(str(row["id"]), {}).get("id"),
                     "support_status": support_by_conversation.get(str(row["id"]), {}).get("status")}
                    for row in rows]
            return {"conversations": rows}
        except Exception as exc:
            logger.exception("Could not list member conversations")
            raise HTTPException(status_code=503, detail="Member chats could not be loaded.") from exc

    @router.post("/members/conversations", status_code=201)
    def create_member_conversation(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            response = supabase.table("member_conversations").insert({"member_id": member_id}).execute()
            row = (response.data or [None])[0]
            if not row:
                raise RuntimeError("Conversation insert returned no row")
            return {"conversation": row}
        except Exception as exc:
            logger.exception("Could not create member conversation")
            raise HTTPException(status_code=503, detail="A new chat could not be created.") from exc

    @router.post("/members/conversations/{conversation_id}/request-support")
    def request_member_conversation_support(conversation_id: uuid.UUID,
                                            authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            result = supabase.rpc("request_member_conversation_support", {
                "p_member_id": member_id, "p_conversation_id": str(conversation_id),
            }).execute()
            work_item = result.data
            if isinstance(work_item, list):
                work_item = work_item[0] if work_item else None
            if not isinstance(work_item, dict) or not work_item.get("id"):
                raise RuntimeError("Support request returned no work item")
            return {"work_item_id": work_item["id"], "status": work_item.get("status", "open")}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not request member conversation support")
            message = str(exc).casefold()
            if "not found" in message or "not owned" in message:
                raise HTTPException(status_code=404, detail="Chat not found.") from exc
            if "linked request" in message or "read only" in message:
                raise HTTPException(status_code=409, detail="This chat is linked to a sourcing request. Follow its progress in Requests.") from exc
            raise HTTPException(status_code=503, detail="Staff support could not be requested right now.") from exc

    @router.delete("/members/conversations/{conversation_id}")
    def delete_member_conversation(conversation_id: uuid.UUID,
                                   authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        conversation_ref = str(conversation_id)
        try:
            owner = (supabase.table("member_conversations").select("id,retention_hold,linked_request_id")
                .eq("id", conversation_ref).eq("member_id", member_id).maybe_single().execute())
            conversation = _response_data(owner)
            if not conversation:
                raise HTTPException(status_code=404, detail="Chat not found.")
            if conversation.get("retention_hold") or conversation.get("linked_request_id"):
                raise HTTPException(status_code=409,
                    detail="This chat is retained with a sourcing request and cannot be deleted here.")

            reviews = (supabase.table("member_chat_reviews").select("id")
                .eq("conversation_id", conversation_ref).execute().data or [])
            review_ids = [row["id"] for row in reviews if row.get("id")]
            storage_paths = []
            if review_ids:
                media = (supabase.table("member_chat_review_media").select("storage_path")
                    .in_("review_id", review_ids).execute().data or [])
                storage_paths = [row["storage_path"] for row in media if row.get("storage_path")]
            if storage_paths:
                supabase.storage.from_("member-chat-review-media").remove(storage_paths)

            deleted = (supabase.table("member_conversations").delete()
                .eq("id", conversation_ref).eq("member_id", member_id)
                .eq("retention_hold", False).is_("linked_request_id", "null")
                .select("id").execute().data or [])
            if not deleted:
                raise HTTPException(status_code=409,
                    detail="This chat was linked to a sourcing request and is now retained.")
            return {"deleted": True, "conversation_id": conversation_ref}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not delete member conversation")
            raise HTTPException(status_code=503, detail="The chat could not be deleted.") from exc

    @router.get("/members/conversations/{conversation_id}/messages")
    def list_member_messages(conversation_id: uuid.UUID, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            owner = (supabase.table("member_conversations").select("id")
                .eq("id", str(conversation_id)).eq("member_id", member_id).maybe_single().execute())
            if not _response_data(owner):
                raise HTTPException(status_code=404, detail="Chat not found.")
            rows = (supabase.table("member_messages").select("id,sender_type,content,related_product_ids,find_it,created_at")
                .eq("conversation_id", str(conversation_id)).order("created_at").limit(500).execute().data or [])
            product_ids = list(dict.fromkeys(product_id for row in rows
                for product_id in (row.get("related_product_ids") or []) if product_id))
            products = []
            if product_ids:
                products = (supabase.table("directory_products")
                    .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
                    .eq("active", True).in_("id", product_ids).execute().data or [])
                products = _with_commerce_cards(products)
            return {"messages": rows, "products": products}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load member chat messages")
            raise HTTPException(status_code=503, detail="Chat messages could not be loaded.") from exc

    @router.post("/members/conversations/{conversation_id}/messages", status_code=201)
    def send_member_message(conversation_id: uuid.UUID, payload: NewMemberMessage,
                            authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        user_row = None
        try:
            owner = (supabase.table("member_conversations").select("id,retention_hold,linked_request_id")
                .eq("id", str(conversation_id)).eq("member_id", member_id).maybe_single().execute())
            conversation = _response_data(owner)
            if not conversation:
                raise HTTPException(status_code=404, detail="Chat not found.")
            if conversation.get("retention_hold"):
                raise HTTPException(status_code=409,
                    detail="This chat is read-only because it is linked to a sourcing request. Follow its progress in Requests.")
            user_row = (supabase.table("member_messages").insert({"conversation_id": str(conversation_id),
                "sender_type": "member", "content": payload.content}).execute().data or [None])[0]
            if not user_row:
                raise RuntimeError("Member message insert returned no row")
            # Handoff window: while a FayFort person is actively chatting, the AI stays quiet (with a
            # holding note if they've been quiet a while); after their idle window the AI resumes.
            support_state = None
            try:
                from app.handoffs import window as handoff_window
                support_state = handoff_window.member_support_state(str(conversation_id))
            except Exception:
                logger.exception("Member support window could not be evaluated")
            if support_state is not None and support_state.phase == "human_active":
                holding_row = None
                if support_state.holding_due:
                    holding_row = (supabase.table("member_messages").insert({"conversation_id": str(conversation_id),
                        "sender_type": "assistant", "content": handoff_window.HUMAN_BUSY_REPLY}).execute().data or [None])[0]
                supabase.table("member_conversations").update({"last_activity_at": datetime.now(timezone.utc).isoformat()})\
                    .eq("id", str(conversation_id)).eq("member_id", member_id).execute()
                return {"member_message": user_row, "assistant_message": holding_row, "products": [], "find_it": None,
                        "human_active": True}
            previous = (supabase.table("member_messages").select("sender_type,content")
                .eq("conversation_id", str(conversation_id)).order("created_at", desc=True).limit(12).execute().data or [])
            matches = _catalog_matches(payload.content)
            find_result = _find_it_for_message(member_id, str(conversation_id), payload.content)
            if find_result:
                found_ids = [item["id"] for item in ([find_result.get("exact")] if find_result.get("exact") else [])
                             + list(find_result.get("alternatives") or [])]
                by_id = {str(item["id"]): item for item in matches}
                extra = [] if not found_ids else (supabase.table("directory_products")
                    .select("id,name,category_ref,description,availability_status,media_url,media_type,media_source")
                    .eq("active", True).in_("id", found_ids).execute().data or [])
                for item in extra:
                    by_id.setdefault(str(item["id"]), item)
                ordered = [by_id[i] for i in found_ids if i in by_id]
                matches = (ordered + [m for m in matches if str(m["id"]) not in found_ids])[:5]
            catalog_facts = "\n".join(
                f"- Product {item['id']}: {item['name']}; category {item.get('category_ref') or 'unlisted'}; "
                f"catalog status {item.get('availability_status') or 'unknown'}; details {item.get('description') or 'not provided'}"
                for item in matches)
            system = ("You are FayFort's member product discovery assistant. Help users find products using only the active catalog facts below. "
                "Never invent product names, prices, stock, availability, delivery, or business policies. Catalog status is not a live inventory promise. "
                "If no relevant match is listed, ask a short clarifying question or suggest browsing the catalog. Do not claim to create a request, contact staff, or complete an action.\n"
                f"Active catalog matches:\n{catalog_facts or '(No active catalog matches were found for this message.)'}"
                + ("\nThe member shared a link. FayFort shows them cards for it below your reply: an exact match if the store has it, "
                   "the closest alternatives, and a Source it button that asks the FayFort team to find it. Refer to those cards briefly."
                   if find_result and find_result.get("kind") == "link" else ""))
            history = list(reversed(previous))
            messages = [{"role": "system", "content": system}]
            messages.extend({"role": "user" if item["sender_type"] == "member" else "assistant",
                "content": item["content"]} for item in history)
            answer, _, _, _, _ = _invoke_member_model(member_id=member_id, messages=messages)
            answer = _guard_response_grounding(answer=answer, customer_message=payload.content,
                knowledge_context=catalog_facts, action_decision=None)
            assistant_values = {"conversation_id": str(conversation_id), "sender_type": "assistant", "content": answer,
                "related_product_ids": [item["id"] for item in matches]}
            if find_result:
                assistant_values["find_it"] = find_result
            assistant_row = (supabase.table("member_messages").insert(assistant_values).execute().data or [None])[0]
            if not assistant_row:
                raise RuntimeError("Assistant message insert returned no row")
            title = payload.content[:117] + "…" if len(payload.content) > 120 else payload.content
            supabase.table("member_conversations").update({"title": title, "last_activity_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", str(conversation_id)).eq("member_id", member_id).execute()
            return {"member_message": user_row, "assistant_message": assistant_row,
                    "products": _with_commerce_cards(matches), "find_it": find_result}
        except HTTPException as exc:
            if exc.status_code == 429 and user_row and user_row.get("id"):
                try:
                    supabase.table("member_messages").delete().eq("id", user_row["id"])\
                        .eq("conversation_id", str(conversation_id)).execute()
                except Exception:
                    logger.error("Could not remove throttled member chat message: %s", type(exc).__name__)
            raise
        except Exception as exc:
            logger.exception("Member chat send failed")
            raise HTTPException(status_code=503, detail="Your message was saved, but chat could not finish. Please retry.") from exc

    @router.post("/members/conversations/{conversation_id}/retention-hold")
    def link_request_retention_hold(conversation_id: uuid.UUID, payload: LinkMemberRequest,
                                    authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            supabase.rpc("link_member_chat_request", {
                "p_member_id": member_id,
                "p_conversation_id": str(conversation_id),
                "p_request_id": str(payload.request_id),
            }).execute()
            return {"conversation_id": str(conversation_id), "request_id": str(payload.request_id), "retention_hold": True}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not link member chat retention hold")
            raise HTTPException(status_code=503, detail="The chat could not be linked to the request.") from exc

    return router
