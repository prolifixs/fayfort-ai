import re

from app.database.directory.common import search_rows, upsert_rows


_WORDS = re.compile(r"[a-zA-Z0-9\u4e00-\u9fff]+")
_DESTINATION_PHRASE = re.compile(
    r"\b(?:ship(?:s|ping)?|deliver(?:s|y)?|send(?:s|ing)?|freight)\b"
    r".{0,60}?\bto\s+([^?.!,;]+)",
    re.IGNORECASE,
)
_GENERIC_TERMS = {
    "a", "an", "and", "are", "find", "for", "freight", "forwarder",
    "forwarders", "forwarding", "from", "give", "i", "me", "my", "please",
    "provider", "providers", "service", "services", "ship", "ships", "shipping",
    "that", "the", "to", "we", "with", "you",
}


def _destination_terms(query: str, rows: list[dict]) -> set[str]:
    match = _DESTINATION_PHRASE.search(query or "")
    if match:
        terms = {
            word.casefold()
            for word in _WORDS.findall(match.group(1))
            if word.casefold() not in _GENERIC_TERMS
        }
        if terms:
            return terms

    query_terms = {
        word.casefold()
        for word in _WORDS.findall(query or "")
        if word.casefold() not in _GENERIC_TERMS
    }
    shipping_terms = {
        word.casefold()
        for row in rows
        for word in _WORDS.findall(str(row.get("ships_to") or ""))
    }
    return query_terms & shipping_terms


def search_service_providers(query: str) -> list[dict]:
    rows = search_rows(
        "directory_service_providers", query, ("service", "city", "ships_to"), limit=20
    )
    destination_terms = _destination_terms(query, rows)
    if not destination_terms:
        return rows
    return [
        row for row in rows
        if destination_terms.issubset({
            word.casefold()
            for word in _WORDS.findall(str(row.get("ships_to") or ""))
        })
    ]


def upsert_service_providers(rows: list[dict]) -> int:
    return upsert_rows("directory_service_providers", rows, "source_key")
