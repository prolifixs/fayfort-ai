from app.database.directory.common import search_rows, upsert_rows


def search_restaurants(query: str) -> list[dict]:
    return search_rows("directory_restaurants", query, ("area", "restaurant", "food_type"), limit=20)


def upsert_restaurants(rows: list[dict]) -> int:
    return upsert_rows("directory_restaurants", rows, "source_key")
