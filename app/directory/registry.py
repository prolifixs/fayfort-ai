from __future__ import annotations

from app.database.directory.categories import search_categories_and_markets
from app.database.directory.city_guides import search_city_guides
from app.database.directory.hotels import search_hotels
from app.database.directory.restaurants import search_restaurants
from app.database.directory.services import search_service_providers
from app.directory.contracts import DirectoryTool


TOOLS: tuple[DirectoryTool, ...] = (
    DirectoryTool(
        tool_id="category_market_search",
        family="supplier_market",
        description="Search the public product taxonomy and approved market summaries.",
        visibility="public_with_premium_fields",
        entitlement_key="category_market_search",
        required_context=("product_or_market_query",),
        verification_policy="taxonomy_public; location_premium_requires_verified_record",
        public_fields=("category", "group_name", "product_type", "place_name", "city", "district"),
        premium_fields=("address_en", "address_cn", "buyer_notes", "contact_name", "phone_wechat", "floor_or_stall", "best_time"),
        blocked_fields=("source", "source_workbook", "source_sheet", "source_row", "contact_verification_status"),
        premium_terms=("exact address", "full address", "street address", "address", "stall", "floor", "buyer notes", "contact", "phone", "wechat", "supplier name", "company name"),
        requires_verified_record=False,
        search=search_categories_and_markets,
    ),
    DirectoryTool(
        tool_id="service_provider_search",
        family="service_provider",
        description="Search FayFort service providers by service type and destination.",
        visibility="public_with_premium_fields",
        entitlement_key="service_provider_search",
        required_context=("service_type_or_destination",),
        verification_policy="verified_records_only",
        public_fields=("service", "city", "ships_to"),
        premium_fields=("company", "company_cn", "contact_name", "phone_wechat", "other_numbers", "email_qq", "address_en", "address_cn", "booth", "hours"),
        blocked_fields=("notes", "source", "source_workbook", "source_sheet", "source_row", "verification_status"),
        premium_terms=("contact", "person", "phone", "number", "wechat", "email", "qq", "exact address", "address", "booth", "company name", "provider name"),
        requires_verified_record=True,
        human_on_unverified=True,
        search=search_service_providers,
    ),
    DirectoryTool(
        tool_id="hotel_search",
        family="hotel",
        description="Search FayFort hotel records by area and guest requirements.",
        visibility="public_with_premium_fields",
        entitlement_key="hotel_search",
        required_context=("hotel_area_or_requirement",),
        verification_policy="verified_records_only",
        public_fields=("area", "hotel_name", "name_cn", "address_or_nearest_metro", "takes_foreigners", "tier"),
        premium_fields=("rough_price_per_night", "phone"),
        blocked_fields=("notes", "source", "source_workbook", "source_sheet", "source_row", "verification_status"),
        premium_terms=("phone", "internal note", "private recommendation", "negotiated", "price"),
        requires_verified_record=True,
        human_on_unverified=True,
        search=search_hotels,
    ),
    DirectoryTool(
        tool_id="restaurant_search",
        family="restaurant",
        description="Search FayFort restaurant records by area and food requirements.",
        visibility="public_with_premium_fields",
        entitlement_key="restaurant_search",
        required_context=("area_or_food_requirement",),
        verification_policy="verified_records_only",
        public_fields=("area", "restaurant", "name_cn", "where_it_is", "food_type", "halal", "opening_hours"),
        premium_fields=("phone",),
        blocked_fields=("notes", "source", "source_workbook", "source_sheet", "source_row", "verification_status"),
        premium_terms=("phone", "internal note", "private recommendation", "source"),
        requires_verified_record=True,
        human_on_unverified=True,
        search=search_restaurants,
    ),
    DirectoryTool(
        tool_id="city_area_guide_search",
        family="city_area_guide",
        description="Search approved FayFort city and area guidance.",
        visibility="public",
        entitlement_key=None,
        required_context=("city_or_area",),
        verification_policy="verified_records_only",
        public_fields=("city", "province", "known_for"),
        blocked_fields=("research_notes", "source_workbook", "source_sheet", "source_row", "verification_status"),
        premium_terms=(),
        requires_verified_record=True,
        human_on_unverified=True,
        search=search_city_guides,
    ),
)

REGISTRY = {tool.tool_id: tool for tool in TOOLS}


def get_tool(tool_id: str) -> DirectoryTool | None:
    return REGISTRY.get(tool_id)
