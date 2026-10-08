from __future__ import annotations
from fastapi import APIRouter, Header, HTTPException
from app.database.dashboard import list_businesses_for_user
from app.directory.identity import trusted_user_id

def create_dashboard_router() -> APIRouter:
    router = APIRouter(prefix="/dashboard", tags=["dashboard"])
    @router.get("/businesses")
    def businesses(authorization: str | None = Header(default=None)):
        user_id = trusted_user_id(authorization)
        if not user_id: raise HTTPException(status_code=401, detail="A valid signed-in user is required.")
        try: return {"businesses":list_businesses_for_user(user_id)}
        except Exception: raise HTTPException(status_code=503, detail="Business workspaces could not be loaded.")
    return router
