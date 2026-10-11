from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.accounts.member_chat_review import BUCKET
from app.database.client import supabase

logger = logging.getLogger(__name__)
POLL_SECONDS = 24 * 60 * 60


def purge_expired_member_review_media(*, now: datetime | None = None, limit: int = 500) -> dict[str, int]:
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        raise ValueError("Retention clock must be timezone-aware")
    reference = reference.astimezone(timezone.utc)
    rows = (supabase.table("member_chat_review_media")
        .select("id,review_id,storage_path,expires_at").lte("expires_at", reference.isoformat())
        .order("expires_at").limit(limit).execute().data or [])
    deleted = failed = 0
    for row in rows:
        try:
            review_result = (supabase.table("member_chat_reviews")
                .select("conversation_id,reviewed_at,created_at")
                .eq("id", row["review_id"]).maybe_single().execute())
            review = review_result.data if review_result is not None else None
            if not review:
                raise RuntimeError("Review metadata is missing; retain media fail-closed")
            conversation_result = (supabase.table("member_conversations")
                .select("linked_request_id,retention_hold")
                .eq("id", review["conversation_id"]).maybe_single().execute())
            conversation = conversation_result.data if conversation_result is not None else None
            if not conversation:
                raise RuntimeError("Conversation metadata is missing; retain media fail-closed")

            hold = conversation.get("retention_hold") is True
            request_id = conversation.get("linked_request_id")
            if hold or request_id:
                if not request_id:
                    # A hold with no resolvable request remains protected for manual review.
                    supabase.table("member_chat_review_media").update({
                        "expires_at": (reference + timedelta(days=30)).isoformat(),
                    }).eq("id", row["id"]).execute()
                    continue
                latest_result = (supabase.table("member_request_events")
                    .select("stage,created_at").eq("request_id", request_id)
                    .order("sequence_no", desc=True).limit(1).maybe_single().execute())
                latest = latest_result.data if latest_result is not None else None
                stage = latest.get("stage") if latest else None
                if not latest or stage not in {"delivered", "cancelled"} or (stage == "cancelled" and hold):
                    # Keep evidence during active work and closed requests awaiting manual release.
                    supabase.table("member_chat_review_media").update({
                        "expires_at": (reference + timedelta(days=30)).isoformat(),
                    }).eq("id", row["id"]).execute()
                    continue
                reviewed_at = review.get("reviewed_at") or review["created_at"]
                reviewed = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
                resolved = datetime.fromisoformat(latest["created_at"].replace("Z", "+00:00"))
                deadline = max(reviewed, resolved).astimezone(timezone.utc) + timedelta(days=30)
                current_expiry = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
                if deadline > current_expiry:
                    supabase.table("member_chat_review_media").update({
                        "expires_at": deadline.isoformat(),
                    }).eq("id", row["id"]).execute()
                    if deadline > reference:
                        continue

            supabase.storage.from_(BUCKET).remove([row["storage_path"]])
            supabase.table("member_chat_review_media").delete().eq("id", row["id"]).execute()
            deleted += 1
        except Exception:
            failed += 1
            logger.exception("Member review media expiry failed: media_id=%s", row.get("id"))
    return {"eligible": len(rows), "deleted": deleted, "failed": failed}


async def member_review_media_retention_loop() -> None:
    while True:
        try:
            result = await asyncio.to_thread(purge_expired_member_review_media)
            if result["eligible"]:
                logger.info("Member review media retention sweep: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Member review media retention sweep failed")
        await asyncio.sleep(POLL_SECONDS)
