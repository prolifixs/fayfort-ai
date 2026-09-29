from __future__ import annotations

from typing import Any

from app.database.customer_requests import (
    create_customer_request,
    get_current_customer_request,
    update_customer_request,
)
from app.database.intents import get_active_intent, update_intent
from app.database.customers import (
    get_customer_by_identity,
    upsert_customer,
)
from app.schemas.customer import CustomerProfile, CustomerState
from app.schemas.customer_request import (
    CustomerRequestState,
    CustomerRequestStatus,
    RequestLifecycleUpdate,
    RequestRelationship,
)
from app.schemas.intent import ClassificationStatus, IntentName, IntentResult


_NON_REQUEST_INTENTS = {
    IntentName.GREETING,
    IntentName.GENERAL_INFORMATION,
    IntentName.HUMAN_HANDOFF,
    IntentName.UNKNOWN,
}
_PROFILE_FIELDS = set(CustomerProfile.model_fields)


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (dict, list)):
        return bool(value)
    return True


def _merge_fields(
    existing: dict[str, Any],
    incoming: dict[str, Any],
    cleared: list[str],
    allowed_fields: set[str] | None = None,
) -> dict[str, Any]:
    merged = dict(existing)
    for field in cleared:
        if allowed_fields is None or field in allowed_fields:
            merged.pop(field, None)
    for field, value in incoming.items():
        if (allowed_fields is None or field in allowed_fields) and _has_value(value):
            merged[field] = value
    return merged


def _unique_fields(*field_lists: list[str]) -> list[str]:
    return list(dict.fromkeys(
        field.strip()
        for fields in field_lists
        for field in fields
        if isinstance(field, str) and field.strip()
    ))


def _request_state(row: dict[str, Any] | None) -> CustomerRequestState | None:
    if row is None:
        return None
    return CustomerRequestState.model_validate({
        key: row.get(key)
        for key in CustomerRequestState.model_fields
    })


def _load_state(
    conversation: dict[str, Any],
    relationship_unclear: bool = False,
) -> CustomerState:
    customer = get_customer_by_identity(
        business_id=conversation["business_id"],
        channel=conversation["channel"],
        external_customer_id=conversation["customer_external_id"],
    )
    request = get_current_customer_request(conversation["id"])
    return CustomerState(
        customer_id=customer["id"] if customer else None,
        profile=CustomerProfile.model_validate(customer.get("profile") or {}) if customer else CustomerProfile(),
        request=_request_state(request),
        request_relationship_unclear=relationship_unclear,
    )


def update_customer_state(
    conversation: dict[str, Any],
    intent: IntentResult,
) -> CustomerState:
    """Apply one validated Layer 4 result to durable Layer 5 state.

    Provider and invalid-output fallbacks are read-only: they cannot create,
    close, or overwrite customer/request state.
    """
    if intent.classification_status in {
        ClassificationStatus.PROVIDER_ERROR,
        ClassificationStatus.INVALID_OUTPUT,
    }:
        return _load_state(conversation)

    existing_customer = get_customer_by_identity(
        business_id=conversation["business_id"],
        channel=conversation["channel"],
        external_customer_id=conversation["customer_external_id"],
    )
    prior_profile = (existing_customer or {}).get("profile") or {}
    profile = _merge_fields(
        existing=prior_profile,
        incoming=intent.customer_information,
        cleared=intent.cleared_customer_information,
        allowed_fields=_PROFILE_FIELDS,
    )
    customer = upsert_customer(
        business_id=conversation["business_id"],
        channel=conversation["channel"],
        external_customer_id=conversation["customer_external_id"],
        profile=profile,
    )

    current = get_current_customer_request(conversation["id"])
    if current is None:
        # Materialize an existing Layer 4 intent as the first request record
        # so conversations already in progress keep their accumulated facts.
        prior_intent = get_active_intent(conversation["id"])
        if (
            prior_intent
            and prior_intent.get("intent_key") not in {
                item.value for item in _NON_REQUEST_INTENTS
            }
        ):
            prior_details = prior_intent.get("entities") or {}
            prior_required = _unique_fields(
                prior_intent.get("required_information") or [],
                prior_intent.get("missing_information") or [],
            )
            prior_missing = [
                field for field in prior_required
                if not _has_value(prior_details.get(field))
            ]
            current = create_customer_request(
                customer_id=customer["id"],
                conversation_id=conversation["id"],
                request_type=prior_intent["intent_key"],
                details=prior_details,
                required_information=prior_required,
                missing_information=prior_missing,
                status=(
                    CustomerRequestStatus.AWAITING_CUSTOMER.value
                    if prior_missing else CustomerRequestStatus.ACTIVE.value
                ),
            )
            update_intent(
                prior_intent["id"],
                customer_id=customer["id"],
                customer_request_id=current["id"],
            )

    if intent.classification_status == ClassificationStatus.AMBIGUOUS:
        return CustomerState(
            customer_id=customer["id"],
            profile=CustomerProfile.model_validate(profile),
            request=_request_state(current),
        )

    if intent.request_lifecycle_update == RequestLifecycleUpdate.CANCEL:
        updated = (
            update_customer_request(
                current["id"], status=CustomerRequestStatus.CANCELLED.value
            )
            if current else None
        )
        return CustomerState(
            customer_id=customer["id"],
            profile=CustomerProfile.model_validate(profile),
            request=_request_state(updated or current),
        )

    if intent.intent in _NON_REQUEST_INTENTS:
        return CustomerState(
            customer_id=customer["id"],
            profile=CustomerProfile.model_validate(profile),
            request=_request_state(current),
        )

    relationship = intent.request_relationship
    if current and relationship == RequestRelationship.UNCLEAR:
        return CustomerState(
            customer_id=customer["id"],
            profile=CustomerProfile.model_validate(profile),
            request=_request_state(current),
            request_relationship_unclear=True,
        )

    if current and relationship == RequestRelationship.CONTINUE:
        details = _merge_fields(
            existing=current.get("details") or {},
            incoming=intent.known_information,
            cleared=intent.cleared_information,
        )
        required = _unique_fields(
            current.get("required_information") or [],
            intent.required_information,
            intent.missing_information,
        )
        missing = [field for field in required if not _has_value(details.get(field))]
        updated = update_customer_request(
            current["id"],
            request_type=str(intent.intent),
            details=details,
            required_information=required,
            missing_information=missing,
            status=(
                CustomerRequestStatus.AWAITING_CUSTOMER.value
                if missing else CustomerRequestStatus.ACTIVE.value
            ),
        )
        return CustomerState(
            customer_id=customer["id"],
            profile=CustomerProfile.model_validate(profile),
            request=_request_state(updated),
        )

    # A related request becomes a separate record linked to the current one;
    # an unrelated request starts a new record without erasing prior history.
    details = _merge_fields({}, intent.known_information, intent.cleared_information)
    required = _unique_fields(intent.required_information, intent.missing_information)
    missing = [field for field in required if not _has_value(details.get(field))]
    request = create_customer_request(
        customer_id=customer["id"],
        conversation_id=conversation["id"],
        request_type=str(intent.intent),
        details=details,
        required_information=required,
        missing_information=missing,
        related_request_id=(
            current["id"]
            if current and relationship == RequestRelationship.RELATED
            else None
        ),
        status=(
            CustomerRequestStatus.AWAITING_CUSTOMER.value
            if missing else CustomerRequestStatus.ACTIVE.value
        ),
    )
    return CustomerState(
        customer_id=customer["id"],
        profile=CustomerProfile.model_validate(profile),
        request=_request_state(request),
    )
