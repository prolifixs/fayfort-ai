from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.customer_request import RequestLifecycleUpdate, RequestRelationship


class ClassificationStatus(StrEnum):
    CLASSIFIED = "classified"
    AMBIGUOUS = "ambiguous"
    PROVIDER_ERROR = "provider_error"
    INVALID_OUTPUT = "invalid_output"


class IntentName(StrEnum):
    PRODUCT_SOURCING = "product_sourcing"
    PRODUCT_PRICING = "product_pricing"
    SUPPLIER_SEARCH = "supplier_search"
    SHIPPING = "shipping"
    SHIPPING_QUOTE = "shipping_quote"
    ORDER_STATUS = "order_status"
    QUOTATION = "quotation"
    PAYMENT = "payment"
    INVOICE = "invoice"
    BUSINESS_CONSULTATION = "business_consultation"
    CANTON_FAIR = "canton_fair"
    GENERAL_INFORMATION = "general_information"
    GREETING = "greeting"
    COMPLAINT = "complaint"
    FOLLOW_UP = "follow_up"
    HUMAN_HANDOFF = "human_handoff"
    UNKNOWN = "unknown"


class NextAction(StrEnum):
    ANSWER_QUESTION = "answer_question"
    COLLECT_PRODUCT_REQUIREMENTS = "collect_product_requirements"
    COLLECT_SHIPPING_DETAILS = "collect_shipping_details"
    ASK_FOR_MISSING_INFORMATION = "ask_for_missing_information"
    UPDATE_REQUIREMENTS = "update_requirements"
    SEARCH_KNOWLEDGE = "search_knowledge"
    PREPARE_SOURCING_REQUEST = "prepare_sourcing_request"
    REQUEST_HUMAN_REVIEW = "request_human_review"
    HANDOFF_TO_AGENT = "handoff_to_agent"
    CLARIFY_INTENT = "clarify_intent"


class IntentResult(BaseModel):
    """Validated intent analysis returned to the conversation pipeline."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    intent: IntentName
    language: str = "und"
    action: NextAction
    confidence: float = Field(ge=0.0, le=1.0)
    known_information: dict[str, Any] = Field(default_factory=dict)
    required_information: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    customer_information: dict[str, Any] = Field(default_factory=dict)
    cleared_information: list[str] = Field(default_factory=list)
    cleared_customer_information: list[str] = Field(default_factory=list)
    request_relationship: RequestRelationship = RequestRelationship.UNCLEAR
    request_lifecycle_update: RequestLifecycleUpdate = RequestLifecycleUpdate.NONE
    classification_status: ClassificationStatus = ClassificationStatus.CLASSIFIED
    clarification_needed: bool = False
    can_handle_automatically: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActionDecision(BaseModel):
    """A conversational next step; it never executes an external operation."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    action: NextAction
    requirements_to_collect: list[str] = Field(default_factory=list)
    needs_human: bool = False
    response_guidance: str
    should_execute: Literal[False] = False
