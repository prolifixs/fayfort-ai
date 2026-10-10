from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TriggerType = Literal["manual_test", "conversation_inbound", "scheduled_interval"]
ActionType = Literal["record_test_run", "send_approved_reply"]
ALLOWED_CONDITION_KEYS = {"intent", "channel", "language"}

class AutomationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    trigger_type: TriggerType
    action_type: ActionType = "record_test_run"
    conditions: dict[str, Any] = Field(default_factory=dict)
    response_text: str | None = Field(default=None, min_length=1, max_length=1000)
    schedule_interval_seconds: int | None = Field(default=None, ge=60, le=604800)

    @model_validator(mode="after")
    def validate_schedule(self) -> "AutomationCreate":
        scheduled = self.trigger_type == "scheduled_interval"
        if scheduled != (self.schedule_interval_seconds is not None):
            raise ValueError("scheduled_interval rules require an interval from 60 seconds to 7 days; other triggers must omit it")
        return self

    @model_validator(mode="after")
    def validate_action(self) -> "AutomationCreate":
        if self.action_type == "send_approved_reply":
            if self.trigger_type != "conversation_inbound":
                raise ValueError("approved replies are only valid for inbound conversation rules")
            if self.response_text is None or not self.response_text.strip():
                raise ValueError("approved replies require non-empty response_text")
            channel = self.conditions.get("channel")
            if channel is not None and channel.casefold() not in {"instagram", "messenger"}:
                raise ValueError("approved replies require a supported connected messaging channel")
            self.response_text = self.response_text.strip()
        elif self.response_text is not None:
            raise ValueError("response_text is only valid for approved reply rules")
        return self

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
        for key in ("channel", "intent", "language"):
            if key in values and (not isinstance(values[key], str) or not values[key].strip()):
                raise ValueError(f"{key} condition must be a non-empty string")
        return values

class AutomationEnable(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool

class AutomationRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=255)
    trigger_id: str | None = Field(default=None, max_length=255)
    conversation_id: str | None = Field(default=None, max_length=64)
