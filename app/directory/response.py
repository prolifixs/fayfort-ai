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


def format_directory_response(result: DirectoryToolResult) -> str:
    """Render only gateway-approved fields; never ask the model to fill gaps."""
    if result.outcome != DirectoryOutcome.ALLOW or not result.records:
        return result.message

    heading = (
        "Verified directory information:"
        if result.verification_state is not None
        and result.verification_state.value == "verified"
        else "Directory information:"
    )
    lines = [heading]
    for index, record in enumerate(result.records, start=1):
        lines.extend(("", f"{index}.") )
        for field in result.allowed_fields:
            value = record.get(field)
            if value is None or value == "":
                continue
            label = FIELD_LABELS.get(field, field.replace("_", " ").capitalize())
            lines.append(f"- {label}: {value}")
    return "\n".join(lines)
