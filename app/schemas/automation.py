from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

TriggerType = Literal["manual_test", "conversation_inbound"]
ActionType = Literal["record_test_run"]
ALLOWED_CONDITION_KEYS = {"intent", "channel", "language"}

class AutomationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    trigger_type: TriggerType
    action_type: ActionType = "record_test_run"
    conditions: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value

    @field_validator("conditions")
    @classmethod
    def validate_conditions(cls, values: dict[str, Any]) -> dict[str, Any]:
        unexpected = set(values) - ALLOWED_CONDITION_KEYS
        if unexpected:
            raise ValueError(f"unsupported condition keys: {', '.join(sorted(unexpected))}")
        if len(values) > 16 or any(not isinstance(v, (str, bool, int, float, type(None))) for v in values.values()):
            raise ValueError("conditions must contain only simple supported values")
        return values

class AutomationEnable(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool

class AutomationRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=255)
    trigger_id: str | None = Field(default=None, max_length=255)
    conversation_id: str | None = Field(default=None, max_length=64)