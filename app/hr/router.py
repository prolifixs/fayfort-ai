"""HR and hiring API, H1 (docs/HR_AND_HIRING_PLAN.md).

Public (fayfort.com/careers):  GET /public/careers/jobs   GET /public/careers/jobs/{slug}
                               POST /public/careers/jobs/{slug}/apply
Candidate's private link:      GET /public/careers/status/{token}
                               POST /public/careers/status/{token}/withdraw | /delete
HR staff (Control Center -> People -> Hiring; HR flag, CEO or platform admin):
                               GET /hr/me   GET|POST /hr/jobs   PUT /hr/jobs/{id}   POST /hr/jobs/{id}/status
                               GET /hr/applications?job_id=&stage=   GET /hr/applications/{id}
                               GET /hr/applications/{id}/cv   POST /hr/applications/{id}/stage | /notes
Owner (platform admin):        GET /hr/access   PUT /hr/access/{worker_id}
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from typing import Any, Callable, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.config.settings import settings
from app.hr import service
from app.hr.service import HrError

logger = logging.getLogger(__name__)


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str | None = Field(default=None, max_length=20)
    label: str = Field(max_length=200)
    kind: Literal["short", "yes_no", "choice"] = "short"
    options: list[str] = Field(default_factory=list, max_length=6)
    required: bool = True


class JobFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=80)
    department: str | None = None
    job_type: str | None = None
    location: str | None = None
    pay_range: str | None = Field(default=None, max_length=80)
    show_pay: bool | None = None
    summary: str | None = Field(default=None, max_length=1200)
    duties: list[str] | None = Field(default=None, max_length=12)
    requirements: list[str] | None = Field(default=None, max_length=12)
    questions: list[Question] | None = Field(default=None, max_length=5)
    trial_task: bool | None = None
    trial_paid: bool | None = None


class JobStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["draft", "open", "paused", "closed"]


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=20)
    answer: str | bool | None = None


class Application(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(max_length=120)
    email: str = Field(max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    location: str | None = Field(default=None, max_length=120)
    languages: str | None = Field(default=None, max_length=200)
    portfolio_url: str | None = Field(default=None, max_length=300)
    heard_from: str | None = Field(default=None, max_length=80)
    answers: list[Answer] = Field(default_factory=list, max_length=5)
    keep_details: bool = False
    cv_name: str | None = Field(default=None, max_length=160)
    cv_type: str = Field(max_length=120)
    cv_base64: str = Field(max_length=7_100_000)
    captcha_token: str | None = Field(default=None, max_length=4096)
    website: str | None = Field(default=None, max_length=200)  # hidden field: people leave it empty, bots fill it


class StageMove(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: str = Field(max_length=30)
    reason: str | None = Field(default=None, max_length=300)


class Note(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)


class Access(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hr_access: bool


class _Limiter:
    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self.lock:
            hits = self.hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(status_code=429, detail="Too many tries. Please wait a few minutes.")
            hits.append(now)


def client_address(request: Request) -> str:
    # The API sits behind Cloudflare's tunnel, which sets CF-Connecting-IP to the visitor's address.
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "") or "unknown"


def captcha_ok(token: str | None, address: str) -> bool:
    secret = (settings.TURNSTILE_SECRET_KEY or "").strip()
    if not secret:
        return True
    if not token:
        return False
    try:
        response = httpx.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", timeout=8,
                              data={"secret": secret, "response": token, "remoteip": address})
        return bool(response.json().get("success"))
    except Exception:
        logger.warning("Turnstile check could not be made", exc_info=True)
        return False


def _fail(exc: Exception, default: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, HrError):
        return HTTPException(status_code=exc.status, detail=str(exc))
    logger.exception(default)
    return HTTPException(status_code=503, detail=default)


def create_hr_router(trusted_fayfort_staff: Callable[[str | None], dict | None]) -> APIRouter:
    router = APIRouter(tags=["hr"])
    apply_limit = _Limiter(5, 600)
    status_limit = _Limiter(30, 60)

    def hiring_staff(authorization: str | None) -> dict:
        staff = trusted_fayfort_staff(authorization)
        if not staff:
            raise HTTPException(status_code=403, detail="Active FayFort staff access is required.")
        if staff.get("role") != "platform_admin" and not service.worker_can_hire(staff["user_id"]):
            raise HTTPException(status_code=403, detail="Hiring is for HR staff. Ask the owner to give you HR access.")
        return staff

    def owner(authorization: str | None) -> dict:
        staff = trusted_fayfort_staff(authorization)
        if not staff or staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="Only a platform administrator can do this.")
        return staff

    # ---- Public --------------------------------------------------------------------------------------------------
    @router.get("/public/careers/jobs")
    def careers():
        try:
            body: dict[str, Any] = {"jobs": service.open_jobs()}
        except Exception:
            logger.warning("Open roles could not be loaded", exc_info=True)
            body = {"jobs": []}
        return JSONResponse(body, headers={"Cache-Control": "public, max-age=120"})

    @router.get("/public/careers/jobs/{slug}")
    def career(slug: str):
        try:
            return JSONResponse({"job": service.public_job(service.open_job(slug))},
                                headers={"Cache-Control": "public, max-age=120"})
        except Exception as exc:
            raise _fail(exc, "This role could not be loaded.") from exc

    @router.post("/public/careers/jobs/{slug}/apply", status_code=201)
    def apply(slug: str, payload: Application, request: Request):
        address = client_address(request)
        apply_limit.check(address)
        if payload.website:
            # A bot filled the hidden field: answer as if it worked, save nothing.
            return {"received": True}
        if not captcha_ok(payload.captcha_token, address):
            raise HTTPException(status_code=400, detail="Please complete the check that you're not a robot.")
        try:
            form = payload.model_dump()
            form["answers"] = [a.model_dump() for a in payload.answers]
            result = service.apply(slug, form)
        except Exception as exc:
            raise _fail(exc, "Your application couldn't be sent. Please try again.") from exc
        return {"received": True, "job_title": result["job_title"], "status_token": result["token"]}

    @router.get("/public/careers/status/{token}")
    def status(token: str, request: Request):
        status_limit.check(client_address(request))
        try:
            return JSONResponse({"application": service.status_view(token)},
                                headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
        except Exception as exc:
            raise _fail(exc, "Your application could not be loaded.") from exc

    @router.post("/public/careers/status/{token}/withdraw")
    def withdraw(token: str, request: Request):
        status_limit.check(client_address(request))
        try:
            return {"application": service.withdraw(token)}
        except Exception as exc:
            raise _fail(exc, "That didn't work. Please try again.") from exc

    @router.post("/public/careers/status/{token}/delete")
    def delete(token: str, request: Request):
        status_limit.check(client_address(request))
        try:
            service.delete_my_details(token)
        except Exception as exc:
            raise _fail(exc, "That didn't work. Please try again.") from exc
        return {"deleted": True}

    # ---- HR staff ------------------------------------------------------------------------------------------------
    @router.get("/hr/me")
    def me(authorization: str | None = Header(default=None)):
        staff = trusted_fayfort_staff(authorization)
        if not staff:
            return {"can_hire": False, "is_owner": False}
        is_owner = staff.get("role") == "platform_admin"
        try:
            can_hire = is_owner or service.worker_can_hire(staff["user_id"])
        except Exception:
            can_hire = False
        return {"can_hire": can_hire, "is_owner": is_owner}

    @router.get("/hr/jobs")
    def jobs(authorization: str | None = Header(default=None)):
        hiring_staff(authorization)
        try:
            return {"jobs": service.list_jobs(), "departments": service.DEPARTMENTS, "job_types": service.JOB_TYPES,
                    "locations": service.LOCATIONS}
        except Exception as exc:
            raise _fail(exc, "Jobs could not be loaded.") from exc

    @router.post("/hr/jobs", status_code=201)
    def new_job(payload: JobFields, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return {"job": service.create_job(payload.model_dump(exclude_unset=True), staff["user_id"])}
        except Exception as exc:
            raise _fail(exc, "The job could not be saved.") from exc

    @router.put("/hr/jobs/{job_id}")
    def edit_job(job_id: UUID, payload: JobFields, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return {"job": service.update_job(str(job_id), payload.model_dump(exclude_unset=True), staff["user_id"])}
        except Exception as exc:
            raise _fail(exc, "The job could not be saved.") from exc

    @router.post("/hr/jobs/{job_id}/status")
    def job_status(job_id: UUID, payload: JobStatus, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return {"job": service.set_job_status(str(job_id), payload.status, staff["user_id"])}
        except Exception as exc:
            raise _fail(exc, "The job could not be updated.") from exc

    @router.get("/hr/applications")
    def applications(job_id: UUID | None = Query(default=None), stage: str | None = Query(default=None, max_length=30),
                     authorization: str | None = Header(default=None)):
        hiring_staff(authorization)
        try:
            return {"applications": service.list_applications(str(job_id) if job_id else None, stage),
                    "stages": service.STAGE_LABELS}
        except Exception as exc:
            raise _fail(exc, "Applications could not be loaded.") from exc

    @router.get("/hr/applications/{application_id}")
    def application(application_id: UUID, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return service.application_detail(str(application_id), staff["user_id"])
        except Exception as exc:
            raise _fail(exc, "The application could not be loaded.") from exc

    @router.get("/hr/applications/{application_id}/cv")
    def cv(application_id: UUID, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return {"url": service.cv_link(str(application_id), staff["user_id"])}
        except Exception as exc:
            raise _fail(exc, "The CV could not be opened.") from exc

    @router.post("/hr/applications/{application_id}/stage")
    def stage(application_id: UUID, payload: StageMove, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return service.move_stage(str(application_id), payload.stage, payload.reason, staff["user_id"])
        except Exception as exc:
            raise _fail(exc, "The application could not be moved.") from exc

    @router.post("/hr/applications/{application_id}/notes")
    def note(application_id: UUID, payload: Note, authorization: str | None = Header(default=None)):
        staff = hiring_staff(authorization)
        try:
            return service.add_note(str(application_id), payload.text, staff["user_id"])
        except Exception as exc:
            raise _fail(exc, "The note could not be saved.") from exc

    # ---- Owner ---------------------------------------------------------------------------------------------------
    @router.get("/hr/access")
    def access(authorization: str | None = Header(default=None)):
        owner(authorization)
        try:
            return {"workers": service.hr_team()}
        except Exception as exc:
            raise _fail(exc, "The team could not be loaded.") from exc

    @router.put("/hr/access/{worker_id}")
    def set_access(worker_id: UUID, payload: Access, authorization: str | None = Header(default=None)):
        staff = owner(authorization)
        try:
            service.set_hr_access(str(worker_id), payload.hr_access, staff["user_id"])
            return {"workers": service.hr_team()}
        except Exception as exc:
            raise _fail(exc, "HR access could not be changed.") from exc

    return router
