from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from typing import Any
from urllib.parse import quote

import requests

from app.config.settings import settings
from app.database.client import supabase

logger = logging.getLogger(__name__)
MICRO_USD_PER_USD = 1_000_000
TOKENS_PER_MILLION = 1_000_000


class AIBudgetError(RuntimeError):
    """Base error for a fail-closed AI budget decision."""


class AIBudgetExceeded(AIBudgetError):
    """The reservation would exceed the business's current monthly ceiling."""


class AIBudgetUnavailable(AIBudgetError):
    """Pricing or budget reservation could not be verified safely."""


@dataclass(frozen=True)
class AIBudgetReservation:
    request_id: str
    business_id: str
    operation: str
    model: str
    provider: str
    input_price_micro_usd_per_million: int
    output_price_micro_usd_per_million: int
    max_input_tokens: int
    max_output_tokens: int
    reserved_micro_usd: int


def _micro_usd_per_million(price: Any) -> int:
    if isinstance(price, bool) or not isinstance(price, (int, float, str)):
        raise AIBudgetUnavailable("Provider pricing is missing or invalid")
    try:
        amount = Decimal(str(price))
    except Exception as exc:
        raise AIBudgetUnavailable("Provider pricing is missing or invalid") from exc
    if not amount.is_finite() or amount < 0:
        raise AIBudgetUnavailable("Provider pricing is missing or invalid")
    # Provider JSON may represent decimal rates as floats (for example
    # 0.030000000000000002). Remove binary-float noise before converting to
    # integer micro-USD per million tokens; retain sub-nanodollar precision.
    amount = amount.quantize(Decimal("0.000000001"), rounding=ROUND_HALF_UP)
    return int((amount * MICRO_USD_PER_USD).to_integral_value(rounding=ROUND_CEILING))


def _configured_model_route() -> tuple[str, str]:
    model, separator, provider = settings.HF_MODEL.rpartition(":")
    if not separator or not model or provider in {"fastest", "cheapest", "preferred"}:
        raise AIBudgetUnavailable("AI budget requires a pinned model and provider route")
    return model, provider


def fetch_pinned_provider_prices() -> tuple[int, int]:
    """Read the provider's live advertised rates and fail if they exceed the approved ceiling."""
    model, provider = _configured_model_route()
    endpoint = settings.HF_CHAT_COMPLETIONS_URL.rsplit("/chat/completions", 1)[0]
    if endpoint == settings.HF_CHAT_COMPLETIONS_URL:
        raise AIBudgetUnavailable("AI pricing endpoint cannot be derived from the configured chat endpoint")
    url = f"{endpoint}/models/{quote(model, safe='/')}"
    try:
        response = requests.get(
            url,
            headers={"Authorization": f"Bearer {settings.HF_TOKEN}"},
            timeout=8,
        )
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise AIBudgetUnavailable("Provider pricing could not be verified") from exc

    model_info = body.get("data", body) if isinstance(body, dict) else None
    providers = model_info.get("providers") if isinstance(model_info, dict) else None
    matched = next((item for item in providers or [] if isinstance(item, dict) and item.get("provider") == provider and item.get("status") == "live"), None)
    pricing = matched.get("pricing") if matched else None
    if not isinstance(pricing, dict) or "input" not in pricing or "output" not in pricing:
        raise AIBudgetUnavailable("Pinned provider has no complete live token pricing")
    input_price = _micro_usd_per_million(pricing["input"])
    output_price = _micro_usd_per_million(pricing["output"])
    input_ceiling = _micro_usd_per_million(settings.AI_MODEL_INPUT_PRICE_USD_PER_MILLION)
    output_ceiling = _micro_usd_per_million(settings.AI_MODEL_OUTPUT_PRICE_USD_PER_MILLION)
    if input_price > input_ceiling or output_price > output_ceiling:
        raise AIBudgetUnavailable("Pinned provider price is above the configured safe price ceiling")
    # Enforce the approved cap above, but reserve and settle at the provider's
    # current advertised rates so usage reports reflect model-specific costs.
    return input_price, output_price


def _calculate_cost_micro_usd(tokens: int, rate_micro_usd_per_million: int) -> int:
    if tokens <= 0 or rate_micro_usd_per_million <= 0:
        return 0
    return (tokens * rate_micro_usd_per_million + TOKENS_PER_MILLION - 1) // TOKENS_PER_MILLION


def estimate_input_token_upper_bound(messages: list[dict[str, Any]]) -> int:
    serialized = json.dumps(messages, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(serialized) > settings.AI_MAX_INPUT_BYTES:
        raise AIBudgetUnavailable("AI input exceeds the configured byte limit")
    # UTF-8 bytes bound byte-level tokenization; include conservative per-message framing overhead.
    return len(serialized) + 16 * len(messages) + 16


def reserve_ai_usage_budget(
    *,
    business_id: str | None,
    operation: str,
    messages: list[dict[str, Any]],
    max_output_tokens: int,
) -> AIBudgetReservation:
    if not business_id:
        raise AIBudgetUnavailable("AI inference requires an owning business for budget enforcement")
    if operation not in {"intent", "response", "summary"} or max_output_tokens < 0:
        raise AIBudgetUnavailable("AI budget request is invalid")
    model, provider = _configured_model_route()
    input_price, output_price = fetch_pinned_provider_prices()
    max_input_tokens = estimate_input_token_upper_bound(messages)
    reserve = (
        _calculate_cost_micro_usd(max_input_tokens, input_price)
        + _calculate_cost_micro_usd(max_output_tokens, output_price)
    )
    request_id = str(uuid.uuid4())
    try:
        result = supabase.rpc("reserve_ai_usage_budget", {
            "p_request_id": request_id,
            "p_business_id": business_id,
            "p_operation": operation,
            "p_model": model,
            "p_provider": provider,
            "p_input_price_micro_usd_per_million": input_price,
            "p_output_price_micro_usd_per_million": output_price,
            "p_max_input_tokens": max_input_tokens,
            "p_max_output_tokens": max_output_tokens,
            "p_reserved_micro_usd": reserve,
        }).execute().data
    except Exception as exc:
        logger.error("AI budget reservation failed closed: operation=%s error=%s", operation, type(exc).__name__)
        raise AIBudgetUnavailable("AI budget reservation is unavailable") from exc

    if isinstance(result, list):
        result = result[0] if result else None
    if not isinstance(result, dict):
        raise AIBudgetUnavailable("AI budget reservation returned an invalid result")
    if result.get("allowed") is not True:
        raise AIBudgetExceeded("The business monthly AI budget has been reached")
    return AIBudgetReservation(
        request_id=request_id,
        business_id=business_id,
        operation=operation,
        model=model,
        provider=provider,
        input_price_micro_usd_per_million=input_price,
        output_price_micro_usd_per_million=output_price,
        max_input_tokens=max_input_tokens,
        max_output_tokens=max_output_tokens,
        reserved_micro_usd=reserve,
    )


def cost_from_provider_usage(reservation: AIBudgetReservation, usage: dict[str, int | None]) -> int | None:
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens")
    if type(prompt) is not int or type(completion) is not int:
        return None
    return (
        _calculate_cost_micro_usd(prompt, reservation.input_price_micro_usd_per_million)
        + _calculate_cost_micro_usd(completion, reservation.output_price_micro_usd_per_million)
    )


def settle_ai_usage_budget(
    reservation: AIBudgetReservation,
    actual_micro_usd: int | None,
    *,
    release: bool = False,
) -> None:
    status = "released" if release else ("settled" if actual_micro_usd is not None else "uncertain")
    if release and actual_micro_usd is not None:
        raise ValueError("A released AI budget reservation cannot have an actual cost")
    try:
        supabase.rpc("settle_ai_usage_budget", {
            "p_request_id": reservation.request_id,
            "p_actual_micro_usd": actual_micro_usd,
            "p_reservation_status": status,
        }).execute()
    except Exception as exc:
        # Keep the full reservation charged if settlement storage is unavailable.
        logger.error("AI budget settlement failed; reservation remains held: operation=%s error=%s", reservation.operation, type(exc).__name__)
