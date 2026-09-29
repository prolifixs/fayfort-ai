from __future__ import annotations


def select_directory_tool(message: str, intent: str) -> str | None:
    """Choose a tool with deterministic rules; message text never grants access."""
    text = (message or "").casefold()
    intent = str(intent or "").casefold()
    if any(term in text for term in ("restaurant", "food", "eat", "halal", "cuisine")):
        return "restaurant_search"
    if any(term in text for term in ("hotel", "accommodation", "where should i stay", "takes foreigners", "place to stay")):
        return "hotel_search"
    if any(term in text for term in ("freight", "forwarder", "cargo", "consolidator", "ship to", "shipping")) or intent in {"shipping", "shipping_quote"}:
        return "service_provider_search"
    if any(term in text for term in ("which city", "city known for", "area guide", "province")):
        return "city_area_guide_search"
    if intent in {"product_sourcing", "supplier_search", "product_pricing", "quotation"} or any(term in text for term in ("market", "supplier", "source", "where can i buy")):
        return "category_market_search"
    return None


def requests_premium_data(message: str, premium_terms: tuple[str, ...]) -> bool:
    text = (message or "").casefold()
    return any(term in text for term in premium_terms)
