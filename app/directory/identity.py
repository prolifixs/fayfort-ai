from __future__ import annotations

import logging

from app.database.business_members import get_business_member
from app.database.client import supabase


logger = logging.getLogger(__name__)


def has_trusted_business_identity(authorization: str | None, business_id: str) -> bool:
    """Validate a Supabase access token and confirm active business membership.

    This is intentionally a boolean gate: caller-supplied payload fields never
    establish identity. Invalid tokens, membership errors, or inactive members
    all fail closed.
    """
    if not authorization:
        return False
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token.strip():
        return False
    try:
        response = supabase.auth.get_user(token.strip())
        user = getattr(response, "user", None)
        user_id = getattr(user, "id", None)
        if not user_id:
            return False
        member = get_business_member(business_id, str(user_id))
        return bool(member and member.get("status") == "active")
    except Exception:
        logger.info("Supabase token or membership could not be verified", exc_info=True)
        return False
