from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.schemas.directory import DirectoryToolResult


@dataclass(frozen=True)
class DirectoryTool:
    tool_id: str
    family: str
    description: str
    visibility: str
    entitlement_key: str | None
    required_context: tuple[str, ...]
    verification_policy: str
    public_fields: tuple[str, ...]
    premium_fields: tuple[str, ...] = ()
    blocked_fields: tuple[str, ...] = ()
    premium_terms: tuple[str, ...] = ()
    requires_verified_record: bool = True
    human_on_unverified: bool = False
    active: bool = True
    search: Callable[[str], list[dict]] | None = None


@dataclass(frozen=True)
class DirectoryContext:
    business_id: str
    conversation_id: str
    customer_id: str | None = None
    request_id: str | None = None
    identity_verified: bool = False


__all__ = ["DirectoryContext", "DirectoryTool", "DirectoryToolResult"]
