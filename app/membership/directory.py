"""Supplier directory for members: everyone sees the public half of a record; the private half (address,
stall, contact person, phone/WeChat …) is shown once the member has unlocked it. Hotels and restaurants
are free. Unlocks go through unlock_member_contact() so a credit can't be spent twice."""
from __future__ import annotations

import re
from typing import Any

from app.commerce.db import db, one, rows
from app.membership import plans

RecordType = str  # "market" | "service_provider" | "hotel" | "restaurant"

_TOKEN = re.compile(r"[a-zA-Z0-9一-鿿]+")
_STOP = {"the", "and", "for", "from", "with", "where", "what", "want", "need", "please", "find", "near", "supplier",
         "suppliers", "market", "markets"}

SPEC: dict[str, dict[str, Any]] = {
    "market": {
        "table": "directory_markets", "verified_only": False,
        "search": ("place_name", "city", "district"),
        "public": ("place_name", "city", "district"),
        "private": ("address_en", "address_cn", "buyer_notes"),
    },
    "service_provider": {
        "table": "directory_service_providers", "verified_only": True,
        "search": ("service", "city", "ships_to"),
        "public": ("service", "city", "ships_to"),
        "private": ("company", "company_cn", "contact_name", "phone_wechat", "other_numbers", "email_qq",
                    "address_en", "address_cn", "booth", "hours"),
    },
    "hotel": {
        "table": "directory_hotels", "verified_only": True,
        "search": ("area", "hotel_name", "name_cn", "address_or_nearest_metro"),
        "public": ("area", "hotel_name", "name_cn", "address_or_nearest_metro", "takes_foreigners", "tier"),
        "private": ("rough_price_per_night", "phone"),
    },
    "restaurant": {
        "table": "directory_restaurants", "verified_only": True,
        "search": ("area", "restaurant", "name_cn", "where_it_is", "food_type"),
        "public": ("area", "restaurant", "name_cn", "where_it_is", "food_type", "halal", "opening_hours"),
        "private": ("phone",),
    },
}
CONTACT_FIELDS = ("contact_name", "phone_wechat", "floor_or_stall", "best_time")


class DirectoryError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def terms(query: str) -> list[str]:
    found = [t for t in _TOKEN.findall((query or "").casefold()) if len(t) >= 2 and t not in _STOP]
    return list(dict.fromkeys(found))[:5]


def _title(record_type: str, row: dict) -> str:
    return str(row.get({"market": "place_name", "service_provider": "service", "hotel": "hotel_name",
                        "restaurant": "restaurant"}[record_type]) or "Directory record")


def _unlocked_ids(member_id: str, record_type: str, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    return {str(r["record_id"]) for r in rows(db().table("member_contact_unlocks").select("record_id")
                                                .eq("member_id", member_id).eq("record_type", record_type)
                                                .in_("record_id", ids).execute())}


def _market_extras(market_ids: list[str], *, with_contacts: set[str]) -> tuple[dict, dict]:
    """Category names per market (public) and verified contacts for unlocked markets (private)."""
    links = rows(db().table("directory_market_categories").select("market_id,category_ref")
                 .in_("market_id", market_ids).limit(1000).execute()) if market_ids else []
    refs = list({str(l["category_ref"]) for l in links})
    names = {str(c["source_ref"]): c.get("category") for c in rows(db().table("directory_categories")
                                                                   .select("source_ref,category").in_("source_ref", refs)
                                                                   .execute())} if refs else {}
    categories: dict[str, list[str]] = {}
    for link in links:
        name = names.get(str(link["category_ref"]))
        if name and name not in categories.setdefault(str(link["market_id"]), []):
            categories[str(link["market_id"])].append(name)
    contacts: dict[str, list[dict]] = {}
    unlocked = [m for m in market_ids if m in with_contacts]
    if unlocked:
        for contact in rows(db().table("directory_contacts").select("market_id,verification_status," + ",".join(CONTACT_FIELDS))
                            .in_("market_id", unlocked).limit(500).execute()):
            if contact.get("verification_status") in ("verified", "unverified", "unknown"):
                contacts.setdefault(str(contact["market_id"]), []).append(
                    {**{f: contact.get(f) for f in CONTACT_FIELDS}, "verified": contact.get("verification_status") == "verified"})
    return categories, contacts


def present(record_type: str, records: list[dict], member_id: str) -> list[dict]:
    spec = SPEC[record_type]
    ids = [str(r["id"]) for r in records]
    free = record_type in plans.FREE_RECORD_TYPES
    unlocked = set(ids) if free else _unlocked_ids(member_id, record_type, ids)
    categories, contacts = (_market_extras(ids, with_contacts=unlocked) if record_type == "market" else ({}, {}))
    output = []
    for row in records:
        rid = str(row["id"])
        item: dict[str, Any] = {"id": rid, "record_type": record_type, "title": _title(record_type, row),
                                "verified": row.get("verification_status") == "verified", "free": free,
                                "unlocked": rid in unlocked,
                                "public": {f: row.get(f) for f in spec["public"] if row.get(f) not in (None, "")}}
        if record_type == "market":
            item["public"]["categories"] = categories.get(rid, [])[:8]
        if rid in unlocked:
            item["private"] = {f: row.get(f) for f in spec["private"] if row.get(f) not in (None, "")}
            if record_type == "market":
                item["private"]["contacts"] = contacts.get(rid, [])
        output.append(item)
    return output


def _select_fields(record_type: str) -> str:
    spec = SPEC[record_type]
    return ",".join(dict.fromkeys(("id", "verification_status", *spec["public"], *spec["private"])))


def search(member_id: str, record_type: str, query: str, limit: int = 20) -> list[dict]:
    spec = SPEC[record_type]
    words = terms(query)
    builder = db().table(spec["table"]).select(_select_fields(record_type))
    if spec["verified_only"]:
        builder = builder.eq("verification_status", "verified")
    if words:
        clauses = [f"{field}.ilike.%{word}%" for word in words for field in spec["search"]]
        if record_type == "market":
            # Also match markets by the product categories they sell.
            cats = rows(db().table("directory_categories").select("source_ref")
                        .or_(",".join(f"{f}.ilike.%{w}%" for w in words for f in ("category", "group_name", "product_type")))
                        .limit(50).execute())
            refs = [str(c["source_ref"]) for c in cats]
            market_ids = list({str(l["market_id"]) for l in rows(db().table("directory_market_categories")
                                                                 .select("market_id").in_("category_ref", refs)
                                                                 .limit(300).execute())}) if refs else []
            if market_ids:
                clauses.append(f"id.in.({','.join(market_ids[:150])})")
        builder = builder.or_(",".join(clauses))
    found = rows(builder.limit(limit * 2).execute())
    found.sort(key=lambda r: r.get("verification_status") != "verified")  # verified records first
    return present(record_type, found[:limit], member_id)


def record(record_type: str, record_id: str) -> dict | None:
    spec = SPEC[record_type]
    builder = db().table(spec["table"]).select(_select_fields(record_type)).eq("id", record_id)
    if spec["verified_only"]:
        builder = builder.eq("verification_status", "verified")
    return one(builder.limit(1).execute())


def unlock(member_id: str, record_type: str, record_id: str) -> dict:
    found = record(record_type, record_id)
    if not found:
        raise DirectoryError("That directory record isn't available.", 404)
    if record_type not in plans.FREE_RECORD_TYPES:
        tier = plans.member_tier(member_id)
        try:
            result = db().rpc("unlock_member_contact", {
                "p_member_id": member_id, "p_record_type": record_type, "p_record_id": record_id,
                "p_is_pro": tier == "pro", "p_pro_monthly_limit": plans.PRO_CONTACTS_PER_MONTH}).execute()
        except Exception as exc:
            if "no_contact_credits" in str(exc):
                raise DirectoryError("You have no contact credits left. Buy a contact to unlock it.", 402) from exc
            raise
        data = result.data[0] if isinstance(result.data, list) and result.data else result.data
        method = (data or {}).get("method")
    else:
        method = "free"
    return {**present(record_type, [found], member_id)[0], "method": method,
            "contacts": plans.contact_status(member_id)}


def unlocked(member_id: str, limit: int = 100) -> list[dict]:
    """The member's unlocked records, newest first ("My contacts")."""
    unlocks = rows(db().table("member_contact_unlocks").select("record_type,record_id,created_at")
                   .eq("member_id", member_id).order("created_at", desc=True).limit(limit).execute())
    output: list[dict] = []
    for record_type in SPEC:
        ids = [str(u["record_id"]) for u in unlocks if u["record_type"] == record_type]
        if not ids:
            continue
        found = rows(db().table(SPEC[record_type]["table"]).select(_select_fields(record_type)).in_("id", ids).execute())
        output += present(record_type, found, member_id)
    order = {str(u["record_id"]): i for i, u in enumerate(unlocks)}
    return sorted(output, key=lambda item: order.get(item["id"], 0))
