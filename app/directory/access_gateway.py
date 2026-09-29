from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.database.directory.access_events import create_access_event
from app.database.directory.entitlements import has_business_entitlement
from app.directory.contracts import DirectoryContext, DirectoryTool
from app.directory.registry import get_tool
from app.directory.selection import requests_premium_data
from app.schemas.directory import DirectoryOutcome, DirectoryToolResult, VerificationState


logger = logging.getLogger(__name__)


def lookup_directory(
    *,
    tool_id: str,
    query: str,
    context: DirectoryContext,
    entitlement_check: Callable[[str, str], bool] = has_business_entitlement,
    audit_writer: Callable[..., None] = create_access_event,
) -> DirectoryToolResult:
    """Authorize, retrieve, verify, project, and audit one directory lookup.

    This is deliberately fail-closed. The language model never calls the
    repository directly and only receives records returned by this function.
    """
    tool = get_tool(tool_id)
    if tool is None or not tool.active or tool.search is None:
        return DirectoryToolResult(
            tool_id=tool_id,
            outcome=DirectoryOutcome.DENIED,
            message="That directory capability is unavailable.",
        )

    needs_premium = requests_premium_data(query, tool.premium_terms)
    entitled = False
    if needs_premium:
        if not context.identity_verified:
            return _audit_and_result(
                tool, context, DirectoryOutcome.AUTH_REQUIRED,
                message="Sign-in or a trusted account check is required before returning those directory details.",
                reason_code="trusted_identity_missing",
                audit_writer=audit_writer,
            )
        try:
            entitled = entitlement_check(context.business_id, tool.entitlement_key or tool.tool_id)
        except Exception:
            logger.exception("Directory entitlement lookup failed for %s", tool.tool_id)
            return _audit_and_result(
                tool, context, DirectoryOutcome.HUMAN_REQUIRED,
                message="Access could not be confirmed, so no directory details were provided.",
                requires_human=True, reason_code="entitlement_check_failed",
                audit_writer=audit_writer,
            )
        if not entitled:
            return _audit_and_result(
                tool, context, DirectoryOutcome.UPGRADE_REQUIRED,
                message="Those curated directory details require an active FayFort entitlement.",
                reason_code="premium_entitlement_missing",
                audit_writer=audit_writer,
            )

    try:
        rows = tool.search(query) or []
    except Exception:
        logger.exception("Directory lookup failed for %s", tool.tool_id)
        return _audit_and_result(
            tool, context, DirectoryOutcome.HUMAN_REQUIRED,
            message="The directory could not be checked, so its information cannot be confirmed.",
            requires_human=True, reason_code="directory_lookup_failed",
            audit_writer=audit_writer,
        )

    if not rows:
        return _audit_and_result(
            tool, context, DirectoryOutcome.NOT_FOUND,
            message="No matching authorized directory record was found.",
            reason_code="no_match", audit_writer=audit_writer,
        )

    accepted: list[dict[str, Any]] = []
    accepted_states: list[VerificationState] = []
    rejected_states: list[VerificationState] = []
    returned_fields: set[str] = set()
    include_premium = entitled and needs_premium
    fields = (set(tool.public_fields) | (set(tool.premium_fields) if include_premium else set())) - set(tool.blocked_fields)
    for row in rows:
        state = _verification_state(row.get("verification_status"))
        if tool.requires_verified_record and state != VerificationState.VERIFIED:
            rejected_states.append(state)
            continue
        if needs_premium and state != VerificationState.VERIFIED:
            rejected_states.append(state)
            continue
        projected = {key: value for key, value in row.items() if key in fields and value is not None}
        if not tool.requires_verified_record and state != VerificationState.VERIFIED:
            # Unknown locations must not be represented as factual market
            # recommendations. The product taxonomy itself remains usable.
            projected = {
                key: value for key, value in projected.items()
                if key not in tool.premium_fields
                and key not in {"place_name", "city", "district"}
            }
            rejected_states.append(state)
        if projected:
            accepted.append(projected)
            accepted_states.append(state)
            returned_fields.update(projected)

    if not accepted:
        observed = _aggregate_verification(rejected_states)
        outcome = (
            DirectoryOutcome.HUMAN_REQUIRED
            if tool.human_on_unverified
            else DirectoryOutcome.VERIFY_REQUIRED
        )
        return _audit_and_result(
            tool, context, outcome,
            message="A matching record exists but needs verification before FayFort can recommend or disclose it.",
            requires_human=outcome == DirectoryOutcome.HUMAN_REQUIRED,
            verification_state=observed,
            reason_code="matching_record_needs_verification",
            audit_writer=audit_writer,
        )

    return _audit_and_result(
        tool, context, DirectoryOutcome.ALLOW,
        message="Use only the returned fields. Do not infer omitted details.",
        records=accepted[:10],
        # Describe the records actually returned. Rejected search matches are
        # useful for a human-review outcome, but must not make verified results
        # appear unverified in an ALLOW audit event.
        verification_state=_aggregate_verification(accepted_states[:10]),
        allowed_fields=sorted(returned_fields),
        reason_code="authorized_match",
        audit_writer=audit_writer,
    )


def disabled_directory_result(tool_id: str) -> DirectoryToolResult:
    return DirectoryToolResult(
        tool_id=tool_id,
        outcome=DirectoryOutcome.HUMAN_REQUIRED,
        message="FayFort directory access is not enabled yet. Do not provide directory claims; offer human follow-up.",
        requires_human=True,
    )


def _verification_state(value: Any) -> VerificationState:
    try:
        return VerificationState(str(value or "unknown").casefold())
    except ValueError:
        return VerificationState.UNKNOWN


def _aggregate_verification(states: list[VerificationState]) -> VerificationState | None:
    for state in (
        VerificationState.CONFLICTING,
        VerificationState.UNVERIFIED,
        VerificationState.UNKNOWN,
    ):
        if state in states:
            return state
    return VerificationState.VERIFIED if states else None


def _audit_and_result(
    tool: DirectoryTool,
    context: DirectoryContext,
    outcome: DirectoryOutcome,
    *,
    message: str,
    records: list[dict[str, Any]] | None = None,
    requires_human: bool = False,
    verification_state: VerificationState | None = None,
    allowed_fields: list[str] | None = None,
    reason_code: str,
    audit_writer: Callable[..., None],
) -> DirectoryToolResult:
    safe_records = records or []
    fields = allowed_fields or []
    try:
        audit_writer(
            business_id=context.business_id,
            conversation_id=context.conversation_id,
            customer_request_id=context.request_id,
            tool_id=tool.tool_id,
            outcome=outcome.value,
            verification_state=verification_state.value if verification_state else None,
            returned_fields=fields,
            reason_code=reason_code,
        )
    except Exception:
        logger.exception("Could not audit directory decision for %s", tool.tool_id)
        # Fail closed if an access decision cannot be recorded.
        return DirectoryToolResult(
            tool_id=tool.tool_id,
            outcome=DirectoryOutcome.HUMAN_REQUIRED,
            message="The directory decision could not be recorded, so no directory data was provided.",
            requires_human=True,
        )
    return DirectoryToolResult(
        tool_id=tool.tool_id,
        outcome=outcome,
        records=safe_records,
        message=message,
        requires_human=requires_human,
        verification_state=verification_state,
        allowed_fields=fields,
    )
