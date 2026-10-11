from __future__ import annotations
import logging
from app.database.client import supabase

logger = logging.getLogger(__name__)

def trusted_user_id(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token.strip():
        return None
    try:
        response = supabase.auth.get_user(token.strip())
        user = getattr(response, "user", None)
        user_id = getattr(user, "id", None)
        return str(user_id) if user_id else None
    except Exception:
        logger.info("Supabase access token could not be verified", exc_info=True)
        return None

def trusted_business_member(authorization: str | None, business_id: str) -> dict | None:
    """Authorize FayFort staff for a managed client account; this is not customer SaaS access."""
    staff = trusted_fayfort_staff(authorization)
    if not staff:
        return None
    return {"user_id": staff["user_id"], "role": "admin" if staff["role"] == "worker" else "owner"}

def trusted_fayfort_staff(authorization: str | None) -> dict | None:
    """Return an active FayFort worker or platform admin, never a business customer."""
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token.strip():
        return None
    try:
        auth_response = supabase.auth.get_user(token.strip())
        user = getattr(auth_response, "user", None)
        user_id = getattr(user, "id", None)
        if not user_id:
            return None
        app_metadata = getattr(user, "app_metadata", None) or {}
        roles = app_metadata.get("roles", []) if isinstance(app_metadata, dict) else []
        if isinstance(app_metadata, dict) and (app_metadata.get("platform_admin") is True or "platform_admin" in roles):
            return {"user_id": str(user_id), "role": "platform_admin"}
        if getattr(user, "email_confirmed_at", None) is None:
            return None
        response = (supabase.table("fayfort_workers").select("status")
            .eq("user_id", str(user_id)).maybe_single().execute())
        worker = response.data if response is not None else None
        if not worker or worker.get("status") != "active":
            return None
        return {"user_id": str(user_id), "role": "worker"}
    except Exception:
        logger.info("FayFort staff identity could not be verified", exc_info=True)
        return None

def has_trusted_business_identity(authorization: str | None, business_id: str) -> bool:
    return trusted_business_member(authorization, business_id) is not None


def trusted_platform_admin(authorization: str | None) -> dict | None:
    """Require a server-managed Supabase app_metadata platform-admin claim."""
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token.strip():
        return None
    try:
        response = supabase.auth.get_user(token.strip())
        user = getattr(response, "user", None)
        user_id = getattr(user, "id", None)
        app_metadata = getattr(user, "app_metadata", None) or {}
        roles = app_metadata.get("roles", []) if isinstance(app_metadata, dict) else []
        if user_id and (app_metadata.get("platform_admin") is True or "platform_admin" in roles):
            return {"user_id": str(user_id)}
    except Exception:
        logger.info("Supabase platform-admin claim could not be verified", exc_info=True)
    return None
