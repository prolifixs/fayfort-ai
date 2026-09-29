from app.database.directory.common import search_rows, upsert_rows


def search_hotels(query: str) -> list[dict]:
    return search_rows("directory_hotels", query, ("area", "hotel_name"), limit=20)


def upsert_hotels(rows: list[dict]) -> int:
    return upsert_rows("directory_hotels", rows, "source_key")
