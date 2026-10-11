from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from app.database.client import supabase

logger = logging.getLogger(__name__)

_STAGE_LABELS = {
    "submitted": "Request received",
    "under_review": "Under review",
    "sourcing": "Sourcing started",
    "needs_member_input": "Your input is needed",
    "options_sent": "Options sent",
    "purchase_confirmed": "Purchase confirmed · paid",
    "item_in_warehouse": "Item received at warehouse",
    "shipped": "Item shipped",
    "in_transit": "In transit",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "cancelled": "Request cancelled",
}


def create_member_notifications_router(require_verified_member) -> APIRouter:
    router = APIRouter(tags=["member notifications"])

    @router.get("/members/notifications")
    def list_member_notifications(
        limit: int = Query(default=30, ge=1, le=100),
        authorization: str | None = Header(default=None),
    ):
        member_id = require_verified_member(authorization)
        try:
            rows = (supabase.table("member_notifications")
                .select("id,notification_type,request_event_id,worker_message_id,review_id,review_status,created_at,read_at,banner_dismissed_at")
                .eq("member_id", member_id).order("created_at", desc=True).order("id", desc=True)
                .limit(limit).execute().data or [])
            unread_result = (supabase.table("member_notifications").select("id", count="exact")
                .eq("member_id", member_id).is_("read_at", "null").execute())
            unread_count = getattr(unread_result, "count", None)
            if unread_count is None:
                unread_count = len(unread_result.data or [])
            return {
                "notifications": _project_notifications(rows, member_id),
                "unread_count": unread_count,
            }
        except Exception as exc:
            logger.exception("Could not load member notifications")
            raise HTTPException(status_code=503, detail="Notifications could not be loaded.") from exc

    @router.post("/members/notifications/{notification_id}/read")
    def mark_member_notification_read(
        notification_id: UUID,
        authorization: str | None = Header(default=None),
    ):
        member_id = require_verified_member(authorization)
        try:
            notification = _owned_notification(str(notification_id), member_id)
            if notification.get("read_at") is None:
                supabase.table("member_notifications").update({
                    "read_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", str(notification_id)).eq("member_id", member_id).is_("read_at", "null").execute()
            return {"notification_id": str(notification_id), "read": True}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not mark member notification read")
            raise HTTPException(status_code=503, detail="The notification could not be updated.") from exc

    @router.post("/members/notifications/read-all")
    def mark_all_member_notifications_read(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            updated = (supabase.table("member_notifications").update({
                "read_at": datetime.now(timezone.utc).isoformat(),
            }).eq("member_id", member_id).is_("read_at", "null").select("id").execute().data or [])
            return {"updated_count": len(updated)}
        except Exception as exc:
            logger.exception("Could not mark all member notifications read")
            raise HTTPException(status_code=503, detail="Notifications could not be updated.") from exc

    @router.post("/members/notifications/{notification_id}/dismiss-banner")
    def dismiss_member_notification_banner(
        notification_id: UUID,
        authorization: str | None = Header(default=None),
    ):
        member_id = require_verified_member(authorization)
        try:
            notification = _owned_notification(str(notification_id), member_id)
            if notification.get("banner_dismissed_at") is None:
                supabase.table("member_notifications").update({
                    "banner_dismissed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", str(notification_id)).eq("member_id", member_id).is_(
                    "banner_dismissed_at", "null").execute()
            return {"notification_id": str(notification_id), "banner_dismissed": True}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not dismiss member activity banner")
            raise HTTPException(status_code=503, detail="The activity banner could not be dismissed.") from exc

    return router


def _owned_notification(notification_id: str, member_id: str) -> dict:
    result = (supabase.table("member_notifications")
        .select("id,member_id,read_at,banner_dismissed_at")
        .eq("id", notification_id).eq("member_id", member_id).maybe_single().execute())
    row = result.data if result is not None else None
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return row


def _project_notifications(rows: list[dict], member_id: str) -> list[dict]:
    event_ids = [row["request_event_id"] for row in rows if row.get("request_event_id")]
    message_ids = [row["worker_message_id"] for row in rows if row.get("worker_message_id")]
    review_ids = [row["review_id"] for row in rows if row.get("review_id")]

    events = (supabase.table("member_request_events")
        .select("id,request_id,stage,member_note,created_at").in_("id", event_ids).execute().data or []) if event_ids else []
    event_by_id = {row["id"]: row for row in events}
    request_ids = list(dict.fromkeys(row["request_id"] for row in events))
    requests = (supabase.table("member_purchase_requests")
        .select("id,request_title").eq("member_id", member_id).in_("id", request_ids).execute().data or []) if request_ids else []
    request_by_id = {row["id"]: row for row in requests}

    messages = (supabase.table("member_messages")
        .select("id,conversation_id,created_at").in_("id", message_ids).execute().data or []) if message_ids else []
    reviews = (supabase.table("member_chat_reviews")
        .select("id,conversation_id,status").eq("member_id", member_id).in_("id", review_ids).execute().data or []) if review_ids else []
    conversations = list(dict.fromkeys(
        row["conversation_id"] for row in [*messages, *reviews] if row.get("conversation_id")
    ))
    chats = (supabase.table("member_conversations")
        .select("id,title").eq("member_id", member_id).in_("id", conversations).execute().data or []) if conversations else []
    chat_by_id = {row["id"]: row for row in chats}
    message_by_id = {row["id"]: row for row in messages}
    review_by_id = {row["id"]: row for row in reviews}

    projected = []
    for row in rows:
        kind = row["notification_type"]
        href = "/member/notifications"
        if kind == "request_milestone":
            event = event_by_id.get(row.get("request_event_id"))
            request = request_by_id.get(event["request_id"]) if event else None
            if not event or not request:
                continue
            stage_label = _STAGE_LABELS.get(event["stage"], event["stage"].replace("_", " ").capitalize())
            title = request["request_title"]
            body = stage_label
            if event.get("member_note"):
                body += f" — {event['member_note']}"
            href = f"/member/products#request-{event['request_id']}"
            source_id = event["request_id"]
        elif kind == "worker_reply":
            message = message_by_id.get(row.get("worker_message_id"))
            chat = chat_by_id.get(message["conversation_id"]) if message else None
            if not message or not chat:
                continue
            title = "A FayFort worker replied"
            body = chat.get("title") or "Open your conversation to read the update."
            href = f"/member/chat?conversation={message['conversation_id']}"
            source_id = message["conversation_id"]
        else:
            review = review_by_id.get(row.get("review_id"))
            chat = chat_by_id.get(review["conversation_id"]) if review else None
            if not review or not chat:
                continue
            title = "Photo review update"
            status = row.get("review_status")
            body = {
                "assigned": "A FayFort worker has been assigned to review your photo.",
                "under_review": "A FayFort worker is reviewing your photo.",
                "reviewed": "Your photo review is complete. Open chat to see the response.",
            }.get(status, "Your photo review status changed.")
            href = f"/member/chat?conversation={review['conversation_id']}"
            source_id = review["conversation_id"]
        projected.append({
            "id": row["id"], "notification_type": kind, "title": title, "body": body,
            "href": href, "source_id": source_id, "created_at": row["created_at"],
            "read_at": row.get("read_at"),
            "banner_dismissed_at": row.get("banner_dismissed_at"),
        })
    return projected
