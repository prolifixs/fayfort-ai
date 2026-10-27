from __future__ import annotations
from typing import Any
from app.database.client import supabase

def list_client_accounts_for_staff() -> list[dict[str, Any]]:
    """List all managed client accounts for authenticated FayFort staff only."""
    # One client account in practice (FayFort International); switched-off accounts stay out of the picker.
    businesses = (supabase.table("businesses").select("id,name").eq("status", "active").order("name").execute().data or [])
    return [{"business_id": row["id"], "name": row["name"]}
            for row in businesses if row.get("id") and row.get("name")]
