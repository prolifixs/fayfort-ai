from __future__ import annotations
import logging
from app.database.business_members import get_business_member
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
    """Return an authenticated active member; caller-provided IDs never establish identity."""
    user_id = trusted_user_id(authorization)
    if not user_id:
        return None
    try:
        member = get_business_member(business_id, user_id)
        if not member or member.get("status") != "active":
            return None
        return {"user_id": user_id, "role": member.get("role")}
    except Exception:
        logger.info("Business membership could not be verified", exc_info=True)
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
