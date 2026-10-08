from __future__ import annotations
from pydantic import BaseModel, ConfigDict, Field, field_validator

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