from __future__ import annotations
from typing import Any
from app.database.client import supabase

def list_businesses_for_user(user_id: str) -> list[dict[str, Any]]:
    membership = (supabase.table("business_members").select("business_id,role")
        .eq("user_id", user_id).eq("status", "active").execute().data or [])
    business_ids = [row["business_id"] for row in membership]
    if not business_ids: return []
    businesses = (supabase.table("businesses").select("id,name")
        .in_("id", business_ids).execute().data or [])
    by_id = {row["id"]: row for row in businesses}
    return [{"business_id":row["business_id"], "name":by_id[row["business_id"]]["name"], "role":row["role"]}
            for row in membership if row["business_id"] in by_id]
