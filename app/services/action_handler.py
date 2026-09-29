from __future__ import annotations

from app.schemas.intent import ActionDecision, IntentName, IntentResult, NextAction


_LOW_CONFIDENCE_THRESHOLD = 0.55


def prepare_action(intent: IntentResult) -> ActionDecision:
    """Turn intent analysis into response guidance without doing side effects."""
    explicitly_human = (
        intent.intent == IntentName.HUMAN_HANDOFF
        or intent.action in {NextAction.HANDOFF_TO_AGENT, NextAction.REQUEST_HUMAN_REVIEW}
    )
    needs_human = explicitly_human or (
        intent.action != NextAction.CLARIFY_INTENT
        and (not intent.can_handle_automatically or intent.confidence < _LOW_CONFIDENCE_THRESHOLD)
    )

    if intent.action in {
        NextAction.COLLECT_PRODUCT_REQUIREMENTS,
        NextAction.COLLECT_SHIPPING_DETAILS,
        NextAction.ASK_FOR_MISSING_INFORMATION,
        NextAction.UPDATE_REQUIREMENTS,
    }:
        guidance = (
            "Acknowledge the information already provided, then ask only for "
            "the listed missing details. Do not repeat questions the customer answered."
        )
    elif explicitly_human or needs_human:
        guidance = "Explain that a human team member should take over and preserve the conversation context."
    elif intent.action == NextAction.CLARIFY_INTENT:
        guidance = "Ask one concise question to clarify what the customer wants."
    else:
        guidance = "Answer the customer's request using conversation history and supplied business knowledge."

    return ActionDecision(
        action=intent.action,
        requirements_to_collect=intent.missing_information,
        needs_human=needs_human,
        response_guidance=guidance,
        should_execute=False,
    )
