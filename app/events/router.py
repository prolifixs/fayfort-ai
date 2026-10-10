from __future__ import annotations
import asyncio
import logging
from fastapi import APIRouter, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from app.database.events import consume_event_ticket, issue_event_ticket, list_business_events
from app.directory.identity import trusted_business_member

logger = logging.getLogger(__name__)


async def _close_websocket(websocket: WebSocket, *, code: int, reason: str) -> None:
    """Close only while the peer is still present; disconnects are normal."""
    try:
        await websocket.close(code=code, reason=reason)
    except (WebSocketDisconnect, RuntimeError):
        # A browser tab can close between the last receive/send and this close.
        # Starlette can surface that race as WebSocketDisconnect(1006).
        return


def create_events_router() -> APIRouter:
    router = APIRouter(prefix="/businesses/{business_id}/events", tags=["business-events"])
    def identity(business_id: str, authorization: str | None):
        member = trusted_business_member(authorization, business_id)
        if not member: raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        return member

    @router.get("")
    def event_feed(business_id: str, after_id: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=200), authorization: str | None = Header(default=None)):
        identity(business_id, authorization)
        try:
            events = list_business_events(business_id, after_id, limit)
            return {"events":events, "next_after_id":events[-1]["id"] if events else after_id}
        except Exception: raise HTTPException(status_code=503, detail="The event feed could not be loaded.")

    @router.post("/ticket")
    def event_ticket(business_id: str, authorization: str | None = Header(default=None)):
        member = identity(business_id, authorization)
        try:
            ticket, expires_at = issue_event_ticket(business_id, member["user_id"])
            return {"ticket":ticket, "expires_at":expires_at, "use_once":True}
        except Exception: raise HTTPException(status_code=503, detail="A live event ticket could not be issued.")

    @router.websocket("/ws")
    async def event_socket(websocket: WebSocket, business_id: str):
        await websocket.accept()
        try:
            auth_message = await asyncio.wait_for(websocket.receive_json(), timeout=10)
            ticket = auth_message.get("ticket") if isinstance(auth_message, dict) else None
            if not isinstance(ticket, str) or len(ticket) < 24:
                await _close_websocket(websocket, code=4401, reason="A valid one-time event ticket is required")
                return
            user_id = await asyncio.to_thread(consume_event_ticket, business_id, ticket)
            if not user_id:
                await _close_websocket(websocket, code=4401, reason="The event ticket is invalid, expired, or already used")
                return
            raw_cursor = auth_message.get("after_id", 0)
            if type(raw_cursor) is not int or raw_cursor < 0:
                await _close_websocket(websocket, code=4400, reason="The event cursor must be a non-negative integer")
                return
            cursor = raw_cursor
            await websocket.send_json({"type":"ready", "after_id":cursor})
            while True:
                events = await asyncio.to_thread(list_business_events, business_id, cursor, 100)
                for event in events:
                    await websocket.send_json({"type":"event", "event":event})
                    cursor = int(event["id"])
                await asyncio.sleep(1)
        except WebSocketDisconnect:
            return
        except asyncio.TimeoutError:
            await _close_websocket(websocket, code=4408, reason="Timed out waiting for event ticket")
        except Exception:
            logger.exception("Dashboard event stream failed")
            await _close_websocket(websocket, code=1011, reason="The event stream ended unexpectedly")
    return router
