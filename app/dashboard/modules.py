from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.database.client import supabase
from app.database.conversations import list_conversations, get_conversation
from app.database.directory.access_events import create_access_event
from app.database.directory.entitlements import has_business_entitlement
from app.directory.access_gateway import lookup_directory
from app.directory.contracts import DirectoryContext
from app.database.messages import list_messages, get_message
from app.database.outbound_deliveries import list_deliveries_for_messages, get_delivery
from app.database.connections import get_connection, get_connection_credentials
from app.channels.outbound import deliver_instagram_text
from app.channels.messenger_outbound import deliver_messenger_text
from app.directory.identity import trusted_business_member, trusted_platform_admin
from app.directory.registry import TOOLS, get_tool
from app.database.events import publish_business_event


class DirectorySearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_id: str = Field(min_length=1, max_length=64)
    conversation_id: str = Field(min_length=1, max_length=80)
    query: str = Field(min_length=1, max_length=1000)



class RequestStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "awaiting_customer", "completed", "cancelled"] | None = None
    required_information: list[str] | None = Field(default=None, max_length=100)
    missing_information: list[str] | None = Field(default=None, max_length=100)
    details: dict[str, object] | None = None
    related_request_id: str | None = Field(default=None, max_length=80)


class EntitlementGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool_id: str = Field(min_length=1, max_length=64)
    access_level: Literal["registered", "premium"]
    reason: str = Field(min_length=5, max_length=300)
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def validate_expiration(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("expires_at must include a timezone")
        return value


class BusinessSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_updated_at: datetime
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("expected_updated_at")
    @classmethod
    def validate_expected_updated_at(cls, value: datetime):
        if value.tzinfo is None:
            raise ValueError("expected_updated_at must include a timezone")
        return value


class VerificationReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verification_status: Literal["verified", "unverified", "conflicting", "unknown"]
    reason: str = Field(min_length=8, max_length=500)


def _has_request_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (dict, list)):
        return bool(value)
    return True


VERIFICATION_SOURCES = {
    "market": ("directory_markets", "category_market_search", "place_name,city,district"),
    "contact": ("directory_contacts", "category_market_search", "contact_name,market_id"),
    "service_provider": ("directory_service_providers", "service_provider_search", "service,city"),
    "hotel": ("directory_hotels", "hotel_search", "hotel_name,area"),
    "restaurant": ("directory_restaurants", "restaurant_search", "restaurant,area"),
    "city_guide": ("directory_city_guides", "city_area_guide_search", "city,province"),
}

def create_workspace_modules_router() -> APIRouter:
    router = APIRouter(prefix="/businesses/{business_id}", tags=["dashboard-modules"])

    def authorize(business_id: str, authorization: str | None) -> None:
        if not trusted_business_member(authorization, business_id):
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")

    def authorize_admin(business_id: str, authorization: str | None) -> dict:
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required for this action.")
        return member

    def authorize_platform_admin(business_id: str, authorization: str | None) -> dict:
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="A FayFort platform administrator is required for this action.")
        return admin

    @router.get("/conversations")
    def conversations(
        business_id: str,
        status: str | None = Query(default=None, max_length=30),
        channel: str | None = Query(default=None, max_length=50),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0, le=1000000),
        authorization: str | None = Header(default=None),
    ):
        authorize(business_id, authorization)
        try:
            rows = list_conversations(
                business_id,
                status,
                channel,
                limit=limit + 1,
                offset=offset,
            )
            has_more = len(rows) > limit
            safe_rows = [
                {key: row.get(key) for key in (
                    "id", "business_id", "customer_external_id", "customer_name",
                    "customer_username", "channel", "platform", "status",
                    "ai_enabled", "summary", "last_message_at", "created_at",
                )}
                for row in rows[:limit]
            ]
            return {
                "conversations": safe_rows,
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
                "next_offset": offset + limit if has_more else None,
            }
        except Exception:
            raise HTTPException(status_code=503, detail="Conversations could not be loaded.")

    @router.get("/conversations/{conversation_id}/messages")
    def conversation_messages(business_id: str, conversation_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            conversation = get_conversation(conversation_id)
            if not conversation or str(conversation.get("business_id")) != business_id:
                raise HTTPException(status_code=404, detail="Conversation not found.")
            channel = str(conversation.get("channel") or conversation.get("platform") or "")
            customer = None
            if channel and conversation.get("customer_external_id"):
                customer_rows = (supabase.table("customers")
                    .select("id,channel,external_customer_id,profile,created_at,updated_at")
                    .eq("business_id", business_id)
                    .eq("channel", channel)
                    .eq("external_customer_id", str(conversation["customer_external_id"]))
                    .limit(1).execute()).data or []
                customer = customer_rows[0] if customer_rows else None
            messages = list_messages(conversation_id, limit=100)
            deliveries = list_deliveries_for_messages(business_id, [str(message["id"]) for message in messages])
            delivery_by_message = {str(row["message_id"]): row for row in deliveries}
            safe_messages = []
            for message in messages:
                delivery = delivery_by_message.get(str(message["id"]))
                safe_messages.append({
                    **{key: message.get(key) for key in ("id", "sender_type", "content", "created_at")},
                    "delivery": ({key: delivery.get(key) for key in ("id", "status", "attempt_count", "safe_error_code", "last_attempt_at", "delivered_at")} if delivery else None),
                })
            related_requests = []
            if customer:
                related_requests = (supabase.table("customer_requests")
                    .select("id,request_type,status,details,required_information,missing_information,created_at,updated_at")
                    .eq("conversation_id", conversation_id)
                    .eq("customer_id", str(customer["id"]))
                    .order("updated_at", desc=True).limit(100).execute()).data or []
            safe_customer = ({key: customer.get(key) for key in (
                "id", "channel", "external_customer_id", "profile", "created_at", "updated_at",
            )} if customer else None)
            safe_requests = [{key: row.get(key) for key in (
                "id", "request_type", "status", "details", "required_information",
                "missing_information", "created_at", "updated_at",
            )} for row in related_requests]
            return {"conversation_id": conversation_id, "customer": safe_customer, "requests": safe_requests, "messages": safe_messages}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Conversation messages could not be loaded.")

    @router.get("/customers")
    def customers(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            response = (supabase.table("customers").select("id,channel,external_customer_id,profile,created_at,updated_at")
                .eq("business_id", business_id).order("updated_at", desc=True).limit(500).execute())
            return {"customers": response.data or []}
        except Exception:
            raise HTTPException(status_code=503, detail="Customers could not be loaded.")

    @router.get("/customers/{customer_id}")
    def customer_detail(business_id: str, customer_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            response = (supabase.table("customers")
                .select("id,channel,external_customer_id,profile,created_at,updated_at")
                .eq("business_id", business_id).eq("id", customer_id).limit(1).execute())
            if not response.data:
                raise HTTPException(status_code=404, detail="Customer not found.")
            customer = response.data[0]
            conversations = (supabase.table("conversations")
                .select("id,customer_external_id,channel,status,summary,last_message_at,created_at")
                .eq("business_id", business_id)
                .eq("channel", customer["channel"])
                .eq("customer_external_id", str(customer["external_customer_id"]))
                .order("last_message_at", desc=True).limit(100).execute()).data or []
            requests = (supabase.table("customer_requests")
                .select("id,conversation_id,request_type,status,details,required_information,missing_information,created_at,updated_at")
                .eq("customer_id", str(customer["id"]))
                .order("updated_at", desc=True).limit(100).execute()).data or []
            safe_conversations = [{key: row.get(key) for key in (
                "id", "customer_external_id", "channel", "status",
                "summary", "last_message_at", "created_at",
            )} for row in conversations]
            safe_requests = [{key: row.get(key) for key in (
                "id", "conversation_id", "request_type", "status", "details",
                "required_information", "missing_information", "created_at", "updated_at",
            )} for row in requests]
            return {"customer": customer, "conversations": safe_conversations, "requests": safe_requests}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Customer details could not be loaded.")

    @router.get("/requests")
    def requests(business_id: str, status: Literal["active", "awaiting_customer", "completed", "cancelled", "superseded"] | None = Query(default=None), authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            customer_rows = (supabase.table("customers").select("id").eq("business_id", business_id).limit(5000).execute()).data or []
            customer_ids = [row["id"] for row in customer_rows]
            if not customer_ids:
                return {"requests": []}
            query = supabase.table("customer_requests").select("id,customer_id,conversation_id,related_request_id,request_type,status,details,required_information,missing_information,created_at,updated_at").in_("customer_id", customer_ids)
            if status:
                query = query.eq("status", status)
            rows = query.order("updated_at", desc=True).limit(500).execute().data or []
            return {"requests": rows}
        except Exception:
            raise HTTPException(status_code=503, detail="Requests could not be loaded.")

    @router.patch("/requests/{request_id}")
    def update_request_status(business_id: str, request_id: str, payload: RequestStatusUpdate, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        try:
            customers = (supabase.table("customers").select("id").eq("business_id", business_id).limit(5000).execute()).data or []
            customer_ids = [row["id"] for row in customers]
            if not customer_ids:
                raise HTTPException(status_code=404, detail="Request not found.")
            response = (supabase.table("customer_requests").select("id,customer_id,conversation_id,related_request_id,request_type,status,details,required_information,missing_information")
                .eq("id", request_id).in_("customer_id", customer_ids).limit(1).execute())
            if not response.data:
                raise HTTPException(status_code=404, detail="Request not found.")
            current = response.data[0]
            updates = payload.model_dump(exclude_unset=True, exclude_none=True)
            if "related_request_id" in payload.model_fields_set:
                updates["related_request_id"] = payload.related_request_id
            if not updates:
                raise HTTPException(status_code=422, detail="Provide a request field to update.")
            allowed = {
                "active": {"awaiting_customer", "completed", "cancelled"},
                "awaiting_customer": {"active", "completed", "cancelled"},
                "completed": set(), "cancelled": set(), "superseded": set(),
            }
            if "status" in updates and updates["status"] == current["status"]:
                updates.pop("status")
            if "status" in updates and updates["status"] not in allowed.get(current["status"], set()):
                raise HTTPException(status_code=409, detail="That request status change is not allowed.")
            if "required_information" in updates or "details" in updates:
                required = updates.get("required_information", current.get("required_information") or [])
                details = updates.get("details", current.get("details") or {})
                if "missing_information" not in updates:
                    updates["missing_information"] = [field for field in required if not _has_request_value(details.get(field))]
            required_after_update = updates.get("required_information", current.get("required_information") or [])
            if "missing_information" in updates and not set(updates["missing_information"]).issubset(set(required_after_update)):
                raise HTTPException(status_code=422, detail="Missing information must be part of the required information list.")
            if "related_request_id" in updates:
                related_id = updates["related_request_id"]
                if related_id == request_id:
                    raise HTTPException(status_code=422, detail="A request cannot be related to itself.")
                if related_id is not None:
                    related = (supabase.table("customer_requests").select("id")
                        .eq("id", related_id).eq("customer_id", current["customer_id"]).limit(1).execute())
                    if not related.data:
                        raise HTTPException(status_code=422, detail="Related requests must belong to the same customer.")
            if not updates:
                return {"request": current}
            updated = (supabase.table("customer_requests").update(updates)
                .eq("id", request_id).eq("customer_id", current["customer_id"])
                .select("id,customer_id,conversation_id,request_type,status,details,required_information,missing_information,created_at,updated_at").execute())
            if not updated.data:
                raise HTTPException(status_code=409, detail="The request changed before this update could be saved.")
            changed_fields = sorted(updates)
            if "status" in updates:
                publish_business_event(business_id, "request.status_changed", "customer_request", request_id,
                    {"request_id": request_id, "status": updates["status"], "updated_fields": ",".join(changed_fields), "updated_by": member["user_id"]})
            else:
                publish_business_event(business_id, "request.updated", "customer_request", request_id,
                    {"request_id": request_id, "updated_fields": ",".join(changed_fields), "updated_by": member["user_id"]})
            return {"request": updated.data[0]}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Request status could not be updated.")

    @router.get("/requests/{request_id}/events")
    def request_events(business_id: str, request_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            customers = (supabase.table("customers").select("id").eq("business_id", business_id).limit(5000).execute()).data or []
            customer_ids = [row["id"] for row in customers]
            if not customer_ids:
                raise HTTPException(status_code=404, detail="Request not found.")
            request = (supabase.table("customer_requests").select("id")
                .eq("id", request_id).in_("customer_id", customer_ids).limit(1).execute())
            if not request.data:
                raise HTTPException(status_code=404, detail="Request not found.")
            rows = (supabase.table("business_events").select("id,event_type,entity_id,payload,created_at")
                .eq("business_id", business_id).eq("entity_type", "customer_request")
                .eq("entity_id", request_id).order("id", desc=True).limit(100).execute()).data or []
            return {"events": rows}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Request history could not be loaded.")

    @router.post("/directory/search")
    def search_directory(business_id: str, payload: DirectorySearchRequest, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        try:
            conversation = get_conversation(payload.conversation_id)
            if not conversation or str(conversation.get("business_id")) != business_id:
                raise HTTPException(status_code=404, detail="Conversation not found in this business.")
            result = lookup_directory(
                tool_id=payload.tool_id,
                query=payload.query,
                context=DirectoryContext(
                    business_id=business_id,
                    conversation_id=payload.conversation_id,
                    customer_id=conversation.get("customer_id"),
                    identity_verified=True,
                ),
                entitlement_check=has_business_entitlement,
                audit_writer=create_access_event,
            )
            return result.model_dump(mode="json", exclude_none=True)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="The directory search could not be completed.")

    @router.get("/directory/tools")
    def directory_tools(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        return {"tools": [{"tool_id": tool.tool_id, "family": tool.family, "description": tool.description, "visibility": tool.visibility, "entitlement_key": tool.entitlement_key, "verification_policy": tool.verification_policy, "active": tool.active} for tool in TOOLS]}

    @router.get("/channels")
    def channels(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            rows = (supabase.table("channel_events").select("id,channel,event_type,status,conversation_id,reason_code,received_at,processed_at")
                .eq("business_id", business_id).order("received_at", desc=True).limit(200).execute()).data or []
            deliveries = (supabase.table("channel_deliveries")
                .select("id,connection_id,conversation_id,message_id,channel,status,attempt_count,provider_message_id,safe_error_code,last_attempt_at,delivered_at,created_at")
                .eq("business_id", business_id).order("created_at", desc=True).limit(200).execute()).data or []
            return {"events": rows, "deliveries": deliveries}
        except Exception:
            raise HTTPException(status_code=503, detail="Channel activity could not be loaded.")

    @router.post("/channel-deliveries/{delivery_id}/retry")
    def retry_channel_delivery(business_id: str, delivery_id: str, authorization: str | None = Header(default=None)):
        member = authorize_admin(business_id, authorization)
        try:
            delivery = get_delivery(business_id, delivery_id)
            if not delivery:
                raise HTTPException(status_code=404, detail="Delivery record not found.")
            if delivery.get("status") != "rejected":
                raise HTTPException(status_code=409, detail="Only a delivery explicitly rejected by the provider can be retried. Uncertain deliveries are never resent automatically.")
            conversation = get_conversation(str(delivery["conversation_id"]))
            message = get_message(str(delivery["message_id"]))
            if not conversation or str(conversation.get("business_id")) != business_id or not message or str(message.get("conversation_id")) != str(conversation["id"]):
                raise HTTPException(status_code=404, detail="The delivery message could not be found.")
            connection_id = str(delivery.get("connection_id") or "")
            connection = get_connection(business_id, connection_id) if connection_id else None
            if not connection or connection.get("provider") not in {"instagram", "messenger"}:
                raise HTTPException(status_code=409, detail="No supported provider connection is available for this delivery.")
            credentials = get_connection_credentials(business_id, connection_id)
            if not credentials:
                raise HTTPException(status_code=409, detail="Provider credentials are unavailable.")
            sender = deliver_instagram_text if connection["provider"] == "instagram" else deliver_messenger_text
            result = sender(
                connection=connection, credentials=credentials,
                conversation=conversation, message=message,
                require_auto_reply=message.get("sender_type") == "ai",
                retry_rejected=True,
            )
            publish_business_event(business_id, "channel.delivery_retried", "channel_delivery", delivery_id,
                {"delivery_id": delivery_id, "status": result.get("status"), "updated_by": member["user_id"]})
            return {"delivery": result}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="The delivery retry could not be completed.")

    @router.get("/entitlements")
    def entitlements(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            rows = (supabase.table("business_tool_entitlements").select("id,tool_id,access_level,status,starts_at,expires_at,entitlement_source,created_at,updated_at")
                .eq("business_id", business_id).order("created_at", desc=True).limit(500).execute()).data or []
            return {"entitlements": rows, "can_manage": bool(trusted_platform_admin(authorization))}
        except Exception:
            raise HTTPException(status_code=503, detail="Entitlements could not be loaded.")

    @router.post("/entitlements", status_code=201)
    def grant_entitlement(business_id: str, payload: EntitlementGrant, authorization: str | None = Header(default=None)):
        member = authorize_platform_admin(business_id, authorization)
        if get_tool(payload.tool_id) is None:
            raise HTTPException(status_code=422, detail="Choose a registered FayFort tool.")
        if payload.expires_at is not None:
            expiration = payload.expires_at
            if expiration.tzinfo is None or expiration <= datetime.now(timezone.utc):
                raise HTTPException(status_code=422, detail="Expiry must be a future date with a timezone.")
        try:
            row = {
                "business_id": business_id, "tool_id": payload.tool_id,
                "access_level": payload.access_level, "status": "active",
                "entitlement_source": "manual", "source_reference": payload.reason.strip(),
                "expires_at": payload.expires_at.isoformat() if payload.expires_at else None,
            }
            response = (supabase.table("business_tool_entitlements").upsert(row,
                on_conflict="business_id,tool_id,access_level").select("id,tool_id,access_level,status,starts_at,expires_at,entitlement_source,source_reference,created_at,updated_at").execute())
            if not response.data:
                raise RuntimeError("Entitlement was not saved")
            grant = response.data[0]
            publish_business_event(business_id, "entitlement.granted", "business_tool_entitlement", str(grant["id"]),
                {"tool_id": payload.tool_id, "access_level": payload.access_level, "updated_by": member["user_id"]})
            return {"entitlement": grant}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Entitlement could not be saved.")

    @router.post("/entitlements/{entitlement_id}/revoke")
    def revoke_entitlement(business_id: str, entitlement_id: str, authorization: str | None = Header(default=None)):
        member = authorize_platform_admin(business_id, authorization)
        try:
            response = (supabase.table("business_tool_entitlements").update({"status": "revoked"})
                .eq("business_id", business_id).eq("id", entitlement_id)
                .select("id,tool_id,access_level,status,updated_at").execute())
            if not response.data:
                raise HTTPException(status_code=404, detail="Entitlement not found.")
            grant = response.data[0]
            publish_business_event(business_id, "entitlement.revoked", "business_tool_entitlement", str(grant["id"]),
                {"tool_id": grant["tool_id"], "access_level": grant["access_level"], "updated_by": member["user_id"]})
            return {"entitlement": grant}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Entitlement could not be revoked.")

    @router.get("/verification")
    def verification_history(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            rows = (supabase.table("tool_access_events").select("id,conversation_id,customer_request_id,tool_id,outcome,verification_state,returned_fields,reason_code,created_at")
                .eq("business_id", business_id).order("created_at", desc=True).limit(200).execute()).data or []
            reviews = (supabase.table("directory_verification_reviews")
                .select("id,reviewer_user_id,source_table,record_id,tool_id,previous_status,verification_status,reason,created_at")
                .eq("business_id", business_id).order("created_at", desc=True).limit(100).execute()).data or []
            queue = []
            for source_type, (table, tool_id, label_fields) in VERIFICATION_SOURCES.items():
                fields = "id,verification_status," + label_fields
                pending = (supabase.table(table).select(fields)
                    .in_("verification_status", ["unknown", "unverified", "conflicting"])
                    .order("updated_at", desc=True).limit(100).execute()).data or []
                for item in pending:
                    queue.append({"source_type": source_type, "tool_id": tool_id, "record_id": item["id"],
                        "verification_status": item.get("verification_status"),
                        "label": " · ".join(str(item[field]) for field in label_fields.split(",") if item.get(field))})
            return {"decisions": rows, "reviews": reviews, "review_queue": queue[:300], "can_review": bool(trusted_platform_admin(authorization))}
        except Exception:
            raise HTTPException(status_code=503, detail="Verification decisions could not be loaded.")

    @router.post("/verification/{source_type}/{record_id}")
    def review_directory_record(business_id: str, source_type: str, record_id: str, payload: VerificationReview, authorization: str | None = Header(default=None)):
        member = authorize_platform_admin(business_id, authorization)
        source = VERIFICATION_SOURCES.get(source_type)
        if source is None:
            raise HTTPException(status_code=404, detail="Directory record type not found.")
        table, tool_id, _ = source
        try:
            result = supabase.rpc("review_directory_record", {
                "p_business_id": business_id,
                "p_reviewer_user_id": member["user_id"],
                "p_source_table": table,
                "p_record_id": record_id,
                "p_tool_id": tool_id,
                "p_verification_status": payload.verification_status,
                "p_reason": payload.reason.strip(),
            }).execute().data
            if not result:
                raise HTTPException(status_code=409, detail="Directory record changed before review could be saved.")
            review = result[0] if isinstance(result, list) else result
            if isinstance(review, dict) and review.get("error") == "not_found":
                raise HTTPException(status_code=404, detail="Directory record not found.")
            prior = review["previous_status"]
            publish_business_event(business_id, "directory.verification_reviewed", "directory_record", record_id,
                {"source_type": source_type, "verification_status": payload.verification_status, "reviewed_by": member["user_id"]})
            return {"review": {"source_type": source_type, "record_id": record_id,
                "previous_status": prior, "verification_status": payload.verification_status}}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Verification review could not be saved.")

    @router.get("/analytics")
    def analytics(
        business_id: str,
        days: int = Query(default=30, ge=1, le=90),
        before_id: int | None = Query(default=None, ge=1),
        limit: int = Query(default=50, ge=1, le=100),
        authorization: str | None = Header(default=None),
    ):
        authorize(business_id, authorization)
        if days not in {7, 30, 90}:
            raise HTTPException(status_code=422, detail="Analytics window must be 7, 30, or 90 days.")
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            sample_query = (supabase.table("business_events").select("id,event_type,created_at")
                .eq("business_id", business_id).gte("created_at", cutoff).order("id", desc=True).limit(501))
            sample_rows = sample_query.execute().data or []
            summary_truncated = len(sample_rows) > 500
            summary_rows = sample_rows[:500]
            counts: dict[str, int] = {}
            for row in summary_rows:
                event_type = str(row.get("event_type", "unknown"))
                counts[event_type] = counts.get(event_type, 0) + 1

            page_query = (supabase.table("business_events").select("id,event_type,entity_type,entity_id,created_at")
                .eq("business_id", business_id).gte("created_at", cutoff))
            if before_id is not None:
                page_query = page_query.lt("id", before_id)
            page_rows = page_query.order("id", desc=True).limit(limit + 1).execute().data or []
            has_more = len(page_rows) > limit
            events = page_rows[:limit]
            return {
                "days": days,
                "sampled_events": len(summary_rows),
                "summary_truncated": summary_truncated,
                "event_counts": counts,
                "events": [
                    {key: event.get(key) for key in ("id", "event_type", "entity_type", "entity_id", "created_at")}
                    for event in events
                ],
                "has_more": has_more,
                "next_before_id": events[-1]["id"] if has_more and events else None,
            }
        except Exception:
            raise HTTPException(status_code=503, detail="Analytics could not be loaded.")

    @router.get("/ai-usage")
    def ai_usage(
        business_id: str,
        days: int = Query(default=30, ge=1, le=90),
        authorization: str | None = Header(default=None),
    ):
        authorize(business_id, authorization)
        if days not in {7, 30, 90}:
            raise HTTPException(status_code=422, detail="AI usage window must be 7, 30, or 90 days.")
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            rows = (supabase.table("ai_usage_events")
                .select("operation,model,provider,request_status,prompt_tokens,completion_tokens,total_tokens,estimated_cost_micro_usd,actual_cost_micro_usd,source_message_id,created_at")
                .eq("business_id", business_id).gte("created_at", cutoff)
                .order("created_at", desc=True).limit(5001).execute().data or [])
            budget = supabase.rpc("get_ai_usage_budget_status", {"p_business_id": business_id}).execute().data
            if isinstance(budget, list):
                budget = budget[0] if budget else None
            if not isinstance(budget, dict):
                raise RuntimeError("AI budget status is unavailable")
            truncated = len(rows) > 5000
            sample = rows[:5000]
            by_operation: dict[str, dict[str, int]] = {}
            by_model: dict[str, int] = {}
            by_provider: dict[str, int] = {}
            calls_by_message: dict[str, int] = {}
            for row in sample:
                operation = str(row.get("operation") or "unknown")
                operation_totals = by_operation.setdefault(operation, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
                operation_totals["calls"] += 1
                model = str(row.get("model") or "unknown")[:200]
                by_model[model] = by_model.get(model, 0) + 1
                provider = str(row.get("provider") or "unknown")[:100]
                by_provider[provider] = by_provider.get(provider, 0) + 1
                source_message_id = row.get("source_message_id")
                if source_message_id:
                    source_key = str(source_message_id)
                    calls_by_message[source_key] = calls_by_message.get(source_key, 0) + 1
                for token_field in ("prompt_tokens", "completion_tokens", "total_tokens"):
                    value = row.get(token_field)
                    if type(value) is int and value >= 0:
                        operation_totals[token_field] += value
            reported = sum(1 for row in sample if any(
                type(row.get(field)) is int and row[field] >= 0
                for field in ("prompt_tokens", "completion_tokens", "total_tokens")
            ))
            return {
                "days": days,
                "sampled_requests": len(sample),
                "summary_truncated": truncated,
                "reported_usage_requests": reported,
                "unknown_usage_requests": len(sample) - reported,
                "prompt_tokens": sum(item["prompt_tokens"] for item in by_operation.values()),
                "completion_tokens": sum(item["completion_tokens"] for item in by_operation.values()),
                "total_tokens": sum(item["total_tokens"] for item in by_operation.values()),
                "source_messages": len({row["source_message_id"] for row in sample if row.get("source_message_id")}),
                "message_call_distribution": {
                    str(call_count): sum(1 for count in calls_by_message.values() if count == call_count)
                    for call_count in sorted(set(calls_by_message.values()))
                },
                "operations": by_operation,
                "models": by_model,
                "providers": by_provider,
                "budget": {
                    "limit_usd": budget["limit_micro_usd"] / 1_000_000,
                    "committed_usd": budget["committed_micro_usd"] / 1_000_000,
                    "pending_usd": budget["pending_micro_usd"] / 1_000_000,
                    "remaining_usd": budget["remaining_micro_usd"] / 1_000_000,
                    "month_start": budget["month_start"],
                },
            }
        except Exception:
            raise HTTPException(status_code=503, detail="AI usage could not be loaded.")

    @router.get("/settings")
    def settings_summary(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            rows = (supabase.table("businesses").select("id,name,description,created_at,updated_at")
                .eq("id", business_id).limit(1).execute()).data or []
            if not rows:
                raise HTTPException(status_code=404, detail="Business not found.")
            return {"business": rows[0], "editable_settings_available": True, "editable_fields": ["name", "description"]}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Workspace details could not be loaded.")

    @router.patch("/settings")
    def update_business_settings(business_id: str, payload: BusinessSettingsUpdate, authorization: str | None = Header(default=None)):
        member = authorize_admin(business_id, authorization)
        changes = payload.model_dump(exclude_unset=True)
        expected_updated_at = changes.pop("expected_updated_at")
        if not changes:
            raise HTTPException(status_code=422, detail="Change the business name or description first.")
        if "name" in changes:
            if changes["name"] is None:
                raise HTTPException(status_code=422, detail="Business name cannot be blank.")
            changes["name"] = changes["name"].strip()
            if not changes["name"]:
                raise HTTPException(status_code=422, detail="Business name cannot be blank.")
        if "description" in changes and changes["description"] is not None:
            changes["description"] = changes["description"].strip() or None
        try:
            result = supabase.rpc("update_business_settings", {
                "p_business_id": business_id,
                "p_updated_by": member["user_id"],
                "p_expected_updated_at": expected_updated_at.astimezone(timezone.utc).isoformat(),
                "p_update_name": "name" in changes,
                "p_name": changes.get("name"),
                "p_update_description": "description" in changes,
                "p_description": changes.get("description"),
            }).execute().data
            result = result[0] if isinstance(result, list) and result else result
            if not isinstance(result, dict):
                raise HTTPException(status_code=503, detail="Workspace settings could not be saved.")
            if result.get("error") == "conflict":
                raise HTTPException(status_code=409, detail="Workspace settings changed since you opened this page. Refresh and reapply your change.")
            if result.get("error") == "not_found":
                raise HTTPException(status_code=404, detail="Business not found.")
            return {"business": result, "editable_settings_available": True, "editable_fields": ["name", "description"]}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Workspace settings could not be saved.")

    return router
