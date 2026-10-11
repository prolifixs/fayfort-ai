from __future__ import annotations
from fastapi import APIRouter, Header, HTTPException
from app.database.dashboard import list_client_accounts_for_staff
from app.directory.identity import trusted_fayfort_staff

def create_dashboard_router() -> APIRouter:
    router = APIRouter(prefix="/dashboard", tags=["dashboard"])
    @router.get("/businesses")
    def businesses(authorization: str | None = Header(default=None)):
        if not trusted_fayfort_staff(authorization):
            raise HTTPException(status_code=403, detail="An active FayFort worker account is required.")
        try: return {"businesses":list_client_accounts_for_staff()}
        except Exception: raise HTTPException(status_code=503, detail="Business workspaces could not be loaded.")
    return router
