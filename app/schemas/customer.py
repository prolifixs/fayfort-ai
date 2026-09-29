from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.customer_request import CustomerRequestState


class CustomerProfile(BaseModel):
    """Customer facts explicitly supplied in conversation."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    company: str | None = None
    country: str | None = None
    email: str | None = None
    phone: str | None = None


class CustomerState(BaseModel):
    """Customer profile plus the request currently in focus, if any."""

    model_config = ConfigDict(extra="forbid")

    customer_id: str | None = None
    profile: CustomerProfile = Field(default_factory=CustomerProfile)
    request: CustomerRequestState | None = None
    request_relationship_unclear: bool = False
