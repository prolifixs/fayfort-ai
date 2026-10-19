from __future__ import annotations

import logging
from typing import Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.accounts.member_themes import ThemeDesign, ThemeDraftInput
from app.database.client import supabase

logger = logging.getLogger(__name__)


class ThemeCreateInput(ThemeDraftInput):
    design: ThemeDesign


class ThemeDraftRevisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    design: ThemeDesign

    @field_validator("display_name")
    @classmethod
    def normalized_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Theme name cannot be blank.")
        return value

    @field_validator("description")
    @classmethod
    def normalized_description(cls, value: str | None) -> str | None:
        value = value.strip() if value else None
        return value or None


def create_member_theme_admin_router(trusted_platform_admin: Callable[[str | None], dict | None]) -> APIRouter:
    router = APIRouter(tags=["platform-member-themes"])

    def require_admin(authorization: str | None) -> dict:
        admin = trusted_platform_admin(authorization)
        if not admin:
            raise HTTPException(status_code=403, detail="A FayFort platform administrator is required.")
        return admin

    def revision_payload(row: dict | None) -> dict | None:
        if not row:
            return None
        return {
            "revision": row["revision"],
            "palette_preset": row["palette_preset"],
            "wrapper_style": row["wrapper_style"],
            "colors": row["colors"],
            "font_family": row.get("font_family") or "system",
            "created_at": row.get("created_at"),
        }

    @router.get("/platform/themes")
    def list_themes(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            themes = (supabase.table("member_themes")
                .select("theme_id,display_name,description,draft_display_name,draft_description,status,requires_paid,is_builtin,draft_revision,published_revision,created_at,updated_at")
                .order("created_at").execute().data or [])
            revisions = (supabase.table("member_theme_revisions")
                .select("theme_id,revision,palette_preset,wrapper_style,colors,font_family,created_at")
                .order("revision", desc=True).execute().data or [])
            by_theme: dict[str, list[dict]] = {}
            for row in revisions:
                by_theme.setdefault(row["theme_id"], []).append(row)
            result = []
            for theme in themes:
                rows = by_theme.get(theme["theme_id"], [])
                by_revision = {row["revision"]: row for row in rows}
                result.append({
                    **theme,
                    "draft": revision_payload(by_revision.get(theme.get("draft_revision"))),
                    "published": revision_payload(by_revision.get(theme.get("published_revision"))),
                })
            return {"themes": result}
        except Exception as exc:
            logger.exception("Could not load member theme catalog")
            raise HTTPException(status_code=503, detail="The member theme catalog could not be loaded.") from exc

    @router.post("/platform/themes", status_code=201)
    def create_theme(payload: ThemeCreateInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        try:
            created_themes = (supabase.table("member_themes").insert({
                "theme_id": payload.theme_id,
                "display_name": payload.display_name,
                "description": payload.description,
                "draft_display_name": payload.display_name,
                "draft_description": payload.description,
                "status": "draft",
                "requires_paid": True,
                "is_builtin": False,
                "created_by": admin["user_id"],
                "updated_by": admin["user_id"],
            }).select("theme_id,display_name,description,status,draft_revision,published_revision").execute().data or [])
            if not created_themes:
                raise RuntimeError("Theme insert returned no created row.")
            theme = created_themes[0]
            (supabase.table("member_theme_revisions").insert({
                "theme_id": payload.theme_id,
                "revision": 1,
                **payload.design.model_dump(),
                "created_by": admin["user_id"],
            }).execute())
            (supabase.table("member_themes").update({
                "draft_revision": 1,
                "updated_by": admin["user_id"],
            }).eq("theme_id", payload.theme_id).execute())
            return {"theme": {**theme, "draft_revision": 1, "draft": {"revision": 1, **payload.design.model_dump()}}}
        except Exception as exc:
            logger.exception("Could not create member theme draft")
            message = str(exc).casefold()
            if "duplicate" in message or "unique" in message or "23505" in message:
                raise HTTPException(status_code=409, detail="A theme with that ID or display name already exists.") from exc
            # This route is platform-admin-only. Return a bounded diagnostic so
            # an operator can distinguish a database constraint/API error from
            # a connection failure when the server log is unavailable.
            diagnostic = (getattr(exc, "message", None) or str(exc) or type(exc).__name__).strip()
            diagnostic = " ".join(diagnostic.split())[:240]
            code = getattr(exc, "code", None)
            code_suffix = f" ({str(code)[:32]})" if code is not None else ""
            raise HTTPException(
                status_code=503,
                detail=f"The theme draft could not be created. Diagnostic: {diagnostic}{code_suffix}",
            ) from exc

    @router.post("/platform/themes/{theme_id}/draft")
    def save_theme_draft(theme_id: str, payload: ThemeDraftRevisionInput, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        if theme_id == "base":
            raise HTTPException(status_code=409, detail="The FayFort base theme is protected.")
        try:
            theme_response = (supabase.table("member_themes")
                .select("theme_id,status").eq("theme_id", theme_id).maybe_single().execute())
            theme = theme_response.data if theme_response else None
            if not theme:
                raise HTTPException(status_code=404, detail="Theme was not found.")
            if theme["status"] == "archived":
                raise HTTPException(status_code=409, detail="Archived themes cannot be edited.")
            latest = (supabase.table("member_theme_revisions")
                .select("revision").eq("theme_id", theme_id).order("revision", desc=True).limit(1).execute().data or [])
            revision = int(latest[0]["revision"]) + 1 if latest else 1
            (supabase.table("member_theme_revisions").insert({
                "theme_id": theme_id,
                "revision": revision,
                **payload.design.model_dump(),
                "created_by": admin["user_id"],
            }).execute())
            (supabase.table("member_themes").update({
                "draft_display_name": payload.display_name,
                "draft_description": payload.description,
                "draft_revision": revision,
                "updated_by": admin["user_id"],
            }).eq("theme_id", theme_id).execute())
            return {"theme_id": theme_id, "draft_revision": revision, "status": theme["status"]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not save member theme revision")
            raise HTTPException(status_code=503, detail="The theme revision could not be saved.") from exc

    @router.post("/platform/themes/{theme_id}/publish")
    def publish_theme(theme_id: str, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        if theme_id == "base":
            raise HTTPException(status_code=409, detail="The FayFort base theme is protected.")
        try:
            response = (supabase.table("member_themes").select("status,draft_revision,display_name,draft_display_name,draft_description")
                .eq("theme_id", theme_id).maybe_single().execute())
            theme = response.data if response else None
            if not theme:
                raise HTTPException(status_code=404, detail="Theme was not found.")
            if theme["status"] == "archived":
                raise HTTPException(status_code=409, detail="Archived themes cannot be published.")
            if not theme.get("draft_revision"):
                raise HTTPException(status_code=409, detail="Save a valid draft revision before publishing.")
            (supabase.table("member_themes").update({
                "status": "published",
                "published_revision": theme["draft_revision"],
                "display_name": theme.get("draft_display_name") or theme["display_name"],
                "description": theme.get("draft_description"),
                "updated_by": admin["user_id"],
            }).eq("theme_id", theme_id).execute())
            return {"theme_id": theme_id, "status": "published", "published_revision": theme["draft_revision"]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not publish member theme")
            raise HTTPException(status_code=503, detail="The theme could not be published.") from exc

    @router.post("/platform/themes/{theme_id}/archive")
    def archive_theme(theme_id: str, authorization: str | None = Header(default=None)):
        admin = require_admin(authorization)
        if theme_id == "base":
            raise HTTPException(status_code=409, detail="The FayFort base theme is protected.")
        try:
            response = (supabase.table("member_themes").select("status,published_revision")
                .eq("theme_id", theme_id).maybe_single().execute())
            theme = response.data if response else None
            if not theme:
                raise HTTPException(status_code=404, detail="Theme was not found.")
            if theme["status"] != "published" or not theme.get("published_revision"):
                raise HTTPException(status_code=409, detail="Only a published theme can be archived.")
            (supabase.table("member_themes").update({
                "status": "archived",
                "updated_by": admin["user_id"],
            }).eq("theme_id", theme_id).execute())
            return {"theme_id": theme_id, "status": "archived"}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not archive member theme")
            raise HTTPException(status_code=503, detail="The theme could not be archived.") from exc

    return router
