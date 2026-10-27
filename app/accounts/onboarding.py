"""Welcome tour and first-week checklist for new workers (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R7).

The tour shows on a worker's first visit to the Operations Center (any device) until they finish or skip it. The
checklist is built from the worker's own departments; most items tick themselves from what the worker has done
(clocked in, claimed, finished an item on each desk...), the rest are ticked by the worker or by the dashboard
(reading a desk's guide).
"""
from __future__ import annotations

from datetime import datetime, timezone

DESK_LABEL = {"conversation_intake": "Conversations", "sourcing": "Sourcing", "fulfillment": "Fulfillment",
              "member_support": "Member support", "disputes": "Disputes", "store_team": "Store team"}
DESK_ORDER = ("conversation_intake", "sourcing", "fulfillment", "member_support", "disputes", "store_team")
# Items the worker or the dashboard may record (the others are worked out from what happened).
RECORDABLE = {"tour", "profile"} | {f"guide_{desk}" for desk in DESK_ORDER}


def _rows(result) -> list[dict]:
    return list((result.data if result is not None else None) or [])


def _one(result) -> dict | None:
    data = result.data if result is not None else None
    if isinstance(data, list):
        return data[0] if data else None
    return data


def checklist(client, worker_id: str, departments: list[str], progress: dict, worker: dict) -> list[dict]:
    desks = [desk for desk in DESK_ORDER if desk in departments]
    clocked = bool(_rows(client.table("worker_shifts").select("id").eq("worker_id", worker_id).limit(1).execute()))
    claimed = bool(_rows(client.table("operations_work_events").select("id").eq("actor_user_id", worker_id)
                         .eq("event_type", "claimed").limit(1).execute()))
    finished = {row.get("department") for row in _rows(
        client.table("operations_work_items").select("department").eq("assigned_worker_id", worker_id)
        .eq("status", "completed").limit(500).execute())}
    handed = bool(_rows(client.table("operations_work_events").select("id").eq("actor_user_id", worker_id)
                        .eq("event_type", "handed_off").limit(1).execute()))
    items = [
        {"key": "tour", "title": "Take the welcome tour", "how": "A two-minute walk through the Operations Center.",
         "done": bool(progress.get("tour") or worker.get("onboarding_completed_at"))},
        {"key": "clock_in", "title": "Clock in for your first shift", "how": "Clock in at the top of the page when you start; Clock out when you finish.",
         "done": clocked},
    ]
    if "conversation_intake" in desks:
        items.append({"key": "chats", "title": "Take chats for a shift", "how": "Use the chat switch next to the shift clock so customers can be handed to you.",
                      "done": bool(worker.get("handoff_availability_updated_at"))})
    items.append({"key": "claim", "title": "Claim your first item", "how": "Open a desk, pick something free to pick up and press Claim. It's yours for 15 minutes and renews while you work.",
                  "done": claimed})
    for desk in desks:
        items.append({"key": f"guide_{desk}", "title": f"Read how the {DESK_LABEL[desk]} desk works", "how": "Guide → your desk: its pipeline, its tools and where its work goes next.",
                      "done": bool(progress.get(f"guide_{desk}")), "desk": desk})
        items.append({"key": f"finish_{desk}", "title": f"Finish your first {DESK_LABEL[desk]} item", "how": "Follow the steps bar to the end and mark it completed.",
                      "done": desk in finished, "desk": desk})
    if "conversation_intake" in desks:
        items.append({"key": "handoff", "title": "Send something from a chat to another desk", "how": "In a claimed chat, use Send to another desk in the customer card.",
                      "done": handed})
    return items


def state(client, worker_id: str, departments: list[str], *, admin: bool = False) -> dict:
    worker = _one(client.table("fayfort_workers").select(
        "user_id,job_title,staff_role,onboarding_completed_at,onboarding_progress,handoff_availability_updated_at,activated_at,created_at")
        .eq("user_id", worker_id).limit(1).execute()) or {}
    progress = worker.get("onboarding_progress") or {}
    items = checklist(client, worker_id, departments, progress, worker)
    return {
        # Administrators never get the tour pushed at them; they can open it from the Guide.
        "show_tour": bool(worker) and not admin and not worker.get("onboarding_completed_at"),
        "completed_at": worker.get("onboarding_completed_at"),
        "job_title": worker.get("job_title"),
        "departments": [desk for desk in DESK_ORDER if desk in departments],
        "checklist": items,
        "done": sum(1 for item in items if item["done"]),
        "total": len(items),
    }


def record(client, worker_id: str, key: str) -> dict:
    if key not in RECORDABLE:
        raise ValueError("That checklist item ticks itself.")
    worker = _one(client.table("fayfort_workers").select("onboarding_progress,onboarding_completed_at")
                  .eq("user_id", worker_id).limit(1).execute())
    if not worker:
        raise LookupError("No worker profile.")
    now = datetime.now(timezone.utc).isoformat()
    progress = dict(worker.get("onboarding_progress") or {})
    progress.setdefault(key, now)
    values: dict = {"onboarding_progress": progress}
    if key == "tour" and not worker.get("onboarding_completed_at"):
        values["onboarding_completed_at"] = now
    client.table("fayfort_workers").update(values).eq("user_id", worker_id).execute()
    return progress
