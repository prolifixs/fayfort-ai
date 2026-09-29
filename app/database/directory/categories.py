from __future__ import annotations

from app.database.client import supabase
from app.database.directory.common import search_rows, upsert_rows


def search_categories_and_markets(query: str) -> list[dict]:
    categories = search_rows(
        "directory_categories", query, ("category", "group_name", "product_type"), limit=20
    )
    refs = [row["source_ref"] for row in categories if row.get("source_ref")]
    if not refs:
        return categories
    links = (
        supabase.table("directory_market_categories")
        .select("category_ref,market_id")
        .in_("category_ref", refs)
        .limit(100)
        .execute()
    ).data or []
    market_ids = list(dict.fromkeys(row["market_id"] for row in links if row.get("market_id")))
    markets = []
    if market_ids:
        markets = (
            supabase.table("directory_markets")
            .select("*")
            .in_("id", market_ids)
            .limit(100)
            .execute()
        ).data or []
    market_by_id = {row["id"]: row for row in markets}
    contacts = []
    if market_ids:
        contacts = (
            supabase.table("directory_contacts")
            .select("*")
            .in_("market_id", market_ids)
            .limit(100)
            .execute()
        ).data or []
    contacts_by_market: dict[str, list[dict]] = {}
    for contact in contacts:
        contacts_by_market.setdefault(contact["market_id"], []).append(contact)
    output = []
    category_by_ref = {row["source_ref"]: row for row in categories}
    for link in links:
        category = category_by_ref.get(link["category_ref"], {})
        market = market_by_id.get(link["market_id"], {})
        contact = next(
            (item for item in contacts_by_market.get(link["market_id"], [])
             if item.get("verification_status") == "verified"),
            {},
        )
        output.append({
            **category,
            "place_name": market.get("place_name"),
            "city": market.get("city"),
            "district": market.get("district"),
            "address_en": market.get("address_en"),
            "address_cn": market.get("address_cn"),
            "buyer_notes": market.get("buyer_notes"),
            "contact_name": contact.get("contact_name"),
            "phone_wechat": contact.get("phone_wechat"),
            "floor_or_stall": contact.get("floor_or_stall"),
            "best_time": contact.get("best_time"),
            "verification_status": market.get("verification_status", "unknown"),
        })
    return output or categories


def upsert_categories(rows: list[dict]) -> int:
    return upsert_rows("directory_categories", rows, "source_ref")


def upsert_markets(rows: list[dict]) -> int:
    return upsert_rows("directory_markets", rows, "source_key")


def upsert_market_categories(rows: list[dict]) -> int:
    return upsert_rows("directory_market_categories", rows, "source_key")
