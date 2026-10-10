from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class HandoffCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="customer_requested", min_length=1, max_length=500)
    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        value = value.strip()
        if not value: raise ValueError("reason must not be blank")
        return value

class HandoffAssign(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: str = Field(min_length=1, max_length=64)

class HumanReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=10_000)
    @field_validator("content")
    @classmethod
    def reject_blank_content(cls, value: str) -> str:
        if not value.strip(): raise ValueError("message content must not be blank")
        return value

class HandoffAvailabilityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    availability: Literal["available", "away", "offline"]
    available_until: datetime | None = None
    max_active_handoffs: int = Field(default=3, ge=1, le=20)

    @model_validator(mode="after")
    def validate_shift(self):
        if self.availability == "available" and self.available_until is None:
            raise ValueError("available_until is required while available")
        if self.availability != "available" and self.available_until is not None:
            raise ValueError("available_until is only valid while available")
        return self
