from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_SAFE_SETTING_KEYS = {
    "auto_reply_enabled",
    "default_language",
    "inbound_enabled",
    "outbound_enabled",
    "timezone",
}


class ConnectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    display_name: str = Field(min_length=1, max_length=120)
    safe_settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("display_name")
    @classmethod
    def trim_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("display_name must not be blank")
        return value

    @field_validator("safe_settings")
    @classmethod
    def validate_safe_settings(cls, values: dict[str, Any]) -> dict[str, Any]:
        unexpected = set(values) - ALLOWED_SAFE_SETTING_KEYS
        if unexpected:
            raise ValueError(f"unsupported safe setting keys: {', '.join(sorted(unexpected))}")
        for key, value in values.items():
            if key.endswith("_enabled") and not isinstance(value, bool):
                raise ValueError(f"{key} must be a boolean")
            if key in {"default_language", "timezone"} and (
                not isinstance(value, str) or len(value) > 64
            ):
                raise ValueError(f"{key} must be a short string")
        return values


class ConnectionSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    safe_settings: dict[str, Any]

    @field_validator("safe_settings")
    @classmethod
    def validate_safe_settings(cls, values: dict[str, Any]) -> dict[str, Any]:
        unexpected = set(values) - ALLOWED_SAFE_SETTING_KEYS
        if unexpected:
            raise ValueError(f"unsupported safe setting keys: {', '.join(sorted(unexpected))}")
        for key, value in values.items():
            if key.endswith("_enabled") and not isinstance(value, bool):
                raise ValueError(f"{key} must be a boolean")
            if key in {"default_language", "timezone"} and (not isinstance(value, str) or len(value) > 64):
                raise ValueError(f"{key} must be a short string")
        if values.get("auto_reply_enabled") is True and values.get("outbound_enabled") is False:
            raise ValueError("Automatic replies require outbound delivery to be enabled")
        return values


class ConnectionRecord(BaseModel):
    id: UUID
    business_id: UUID
    provider: str
    display_name: str
    status: str
    credential_status: str
    safe_settings: dict[str, Any]
    created_at: str | None = None
    updated_at: str | None = None


class InstagramCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app_id: str = Field(min_length=1, max_length=256)
    app_secret: str = Field(min_length=1, max_length=2048)
    access_token: str = Field(min_length=1, max_length=8192)

    @field_validator("app_id", "app_secret", "access_token")
    @classmethod
    def trim_credential(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("credential must not be blank")
        return value


class MessengerCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app_id: str = Field(min_length=1, max_length=256)
    app_secret: str = Field(min_length=1, max_length=2048)
    page_id: str = Field(min_length=1, max_length=256)
    page_access_token: str = Field(min_length=1, max_length=8192)

    @field_validator("app_id", "app_secret", "page_id", "page_access_token")
    @classmethod
    def trim_credential(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("credential must not be blank")
        return value
