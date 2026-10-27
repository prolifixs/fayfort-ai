from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
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
from app.accounts import operations_flow
from app.accounts.desks import desk_stage, desk_summaries, latest_request_stages, my_due_counts

logger = logging.getLogger(__name__)
Department = Literal["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team"]
WorkStatus = Literal["open", "claimed", "waiting", "blocked", "completed", "cancelled"]
Priority = Literal["low", "normal", "high", "urgent"]
DEPARTMENTS = ("conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team")
SOURCES = {"member_request", "member_conversation", "business_handoff", "business_conversation"}
PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
STATUS_RANK = {"blocked": 0, "open": 1, "claimed": 2, "waiting": 3}


def queue_rank(row: dict) -> tuple:
    """Needs-you-now order: urgent first, then work that can move (blocked, open) before work that is waiting,
    then the earliest due date, then the oldest."""
    return (PRIORITY_RANK.get(row.get("priority"), 2), STATUS_RANK.get(row.get("status"), 4),
            row.get("due_at") or "9999", row.get("created_at") or "")


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


class BatchResearchCopy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_work_item_id: UUID
    candidate_ids: list[UUID] = Field(default_factory=list, max_length=20)


class BatchShare(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_work_item_id: UUID
    candidate_ids: list[UUID] = Field(min_length=1, max_length=10)
    member_note: str | None = Field(default=None, max_length=1000)
    eta_at: datetime | None = None


class InvoiceWithdraw(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=300)


class SourcingOptionsShare(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate_ids: list[UUID] = Field(min_length=1, max_length=10)
    member_note: str | None = Field(default=None, max_length=1000)
    # Needed only when the request hasn't reached Sourcing yet and has no delivery estimate: sharing moves it on.
    eta_at: datetime | None = None

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
    departments: list[Department] = Field(max_length=6)

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


class WorkReopen(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=3, max_length=500)


class WorkMemberMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write a message.")
        return value.strip()


class WorkGroupPrice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    price: float = Field(gt=0, le=1000000)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @field_validator("currency")
    @classmethod
    def upper_currency(cls, value: str) -> str:
        return value.upper()


class WorkDeadline(BaseModel):
    """Set or change a work item's deadline. For a member request this is the delivery estimate the member sees."""
    model_config = ConfigDict(extra="forbid")
    due_at: datetime
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value else None


class WorkDepositInvoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_total: float = Field(gt=0, le=1000000)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @field_validator("currency")
    @classmethod
    def upper_currency(cls, value: str) -> str:
        return value.upper()



def worker_on_shift(worker_id: str) -> bool:
    """Workers must be clocked in to claim work (the dashboards are gated the same way). If shifts can't be read,
    claiming isn't blocked: an outage of the hours table mustn't stop the queue."""
    try:
        rows = (supabase.table("worker_shifts").select("id").eq("worker_id", worker_id)
                .is_("ended_at", "null").limit(1).execute().data)
    except Exception:
        logger.warning("Could not check the worker's shift before a claim", exc_info=True)
        return True
    return isinstance(rows, list) and bool(rows)

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
            return {"user_id": staff["user_id"], "departments": ["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team"], "can_manage": True, "staff_role": "admin"}
        role = "staff"
        try:
            found = (supabase.table("fayfort_workers").select("staff_role").eq("user_id", staff["user_id"])
                     .maybe_single().execute())
            role = ((found.data if found is not None else None) or {}).get("staff_role") or "staff"
        except Exception:
            logger.info("Staff role could not be read", exc_info=True)
        return {"user_id": staff["user_id"], "departments": departments_for(staff["user_id"]), "can_manage": False,
                "staff_role": role}

    @router.get("/operations/pending-count")
    def operations_pending_count(authorization: str | None = Header(default=None)):
        """Unfinished work this person can see, for the badge on the Operations Center menu item.
        Administrators see every department; workers see their own departments plus anything assigned to them."""
        staff = staff_identity(authorization)
        live = ["open", "claimed", "waiting", "blocked"]
        try:
            query = supabase.table("operations_work_items").select("id,due_at,department,assigned_worker_id").in_("status", live)
            if staff.get("role") != "platform_admin":
                departments = departments_for(staff["user_id"])
                rows = [row for row in (query.limit(2000).execute().data or [])
                        if row.get("department") in departments or row.get("assigned_worker_id") == staff["user_id"]]
            else:
                rows = query.limit(2000).execute().data or []
            now = datetime.now(timezone.utc)

            def is_overdue(value: object) -> bool:
                try:
                    due = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                    return (due if due.tzinfo else due.replace(tzinfo=timezone.utc)) < now
                except ValueError:
                    return False
            overdue = sum(1 for row in rows if row.get("due_at") and is_overdue(row["due_at"]))
            return {"pending": len(rows), "overdue": overdue}
        except Exception as exc:
            logger.exception("Could not count pending operations work")
            raise HTTPException(status_code=503, detail="Pending work could not be counted.") from exc

    @router.get("/operations/desks")
    def operations_desks(authorization: str | None = Header(default=None)):
        """The left rail and My work: for each desk this person works on, what's free, theirs, waiting, overdue and the
        pipeline stage counts (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R2)."""
        staff = staff_identity(authorization)
        admin = staff.get("role") == "platform_admin"
        departments = list(DEPARTMENTS) if admin else departments_for(staff["user_id"])
        try:
            rows = (supabase.table("operations_work_items")
                    .select("id,department,work_type,status,due_at,assigned_worker_id,claimed_until,member_request_id,"
                            "member_conversation_id,business_conversation_id,handoff_id")
                    .in_("status", ["open", "claimed", "waiting", "blocked"]).limit(3000).execute().data or [])
            stages = latest_request_stages(supabase, [row.get("member_request_id") for row in rows
                                                      if row.get("member_request_id")
                                                      and row.get("department") in ("sourcing", "fulfillment")])
            desks = desk_summaries(rows, stages, staff["user_id"], departments)
            mine = [row for row in rows if row.get("assigned_worker_id") == staff["user_id"]]
            return {"desks": desks, **my_due_counts(mine)}
        except Exception as exc:
            logger.exception("Could not summarise the operations desks")
            raise HTTPException(status_code=503, detail="The desks could not be loaded.") from exc

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

    @router.post("/operations/me/notifications/read-all")
    def read_all_operations_notifications(authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        try:
            rows = (supabase.table("operations_worker_notifications").update({
                "read_at": datetime.now().astimezone().isoformat(),
            }).eq("worker_id", staff["user_id"]).is_("read_at", "null").is_("dismissed_at", "null")
                .execute().data or [])
            return {"marked_read": len(rows)}
        except Exception as exc:
            logger.exception("Could not mark Operations notifications read")
            raise HTTPException(status_code=503, detail="Notifications could not be marked read.") from exc

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
        scope: Literal["mine", "available", "all", "desk"] = Query(default="mine"),
        department: Department | None = None,
        status: WorkStatus | None = None,
        view: Literal["active", "archive"] = Query(default="active"),
        q: str | None = Query(default=None, max_length=100),
        days: int = Query(default=30, ge=0, le=3650),
        offset: int = Query(default=0, ge=0, le=10000),
        authorization: str | None = Header(default=None),
    ):
        staff = staff_identity(authorization)
        admin = staff.get("role") == "platform_admin"
        if scope == "all" and not admin:
            raise HTTPException(status_code=403, detail="Only a platform administrator can view all operations work.")
        if scope == "desk" and not department:
            raise HTTPException(status_code=422, detail="Pick a desk.")
        try:
            query = supabase.table("operations_work_items").select(WORK_ITEM_FIELDS)
            if department:
                query = query.eq("department", department)
            if status:
                query = query.eq("status", status)
            elif view == "archive":
                # Archive: finished work, newest first. The queue only shows live work.
                query = query.in_("status", ["completed", "cancelled"])
                if days:
                    query = query.gte("completed_at", (datetime.now().astimezone() - timedelta(days=days)).isoformat())
            else:
                query = query.in_("status", ["open", "claimed", "waiting", "blocked"])
            if not admin and view == "archive" and scope != "mine":
                # Workers can look back at finished work in their own departments.
                allowed = departments_for(staff["user_id"])
                if not allowed or (department and department not in allowed):
                    return {"work_items": [], "scope": scope, "view": view, "has_more": False}
                query = query.in_("department", allowed)
            elif not admin:
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
            if view == "archive" and not status:
                rows = query.order("completed_at", desc=True).range(offset, offset + 200).execute().data or []
            else:
                rows = query.order("priority").order("due_at", nullsfirst=True).order("created_at").limit(200).execute().data or []
            if q and q.strip():
                needle = q.strip().casefold()
                rows = [row for row in rows if needle in " ".join(str(row.get(key) or "") for key in
                        ("summary", "next_action", "work_type", "id", "member_request_id")).casefold()]
            if view != "archive":
                rows.sort(key=queue_rank)
                # The desk's pipeline stage, so the strip can filter the list (app/accounts/desks.py).
                stages = latest_request_stages(supabase, [row.get("member_request_id") for row in rows
                                                          if row.get("member_request_id")])
                for row in rows:
                    row["desk_stage"] = desk_stage(row, stages.get(str(row.get("member_request_id") or "")))
            if not admin and scope == "available" and view != "archive":
                now = datetime.now().astimezone()
                rows = [row for row in rows if row.get("assigned_worker_id") in (None, staff["user_id"])
                    or (row.get("claimed_until") and datetime.fromisoformat(row["claimed_until"].replace("Z", "+00:00")) <= now)]
            return {"work_items": attach_handoff_conversations(rows[:200]), "scope": scope, "view": view,
                    "has_more": view == "archive" and len(rows) > 200}
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

    def ensure_admin_worker(admin_id: str) -> None:
        """An administrator who claims work gets a worker profile with every department (once), so the same
        claim-first rule and the same worker tools apply. They don't have to clock in."""
        found = (supabase.table("fayfort_workers").select("user_id,status").eq("user_id", admin_id).maybe_single().execute())
        row = found.data if found is not None else None
        now = datetime.now(timezone.utc).isoformat()
        if row and row.get("status") == "inactive":
            raise HTTPException(status_code=409, detail="Your worker profile is deactivated. Reactivate it in FayFort Workers to claim work.")
        if not row:
            supabase.table("fayfort_workers").insert({
                "user_id": admin_id, "status": "active", "provisioned_by": admin_id, "invite_kind": "existing_account",
                "activated_at": now, "invitation_sent_at": now, "job_title": "Administrator"}).execute()
        elif row.get("status") != "active":
            supabase.table("fayfort_workers").update({"status": "active", "activated_at": now, "updated_at": now,
                                                      "invite_token_hash": None, "invite_expires_at": None}) \
                .eq("user_id", admin_id).execute()
        have = {r["department"] for r in (supabase.table("operations_worker_departments").select("department")
                                          .eq("worker_id", admin_id).execute().data or [])}
        if set(DEPARTMENTS) - have:
            supabase.rpc("set_operations_worker_departments", {"p_actor_id": admin_id, "p_worker_id": admin_id,
                                                               "p_departments": list(DEPARTMENTS)}).execute()

    def advance_to_sourcing(item: dict, staff: dict, eta_at: datetime | None) -> None:
        """Sharing options needs the request in Sourcing. Instead of an error, move it there (Under review →
        Sourcing), setting the delivery estimate first if it's missing (owner request 2026-10-26)."""
        request_id = str(item["member_request_id"])
        events = (supabase.table("member_request_events").select("stage,sequence_no").eq("request_id", request_id)
                  .order("sequence_no", desc=True).limit(1).execute().data or [])
        stage = events[0]["stage"] if events else "submitted"
        if stage not in ("submitted", "under_review"):
            return
        request = (supabase.table("member_purchase_requests").select("eta_at").eq("id", request_id).limit(1).execute().data or [{}])[0]
        if not request.get("eta_at"):
            if not eta_at:
                raise HTTPException(status_code=409, detail="Add the estimated delivery date: sharing options moves the request into Sourcing, which needs it.")
            due = eta_at if eta_at.tzinfo else eta_at.replace(tzinfo=timezone.utc)
            supabase.rpc("set_operations_work_due", {
                "p_work_item_id": str(item["id"]), "p_actor_id": staff["user_id"], "p_actor_type": "worker",
                "p_due_at": due.isoformat(), "p_reason": None}).execute()
        for next_stage in (["under_review", "sourcing"] if stage == "submitted" else ["sourcing"]):
            supabase.rpc("append_member_request_milestone", {
                "p_request_id": request_id, "p_worker_id": staff["user_id"], "p_stage": next_stage,
                "p_member_note": None, "p_details": {}}).execute()

    @router.post("/operations/work-items/{work_item_id}/claim")
    def claim_work_item(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") == "platform_admin":
            ensure_admin_worker(staff["user_id"])  # administrators claim like workers, without clocking in
        elif not worker_on_shift(staff["user_id"]):
            raise HTTPException(status_code=409, detail="Clock in first: work can only be claimed while you're on shift.")
        try:
            result = supabase.rpc("claim_operations_work_item", {
                "p_work_item_id": str(work_item_id), "p_worker_id": staff["user_id"],
            }).execute()
            item = result.data
            if isinstance(item, list):
                item = item[0] if item else None
            if not item:
                raise RuntimeError("Claim did not return the work item")
            meta = item.get("metadata") or {}
            if meta.get("source_kind") == "photo_review":
                # The photo review tools follow the claim, so the worker can open the photo and reply.
                supabase.table("member_chat_reviews").update({
                    "assigned_worker_id": staff["user_id"], "status": "assigned", "updated_at": datetime.now().astimezone().isoformat(),
                }).eq("id", str(meta.get("source_id"))).eq("status", "pending_assignment").execute()
                supabase.table("member_chat_reviews").update({"assigned_worker_id": staff["user_id"]}) \
                    .eq("id", str(meta.get("source_id"))).execute()
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
            # Administrators can open a dispute on finished work, which can't be claimed any more.
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
        if (item.get("metadata") or {}).get("source_kind"):
            try:
                return operations_flow.source_context(item)
            except Exception as exc:
                logger.exception("Could not load the work item's source")
                raise HTTPException(status_code=503, detail="This item's details could not be loaded.") from exc
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
                    .select("id,product_name_snapshot,request_title,request_description,source_type,source_url,created_at,updated_at,eta_at,eta_reason,eta_updated_at")
                    .eq("id", str(request_id)).maybe_single().execute())
                request = result.data if result is not None else None
                if not request:
                    raise HTTPException(status_code=404, detail="The linked member request is no longer available.")
                request["eta_changes"] = []
                if request.get("eta_updated_at"):
                    try:
                        request["eta_changes"] = (supabase.table("member_request_eta_changes")
                            .select("id,previous_eta_at,eta_at,reason,created_at")
                            .eq("request_id", str(request_id)).order("created_at").limit(50).execute().data or [])
                    except Exception:
                        logger.exception("Could not load delivery estimate history")
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
                # The screenshot the member sent with the request (private bucket, short-lived link).
                request["source_media"] = []
                try:
                    for media in (supabase.table("member_request_source_media")
                            .select("id,storage_path,content_type,byte_size,original_filename,created_at")
                            .eq("request_id", str(request_id)).order("created_at").execute().data or []):
                        signed = supabase.storage.from_("member-request-source-images").create_signed_url(media["storage_path"], 900)
                        signed_url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
                        if signed_url and signed_url.startswith("/"):
                            signed_url = urljoin(settings.SUPABASE_URL.rstrip("/") + "/", signed_url.lstrip("/"))
                        if signed_url:
                            request["source_media"].append({
                                "id": media["id"], "url": signed_url, "content_type": media["content_type"],
                                "byte_size": media["byte_size"], "original_filename": media["original_filename"],
                                "created_at": media["created_at"]})
                except Exception:
                    logger.exception("Could not sign a request screenshot")
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
                    .select("id,title,linked_request_id,retention_hold,staff_takeover_at,staff_takeover_by")
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

    # ---- Member app chats in the Control Center (Conversations → Member app) ------------------------------------
    CHAT_DEPARTMENTS = ("member_support", "conversation_intake")

    def member_chat_staff(authorization: str | None) -> dict:
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin" and not set(CHAT_DEPARTMENTS) & set(departments_for(staff["user_id"])):
            raise HTTPException(status_code=403, detail="Member support or conversation intake access is needed for member chats.")
        return staff

    @router.get("/operations/member-chats")
    def list_member_chats(q: str | None = Query(default=None, max_length=100), offset: int = Query(default=0, ge=0, le=5000),
                          authorization: str | None = Header(default=None)):
        member_chat_staff(authorization)
        try:
            query = (supabase.table("member_conversations")
                     .select("id,member_id,title,last_activity_at,created_at,linked_request_id,staff_takeover_at,archived_at"))
            if q and q.strip():
                query = query.ilike("title", f"%{q.strip().replace('%', '').replace('_', ' ')}%")
            chats = (query.order("last_activity_at", desc=True).range(offset, offset + 49).execute().data or [])
            ids = [str(c["id"]) for c in chats]
            member_ids = list({str(c["member_id"]) for c in chats})
            profiles = {str(p["user_id"]): p for p in (supabase.table("member_profiles").select("user_id,display_name,username")
                        .in_("user_id", member_ids).execute().data or [])} if member_ids else {}
            work = {}
            for row in (supabase.table("operations_work_items").select("id,member_conversation_id,status,assigned_worker_id")
                        .in_("member_conversation_id", ids).in_("status", ["open", "claimed", "waiting", "blocked"])
                        .execute().data or []) if ids else []:
                work[str(row["member_conversation_id"])] = row
            last: dict[str, dict] = {}
            for row in (supabase.table("member_messages").select("conversation_id,sender_type,content,created_at")
                        .in_("conversation_id", ids).order("created_at", desc=True).limit(len(ids) * 6 + 10).execute().data or []) if ids else []:
                last.setdefault(str(row["conversation_id"]), row)
            out = []
            for chat in chats:
                cid = str(chat["id"])
                if cid not in last:
                    continue  # empty chats
                profile = profiles.get(str(chat["member_id"])) or {}
                item = work.get(cid)
                out.append({
                    "id": cid, "title": chat.get("title") or "Chat", "last_activity_at": chat.get("last_activity_at"),
                    "member_name": profile.get("display_name") or (f"@{profile['username']}" if profile.get("username") else "Member"),
                    "last_message": {k: last[cid].get(k) for k in ("sender_type", "content", "created_at")},
                    "handled_by": "staff" if chat.get("staff_takeover_at") else ("waiting" if item else "ai"),
                    "work_item_id": str(item["id"]) if item else None, "linked_request_id": chat.get("linked_request_id"),
                })
            return {"chats": out, "has_more": len(chats) == 50}
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not list member chats")
            raise HTTPException(status_code=503, detail="Member chats could not be loaded.") from exc

    @router.get("/operations/member-chats/{conversation_id}")
    def read_member_chat(conversation_id: UUID, authorization: str | None = Header(default=None)):
        member_chat_staff(authorization)
        chat = (supabase.table("member_conversations").select("id,title,member_id,staff_takeover_at,linked_request_id")
                .eq("id", str(conversation_id)).limit(1).execute().data or [])
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found.")
        messages = (supabase.table("member_messages").select("id,sender_type,content,created_at")
                    .eq("conversation_id", str(conversation_id)).order("created_at").limit(300).execute().data or [])
        return {"chat": chat[0], "messages": messages}

    @router.post("/operations/member-chats/{conversation_id}/take-over")
    def take_over_from_member_chats(conversation_id: UUID, authorization: str | None = Header(default=None)):
        """Start (or join) staff support on a member chat, claim it and take it over from the AI. Returns the work item
        to open in the Operations Center, where the reply box is."""
        staff = member_chat_staff(authorization)
        chat = (supabase.table("member_conversations").select("id,member_id,linked_request_id")
                .eq("id", str(conversation_id)).limit(1).execute().data or [])
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found.")
        if chat[0].get("linked_request_id"):
            raise HTTPException(status_code=409, detail="This chat belongs to a sourcing request. Work it from that request.")
        if staff.get("role") == "platform_admin":
            ensure_admin_worker(staff["user_id"])
        elif not worker_on_shift(staff["user_id"]):
            raise HTTPException(status_code=409, detail="Clock in first: work can only be claimed while you're on shift.")
        try:
            work = supabase.rpc("request_member_conversation_support", {"p_member_id": str(chat[0]["member_id"]),
                                                                        "p_conversation_id": str(conversation_id)}).execute()
            item = work.data[0] if isinstance(work.data, list) and work.data else work.data
            if not isinstance(item, dict) or not item.get("id"):
                raise RuntimeError("No work item for the chat")
            if not (item.get("assigned_worker_id") == staff["user_id"] and item.get("status") == "claimed"):
                supabase.rpc("claim_operations_work_item", {"p_work_item_id": str(item["id"]), "p_worker_id": staff["user_id"]}).execute()
            from app.handoffs import window as handoff_window
            handoff_window.take_over_member_chat(str(conversation_id), staff["user_id"])
            return {"work_item_id": str(item["id"])}
        except Exception as exc:
            logger.exception("Could not take over a member chat from Conversations")
            raise HTTPException(status_code=409, detail="This chat couldn't be taken over. Someone else may have it.") from exc

    # ---- Batches: several members sourcing the same item, worked once ----------------------------------------
    CANDIDATE_COPY_FIELDS = ("product_name", "supplier_name", "product_url", "price_amount", "currency", "availability",
                             "evidence_note")

    def batch_items(batch_id: str) -> list[dict]:
        members = (supabase.table("operations_sourcing_batch_items").select("work_item_id,member_request_id")
                   .eq("batch_id", batch_id).execute().data or [])
        ids = [str(m["work_item_id"]) for m in members]
        if not ids:
            raise HTTPException(status_code=404, detail="Batch not found.")
        return (supabase.table("operations_work_items").select("*").in_("id", ids).execute().data or [])

    def copy_candidates(source: list[dict], target: dict, actor_id: str) -> dict[str, str]:
        """Copy research rows onto another request in the batch (skipping links it already has).
        Returns {source candidate id: target candidate id}."""
        existing = {row["product_url"]: str(row["id"]) for row in (supabase.table("operations_sourcing_candidates")
                    .select("id,product_url").eq("work_item_id", str(target["id"])).execute().data or [])}
        mapping: dict[str, str] = {}
        for candidate in source:
            if candidate["product_url"] in existing:
                mapping[str(candidate["id"])] = existing[candidate["product_url"]]
                continue
            made = (supabase.table("operations_sourcing_candidates").insert({
                **{key: candidate.get(key) for key in CANDIDATE_COPY_FIELDS},
                "work_item_id": str(target["id"]), "member_request_id": str(target["member_request_id"]),
                "created_by": actor_id}).execute().data or [])
            if made:
                mapping[str(candidate["id"])] = str(made[0]["id"])
                existing[candidate["product_url"]] = str(made[0]["id"])
        return mapping

    def source_candidates(item_id: str, candidate_ids: list[UUID]) -> list[dict]:
        query = (supabase.table("operations_sourcing_candidates").select("id," + ",".join(CANDIDATE_COPY_FIELDS))
                 .eq("work_item_id", item_id))
        if candidate_ids:
            query = query.in_("id", [str(value) for value in candidate_ids])
        return query.execute().data or []

    @router.post("/operations/sourcing/batches/{batch_id}/claim")
    def claim_batch(batch_id: UUID, authorization: str | None = Header(default=None)):
        """Claim every request in the batch that nobody else is working on, so one person can work the batch."""
        staff = staff_identity(authorization)
        if staff.get("role") == "platform_admin":
            ensure_admin_worker(staff["user_id"])
        elif not worker_on_shift(staff["user_id"]):
            raise HTTPException(status_code=409, detail="Clock in first: work can only be claimed while you're on shift.")
        claimed, skipped = [], []
        for item in batch_items(str(batch_id)):
            if item.get("assigned_worker_id") == staff["user_id"] and item.get("status") == "claimed":
                claimed.append(str(item["id"]))
                continue
            try:
                supabase.rpc("claim_operations_work_item", {"p_work_item_id": str(item["id"]), "p_worker_id": staff["user_id"]}).execute()
                claimed.append(str(item["id"]))
            except Exception:
                skipped.append({"work_item_id": str(item["id"]), "summary": item.get("summary"),
                                "reason": "Someone else has it, or it's waiting or finished."})
        return {"claimed": claimed, "skipped": skipped}

    @router.post("/operations/sourcing/batches/{batch_id}/copy-research")
    def copy_batch_research(batch_id: UUID, payload: BatchResearchCopy, authorization: str | None = Header(default=None)):
        """Research once: copy the suppliers found on one request to every other request in the batch you've claimed."""
        staff = staff_identity(authorization)
        items = batch_items(str(batch_id))
        source_item = next((i for i in items if str(i["id"]) == str(payload.from_work_item_id)), None)
        if not source_item:
            raise HTTPException(status_code=404, detail="That request isn't in this batch.")
        if source_item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this request before copying its research.")
        source = source_candidates(str(source_item["id"]), payload.candidate_ids)
        if not source:
            raise HTTPException(status_code=409, detail="Add research to this request first.")
        copied, skipped = [], []
        for item in items:
            if str(item["id"]) == str(source_item["id"]):
                continue
            if item.get("assigned_worker_id") != staff["user_id"] or item.get("status") in ("completed", "cancelled"):
                skipped.append({"work_item_id": str(item["id"]), "summary": item.get("summary"), "reason": "Not claimed by you"})
                continue
            copy_candidates(source, item, staff["user_id"])
            copied.append(str(item["id"]))
        return {"copied_to": copied, "skipped": skipped, "candidates": len(source)}

    @router.post("/operations/sourcing/batches/{batch_id}/share")
    def share_with_batch(batch_id: UUID, payload: BatchShare, authorization: str | None = Header(default=None)):
        """Share the same options with every request in the batch you've claimed (research is copied as needed)."""
        staff = staff_identity(authorization)
        items = batch_items(str(batch_id))
        source_item = next((i for i in items if str(i["id"]) == str(payload.from_work_item_id)), None)
        if not source_item or source_item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this request before sharing for the batch.")
        source = source_candidates(str(source_item["id"]), payload.candidate_ids)
        if len(source) != len(payload.candidate_ids):
            raise HTTPException(status_code=409, detail="One or more options aren't on this request.")
        results = []
        for item in items:
            if item.get("status") in ("completed", "cancelled"):
                continue
            entry = {"work_item_id": str(item["id"]), "summary": item.get("summary")}
            if item.get("assigned_worker_id") != staff["user_id"]:
                results.append({**entry, "shared": False, "reason": "Not claimed by you"})
                continue
            try:
                mapping = ({str(c["id"]): str(c["id"]) for c in source} if str(item["id"]) == str(source_item["id"])
                           else copy_candidates(source, item, staff["user_id"]))
                advance_to_sourcing(item, staff, payload.eta_at)
                supabase.rpc("share_operations_sourcing_options", {
                    "p_request_id": item["member_request_id"], "p_work_item_id": str(item["id"]),
                    "p_candidate_ids": [mapping[str(c["id"])] for c in source],
                    "p_actor_id": staff["user_id"], "p_member_note": payload.member_note}).execute()
                results.append({**entry, "shared": True})
            except HTTPException as exc:
                results.append({**entry, "shared": False, "reason": exc.detail})
            except Exception:
                logger.exception("Could not share batch options with a request")
                results.append({**entry, "shared": False, "reason": "Couldn't be shared. Open it and try there."})
        return {"results": results}

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
        if item.get("assigned_worker_id") != staff["user_id"]:
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
        if item.get("assigned_worker_id") != staff["user_id"]:
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
        if item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this sourcing request before sharing options.")
        try:
            advance_to_sourcing(item, staff, payload.eta_at)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Could not move the request into Sourcing before sharing")
            raise HTTPException(status_code=409, detail="The request couldn't be moved into Sourcing. Refresh and try again.") from exc
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
        if item.get("assigned_worker_id") != staff["user_id"]:
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
            # Replying takes the chat over from the AI (it stays quiet until handed back or the idle window ends).
            try:
                from app.handoffs import window as handoff_window
                handoff_window.take_over_member_chat(str(item["member_conversation_id"]), staff["user_id"], announce=False)
            except Exception:
                logger.exception("Could not mark the member chat as taken over")
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

    @router.post("/operations/work-items/{work_item_id}/take-over")
    def take_over_member_chat(work_item_id: UUID, authorization: str | None = Header(default=None)):
        """The AI stops answering this member chat until a person hands it back (or goes quiet for the idle window)."""
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if not item.get("member_conversation_id"):
            raise HTTPException(status_code=409, detail="This work item has no member chat.")
        if item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this conversation before taking it over.")
        from app.handoffs import window as handoff_window
        try:
            started = handoff_window.take_over_member_chat(str(item["member_conversation_id"]), staff["user_id"])
        except Exception as exc:
            logger.exception("Could not take over a member chat")
            raise HTTPException(status_code=503, detail="The chat could not be taken over. Try again.") from exc
        if started:
            operations_flow.add_event(item, "status_changed", "Took the chat over from the AI.", **by(staff))
        return {"taken_over": True, "idle_minutes": settings.HANDOFF_IDLE_MINUTES}

    @router.post("/operations/work-items/{work_item_id}/hand-back")
    def hand_member_chat_back(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if not item.get("member_conversation_id"):
            raise HTTPException(status_code=409, detail="This work item has no member chat.")
        if item.get("assigned_worker_id") != staff["user_id"]:
            raise HTTPException(status_code=403, detail="Claim this conversation before handing it back.")
        from app.handoffs import window as handoff_window
        handoff_window.release_member_takeover(str(item["member_conversation_id"]))
        operations_flow.add_event(item, "status_changed", "Handed the chat back to the AI.", **by(staff))
        return {"taken_over": False}

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

    # ---- Operations flow: archive, payments, group buys, giveaways (docs/OPERATIONS_CENTER_PLAN.md) ----
    def require_owner(item: dict, staff: dict) -> None:
        # One rule for everyone (owner decision 2026-10-26): administrators claim before doing the work too.
        if item.get("assigned_worker_id") != staff["user_id"] or item.get("status") not in ("claimed", "waiting"):
            raise HTTPException(status_code=403, detail="Claim this work item first.")

    def by(staff: dict) -> dict:
        """History entries for staff actions name the person who did them."""
        return {"actor_user_id": staff.get("user_id"),
                "actor_type": "platform_admin" if staff.get("role") == "platform_admin" else "worker"}

    def flow_failure(exc: Exception, default: str) -> HTTPException:
        from app.commerce import shopify
        if isinstance(exc, HTTPException):
            return exc
        if isinstance(exc, LookupError):
            return HTTPException(status_code=404, detail=str(exc))
        if isinstance(exc, ValueError):
            return HTTPException(status_code=409, detail=str(exc))
        if isinstance(exc, shopify.ShopifyError):
            return HTTPException(status_code=502, detail="Shopify didn't accept the invoice. Check the shop connection and try again.")
        if "duplicate" in str(exc).casefold() or "unique" in str(exc).casefold():
            return HTTPException(status_code=409, detail="That invoice was already sent.")
        logger.exception(default)
        return HTTPException(status_code=503, detail=default)

    @router.post("/operations/work-items/{work_item_id}/reopen")
    def reopen_work_item(work_item_id: UUID, payload: WorkReopen, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        if staff.get("role") != "platform_admin":
            raise HTTPException(status_code=403, detail="Only a platform administrator can reopen archived work.")
        item = load_accessible_item(work_item_id, staff)
        if item.get("status") not in ("completed", "cancelled"):
            raise HTTPException(status_code=409, detail="Only finished work can be reopened.")
        values = {"status": "open", "completed_at": None, "assigned_worker_id": None, "claimed_until": None,
                  "waiting_on": None, "waiting_reason": None, "next_action": f"Reopened: {payload.reason}"[:500],
                  "version": int(item.get("version") or 1) + 1, "updated_at": datetime.now().astimezone().isoformat()}
        supabase.table("operations_work_items").update(values).eq("id", str(work_item_id)).execute()
        operations_flow.add_event(item, "reopened", f"Reopened by an administrator: {payload.reason}", next_status="open", **by(staff))
        return {"work_item": {**item, **values}}

    @router.get("/operations/work-items/{work_item_id}/payments")
    def work_item_payments(work_item_id: UUID, authorization: str | None = Header(default=None)):
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        if not item.get("member_request_id"):
            return {"invoices": [], "selected_option": None, "deposit_terms": None, "expected_total": None,
                    "expected_currency": "USD", "suggested_deposit": None}
        try:
            return operations_flow.request_payments(str(item["member_request_id"]))
        except Exception as exc:
            raise flow_failure(exc, "Payments for this request could not be loaded.") from exc

    @router.post("/operations/work-items/{work_item_id}/due")
    def set_work_deadline(work_item_id: UUID, payload: WorkDeadline, authorization: str | None = Header(default=None)):
        """Set a delivery estimate (member requests) or change any deadline. Changing one needs a reason."""
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        due_at = payload.due_at if payload.due_at.tzinfo else payload.due_at.replace(tzinfo=timezone.utc)
        try:
            result = supabase.rpc("set_operations_work_due", {
                "p_work_item_id": str(work_item_id), "p_actor_id": staff["user_id"],
                "p_actor_type": "platform_admin" if staff.get("role") == "platform_admin" else "worker",
                "p_due_at": due_at.isoformat(), "p_reason": payload.reason,
            }).execute()
            updated = result.data
            if isinstance(updated, list):
                updated = updated[0] if updated else None
            return {"work_item": updated}
        except Exception as exc:
            message = str(exc).casefold()
            if "reason is required" in message:
                raise HTTPException(status_code=422, detail="Say why the date is changing. The member sees this reason for a delivery estimate.") from exc
            if "in the future" in message:
                raise HTTPException(status_code=422, detail="Pick a date and time in the future.") from exc
            if "too far" in message:
                raise HTTPException(status_code=422, detail="Pick a date within the next year.") from exc
            if "finished" in message:
                raise HTTPException(status_code=409, detail="This work is finished. Reopen it first.") from exc
            logger.exception("Could not set the work deadline")
            raise HTTPException(status_code=503, detail="The date could not be saved. Try again.") from exc

    @router.post("/operations/work-items/{work_item_id}/invoices/{invoice_id}/withdraw")
    def withdraw_work_invoice(work_item_id: UUID, invoice_id: UUID, payload: InvoiceWithdraw,
                              authorization: str | None = Header(default=None)):
        """Withdraw an unpaid deposit or invoice on this request: its Shopify link stops working and the member is told."""
        from app.commerce import withdraw
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        invoice = (supabase.table("commerce_invoices").select("id,request_id").eq("id", str(invoice_id)).limit(1).execute().data or [None])[0]
        if not invoice or not item.get("member_request_id") or str(invoice.get("request_id")) != str(item["member_request_id"]):
            raise HTTPException(status_code=404, detail="Invoice not found on this request.")
        try:
            done = withdraw.withdraw(str(invoice_id), actor_id=staff["user_id"], reason=payload.reason)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Could not withdraw an invoice")
            raise HTTPException(status_code=503, detail="The invoice could not be withdrawn. Try again.") from exc
        return {"invoice": {"id": done["id"], "status": "cancelled"}}

    @router.post("/operations/work-items/{work_item_id}/deposit-invoice", status_code=201)
    def send_work_deposit(work_item_id: UUID, payload: WorkDepositInvoice, authorization: str | None = Header(default=None)):
        from app.commerce import service as commerce
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        if not item.get("member_request_id"):
            raise HTTPException(status_code=409, detail="Deposits belong to sourcing requests.")
        try:
            invoice = commerce.send_deposit_invoice(str(item["member_request_id"]), payload.expected_total,
                                                    payload.currency, staff["user_id"])
        except Exception as exc:
            raise flow_failure(exc, "The deposit invoice could not be sent.") from exc
        operations_flow.add_event(item, "status_changed", f"Deposit invoice sent ({invoice.get('amount')} {payload.currency}).", **by(staff))
        return {"invoice": {key: value for key, value in invoice.items() if key != "quote"}}

    @router.post("/operations/work-items/{work_item_id}/invoice", status_code=201)
    def send_work_invoice(work_item_id: UUID, authorization: str | None = Header(default=None)):
        from app.commerce import service as commerce
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        if not item.get("member_request_id"):
            raise HTTPException(status_code=409, detail="Invoices from here belong to sourcing requests.")
        try:
            invoice = commerce.send_request_invoice(str(item["member_request_id"]), staff["user_id"])
        except Exception as exc:
            raise flow_failure(exc, "The invoice could not be sent.") from exc
        operations_flow.add_event(item, "status_changed", f"Invoice sent ({invoice.get('amount')} {invoice.get('currency')}).", **by(staff))
        return {"invoice": invoice}

    @router.post("/operations/work-items/{work_item_id}/group-invoices")
    def send_group_invoices(work_item_id: UUID, authorization: str | None = Header(default=None)):
        from app.commerce import service as commerce
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        meta = item.get("metadata") or {}
        if meta.get("source_kind") != "trend_pool":
            raise HTTPException(status_code=409, detail="This isn't a group buy.")
        try:
            result = commerce.send_pool_invoices(str(meta["source_id"]), staff["user_id"])
        except Exception as exc:
            raise flow_failure(exc, "The group invoices could not be sent.") from exc
        operations_flow.add_event(item, "status_changed", f"Group invoices sent: {result['sent']} sent, "
                                  f"{len(result['failed'])} failed, {result['skipped']} already invoiced.", **by(staff))
        return result

    @router.post("/operations/work-items/{work_item_id}/member-message", status_code=201)
    def message_member(work_item_id: UUID, payload: WorkMemberMessage, authorization: str | None = Header(default=None)):
        """For work with no chat of its own (prize, failed payment, failed invoice): write in the member's chat."""
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        if item.get("member_conversation_id") or item.get("member_request_id"):
            raise HTTPException(status_code=409, detail="Reply in this work item's own chat.")
        try:
            return operations_flow.send_member_message(item, staff["user_id"], by(staff)["actor_type"], payload.content)
        except Exception as exc:
            raise flow_failure(exc, "The message could not be sent.") from exc

    @router.post("/operations/work-items/{work_item_id}/group-price")
    def set_group_price(work_item_id: UUID, payload: WorkGroupPrice, authorization: str | None = Header(default=None)):
        """The price each buyer pays, agreed with the supplier for the whole group."""
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        meta = item.get("metadata") or {}
        if meta.get("source_kind") != "trend_pool":
            raise HTTPException(status_code=409, detail="This isn't a group buy.")
        try:
            supabase.table("commerce_trend_items").update({"pool_price": round(payload.price, 2),
                                                           "pool_currency": payload.currency}) \
                .eq("id", str(meta["source_id"])).execute()
        except Exception as exc:
            raise flow_failure(exc, "The group price could not be saved.") from exc
        operations_flow.add_event(item, "status_changed", f"Group price set to {payload.price:.2f} {payload.currency}.", **by(staff))
        return {"price": round(payload.price, 2), "currency": payload.currency}

    @router.post("/operations/work-items/{work_item_id}/giveaway-draw")
    def draw_work_giveaway(work_item_id: UUID, authorization: str | None = Header(default=None)):
        from app.commerce import service as commerce
        staff = staff_identity(authorization)
        item = load_accessible_item(work_item_id, staff)
        require_owner(item, staff)
        meta = item.get("metadata") or {}
        if meta.get("source_kind") != "giveaway":
            raise HTTPException(status_code=409, detail="This isn't a giveaway draw.")
        try:
            return commerce.draw_giveaway(str(meta["source_id"]), staff["user_id"])
        except Exception as exc:
            raise flow_failure(exc, "The giveaway could not be drawn.") from exc

    return router
