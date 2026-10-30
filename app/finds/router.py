"""FayFort Finds API (docs/FINDS_PLAN.md).

Store team:  POST /operations/finds  GET /operations/finds?status=  GET|PATCH /operations/finds/{id}
             POST /operations/finds/{id}/checked | /not-obtainable | /drop
             GET|POST /operations/finds/drops   GET|PUT /operations/finds/shipping-rates
Members:     GET /members/finds?drop=&lane=   GET /members/finds/watching   GET /members/finds/{id}?country=
             POST|DELETE /members/finds/{id}/watch   POST /members/finds/niche-requests
Public:      GET /public/finds/teaser
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Callable, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from app.commerce.db import db, rows
from app.finds import service

logger = logging.getLogger(__name__)


class NewFind(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lane: Literal["trending", "rare"]


class FindChanges(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lane: Literal["trending", "rare"] | None = None
    stage: str | None = None
    competition: str | None = None
    signal_platforms: list[str] | None = Field(default=None, max_length=10)
    signal_regions: list[str] | None = Field(default=None, max_length=10)
    why: str | None = Field(default=None, max_length=600)
    scout_note: str | None = Field(default=None, max_length=2000)
    china_check: str | None = None
    china_place: str | None = Field(default=None, max_length=120)
    unit_cost_min: float | None = None
    unit_cost_max: float | None = None
    cost_currency: str | None = Field(default=None, max_length=3)
    supplier_moq: int | None = None
    sample_available: bool | None = None
    china_note: str | None = Field(default=None, max_length=2000)
    sell_price_min: float | None = None
    sell_price_max: float | None = None
    price_breaks: list[dict[str, Any]] | None = Field(default=None, max_length=6)
    unit_weight_kg: float | None = None


class Reason(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=500)


class DropChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    drop_id: UUID


class NewDrop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    release_day: date
    target_count: int = Field(default=service.DROP_TARGET, ge=1, le=50)


class Rate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    zone: str = Field(max_length=40)
    air_per_kg: float | None = Field(default=None, ge=0, le=10000)
    handling_per_unit: float | None = Field(default=None, ge=0, le=10000)


class Rates(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rates: list[Rate] = Field(max_length=20)


class NicheRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=10, max_length=1000)


class DropAlerts(BaseModel):
    on: bool


def _fail(exc: Exception, default: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    logger.exception(default)
    return HTTPException(status_code=503, detail=default)


def create_finds_router(require_verified_member: Callable[[str | None], str],
                        trusted_fayfort_staff: Callable[[str | None], dict | None]) -> APIRouter:
    router = APIRouter(tags=["finds"])

    def store_staff(authorization: str | None) -> dict:
        staff = trusted_fayfort_staff(authorization)
        if not staff:
            raise HTTPException(status_code=403, detail="Active FayFort staff access is required.")
        if staff.get("role") != "platform_admin":
            departments = {str(r["department"]) for r in rows(db().table("operations_worker_departments")
                                                              .select("department").eq("worker_id", staff["user_id"])
                                                              .eq("can_claim", True).execute())}
            if "store_team" not in departments:
                raise HTTPException(status_code=403, detail="Finds are Store team work. Ask an administrator to add you to the Store team.")
        return staff

    def admin(authorization: str | None) -> dict:
        staff = store_staff(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="Only a platform administrator can do this.")
        return staff

    def owned_find(find_id: UUID, staff: dict) -> dict:
        """Changing a find's research needs its listing's work item claimed, like the listing itself."""
        find = service.get(str(find_id))
        if staff.get("role") == "platform_admin" or not find.get("listing_id"):
            return find
        from app.commerce import store_team
        item = store_team.listing_item(str(find["listing_id"]))
        if not item or item.get("assigned_worker_id") != staff["user_id"] or item.get("status") != "claimed":
            raise HTTPException(status_code=403, detail="Claim this find's work item first.")
        return find

    # ---- Store team -----------------------------------------------------------------------
    @router.post("/operations/finds", status_code=201)
    def new_find(payload: NewFind, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            role = "platform_admin" if staff.get("role") == "platform_admin" else "worker"
            find, listing, item = service.open_find(payload.lane, staff["user_id"], role)
            return {"find": service.staff_detail(find), "listing_id": listing["id"], "work_item_id": (item or {}).get("id")}
        except Exception as exc:
            raise _fail(exc, "The find could not be started.") from exc

    @router.get("/operations/finds")
    def staff_finds(status: Literal["open", "live", "all", "not_obtainable", "retired", "scheduled", "released"] = "open",
                    authorization: str | None = Header(default=None)):
        store_staff(authorization)
        try:
            return {"finds": service.staff_list(status), "drops": service.staff_drops(),
                    "platforms": [{"key": k, "label": service.PLATFORM_LABEL[k]} for k in service.PLATFORMS]}
        except Exception as exc:
            raise _fail(exc, "Finds could not be loaded.") from exc

    @router.get("/operations/finds/drops")
    def drops(authorization: str | None = Header(default=None)):
        store_staff(authorization)
        try:
            return {"drops": service.staff_drops()}
        except Exception as exc:
            raise _fail(exc, "Drops could not be loaded.") from exc

    @router.post("/operations/finds/drops", status_code=201)
    def new_drop(payload: NewDrop, authorization: str | None = Header(default=None)):
        staff = admin(authorization)
        try:
            return {"drop": service.create_drop(payload.release_day, staff["user_id"], payload.target_count)}
        except Exception as exc:
            raise _fail(exc, "The drop could not be saved.") from exc

    @router.get("/operations/finds/shipping-rates")
    def rates(authorization: str | None = Header(default=None)):
        store_staff(authorization)
        try:
            return {"rates": service.shipping_rates()}
        except Exception as exc:
            raise _fail(exc, "Shipping rates could not be loaded.") from exc

    @router.put("/operations/finds/shipping-rates")
    def save_rates(payload: Rates, authorization: str | None = Header(default=None)):
        staff = admin(authorization)
        try:
            return {"rates": service.save_shipping_rates([r.model_dump() for r in payload.rates], staff["user_id"])}
        except Exception as exc:
            raise _fail(exc, "Shipping rates could not be saved.") from exc

    @router.get("/operations/finds/{find_id}")
    def staff_find(find_id: UUID, authorization: str | None = Header(default=None)):
        store_staff(authorization)
        try:
            return {"find": service.staff_detail(service.get(str(find_id)))}
        except Exception as exc:
            raise _fail(exc, "The find could not be loaded.") from exc

    @router.patch("/operations/finds/{find_id}")
    def change_find(find_id: UUID, payload: FindChanges, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            find = owned_find(find_id, staff)
            return {"find": service.staff_detail(service.update(find, payload.model_dump(exclude_unset=True), staff["user_id"]))}
        except Exception as exc:
            raise _fail(exc, "The find could not be saved.") from exc

    @router.post("/operations/finds/{find_id}/checked")
    def checked(find_id: UUID, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            return {"find": service.staff_detail(service.mark_checked(owned_find(find_id, staff), staff["user_id"]))}
        except Exception as exc:
            raise _fail(exc, "The China check could not be saved.") from exc

    @router.post("/operations/finds/{find_id}/not-obtainable")
    def not_obtainable(find_id: UUID, payload: Reason, authorization: str | None = Header(default=None)):
        staff = store_staff(authorization)
        try:
            return {"find": service.staff_detail(service.mark_not_obtainable(owned_find(find_id, staff), staff["user_id"],
                                                                             payload.reason))}
        except Exception as exc:
            raise _fail(exc, "The find could not be closed.") from exc

    @router.post("/operations/finds/{find_id}/drop")
    def move(find_id: UUID, payload: DropChoice, authorization: str | None = Header(default=None)):
        admin(authorization)
        try:
            return {"find": service.staff_detail(service.move_to_drop(service.get(str(find_id)), str(payload.drop_id)))}
        except Exception as exc:
            raise _fail(exc, "The find could not be moved.") from exc

    # ---- members --------------------------------------------------------------------------
    @router.get("/members/finds")
    def member_finds(drop: UUID | None = None, lane: Literal["trending", "rare"] | None = None,
                     authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return service.member_finds(member_id, drop_id=str(drop) if drop else None, lane=lane)
        except Exception as exc:
            raise _fail(exc, "Finds could not be loaded.") from exc

    @router.put("/members/finds/alerts")
    def drop_alerts(payload: DropAlerts, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return {"drop_alerts": service.set_drop_alerts(member_id, payload.on)}
        except Exception as exc:
            raise _fail(exc, "That didn't save. Please try again.") from exc

    @router.get("/members/finds/watching")
    def watching(authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return {"finds": service.watched(member_id), "access": service.access_for(member_id)}
        except Exception as exc:
            raise _fail(exc, "Your watched finds could not be loaded.") from exc

    @router.post("/members/finds/niche-requests", status_code=201)
    def niche(payload: NicheRequest, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return service.niche_request(member_id, payload.text)
        except Exception as exc:
            raise _fail(exc, "Your request could not be sent.") from exc

    @router.get("/members/finds/{find_id}")
    def member_find(find_id: UUID, country: str | None = Query(default=None, min_length=2, max_length=2),
                    authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return service.member_detail(member_id, str(find_id), country)
        except Exception as exc:
            raise _fail(exc, "This find could not be loaded.") from exc

    @router.post("/members/finds/{find_id}/watch")
    def watch(find_id: UUID, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return service.watch(member_id, str(find_id))
        except Exception as exc:
            raise _fail(exc, "This find could not be watched.") from exc

    @router.delete("/members/finds/{find_id}/watch")
    def unwatch(find_id: UUID, authorization: str | None = Header(default=None)):
        member_id = require_verified_member(authorization)
        try:
            return service.unwatch(member_id, str(find_id))
        except Exception as exc:
            raise _fail(exc, "This find could not be updated.") from exc

    # ---- fayfort.com -----------------------------------------------------------------------
    teaser_cache: dict[str, Any] = {"at": None, "body": None}

    @router.get("/public/finds/teaser")
    def teaser():
        now = service.now_utc()
        if teaser_cache["at"] and (now - teaser_cache["at"]).total_seconds() < 300:
            return teaser_cache["body"]
        try:
            body = service.public_teaser()
            teaser_cache.update(at=now, body=body)
            return body
        except Exception as exc:
            raise _fail(exc, "Finds could not be loaded.") from exc

    return router
