from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RequestRelationship(StrEnum):
    CONTINUE = "continue"
    RELATED = "related"
    NEW = "new"
    UNCLEAR = "unclear"


class RequestLifecycleUpdate(StrEnum):
    NONE = "none"
    CANCEL = "cancel"


class CustomerRequestStatus(StrEnum):
    ACTIVE = "active"
    AWAITING_CUSTOMER = "awaiting_customer"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    SUPERSEDED = "superseded"


class CustomerRequestState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    customer_id: str
    conversation_id: str
    related_request_id: str | None = None
    request_type: str
    status: CustomerRequestStatus
    details: dict[str, Any] = Field(default_factory=dict)
    required_information: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
