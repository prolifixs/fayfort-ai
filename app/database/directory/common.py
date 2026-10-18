from __future__ import annotations

from typing import Any

from app.database.client import supabase


def search_rows(
    table: str,
    query: str,
    search_fields: tuple[str, ...],
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Search only named columns; sanitize terms before building PostgREST OR filters.

    Only words that can name something are searched (app/services/process_guide.py: no "to", "me", "through"),
    and rows matching the most of them come first; rows matching fewer words than the best are dropped, so
    "furniture packages" returns furniture, not everything with "pack" in it.
    """
    from app.services.process_guide import meaningful_terms

    tokens = meaningful_terms(query)
    if not tokens:
        return []
    clauses = [
        f"{field}.ilike.%{token}%"
        for token in tokens
        for field in search_fields
    ]
    response = (
        supabase.table(table)
        .select("*")
        .or_(",".join(clauses))
        .limit(max(limit * 5, 100))
        .execute()
    )
    rows = response.data or []

    def score(row: dict[str, Any]) -> int:
        text = " ".join(str(row.get(field) or "") for field in search_fields).casefold()
        return sum(token in text for token in tokens)

    scored = [(score(row), index, row) for index, row in enumerate(rows)]
    best = max((item[0] for item in scored), default=0)
    if best == 0:
        return []
    return [row for value, _, row in sorted(scored, key=lambda item: (-item[0], item[1])) if value == best][:limit]


def upsert_rows(table: str, rows: list[dict[str, Any]], conflict_column: str) -> int:
    if not rows:
        return 0
    total = 0
    for start in range(0, len(rows), 100):
        response = (
            supabase.table(table)
            .upsert(rows[start:start + 100], on_conflict=conflict_column)
            .execute()
        )
        total += len(response.data or [])
    return total
