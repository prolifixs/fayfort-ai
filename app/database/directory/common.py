from __future__ import annotations

import re
from typing import Any

from app.database.client import supabase


_TOKEN_RE = re.compile(r"[a-zA-Z0-9\u4e00-\u9fff]+")
_STOP_WORDS = {"the", "and", "for", "from", "with", "where", "what", "when", "want", "need", "please", "can", "you", "find", "tell", "about", "near", "into"}


def search_rows(
    table: str,
    query: str,
    search_fields: tuple[str, ...],
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Search only named columns; sanitize terms before building PostgREST OR filters."""
    tokens = [token for token in _TOKEN_RE.findall((query or "").casefold()) if len(token) >= 2 and token not in _STOP_WORDS]
    tokens = list(dict.fromkeys(tokens))[:6]
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
        .limit(limit)
        .execute()
    )
    return response.data or []


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
