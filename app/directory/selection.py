from __future__ import annotations

import re


def _has(text: str, terms: tuple[str, ...]) -> bool:
    """Whole words only: "eat" must not match "great" and "source" must not match "resource"."""
    return any(re.search(rf"\b{re.escape(term)}", text) for term in terms)


def select_directory_tool(message: str, intent: str) -> str | None:
    """Choose a tool with deterministic rules; message text never grants access.

    "How does it work / walk me through" questions never go to the directory: they get the whole process from the
    business knowledge instead (app/services/process_guide.py)."""
    from app.services.process_guide import asks_for_process

    text = (message or "").casefold()
    if asks_for_process(text):
        return None
    intent = str(intent or "").casefold()
    if _has(text, ("restaurant", "food", "eat", "halal", "cuisine")):
        return "restaurant_search"
    if _has(text, ("hotel", "accommodation", "where should i stay", "takes foreigners", "place to stay")):
        return "hotel_search"
    if _has(text, ("freight", "forwarder", "cargo", "consolidator", "ship to", "shipping")) or intent in {"shipping", "shipping_quote"}:
        return "service_provider_search"
    if _has(text, ("which city", "city known for", "area guide", "province")):
        return "city_area_guide_search"
    if intent in {"product_sourcing", "supplier_search", "product_pricing", "quotation"} or _has(text, ("market", "supplier", "source", "where can i buy")):
        return "category_market_search"
    return None


def requests_premium_data(message: str, premium_terms: tuple[str, ...]) -> bool:
    text = (message or "").casefold()
    return any(term in text for term in premium_terms)
