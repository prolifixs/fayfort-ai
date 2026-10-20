"""Member name, surname and username (owner rule, 2026-10-19: all three are required before using the member app).

GET  /members/me/identity            what's saved, whether it's complete, and suggestions from the sign-in (Google)
GET  /members/me/username?u=...      is this username free?
PUT  /members/me/identity            save all three; display_name becomes "First Last" for staff screens
"""
from __future__ import annotations

import logging
import re
import unicodedata
from typing import Callable

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.database.client import supabase

logger = logging.getLogger(__name__)

USERNAME = re.compile(r"^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$")
# Names a member can't take: they would look like FayFort speaking.
RESERVED = {
    "fayfort", "fayfortai", "fayfort_ai", "fayfortteam", "admin", "administrator", "support", "help", "staff", "team",
    "official", "moderator", "system", "root", "owner", "fayfay", "billing", "security", "info", "contact",
}


def clean_name(value: str) -> str:
    """Trim, collapse spaces; at least one letter, no digits or symbols beyond ' - . and spaces."""
    value = " ".join(str(value or "").split())
    if not value:
        raise ValueError("required")
    if len(value) > 60:
        raise ValueError("Keep it under 60 characters.")
    if not any(ch.isalpha() for ch in value):
        raise ValueError("Use letters.")
    for ch in value:
        if not (ch.isalpha() or ch in " '-." or unicodedata.category(ch) == "Mn"):
            raise ValueError("Use letters only (hyphens and apostrophes are fine).")
    return value


def username_problem(value: str) -> str | None:
    """Why a username can't be used, in plain words, or None when its shape is fine."""
    if not value:
        return "Choose a username."
    if len(value) < 3:
        return "At least 3 characters."
    if len(value) > 20:
        return "At most 20 characters."
    if not USERNAME.fullmatch(value):
        return "Use lowercase letters, numbers, dots or underscores, starting and ending with a letter or number."
    if ".." in value or "__" in value:
        return "No double dots or underscores."
    if value in RESERVED or value.startswith("fayfort"):
        return "That username is reserved."
    return None


def normalize_username(value: str) -> str:
    return str(value or "").strip().lstrip("@").lower()


def identity_complete(profile: dict) -> bool:
    return all(str(profile.get(key) or "").strip() for key in ("first_name", "last_name", "username"))


def suggest_username(first: str, last: str) -> str:
    base = re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", f"{first}{last}").encode("ascii", "ignore").decode().lower())[:16]
    return base if len(base) >= 3 else ""


class IdentityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: str = Field(max_length=120)
    last_name: str = Field(max_length=120)
    username: str = Field(max_length=40)

    @field_validator("first_name", "last_name")
    @classmethod
    def names(cls, value: str) -> str:
        try:
            return clean_name(value)
        except ValueError as exc:
            raise ValueError("Enter your name." if str(exc) == "required" else str(exc)) from exc

    @field_validator("username")
    @classmethod
    def handle(cls, value: str) -> str:
        value = normalize_username(value)
        problem = username_problem(value)
        if problem:
            raise ValueError(problem)
        return value


def _taken(username: str, member_id: str) -> bool:
    """Usernames are stored lowercase, so an exact match is a case-insensitive match (and _ isn't a wildcard)."""
    rows = (supabase.table("member_profiles").select("user_id").eq("username", username).limit(2).execute().data or [])
    return any(str(row.get("user_id")) != member_id for row in rows)


def create_member_identity_router(require_verified_member: Callable[[str | None], str]) -> APIRouter:
    router = APIRouter(tags=["member-profile"])

    @router.get("/members/me/identity")
    def get_identity(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            profile = (supabase.table("member_profiles").select("first_name,last_name,username,display_name")
                       .eq("user_id", member_id).maybe_single().execute())
            row = (profile.data if profile else None) or {}
        except Exception as exc:
            logger.exception("Could not load member identity")
            raise HTTPException(status_code=503, detail="Your profile could not be loaded.") from exc
        suggestion = {"first_name": "", "last_name": "", "username": ""}
        try:
            token = authorization.partition(" ")[2].strip() if authorization else ""
            user = getattr(supabase.auth.get_user(token), "user", None)
            meta = dict(getattr(user, "user_metadata", None) or {})
            full = str(meta.get("full_name") or meta.get("name") or row.get("display_name") or "").split()
            first = str(meta.get("given_name") or meta.get("first_name") or (full[0] if full else ""))
            last = str(meta.get("family_name") or meta.get("last_name") or (" ".join(full[1:]) if len(full) > 1 else ""))
            for key, value in (("first_name", first), ("last_name", last)):
                try:
                    suggestion[key] = clean_name(value)
                except ValueError:
                    pass
            candidate = suggest_username(suggestion["first_name"], suggestion["last_name"])
            if candidate and not username_problem(candidate) and not _taken(candidate, member_id):
                suggestion["username"] = candidate
        except Exception:
            logger.warning("Could not prepare name suggestions", exc_info=True)
        return {"first_name": row.get("first_name"), "last_name": row.get("last_name"), "username": row.get("username"),
                "complete": identity_complete(row), "suggestion": suggestion}

    @router.get("/members/me/username")
    def check_username(u: str = Query(default="", max_length=40), authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        value = normalize_username(u)
        problem = username_problem(value)
        if problem:
            return {"username": value, "available": False, "reason": problem}
        try:
            taken = _taken(value, member_id)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Usernames can't be checked right now.") from exc
        return {"username": value, "available": not taken, "reason": "That username is taken." if taken else None}

    @router.put("/members/me/identity")
    def save_identity(payload: IdentityInput, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            if _taken(payload.username, member_id):
                raise HTTPException(status_code=409, detail="That username is taken. Try another.")
            values = {"first_name": payload.first_name, "last_name": payload.last_name, "username": payload.username,
                      "display_name": f"{payload.first_name} {payload.last_name}"[:120]}
            rows = (supabase.table("member_profiles").update(values).eq("user_id", member_id)
                    .select("first_name,last_name,username,display_name").execute().data or [])
            if not rows:
                raise HTTPException(status_code=404, detail="Member profile is not available yet.")
            return {**rows[0], "complete": True}
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc).casefold()
            if "duplicate" in message or "unique" in message or "23505" in message:
                raise HTTPException(status_code=409, detail="That username is taken. Try another.") from exc
            logger.exception("Could not save member identity")
            raise HTTPException(status_code=503, detail="Your name could not be saved. Try again.") from exc

    return router
