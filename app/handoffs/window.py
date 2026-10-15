"""Handoff windows: a human handoff never leaves a customer talking to silence.

Rules (Instagram/Messenger DMs and the website member chat):
- **Waiting** (a person was asked for, nobody has replied yet): the customer gets a short holding
  reply (at most once every HANDOFF_HOLDING_INTERVAL_MINUTES). If no person replies within
  HANDOFF_WAIT_MINUTES, the handoff closes and the AI picks the conversation back up.
- **Human active** (a person replied): the AI stays quiet so it doesn't talk over them. If the person
  goes quiet for HANDOFF_IDLE_MINUTES, the handoff closes and the AI picks back up. While the person
  is quiet for more than the holding interval, the customer still gets a holding reply.
- A background sweep closes expired DM handoffs even when the customer writes nothing more, and tells
  the customer the AI is back, so nobody waits in an empty chat.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from app.config.settings import settings

logger = logging.getLogger(__name__)

WAITING_REPLY = (
    "Thanks, a member of our team has your message and will reply here soon. "
    "If nobody is free within about {minutes} minutes, I'll keep helping you myself."
)
HUMAN_BUSY_REPLY = "Our team member has your message and will reply here shortly."
RESUMED_REPLY = (
    "Sorry for the wait. Our team couldn't get to you just now, so I'm back to help. "
    "Ask me anything, or ask for a person again any time."
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class WindowState:
    phase: str  # "waiting" | "human_active" | "expired"
    last_human_at: datetime | None
    holding_due: bool


def evaluate(*, opened_at: Any, last_human_at: Any, last_reply_at: Any, now: datetime | None = None) -> WindowState:
    """opened_at: when a person was asked for. last_human_at: the person's latest reply (or None).
    last_reply_at: the latest message the customer received from anyone (AI, holding note or person)."""
    now = now or now_utc()
    opened = parse_time(opened_at) or now
    human = parse_time(last_human_at)
    if human and human < opened:
        human = None
    last_reply = parse_time(last_reply_at)
    holding_gap = timedelta(minutes=max(1, settings.HANDOFF_HOLDING_INTERVAL_MINUTES))
    holding_due = last_reply is None or now - last_reply >= holding_gap
    if human is None:
        if now - opened >= timedelta(minutes=max(1, settings.HANDOFF_WAIT_MINUTES)):
            return WindowState("expired", None, False)
        return WindowState("waiting", None, holding_due)
    if now - human >= timedelta(minutes=max(1, settings.HANDOFF_IDLE_MINUTES)):
        return WindowState("expired", human, False)
    # The person replied recently: only nudge if they have been quiet past the holding interval.
    return WindowState("human_active", human, holding_due and now - human >= holding_gap)


def waiting_reply() -> str:
    return WAITING_REPLY.format(minutes=max(1, settings.HANDOFF_WAIT_MINUTES))


# ---------------------------------------------------------------------------------------------
# Business conversations (Instagram / Messenger / manual channel)
# ---------------------------------------------------------------------------------------------
def _db():
    from app.database.client import supabase
    return supabase


def conversation_timeline(conversation_id: str, since: Any) -> tuple[Any, Any]:
    """(latest person reply, latest reply of any kind) after `since` in a business conversation."""
    rows = (_db().table("messages").select("sender_type,created_at").eq("conversation_id", conversation_id)
            .gte("created_at", str(since)).in_("sender_type", ["agent", "ai"]).order("created_at", desc=True)
            .limit(50).execute().data or [])
    last_human = next((row["created_at"] for row in rows if row.get("sender_type") == "agent"), None)
    last_reply = rows[0]["created_at"] if rows else None
    return last_human, last_reply


def close_handoff_for_timeout(handoff: dict[str, Any], reason: str) -> bool:
    """Return the conversation to automation. The Operations work item closes through its trigger."""
    try:
        updated = (_db().table("conversation_handoffs")
                   .update({"status": "returned", "closed_at": now_utc().isoformat()})
                   .eq("id", handoff["id"]).in_("status", ["requested", "assigned", "active"]).execute().data or [])
        if not updated:
            return False
        from app.database.handoffs import record_handoff_event
        actor = handoff.get("assigned_to") or handoff.get("requested_by")
        record_handoff_event(handoff["id"], handoff["business_id"], actor, "returned_to_automation",
                             {"reason": reason, "automatic": True})
        return True
    except Exception:
        logger.exception("Could not close expired handoff %s", handoff.get("id"))
        return False


def sweep_business_handoffs(*, deliver: Callable[[dict, dict], Any] | None = None, now: datetime | None = None) -> int:
    """Close DM handoffs whose window ran out and tell the customer the AI is back."""
    now = now or now_utc()
    from app.database.handoffs import HANDOFF_FIELDS
    handoffs = (_db().table("conversation_handoffs").select(HANDOFF_FIELDS)
                .in_("status", ["requested", "assigned", "active"]).limit(200).execute().data or [])
    closed = 0
    for handoff in handoffs:
        last_human, last_reply = conversation_timeline(str(handoff["conversation_id"]), handoff["requested_at"])
        state = evaluate(opened_at=handoff["requested_at"], last_human_at=last_human, last_reply_at=last_reply, now=now)
        if state.phase != "expired":
            continue
        reason = "no_reply_within_window" if state.last_human_at is None else "agent_idle"
        if not close_handoff_for_timeout(handoff, reason):
            continue
        closed += 1
        try:
            message = (_db().table("messages").insert({
                "conversation_id": handoff["conversation_id"], "external_message_id": f"handoff-resume-{handoff['id']}",
                "sender_type": "ai", "content": RESUMED_REPLY}).execute().data or [None])[0]
            if message and deliver:
                deliver(handoff, message)
        except Exception:
            logger.exception("Could not tell the customer the AI resumed for handoff %s", handoff.get("id"))
    return closed


def deliver_to_channel(handoff: dict, message: dict) -> None:
    """Send an AI message to the customer's Instagram/Messenger thread, when auto-reply is on."""
    from app.channels.messenger_outbound import deliver_messenger_text
    from app.channels.outbound import deliver_instagram_text
    from app.database.connections import get_connection, get_connection_credentials
    from app.database.conversations import get_conversation
    conversation = get_conversation(str(handoff["conversation_id"]))
    connection_id = (conversation or {}).get("business_connection_id")
    if not conversation or not connection_id:
        return
    connection = get_connection(str(handoff["business_id"]), str(connection_id))
    if not connection or connection.get("provider") not in {"instagram", "messenger"}:
        return
    if (connection.get("safe_settings") or {}).get("auto_reply_enabled") is not True:
        return
    credentials = get_connection_credentials(str(handoff["business_id"]), connection["id"])
    if not credentials:
        return
    sender = deliver_instagram_text if connection["provider"] == "instagram" else deliver_messenger_text
    sender(connection=connection, credentials=credentials, conversation=conversation, message=message)


# ---------------------------------------------------------------------------------------------
# Website member chat
# ---------------------------------------------------------------------------------------------
def member_support_state(conversation_id: str, now: datetime | None = None) -> WindowState | None:
    """None when no person is involved; otherwise the window state of the chat's staff support."""
    db = _db()
    items = (db.table("operations_work_items").select("id,status,updated_at,created_at")
             .eq("member_conversation_id", conversation_id).limit(1).execute().data or [])
    item = items[0] if isinstance(items, list) and items else None
    if not isinstance(item, dict) or item.get("status") not in ("open", "claimed"):
        return None
    rows = (db.table("member_messages").select("sender_type,created_at").eq("conversation_id", conversation_id)
            .in_("sender_type", ["worker", "assistant"]).order("created_at", desc=True).limit(50).execute().data or [])
    rows = rows if isinstance(rows, list) else []
    opened = item.get("updated_at") or item.get("created_at")
    last_human = next((row["created_at"] for row in rows if row.get("sender_type") == "worker"), None)
    last_reply = rows[0]["created_at"] if rows else None
    state = evaluate(opened_at=opened, last_human_at=last_human, last_reply_at=last_reply, now=now)
    # On the website the AI keeps answering while the member waits for a person; it only steps
    # back while a person is actively chatting.
    if state.phase == "waiting":
        return None
    return state


async def handoff_window_loop() -> None:
    await asyncio.sleep(20)
    while True:
        try:
            closed = await asyncio.to_thread(sweep_business_handoffs, deliver=deliver_to_channel)
            if closed:
                logger.info("Handoff window: %s expired handoff(s) returned to the AI", closed)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Handoff window sweep failed; will retry")
        await asyncio.sleep(60)
