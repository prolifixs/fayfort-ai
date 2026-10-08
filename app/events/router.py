from __future__ import annotations
import asyncio
from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from app.database.events import consume_event_ticket, issue_event_ticket, list_business_events
from app.directory.identity import trusted_business_member


def create_events_router() -> APIRouter:
    router = APIRouter(prefix="/businesses/{business_id}/events", tags=["business-events"])
    def identity(business_id: str, authorization: str | None):
        member = trusted_business_member(authorization, business_id)
        if not member: raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        return member

    @router.get("")
    def event_feed(business_id: str, after_id: int = 0, limit: int = 100, authorization: str | None = Header(default=None)):
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
                await websocket.close(code=4401, reason="A valid one-time event ticket is required")
                return
            user_id = await asyncio.to_thread(consume_event_ticket, business_id, ticket)
            if not user_id:
                await websocket.close(code=4401, reason="The event ticket is invalid, expired, or already used")
                return
            cursor = int(auth_message.get("after_id", 0) or 0)
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
            await websocket.close(code=4408, reason="Timed out waiting for event ticket")
        except Exception:
            await websocket.close(code=1011, reason="The event stream ended unexpectedly")
    return router
