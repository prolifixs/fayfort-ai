from app.database.directory.common import search_rows, upsert_rows


def search_city_guides(query: str) -> list[dict]:
    return search_rows("directory_city_guides", query, ("city", "province", "known_for"), limit=20)


def upsert_city_guides(rows: list[dict]) -> int:
    return upsert_rows("directory_city_guides", rows, "source_key")
