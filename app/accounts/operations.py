from __future__ import annotations

import logging
from datetime import datetime
from typing import Callable, Literal
from urllib.parse import urljoin, urlsplit
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.channels.messenger_outbound import deliver_messenger_text
from app.channels.outbound import deliver_instagram_text
from app.config.settings import settings
from app.database.client import supabase
from app.database.connections import get_connection, get_connection_credentials
from app.database.conversations import get_conversation
from app.accounts.operations_reports import operations_report

logger = logging.getLogger(__name__)
Department = Literal["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support"]
WorkStatus = Literal["open", "claimed", "waiting", "blocked", "completed", "cancelled"]
Priority = Literal["low", "normal", "high", "urgent"]
SOURCES = {"member_request", "member_conversation", "business_handoff", "business_conversation"}
WORK_ITEM_FIELDS = (
    "id,department,work_type,status,priority,summary,next_action,waiting_on,waiting_reason,due_at,"
    "assigned_worker_id,assigned_automation_key,claimed_until,version,member_request_id,"
    "member_conversation_id,business_id,business_conversation_id,handoff_id,metadata,created_by,created_at,updated_at,completed_at"
)


class WorkItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    department: Department
    work_type: str = Field(min_length=1, max_length=60)
    summary: str = Field(min_length=1, max_length=240)
    next_action: str = Field(min_length=1, max_length=500)
    source_type: Literal["member_request", "member_conversation", "business_handoff", "business_conversation"]
    source_id: UUID
    priority: Priority = "normal"
    due_at: datetime | None = None
    assigned_worker_id: UUID | None = None

    @field_validator("work_type", "summary", "next_action")
    @classmethod
    def trim_nonblank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("This field cannot be blank.")
        return normalized


class WorkItemTransition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    status: WorkStatus
    next_action: str = Field(min_length=1, max_length=500)
    waiting_on: Literal["member", "supplier", "payment", "carrier", "automation", "internal"] | None = None
    waiting_reason: str | None = Field(default=None, max_length=1000)
    due_at: datetime | None = None
    reason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def waiting_fields(self):
        if self.status == "waiting" and (self.waiting_on is None or len((self.waiting_reason or "").strip()) < 3):
            raise ValueError("Waiting work requires who or what it is waiting on and a reason.")
        if self.status != "waiting" and (self.waiting_on is not None or self.waiting_reason is not None):
            raise ValueError("Waiting details are only allowed when status is waiting.")
        self.next_action = self.next_action.strip()
        if not self.next_action:
            raise ValueError("A next action is required.")
        if self.waiting_reason is not None:
            self.waiting_reason = self.waiting_reason.strip()
        return self


class WorkNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str = Field(min_length=1, max_length=4000)

    @field_validator("note")
    @classmethod
    def trim_note(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Enter a note.")
        return normalized


class SourcingBatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    work_item_ids: list[UUID] = Field(min_length=1, max_length=50)

    @field_validator("title")
    @classmethod
    def trim_batch_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a batch name.")
        return value

    @field_validator("work_item_ids")
    @classmethod
    def unique_work_items(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("A work item can only appear once in a batch.")
        return value


class SourcingCandidateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_name: str = Field(min_length=1, max_length=240)
    supplier_name: str | None = Field(default=None, max_length=160)
    product_url: str = Field(min_length=8, max_length=2000)
    price_amount: float | None = Field(default=None, ge=0, le=100000000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    availability: str | None = Field(default=None, max_length=240)
    evidence_note: str = Field(min_length=1, max_length=2000)

    @field_validator("product_name", "supplier_name", "availability", "evidence_note")
    @classmethod
    def trim_candidate_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value and value is not None:
            raise ValueError("This field cannot be blank.")
        return value

    @field_validator("product_url")
    @classmethod
    def validate_product_url(cls, value: str) -> str:
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname:
            raise ValueError("Use a complete http or https product URL.")
        return value

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else None


class SourcingCandidateUpdate(SourcingCandidateCreate):
    """Validated full replacement for staff research on a sourcing candidate."""


class SourcingOptionsShare(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_ids: list[UUID] = Field(min_length=1, max_length=10)
    member_note: str | None = Field(default=None, max_length=1000)

    @field_validator("member_note")
    @classmethod
    def trim_member_note(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("candidate_ids")
    @classmethod
    def unique_candidates(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Choose each candidate only once.")
        return value


class MemberSourcingOptionSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    option_id: UUID


class MemberConversationReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def trim_reply(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter a reply.")
        return value


class ChecklistCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=240)
    position: int = Field(default=0, ge=0, le=10000)

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Enter a checklist item.")
        return normalized


class WorkerDepartments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    departments: list[Department] = Field(max_length=5)

    @field_validator("departments")
    @classmethod
    def unique_departments(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Choose each department only once.")
        return value


class WorkerNotificationPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sound_enabled: bool


class WorkerNotificationAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["read", "dismiss"]


class WorkItemTransfer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    department: Department
    next_action: str = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("next_action", "reason")
    @classmethod
    def trim_transfer_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("This field cannot be blank.")
        return normalized


class DisputeCaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["wrong_item", "item_condition", "missing_item", "delivery", "payment", "other"]
    summary: str = Field(min_length=1, max_length=2000)
    next_action: str = Field(min_length=1, max_length=500)
    due_at: datetime | None = None

    @field_validator("summary", "next_action")
    @classmethod
    def trim_dispute_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank.")
        return value


class DisputeCaseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    status: Literal["investigating", "awaiting_member", "awaiting_supplier", "resolved", "closed"]
    resolution: str | None = Field(default=None, max_length=2000)

    @field_validator("resolution")
    @classmethod
    def trim_resolution(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @model_validator(mode="after")
    def require_resolution_for_terminal_state(self):
        if self.status in ("resolved", "closed") and not self.resolution:
            raise ValueError("Add a resolution before resolving or closing the dispute.")
        return self


def create_operations_router(trusted_fayfort_staff: Callable[[str | None], dict | None]) -> APIRouter:
    router = APIRouter(tags=["departmental-operations"])

    def attach_handoff_conversations(rows: list[dict]) -> list[dict]:
        unresolved = [row for row in rows if row.get("handoff_id") and not row.get("business_conversation_id")]
        if not unresolved:
            return rows
        handoff_ids = list(dict.fromkeys(str(row["handoff_id"]) for row in unresolved))
        handoffs = (supabase.table("conversation_handoffs").select("id,conversation_id")
            .in_("id", handoff_ids).execute().data or [])
        conversation_by_handoff = {str(row["id"]): row.get("conversation_id") for row in handoffs}
        return [
            {**row, "business_conversation_id": conversation_by_handoff.get(str(row["handoff_id"]))}
            if row.get("handoff_id") and not row.get("business_conversation_id") else row
            for row in rows
        ]

    def staff_identity(authorization: str | None) -> dict:
        staff = trusted_fayfort_staff(authorization)
        if not staff:
            raise HTTPException(status_code=403, detail="Active FayFort staff access is required.")
        return staff

    def departments_for(worker_id: str) -> list[str]:
        rows = (supabase.table("operations_worker_departments").select("department")
            .eq("worker_id", worker_id).eq("can_claim", True).execute().data or [])
        return list(dict.fromkeys(str(row["department"]) for row in rows))

    @router.get("/operations/reports")
    def operations_reports(days: int = Query(default=30, ge=7, le=90),
                           authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="Only a platform administrator can view Operations reports.")
        if days not in (7, 30, 90):
            raise HTTPException(status_code=422, detail="Report period must be 7, 30, or 90 days.")
        try:
            return operations_report(days)
        except Exception as exc:
            logger.exception("Could not build Operations reports")
            raise HTTPException(status_code=503, detail="Operations reports could not be loaded.") from exc

    def load_accessible_item(work_item_id: UUID, staff: dict) -> dict:
        result = (supabase.table("operations_work_items").select(WORK_ITEM_FIELDS)
            .eq("id", str(work_item_id)).maybe_single().execute())
        item = result.data if result is not None else None
        if not item:
            raise HTTPException(status_code=404, detail="Operations work item not found.")
        if staff.get("role") == "platform_admin":
            return item
        if item.get("assigned_worker_id") == staff["user_id"] or item.get("department") in departments_for(staff["user_id"]):
            return item
        raise HTTPException(status_code=404, detail="Operations work item not found.")

    @router.get("/operations/me/departments")
    def my_departments(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") == "platform_admin":
            return {"user_id": staff["user_id"], "departments": ["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support"], "can_manage": True}
        return {"user_id": staff["user_id"], "departments": departments_for(staff["user_id"]), "can_manage": False}

    @router.get("/operations/work-items/{work_item_id}/mention-options")
    def operations_mention_options(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        try:
            item = load_accessible_item(work_item_id, staff)
            workers = (supabase.table("fayfort_workers").select("user_id")
                .eq("status", "active").order("created_at").limit(200).execute().data or [])
            worker_ids = [str(worker.get("user_id")) for worker in workers if worker.get("user_id")]
            department_rows = (supabase.table("operations_worker_departments").select("worker_id")
                .eq("department", item["department"]).eq("can_claim", True)
                .in_("worker_id", worker_ids).execute().data or []) if worker_ids else []
            allowed_ids = {str(row["worker_id"]) for row in department_rows if row.get("worker_id")}
            if item.get("assigned_worker_id"):
                allowed_ids.add(str(item["assigned_worker_id"]))
            options = []
            for worker in workers:
                user_id = str(worker.get("user_id") or "")
                if not user_id or user_id == staff["user_id"] or user_id not in allowed_ids:
                    continue
                response = supabase.auth.admin.get_user_by_id(user_id)
                user = getattr(response, "user", None)
                email = getattr(user, "email", None) if user else None
                if not email:
                    continue
                metadata = getattr(user, "user_metadata", None) or {}
                name = metadata.get("display_name") or metadata.get("full_name") or metadata.get("name")
                options.append({"user_id": user_id, "email": str(email).lower(),
                                "label": str(name).strip() if name and str(name).strip() else str(email).lower()})
            return {"workers": options}
        except Exception as exc:
            logger.exception("Could not load Operations mention options")
            raise HTTPException(status_code=503, detail="Staff mention options could not be loaded.") from exc

    @router.get("/operations/me/notifications")
    def my_operations_notifications(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        try:
            unread_result = (supabase.table("operations_worker_notifications").select("id", count="exact")
                .eq("worker_id", staff["user_id"]).is_("read_at", "null")
                .is_("dismissed_at", "null").execute())
            rows = (supabase.table("operations_worker_notifications")
                .select("id,work_item_id,notification_type,title,body,href,read_at,dismissed_at,created_at")
                .eq("worker_id", staff["user_id"]).is_("dismissed_at", "null")
                .order("created_at", desc=True).limit(50).execute().data or [])
            preference = (supabase.table("operations_worker_notification_preferences")
                .select("sound_enabled").eq("worker_id", staff["user_id"]).maybe_single().execute())
            pref_row = preference.data if preference is not None else None
            return {"notifications": rows, "unread_count": unread_result.count or 0,
                    "sound_enabled": bool(pref_row.get("sound_enabled", False)) if pref_row else False}
        except Exception as exc:
            logger.exception("Could not load Operations notifications")
            raise HTTPException(status_code=503, detail="Operations notifications could not be loaded.") from exc

    @router.put("/operations/me/notification-preferences")
    def set_operations_notification_preferences(payload: WorkerNotificationPreference,
            authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        try:
            rows = (supabase.table("operations_worker_notification_preferences").upsert({
                "worker_id": staff["user_id"], "sound_enabled": payload.sound_enabled,
                "updated_at": datetime.now().astimezone().isoformat(),
            }, on_conflict="worker_id").select("worker_id,sound_enabled,updated_at").execute().data or [])
            return {"preference": rows[0] if rows else {"sound_enabled": payload.sound_enabled}}
        except Exception as exc:
            logger.exception("Could not save Operations notification preferences")
            raise HTTPException(status_code=503, detail="The notification preference could not be saved.") from exc

    @router.patch("/operations/me/notifications/{notification_id}")
    def update_operations_notification(notification_id: UUID, payload: WorkerNotificationAction,
            authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        field = "read_at" if payload.action == "read" else "dismissed_at"
        try:
            rows = (supabase.table("operations_worker_notifications").update({
                field: datetime.now().astimezone().isoformat(),
            }).eq("id", str(notification_id)).eq("worker_id", staff["user_id"])
                .select("id,read_at,dismissed_at").execute().data or [])
            if not rows:
                raise HTTPException(status_code=404, detail="Notification not found.")
            return {"notification": rows[0]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not update Operations notification")
            raise HTTPException(status_code=503, detail="The notification could not be updated.") from exc

    @router.post("/operations/presence")
    def heartbeat_presence(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "worker":
            raise HTTPException(status_code=403, detail="Only an active FayFort worker can report workforce presence.")
        now = datetime.now().astimezone().isoformat()
        try:
            rows = (supabase.table("operations_worker_presence").upsert({
                "worker_id": staff["user_id"], "last_seen_at": now,
            }, on_conflict="worker_id").execute().data or [])
            return {"online": True, "last_seen_at": (rows[0].get("last_seen_at") if rows else now)}
        except Exception as exc:
            logger.exception("Could not record operations workforce presence")
            raise HTTPException(status_code=503, detail="Workforce presence could not be recorded.") from exc

    @router.get("/operations/workforce")
    def workforce_overview(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="Only a platform administrator can view the FayFort workforce.")
        try:
            workers = (supabase.table("fayfort_workers")
                .select("user_id,status,handoff_availability,handoff_available_until,handoff_max_active,handoff_availability_updated_at")
                .order("created_at").limit(500).execute().data or [])
            worker_ids = [str(worker["user_id"]) for worker in workers]
            presence_rows = (supabase.table("operations_worker_presence")
                .select("worker_id,last_seen_at").in_("worker_id", worker_ids).execute().data or []) if worker_ids else []
            department_rows = (supabase.table("operations_worker_departments")
                .select("worker_id,department,can_claim").in_("worker_id", worker_ids).execute().data or []) if worker_ids else []
            work_rows = (supabase.table("operations_work_items")
                .select("id,summary,department,status,assigned_worker_id,assigned_automation_key,priority,due_at,updated_at")
                .order("updated_at", desc=True).limit(1000).execute().data or [])
            work_rows = [row for row in work_rows if row.get("status") not in ("completed", "cancelled")]

            now = datetime.now().astimezone()
            online_cutoff = now.timestamp() - 90
            last_seen = {str(row["worker_id"]): row.get("last_seen_at") for row in presence_rows}
            access_by_worker: dict[str, list[str]] = {}
            for row in department_rows:
                if row.get("can_claim"):
                    access_by_worker.setdefault(str(row["worker_id"]), []).append(str(row["department"]))
            work_by_worker: dict[str, list[dict]] = {}
            automation_items = []
            for row in work_rows:
                if row.get("assigned_worker_id"):
                    work_by_worker.setdefault(str(row["assigned_worker_id"]), []).append(row)
                if row.get("assigned_automation_key"):
                    automation_items.append(row)

            roster = []
            for worker in workers:
                user_id = str(worker["user_id"])
                seen = last_seen.get(user_id)
                try:
                    online = bool(seen and datetime.fromisoformat(seen.replace("Z", "+00:00")).timestamp() >= online_cutoff)
                except (ValueError, TypeError):
                    online = False
                roster.append({
                    **worker,
                    "online": online,
                    "last_seen_at": seen,
                    "departments": access_by_worker.get(user_id, []),
                    "active_work_count": len(work_by_worker.get(user_id, [])),
                    "current_work": work_by_worker.get(user_id, [])[:5],
                })
            return {
                "workers": roster,
                "summary": {
                    "active_workers": sum(row.get("status") == "active" for row in workers),
                    "online_workers": sum(row["online"] for row in roster),
                    "active_work_items": len(work_rows),
                    "automation_owned_work_items": len(automation_items),
                    "automation_work": automation_items[:20],
                },
                "online_window_seconds": 90,
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load operations workforce overview")
            raise HTTPException(status_code=503, detail="The workforce overview could not be loaded.") from exc

    @router.get("/operations/automation-health")
    def automation_health(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="Only a platform administrator can view automation health.")
        try:
            automation_rows = (supabase.table("business_automations")
                .select("id,business_id,name,trigger_type,enabled,schedule_next_run_at,schedule_attempts,schedule_last_error_code")
                .order("updated_at", desc=True).limit(500).execute().data or [])
            execution_rows = (supabase.table("automation_executions")
                .select("id,business_id,automation_id,status,error_code,triggered_by,created_at,completed_at")
                .order("created_at", desc=True).limit(50).execute().data or [])
            names = {str(row["id"]): row for row in automation_rows}
            recent_runs = [{
                "id": row.get("id"),
                "automation_name": names.get(str(row.get("automation_id")), {}).get("name", "Automation"),
                "business_ref": str(row.get("business_id", ""))[:8],
                "status": row.get("status"),
                "error_code": row.get("error_code"),
                "triggered_by": row.get("triggered_by"),
                "created_at": row.get("created_at"),
                "completed_at": row.get("completed_at"),
            } for row in execution_rows]
            schedule_rows = [row for row in automation_rows if row.get("trigger_type") == "scheduled_interval" and row.get("enabled")]
            schedule_issues = [{
                "id": row.get("id"),
                "name": row.get("name"),
                "business_ref": str(row.get("business_id", ""))[:8],
                "next_run_at": row.get("schedule_next_run_at"),
                "attempts": int(row.get("schedule_attempts") or 0),
                "last_error_code": row.get("schedule_last_error_code"),
            } for row in schedule_rows if int(row.get("schedule_attempts") or 0) > 0 or row.get("schedule_last_error_code")]
            return {
                "summary": {
                    "recent_runs": len(recent_runs),
                    "failed_runs": sum(row.get("status") == "failed" for row in recent_runs),
                    "enabled_schedules": len(schedule_rows),
                    "schedule_issues": len(schedule_issues),
                },
                "recent_runs": recent_runs,
                "schedule_issues": schedule_issues,
            }
        except Exception as exc:
            logger.exception("Could not load Operations automation health")
            raise HTTPException(status_code=503, detail="Automation health could not be loaded.") from exc

    @router.put("/operations/workers/{worker_id}/departments")
    def set_worker_departments(worker_id: UUID, payload: WorkerDepartments,
                               authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="A platform administrator is required to manage department access.")
        try:
            result = supabase.rpc("set_operations_worker_departments", {
                "p_actor_id": staff["user_id"], "p_worker_id": str(worker_id),
                "p_departments": payload.departments,
            }).execute()
            return {"worker_id": str(worker_id), "departments": result.data or []}
        except Exception as exc:
            logger.exception("Could not update worker department access")
            raise HTTPException(status_code=409, detail="Department access could not be saved; the worker must be active.") from exc

    @router.get("/operations/work-items")
    def list_work_items(
        scope: Literal["mine", "available", "all"] = Query(default="mine"),
        department: Department | None = None,
        status: WorkStatus | None = None,
        authorization: str | None = Header(default=None),
    ):
        staff = staff_identity(authorization)
        admin = staff.get("role") == "platform_admin"
        if scope == "all" and not admin:
            raise HTTPException(status_code=403, detail="Only a platform administrator can view all operations work.")
        try:
            query = supabase.table("operations_work_items").select(WORK_ITEM_FIELDS)
            if department:
                query = query.eq("department", department)
            if status:
                query = query.eq("status", status)
            if not admin:
                if scope == "mine":
                    query = query.eq("assigned_worker_id", staff["user_id"])
                else:
                    allowed = departments_for(staff["user_id"])
                    if department and department not in allowed:
                        return {"work_items": [], "scope": scope}
                    if not allowed:
                        return {"work_items": [], "scope": scope}
                    query = query.in_("department", allowed)
                    if scope == "available":
                        query = query.in_("status", ["open", "claimed"])
            elif scope == "mine":
                query = query.eq("assigned_worker_id", staff["user_id"])
            elif scope == "available":
                query = query.in_("status", ["open", "claimed"])
            rows = query.order("priority").order("due_at", nullsfirst=True).order("created_at").limit(200).execute().data or []
            if not admin and scope == "available":
                now = datetime.now().astimezone()
                rows = [row for row in rows if row.get("assigned_worker_id") in (None, staff["user_id"])
                    or (row.get("claimed_until") and datetime.fromisoformat(row["claimed_until"].replace("Z", "+00:00")) <= now)]
            return {"work_items": attach_handoff_conversations(rows), "scope": scope}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not list operations work items")
            raise HTTPException(status_code=503, detail="Operations work could not be loaded.") from exc

    @router.post("/operations/work-items", status_code=201)
    def create_work_item(payload: WorkItemCreate, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="A platform administrator is required to create operations work.")
        try:
            result = supabase.rpc("create_operations_work_item", {
                "p_actor_id": staff["user_id"], "p_department": payload.department,
                "p_work_type": payload.work_type, "p_summary": payload.summary,
                "p_next_action": payload.next_action, "p_source_type": payload.source_type,
                "p_source_id": str(payload.source_id), "p_priority": payload.priority,
                "p_due_at": payload.due_at.isoformat() if payload.due_at else None,
                "p_assigned_worker_id": str(payload.assigned_worker_id) if payload.assigned_worker_id else None,
            }).execute()
            item = result.data
            if isinstance(item, list):
                item = item[0] if item else None
            if not item:
                raise RuntimeError("Operations work creation returned no record")
            return {"work_item": item}
        except Exception as exc:
            logger.exception("Could not create operations work item")
            raise HTTPException(status_code=409, detail="The work item could not be created with those source and ownership details.") from exc

    @router.post("/operations/work-items/{work_item_id}/claim")
    def claim_work_item(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "worker":
            raise HTTPException(status_code=403, detail="Only an active FayFort worker can claim queue work.")
        try:
            result = supabase.rpc("claim_operations_work_item", {
                "p_work_item_id": str(work_item_id), "p_worker_id": staff["user_id"],
            }).execute()
            item = result.data
            if isinstance(item, list):
                item = item[0] if item else None
            if not item:
                raise RuntimeError("Claim did not return the work item")
            return {"work_item": item}
        except Exception as exc:
            logger.exception("Could not claim operations work item")
            raise HTTPException(status_code=409, detail="This item is no longer available or you are not assigned to its department.") from exc

    @router.patch("/operations/work-items/{work_item_id}")
    def transition_work_item(work_item_id: UUID, payload: WorkItemTransition,
                             authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if item.get("handoff_id"):
            raise HTTPException(status_code=409, detail="Business handoffs must be closed through Return to automation.")
        if staff.get("role") != "platform_admin" and item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this work item before changing its status.")
        try:
            result = supabase.rpc("transition_operations_work_item", {
                "p_work_item_id": str(work_item_id), "p_actor_id": staff["user_id"],
                "p_actor_type": "platform_admin" if staff.get("role") == "platform_admin" else "worker",
                "p_expected_version": payload.expected_version, "p_status": payload.status,
                "p_next_action": payload.next_action, "p_waiting_on": payload.waiting_on,
                "p_waiting_reason": payload.waiting_reason, "p_due_at": payload.due_at.isoformat() if payload.due_at else None,
                "p_reason": payload.reason, "p_allow_reopen": staff.get("role") == "platform_admin",
            }).execute()
            updated = result.data
            if isinstance(updated, list):
                updated = updated[0] if updated else None
            if not updated:
                raise RuntimeError("Transition returned no work item")
            return {"work_item": updated}
        except Exception as exc:
            logger.exception("Could not transition operations work item")
            message = str(exc).casefold()
            if "version conflict" in message:
                raise HTTPException(status_code=409, detail="This item changed in another session. Refresh before updating it.") from exc
            raise HTTPException(status_code=409, detail="The requested work-item transition is not allowed.") from exc

    @router.post("/operations/work-items/{work_item_id}/transfer")
    def transfer_work_item(work_item_id: UUID, payload: WorkItemTransfer,
                           authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if item.get("handoff_id"):
            raise HTTPException(status_code=409, detail="Business handoffs cannot transfer departments until a linked request handoff exists.")
        if item.get("department") == "fulfillment" and payload.department == "sourcing":
            raise HTTPException(status_code=409, detail="Fulfillment work cannot be routed back to sourcing. Open a separate dispute or support case if needed.")
        if staff.get("role") != "platform_admin":
            if item.get("assigned_worker_id") != staff["user_id"]:
                raise HTTPException(status_code=403, detail="Claim this work item before transferring it.")
            if payload.department not in departments_for(staff["user_id"]):
                raise HTTPException(status_code=403, detail="You need access to both departments to transfer this item.")
        try:
            result = supabase.rpc("transfer_operations_work_item", {
                "p_work_item_id": str(work_item_id), "p_actor_id": staff["user_id"],
                "p_expected_version": payload.expected_version, "p_department": payload.department,
                "p_next_action": payload.next_action, "p_reason": payload.reason,
            }).execute()
            item = result.data
            if isinstance(item, list):
                item = item[0] if item else None
            if not item:
                raise RuntimeError("Transfer returned no work item")
            return {"work_item": item}
        except Exception as exc:
            logger.exception("Could not transfer operations work item")
            if "version conflict" in str(exc).casefold():
                raise HTTPException(status_code=409, detail="This item changed in another session. Refresh before transferring it.") from exc
            raise HTTPException(status_code=409, detail="The work item could not be transferred.") from exc

    @router.post("/operations/work-items/{work_item_id}/dispute-cases", status_code=201)
    def create_dispute_case(work_item_id: UUID, payload: DisputeCaseCreate,
                            authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if not item.get("member_request_id") or item.get("dispute_case_id"):
            raise HTTPException(status_code=409, detail="Open a dispute from a member request work item.")
        if staff.get("role") != "platform_admin" and item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Only the worker assigned to this request can open its dispute case.")
        if staff.get("role") != "platform_admin" and "disputes" not in departments_for(staff["user_id"]):
            raise HTTPException(status_code=403, detail="You need Disputes department access before opening a dispute case.")
        try:
            result = supabase.rpc("create_operations_dispute_case", {
                "p_actor_id": staff["user_id"],
                "p_actor_type": "platform_admin" if staff.get("role") == "platform_admin" else "worker",
                "p_request_id": item["member_request_id"], "p_category": payload.category,
                "p_summary": payload.summary, "p_next_action": payload.next_action,
                "p_due_at": payload.due_at.isoformat() if payload.due_at else None,
            }).execute()
            created = result.data
            if isinstance(created, list):
                created = created[0] if created else None
            if not created:
                raise RuntimeError("Dispute creation returned no records")
            return created
        except Exception as exc:
            message = str(exc).casefold()
            if "one_active_per_request" in message or "duplicate key" in message:
                raise HTTPException(status_code=409, detail="This request already has an active dispute case.") from exc
            logger.exception("Could not create operations dispute case")
            raise HTTPException(status_code=503, detail="The dispute case could not be opened.") from exc

    @router.patch("/operations/dispute-cases/{case_id}")
    def update_dispute_case(case_id: UUID, payload: DisputeCaseUpdate,
                            authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        try:
            result = (supabase.table("operations_dispute_cases").select("id,version")
                .eq("id", str(case_id)).maybe_single().execute())
            dispute = result.data if result is not None else None
            if not dispute:
                raise HTTPException(status_code=404, detail="Dispute case not found.")
            item_result = (supabase.table("operations_work_items").select("id,department,status,assigned_worker_id")
                .eq("dispute_case_id", str(case_id)).maybe_single().execute())
            item = item_result.data if item_result is not None else None
            if not item:
                raise HTTPException(status_code=404, detail="Dispute case work item not found.")
            is_admin = staff.get("role") == "platform_admin"
            if not is_admin and (
                item.get("department") not in departments_for(staff["user_id"])
                or item.get("assigned_worker_id") != staff["user_id"]
                or item.get("status") != "claimed"
            ):
                raise HTTPException(status_code=403, detail="Claim this dispute in an enabled department before updating it.")
            result = supabase.rpc("update_operations_dispute_case", {
                "p_case_id": str(case_id), "p_actor_id": staff["user_id"],
                "p_expected_version": payload.expected_version, "p_status": payload.status,
                "p_resolution": payload.resolution,
            }).execute()
            updated = result.data
            if isinstance(updated, list):
                updated = updated[0] if updated else None
            if not updated:
                raise RuntimeError("Dispute update returned no case")
            return {"dispute_case": updated}
        except HTTPException:
            raise
        except Exception as exc:
            message = str(exc).casefold()
            if "version conflict" in message:
                raise HTTPException(status_code=409, detail="This dispute changed in another session. Refresh before updating it.") from exc
            if "invalid dispute status" in message:
                raise HTTPException(status_code=409, detail="That dispute status cannot follow the current status.") from exc
            if "resolution is required" in message:
                raise HTTPException(status_code=422, detail="Add a resolution before resolving or closing the dispute.") from exc
            logger.exception("Could not update operations dispute case")
            raise HTTPException(status_code=503, detail="The dispute case could not be updated.") from exc

    @router.get("/operations/work-items/{work_item_id}/source-context")
    def work_item_source_context(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        request_id = item.get("member_request_id")
        dispute_case = None
        dispute_case_id = item.get("dispute_case_id")
        if not dispute_case_id and item.get("work_type") == "dispute_case":
            case_link = (supabase.table("operations_work_items").select("dispute_case_id")
                .eq("id", str(work_item_id)).maybe_single().execute())
            dispute_case_id = (case_link.data or {}).get("dispute_case_id") if case_link is not None else None
        if dispute_case_id:
            case_result = (supabase.table("operations_dispute_cases")
                .select("id,member_request_id,category,summary,status,resolution,version,opened_by,created_at,updated_at,resolved_at,closed_at")
                .eq("id", str(dispute_case_id)).maybe_single().execute())
            dispute_case = case_result.data if case_result is not None else None
            if not dispute_case:
                raise HTTPException(status_code=404, detail="The linked dispute case is no longer available.")
            dispute_case["events"] = (supabase.table("operations_dispute_events")
                .select("id,sequence_no,actor_id,previous_status,next_status,note,created_at")
                .eq("dispute_case_id", str(dispute_case["id"])).order("sequence_no").limit(100).execute().data or [])
            request_id = dispute_case["member_request_id"]
        conversation_id = item.get("member_conversation_id")
        if not request_id and conversation_id and staff.get("role") != "platform_admin" \
                and item.get("assigned_worker_id") != staff.get("user_id"):
            raise HTTPException(status_code=404, detail="Operations work item not found.")
        try:
            if request_id:
                result = (supabase.table("member_purchase_requests")
                    .select("id,product_name_snapshot,request_title,request_description,source_type,source_url,created_at,updated_at")
                    .eq("id", str(request_id)).maybe_single().execute())
                request = result.data if result is not None else None
                if not request:
                    raise HTTPException(status_code=404, detail="The linked member request is no longer available.")
                events = (supabase.table("member_request_events")
                    .select("id,sequence_no,stage,member_note,details,created_at")
                    .eq("request_id", str(request_id)).order("sequence_no").limit(100).execute().data or [])
                for event in events:
                    event["details"] = event.get("details") or {}
                    event["media"] = []
                warehouse_event_ids = [event["id"] for event in events if event.get("stage") == "item_in_warehouse"]
                if warehouse_event_ids:
                    media_rows = (supabase.table("member_request_media")
                        .select("id,event_id,storage_path,content_type,byte_size,original_filename,created_at")
                        .in_("event_id", warehouse_event_ids).order("created_at").execute().data or [])
                    event_by_id = {event["id"]: event for event in events}
                    for media in media_rows:
                        signed = supabase.storage.from_("member-request-evidence").create_signed_url(media["storage_path"], 900)
                        signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
                        if signed_url and signed_url.startswith("/"):
                            signed_url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", signed_url.lstrip("/"))
                        if signed_url and media.get("event_id") in event_by_id:
                            event_by_id[media["event_id"]]["media"].append({
                                "id": media["id"], "url": signed_url, "content_type": media["content_type"],
                                "byte_size": media["byte_size"], "original_filename": media["original_filename"],
                                "created_at": media["created_at"],
                            })
                schedule_result = (supabase.table("member_request_schedules")
                    .select("id,cadence,interval_count,interval_unit,units_per_order,occurrence_limit,time_zone,next_occurrence_number,next_due_at,expires_at,status,created_at,updated_at")
                    .eq("originating_request_id", str(request_id)).maybe_single().execute())
                schedule = schedule_result.data if schedule_result is not None else None
                occurrence = None
                if not schedule:
                    occurrence_result = (supabase.table("member_request_schedule_occurrences")
                        .select("schedule_id,occurrence_number,due_at,status")
                        .eq("request_id", str(request_id)).maybe_single().execute())
                    occurrence = occurrence_result.data if occurrence_result is not None else None
                    if occurrence:
                        schedule_result = (supabase.table("member_request_schedules")
                            .select("id,cadence,interval_count,interval_unit,units_per_order,occurrence_limit,time_zone,next_occurrence_number,next_due_at,expires_at,status,created_at,updated_at")
                            .eq("id", occurrence["schedule_id"]).maybe_single().execute())
                        schedule = schedule_result.data if schedule_result is not None else None
                if schedule:
                    schedule["occurrences"] = (supabase.table("member_request_schedule_occurrences")
                        .select("id,occurrence_number,request_id,due_at,status,quote_accepted_at")
                        .eq("schedule_id", schedule["id"]).order("occurrence_number").limit(12).execute().data or [])
                    schedule["events"] = (supabase.table("member_request_schedule_events")
                        .select("id,sequence_no,event_type,occurrence_number,details,created_at")
                        .eq("schedule_id", schedule["id"]).order("sequence_no").limit(100).execute().data or [])
                    schedule["current_occurrence"] = occurrence
                return {"source_type": "dispute_case" if dispute_case else "member_request",
                    "request": {**request, "events": events, "recurring_schedule": schedule},
                    "dispute_case": dispute_case}
            if conversation_id:
                result = (supabase.table("member_conversations")
                    .select("id,title,linked_request_id,retention_hold")
                    .eq("id", str(conversation_id)).maybe_single().execute())
                conversation = result.data if result is not None else None
                if not conversation:
                    raise HTTPException(status_code=404, detail="The linked member conversation is no longer available.")
                messages = (supabase.table("member_messages")
                    .select("id,sender_type,content,related_product_ids,created_at")
                    .eq("conversation_id", str(conversation_id)).order("created_at").limit(200).execute().data or [])
                return {"source_type": "member_conversation", "conversation": {**conversation, "messages": messages}}
            source_type = "business_conversation" if item.get("business_conversation_id") else "business_handoff"
            handoff = None
            business_conversation = None
            if item.get("handoff_id") and item.get("business_id"):
                result = (supabase.table("conversation_handoffs")
                    .select("id,conversation_id,status,reason,requested_at,updated_at,closed_at")
                    .eq("id", str(item["handoff_id"]))
                    .eq("business_id", str(item["business_id"]))
                    .maybe_single().execute())
                handoff = result.data if result is not None else None
                if handoff and handoff.get("conversation_id"):
                    conversation_result = (supabase.table("conversations")
                        .select("id,business_id,channel,status,created_at,last_message_at,summary")
                        .eq("id", str(handoff["conversation_id"]))
                        .eq("business_id", str(item["business_id"]))
                        .maybe_single().execute())
                    business_conversation = conversation_result.data if conversation_result is not None else None
                    if business_conversation:
                        messages = (supabase.table("messages")
                            .select("id,sender_type,content,created_at")
                            .eq("conversation_id", str(business_conversation["id"]))
                            .order("created_at").limit(200).execute().data or [])
                        business_conversation = {**business_conversation, "messages": messages}
            elif item.get("business_conversation_id") and item.get("business_id"):
                conversation_result = (supabase.table("conversations")
                    .select("id,business_id,channel,status,created_at,last_message_at,summary")
                    .eq("id", str(item["business_conversation_id"]))
                    .eq("business_id", str(item["business_id"]))
                    .maybe_single().execute())
                business_conversation = conversation_result.data if conversation_result is not None else None
                if business_conversation:
                    messages = (supabase.table("messages")
                        .select("id,sender_type,content,created_at")
                        .eq("conversation_id", str(business_conversation["id"]))
                        .order("created_at").limit(200).execute().data or [])
                    business_conversation = {**business_conversation, "messages": messages}
            if business_conversation:
                source_type = "business_conversation"
            return {"source_type": source_type, "request": None, "conversation": business_conversation, "handoff": handoff}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not load operations source context")
            raise HTTPException(status_code=503, detail="The linked request context could not be loaded.") from exc

    @router.get("/operations/sourcing/batches")
    def list_sourcing_batches(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin" and "sourcing" not in departments_for(staff["user_id"]):
            raise HTTPException(status_code=403, detail="Sourcing department access is required.")
        try:
            rows = (supabase.table("operations_sourcing_batches")
                .select("id,title,status,created_by,created_at,updated_at")
                .in_("status", ["open", "completed", "cancelled"])
                .order("created_at", desc=True).limit(100).execute().data or [])
            batch_ids = [row["id"] for row in rows]
            memberships = (supabase.table("operations_sourcing_batch_items")
                .select("batch_id,work_item_id,member_request_id,created_at")
                .in_("batch_id", batch_ids).order("created_at").execute().data or []) if batch_ids else []
            members_by_batch: dict[str, list[dict]] = {}
            for membership in memberships:
                members_by_batch.setdefault(str(membership["batch_id"]), []).append(membership)
            rows = [{**row, "items": members_by_batch.get(str(row["id"]), [])} for row in rows]
            return {"batches": rows}
        except Exception as exc:
            logger.exception("Could not list sourcing batches")
            raise HTTPException(status_code=503, detail="Sourcing batches are not available yet.") from exc

    @router.post("/operations/sourcing/batches", status_code=201)
    def create_sourcing_batch(payload: SourcingBatchCreate, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        admin = staff.get("role") == "platform_admin"
        if not admin and "sourcing" not in departments_for(staff["user_id"]):
            raise HTTPException(status_code=403, detail="Sourcing department access is required.")
        try:
            result = supabase.rpc("create_operations_sourcing_batch", {
                "p_actor_id": staff["user_id"], "p_title": payload.title,
                "p_work_item_ids": [str(value) for value in payload.work_item_ids],
                "p_is_admin": admin,
            }).execute()
            batch = result.data
            if isinstance(batch, list):
                batch = batch[0] if batch else None
            if not batch:
                raise RuntimeError("Batch creation returned no record")
            return {"batch": batch}
        except Exception as exc:
            logger.exception("Could not create sourcing batch")
            raise HTTPException(status_code=409, detail="Batch creation failed. Confirm every selected item is an eligible sourcing request and not already batched.") from exc

    @router.get("/operations/work-items/{work_item_id}/sourcing-candidates")
    def list_sourcing_candidates(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if item.get("department") != "sourcing" or not item.get("member_request_id"):
            raise HTTPException(status_code=404, detail="Sourcing request not found.")
        try:
            rows = (supabase.table("operations_sourcing_candidates")
                .select("id,product_name,supplier_name,product_url,price_amount,currency,availability,evidence_note,created_by,created_at")
                .eq("work_item_id", str(work_item_id)).order("created_at", desc=True).limit(100).execute().data or [])
            return {"candidates": rows}
        except Exception as exc:
            logger.exception("Could not load sourcing candidates")
            raise HTTPException(status_code=503, detail="Sourcing research could not be loaded.") from exc

    @router.post("/operations/work-items/{work_item_id}/sourcing-candidates", status_code=201)
    def create_sourcing_candidate(work_item_id: UUID, payload: SourcingCandidateCreate,
                                  authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if item.get("department") != "sourcing" or not item.get("member_request_id"):
            raise HTTPException(status_code=404, detail="Sourcing request not found.")
        if staff.get("role") != "platform_admin" and item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this sourcing request before adding research.")
        try:
            result = (supabase.table("operations_sourcing_candidates").insert({
                "work_item_id": str(work_item_id), "member_request_id": str(item["member_request_id"]),
                "created_by": staff["user_id"], **payload.model_dump(),
            }).execute())
            candidate = (result.data or [None])[0]
            if not candidate:
                raise RuntimeError("Candidate creation returned no record")
            return {"candidate": candidate}
        except Exception as exc:
            logger.exception("Could not record sourcing candidate")
            raise HTTPException(status_code=409, detail="The sourcing candidate could not be recorded.") from exc

    @router.patch("/operations/work-items/{work_item_id}/sourcing-candidates/{candidate_id}")
    def update_sourcing_candidate(work_item_id: UUID, candidate_id: UUID, payload: SourcingCandidateUpdate,
                                  authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if item.get("department") != "sourcing" or not item.get("member_request_id"):
            raise HTTPException(status_code=404, detail="Sourcing request not found.")
        if staff.get("role") != "platform_admin" and item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this sourcing request before editing research.")
        try:
            result = (supabase.table("operations_sourcing_candidates")
                .update(payload.model_dump())
                .eq("id", str(candidate_id))
                .eq("work_item_id", str(work_item_id))
                .eq("member_request_id", str(item["member_request_id"]))
                .select("id,product_name,supplier_name,product_url,price_amount,currency,availability,evidence_note,created_by,created_at")
                .execute())
            candidate = (result.data or [None])[0]
            if not candidate:
                raise HTTPException(status_code=404, detail="Sourcing candidate not found for this request.")
            return {"candidate": candidate}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not update sourcing candidate")
            raise HTTPException(status_code=409, detail="The sourcing candidate could not be updated.") from exc

    @router.post("/operations/work-items/{work_item_id}/sourcing-options", status_code=201)
    def share_sourcing_options(work_item_id: UUID, payload: SourcingOptionsShare,
                               authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if item.get("department") != "sourcing" or not item.get("member_request_id"):
            raise HTTPException(status_code=404, detail="Sourcing request not found.")
        if staff.get("role") != "platform_admin" and item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this sourcing request before sharing options.")
        try:
            result = supabase.rpc("share_operations_sourcing_options", {
                "p_request_id": item["member_request_id"], "p_work_item_id": str(work_item_id),
                "p_candidate_ids": [str(value) for value in payload.candidate_ids],
                "p_actor_id": staff["user_id"], "p_member_note": payload.member_note,
            }).execute()
            return {"options": result.data or []}
        except Exception as exc:
            logger.exception("Could not share sourcing options")
            message = str(exc).casefold()
            if "not ready" in message:
                raise HTTPException(status_code=409, detail="Move the request into sourcing before sharing options.") from exc
            if "candidate" in message or "work item" in message:
                raise HTTPException(status_code=409, detail="One or more candidates do not belong to this request.") from exc
            raise HTTPException(status_code=409, detail="Sourcing options could not be shared.") from exc

    @router.post("/operations/work-items/{work_item_id}/member-reply", status_code=201)
    def reply_to_member_conversation(work_item_id: UUID, payload: MemberConversationReply,
                                     authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if not item.get("member_conversation_id") or item.get("member_request_id"):
            raise HTTPException(status_code=409, detail="This work item is not an unlinked member conversation.")
        if staff.get("role") != "platform_admin" and item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this conversation before replying to the member.")
        try:
            result = supabase.rpc("send_operations_member_conversation_reply", {
                "p_work_item_id": str(work_item_id), "p_actor_id": staff["user_id"],
                "p_actor_type": "platform_admin" if staff.get("role") == "platform_admin" else "worker",
                "p_content": payload.content,
            }).execute()
            message = result.data
            if isinstance(message, list):
                message = message[0] if message else None
            if isinstance(message, dict) and "message" in message:
                message = message["message"]
            if not message:
                raise RuntimeError("Member reply was not returned")
            return {"message": {key: message.get(key) for key in
                    ("id", "sender_type", "content", "related_product_ids", "created_at")}}
        except Exception as exc:
            logger.exception("Could not send Operations member conversation reply")
            message = str(exc).casefold()
            if "not assigned" in message or "claim" in message or "permission" in message:
                raise HTTPException(status_code=403, detail="Claim this conversation before replying to the member.") from exc
            if "linked request" in message or "not a member conversation" in message:
                raise HTTPException(status_code=409, detail="This conversation is linked to a sourcing request or is no longer available.") from exc
            raise HTTPException(status_code=409, detail="The reply could not be sent. Refresh the conversation and try again.") from exc

    @router.post("/operations/work-items/{work_item_id}/business-reply", status_code=201)
    def reply_to_business_handoff(work_item_id: UUID, payload: MemberConversationReply,
                                  authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "worker":
            raise HTTPException(status_code=403, detail="Claim this business handoff as a worker before replying.")
        item = load_accessible_item(work_item_id, staff)
        if not item.get("handoff_id") or item.get("member_request_id"):
            raise HTTPException(status_code=409, detail="This work item is not a business conversation handoff.")
        if item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this business handoff before replying.")
        try:
            result = supabase.rpc("send_operations_business_handoff_reply", {
                "p_work_item_id": str(work_item_id), "p_actor_id": staff["user_id"],
                "p_content": payload.content,
            }).execute()
            message = result.data
            if isinstance(message, list):
                message = message[0] if message else None
            if not message:
                raise RuntimeError("Business handoff reply was not returned")

            delivery = {"status": "recorded_not_delivered"}
            try:
                conversation = get_conversation(str(message["conversation_id"]))
                if conversation and str(conversation.get("business_id")) == str(item.get("business_id")):
                    connection_id = conversation.get("business_connection_id")
                    connection = get_connection(str(item["business_id"]), str(connection_id)) if connection_id else None
                    credentials = get_connection_credentials(str(item["business_id"]), connection["id"]) if connection else None
                    if connection and credentials and connection.get("provider") in {"instagram", "messenger"}:
                        sender = deliver_instagram_text if connection["provider"] == "instagram" else deliver_messenger_text
                        delivery = sender(connection=connection, credentials=credentials,
                                          conversation=conversation, message=message)
            except Exception:
                logger.exception("Operations handoff reply saved but outbound delivery could not be completed")
                delivery = {"status": "unknown", "safe_error_code": "delivery_state_unavailable"}
            return {
                "message": {key: message.get(key) for key in ("id", "sender_type", "content", "created_at")},
                "delivery_status": delivery.get("status"),
                "delivery_error_code": delivery.get("safe_error_code"),
            }
        except Exception as exc:
            logger.exception("Could not send Operations business handoff reply")
            message = str(exc).casefold()
            if "claim" in message or "assigned" in message or "active business handoff" in message:
                raise HTTPException(status_code=403, detail="Claim this business handoff before replying.") from exc
            if "business handoff" in message:
                raise HTTPException(status_code=409, detail="This handoff is no longer available for a staff reply.") from exc
            raise HTTPException(status_code=409, detail="The reply could not be sent. Refresh the conversation and try again.") from exc

    @router.post("/operations/work-items/{work_item_id}/return-to-automation")
    def return_business_handoff_to_automation(work_item_id: UUID,
                                               authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "worker":
            raise HTTPException(status_code=403, detail="Only the worker holding this handoff can return it to automation.")
        item = load_accessible_item(work_item_id, staff)
        if not item.get("handoff_id") or item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this business handoff before returning it.")
        try:
            result = supabase.rpc("return_operations_business_handoff_to_automation", {
                "p_work_item_id": str(work_item_id), "p_actor_id": staff["user_id"],
            }).execute()
            updated = result.data
            if isinstance(updated, list):
                updated = updated[0] if updated else None
            if not updated:
                raise RuntimeError("Business handoff return did not return the work item")
            return {"work_item": updated}
        except Exception as exc:
            logger.exception("Could not return business handoff to automation")
            if "claim" in str(exc).casefold() or "assigned" in str(exc).casefold():
                raise HTTPException(status_code=403, detail="Claim this business handoff before returning it.") from exc
            raise HTTPException(status_code=409, detail="The handoff could not be returned. Refresh and try again.") from exc

    @router.get("/operations/work-items/{work_item_id}/events")
    def work_item_events(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        load_accessible_item(work_item_id, staff)
        try:
            events = (supabase.table("operations_work_events")
                .select("id,sequence_no,event_type,actor_type,previous_department,next_department,previous_status,next_status,reason,created_at")
                .eq("work_item_id", str(work_item_id)).order("sequence_no").limit(200).execute().data or [])
            return {"events": events}
        except Exception as exc:
            logger.exception("Could not load operations work history")
            raise HTTPException(status_code=503, detail="Operations work history could not be loaded.") from exc

    @router.get("/operations/work-items/{work_item_id}/notes")
    def list_notes(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        load_accessible_item(work_item_id, staff)
        try:
            notes = (supabase.table("operations_work_notes").select("id,author_id,note,created_at")
                .eq("work_item_id", str(work_item_id)).order("created_at").limit(200).execute().data or [])
            return {"notes": notes}
        except Exception as exc:
            logger.exception("Could not load operations notes")
            raise HTTPException(status_code=503, detail="Operations notes could not be loaded.") from exc

    @router.post("/operations/work-items/{work_item_id}/notes", status_code=201)
    def add_note(work_item_id: UUID, payload: WorkNoteCreate, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        load_accessible_item(work_item_id, staff)
        try:
            rows = (supabase.table("operations_work_notes").insert({
                "work_item_id": str(work_item_id), "author_id": staff["user_id"], "note": payload.note,
            }).execute().data or [])
            if not rows:
                raise RuntimeError("Operations note insert returned no row")
            return {"note": rows[0]}
        except Exception as exc:
            logger.exception("Could not add operations note")
            raise HTTPException(status_code=503, detail="The operations note could not be saved.") from exc

    @router.get("/operations/work-items/{work_item_id}/checklist")
    def list_checklist(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        load_accessible_item(work_item_id, staff)
        try:
            rows = (supabase.table("operations_work_checklist_items").select("id,title,position,completed_at,completed_by,created_by,created_at,updated_at")
                .eq("work_item_id", str(work_item_id)).order("position").order("created_at").limit(200).execute().data or [])
            return {"items": rows}
        except Exception as exc:
            logger.exception("Could not load operations checklist")
            raise HTTPException(status_code=503, detail="The operations checklist could not be loaded.") from exc

    @router.post("/operations/work-items/{work_item_id}/checklist", status_code=201)
    def add_checklist_item(work_item_id: UUID, payload: ChecklistCreate,
                           authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        load_accessible_item(work_item_id, staff)
        try:
            rows = (supabase.table("operations_work_checklist_items").insert({
                "work_item_id": str(work_item_id), "title": payload.title,
                "position": payload.position, "created_by": staff["user_id"],
            }).execute().data or [])
            if not rows:
                raise RuntimeError("Checklist insert returned no row")
            return {"item": rows[0]}
        except Exception as exc:
            logger.exception("Could not add operations checklist item")
            raise HTTPException(status_code=503, detail="The checklist item could not be saved.") from exc

    @router.patch("/operations/work-items/{work_item_id}/checklist/{checklist_id}")
    def toggle_checklist_item(work_item_id: UUID, checklist_id: UUID,
                              completed: bool = Query(...), authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        load_accessible_item(work_item_id, staff)
        try:
            rows = (supabase.table("operations_work_checklist_items").update({
                "completed_at": datetime.now().astimezone().isoformat() if completed else None,
                "completed_by": staff["user_id"] if completed else None,
                "updated_at": datetime.now().astimezone().isoformat(),
            }).eq("id", str(checklist_id)).eq("work_item_id", str(work_item_id))
                .select("id,title,position,completed_at,completed_by,updated_at").execute().data or [])
            if not rows:
                raise HTTPException(status_code=404, detail="Checklist item not found.")
            return {"item": rows[0]}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not update operations checklist item")
            raise HTTPException(status_code=503, detail="The checklist item could not be updated.") from exc

    return router
