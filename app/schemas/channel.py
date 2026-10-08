from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ManualInboundPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_id: UUID
    customer_external_id: str = Field(min_length=1, max_length=255)
    provider_event_id: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=10_000)

    @field_validator("customer_external_id", "provider_event_id")
    @classmethod
    def trim_identifiers(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("content")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message content must not be blank")
        return value


class NormalizedInboundEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    provider_event_id: str
    business_id: UUID
    customer_external_id: str
    content: str
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def normalize_manual_event(payload: ManualInboundPayload) -> NormalizedInboundEvent:
    return NormalizedInboundEvent(
        provider="manual_test",
        provider_event_id=payload.provider_event_id,
        business_id=payload.business_id,
        customer_external_id=payload.customer_external_id,
        content=payload.content,
    )