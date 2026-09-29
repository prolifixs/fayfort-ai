from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DirectoryOutcome(StrEnum):
    ALLOW = "ALLOW"
    UPGRADE_REQUIRED = "UPGRADE_REQUIRED"
    AUTH_REQUIRED = "AUTH_REQUIRED"
    VERIFY_REQUIRED = "VERIFY_REQUIRED"
    HUMAN_REQUIRED = "HUMAN_REQUIRED"
    NOT_FOUND = "NOT_FOUND"
    DENIED = "DENIED"


class VerificationState(StrEnum):
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    UNKNOWN = "unknown"
    CONFLICTING = "conflicting"


class DirectoryToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: str
    outcome: DirectoryOutcome
    records: list[dict[str, Any]] = Field(default_factory=list)
    message: str
    requires_human: bool = False
    verification_state: VerificationState | None = None
    allowed_fields: list[str] = Field(default_factory=list)

    def prompt_context(self) -> str:
        """Serialize only the already-authorized projection for the responder."""
        return self.model_dump_json(exclude_none=True)
