"""Operations desks (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R2).

Each department is a desk. A desk's pipeline strip counts its live work by stage, and every work item carries the stage
it is in (`desk_stage`) so tapping a stage filters the list. Stages come from what the item is (its work type) and, for
member requests, from the request's latest timeline stage. Anything that fits no stage falls back to its status.
"""
from __future__ import annotations

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo
from typing import Iterable

LIVE = ("open", "claimed", "waiting", "blocked")

# The fallback stages, by work status.
STATUS_STAGES = [("new", "New"), ("working", "Being worked on"), ("waiting", "Waiting"), ("blocked", "Stuck")]
STATUS_TO_STAGE = {"open": "new", "claimed": "working", "waiting": "waiting", "blocked": "blocked"}

# Each desk's stages, in pipeline order (key, label). Status stages close every desk so nothing goes uncounted.
DESK_STAGES: dict[str, list[tuple[str, str]]] = {
    "conversation_intake": [("member_app", "Member app chats"), ("customer", "Customer chats"), *STATUS_STAGES],
    "sourcing": [
        ("review", "Review"), ("sourcing", "Sourcing"), ("with_member", "Options with the member"),
        ("paid", "Paid"), ("group_buy", "Group buys"), *STATUS_STAGES,
    ],
    "fulfillment": [
        ("confirmed", "Confirmed"), ("warehouse", "In the warehouse"), ("on_the_way", "On the way"),
        ("delivered", "Delivered"), ("shop_order", "Shop orders to pack"), *STATUS_STAGES,
    ],
    "member_support": [
        ("money", "Money"), ("bookings", "Bookings"), ("campaigns", "Giveaways"), ("reviews", "Photo reviews"),
        ("chats", "Chats"), *STATUS_STAGES,
    ],
    "disputes": STATUS_STAGES,
    "store_team": [
        ("listings", "Listings"), ("finds", "Finds"), ("sections", "Sections"), ("campaigns", "Campaigns"),
        *STATUS_STAGES,
    ],
}

WORK_TYPE_STAGE = {
    "member_support": {
        "billing_issue": "money", "invoice_failed": "money", "invoice_void": "money", "refund_after_cancel": "money",
        "membership_dispute": "money", "subscription_past_due": "money",
        "consultation": "bookings", "tour_booking": "bookings",
        "giveaway_draw": "campaigns", "giveaway_prize": "campaigns",
        "photo_review": "reviews",
        "member_conversation": "chats", "business_conversation": "chats", "human_handoff": "chats",
    },
    "store_team": {
        "list_store_product": "listings", "list_sourcing_item": "listings", "map_product": "listings",
        "retire_listing": "listings",
        "list_find": "finds", "fill_finds_drop": "finds", "research_niche": "finds",
        "refresh_section": "sections",
        "prepare_campaign": "campaigns",
    },
}

SOURCING_REQUEST_STAGE = {
    "submitted": "review", "under_review": "review", "sourcing": "sourcing",
    "needs_member_input": "with_member", "options_sent": "with_member", "purchase_confirmed": "paid",
}
FULFILLMENT_REQUEST_STAGE = {
    "purchase_confirmed": "confirmed", "item_in_warehouse": "warehouse", "in_transit": "on_the_way",
    "out_for_delivery": "on_the_way", "shipped": "on_the_way", "delivered": "delivered",
}


def desk_stage(row: dict, request_stage: str | None = None) -> str:
    """The pipeline stage a live work item is in on its desk."""
    department = row.get("department")
    work_type = row.get("work_type") or ""
    fallback = STATUS_TO_STAGE.get(row.get("status") or "", "new")
    if department == "conversation_intake":
        if row.get("member_conversation_id") or work_type == "member_conversation":
            return "member_app"
        if row.get("handoff_id") or row.get("business_conversation_id"):
            return "customer"
        return fallback
    if department == "sourcing":
        if work_type == "group_buy":
            return "group_buy"
        return SOURCING_REQUEST_STAGE.get(request_stage or "", fallback if not row.get("member_request_id") else "review")
    if department == "fulfillment":
        if work_type == "store_order":
            return "shop_order"
        return FULFILLMENT_REQUEST_STAGE.get(request_stage or "", fallback)
    if department in WORK_TYPE_STAGE:
        return WORK_TYPE_STAGE[department].get(work_type, fallback)
    return fallback


def _overdue(value: object, now: datetime) -> bool:
    if not value:
        return False
    try:
        due = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return False
    return (due if due.tzinfo else due.replace(tzinfo=timezone.utc)) < now


def _claim_lapsed(row: dict, now: datetime) -> bool:
    until = row.get("claimed_until")
    return bool(until) and _overdue(until, now)


def desk_summaries(rows: Iterable[dict], request_stages: dict[str, str], user_id: str, departments: Iterable[str],
                   now: datetime | None = None) -> list[dict]:
    """Counts for each desk this person can see: what's free to pick up, theirs, waiting, overdue, and by stage."""
    now = now or datetime.now(timezone.utc)
    wanted = list(departments)
    by_department: dict[str, list[dict]] = {department: [] for department in wanted}
    for row in rows:
        if row.get("status") in LIVE and row.get("department") in by_department:
            by_department[row["department"]].append(row)
    summaries = []
    for department in wanted:
        live = by_department[department]
        stage_counts: dict[str, int] = {}
        for row in live:
            stage = desk_stage(row, request_stages.get(str(row.get("member_request_id") or "")))
            stage_counts[stage] = stage_counts.get(stage, 0) + 1
        summaries.append({
            "department": department,
            "total": len(live),
            "available": sum(1 for row in live if row.get("status") in ("open", "claimed")
                             and (not row.get("assigned_worker_id") or _claim_lapsed(row, now))),
            "mine": sum(1 for row in live if row.get("assigned_worker_id") == user_id),
            "waiting": sum(1 for row in live if row.get("status") == "waiting"),
            "overdue": sum(1 for row in live if _overdue(row.get("due_at"), now)),
            # Stages with nothing in them stay in the strip (so the pipeline always reads the same) except the status
            # fallbacks, which only show when something landed there.
            "stages": [{"key": key, "label": label, "count": stage_counts.get(key, 0)}
                       for key, label in DESK_STAGES[department]
                       if stage_counts.get(key) or (key, label) not in STATUS_STAGES or department == "disputes"],
        })
    return summaries


def latest_request_stages(client, request_ids: Iterable[str]) -> dict[str, str]:
    """The latest timeline stage of each member request (member_request_events, highest sequence number)."""
    ids = list(dict.fromkeys(str(value) for value in request_ids if value))
    stages: dict[str, str] = {}
    for start in range(0, len(ids), 150):
        chunk = ids[start:start + 150]
        rows = (client.table("member_request_events").select("request_id,stage,sequence_no").in_("request_id", chunk)
                .order("sequence_no", desc=True).limit(5000).execute().data or [])
        best: dict[str, int] = {}
        for row in rows:
            key, number = str(row.get("request_id")), int(row.get("sequence_no") or 0)
            if key not in best or number > best[key]:
                best[key], stages[key] = number, row.get("stage")
    return stages


CHINA = ZoneInfo("Asia/Shanghai")


def my_due_counts(mine: list[dict], now: datetime | None = None) -> dict:
    """For My work: how many of my items there are, how many are due by the end of today (China time, where the team
    works) and how many are already overdue."""
    now = now or datetime.now(timezone.utc)
    day_end = datetime.combine(now.astimezone(CHINA).date(), time(23, 59, 59), CHINA)
    due_today = overdue = 0
    for row in mine:
        if not row.get("due_at"):
            continue
        if _overdue(row["due_at"], now):
            overdue += 1
        elif _overdue(row["due_at"], day_end):
            due_today += 1
    return {"mine": len(mine), "mine_due_today": due_today, "mine_overdue": overdue}
