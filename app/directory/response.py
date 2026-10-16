from __future__ import annotations

from app.schemas.directory import DirectoryOutcome, DirectoryToolResult


FIELD_LABELS = {
    "category": "Category",
    "group_name": "Group",
    "product_type": "Product type",
    "place_name": "Market",
    "city": "City",
    "district": "District",
    "address_en": "Address",
    "address_cn": "Address (Chinese)",
    "buyer_notes": "Buyer notes",
    "contact_name": "Contact",
    "phone_wechat": "Phone / WeChat",
    "floor_or_stall": "Floor or stall",
    "best_time": "Best time to find them",
    "service": "Service",
    "company": "Company",
    "company_cn": "Company (Chinese)",
    "other_numbers": "Other numbers",
    "email_qq": "Email / QQ",
    "ships_to": "Ships to",
    "booth": "Booth",
    "hours": "Hours",
    "area": "Area",
    "hotel_name": "Hotel",
    "name_cn": "Name (Chinese)",
    "address_or_nearest_metro": "Address or nearest metro",
    "takes_foreigners": "Takes foreign guests",
    "rough_price_per_night": "Approximate price per night",
    "tier": "Tier",
    "restaurant": "Restaurant",
    "where_it_is": "Location",
    "food_type": "Food type",
    "halal": "Halal",
    "opening_hours": "Opening hours",
    "province": "Province",
    "known_for": "Known for",
}


# The field that names a record, best first; the rest follow as short "label: value" details.
NAME_FIELDS = ("place_name", "company", "hotel_name", "restaurant", "service", "product_type", "category")


def format_directory_response(result: DirectoryToolResult) -> str:
    """Render only gateway-approved fields; never ask the model to fill gaps. One readable line per record."""
    if result.outcome != DirectoryOutcome.ALLOW or not result.records:
        return result.message

    verified = result.verification_state is not None and result.verification_state.value == "verified"
    lines = ["Here's what I found in the FayFort directory, dear" + (" (verified):" if verified else ":")]
    for record in result.records:
        shown = [field for field in result.allowed_fields if record.get(field) not in (None, "")]
        name_field = next((field for field in NAME_FIELDS if field in shown), shown[0] if shown else None)
        if name_field is None:
            continue
        details = [
            f"{FIELD_LABELS.get(field, field.replace('_', ' ').capitalize()).lower()} {record[field]}"
            if field not in ("category", "group_name", "city", "district", "province") else str(record[field])
            for field in shown if field != name_field
        ]
        lines.append(f"• {record[name_field]}" + (f" ({', '.join(details)})" if details else ""))
    lines.append("Would you like help with any of these?")
    return "\n".join(lines)
