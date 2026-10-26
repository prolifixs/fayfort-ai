"""Member ranks and points (docs/MEMBERSHIP_PLAN.md, section 6).

Real activity becomes ledger rows (member_activity_events). Two numbers come out of it:
- the **status score**: points from the last 90 days. It sets the rank and can't be spent;
- the **points balance**: everything earned minus what was spent. Members spend it on rewards.

Ranks 1–5, each with subranks 1–5. A member moves up as soon as the score allows. If the score falls below the
current rank, a 30-day grace period starts; after it the member drops one subrank (then another after 30 more days
if still below), never straight to the bottom.

Rank perk: Free members at rank 4 (Insider) or higher pay Standard rates (25% sourcing deposit, $50 consultations)
while the rank holds. Paid members keep Pro's deposit-free sourcing through the good-standing rule (plans.py).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

from app.commerce.db import db, rows
from app.membership import plans

logger = logging.getLogger(__name__)

WINDOW_DAYS = 90
GRACE_DAYS = 30
RANK_NAMES = {1: "Browser", 2: "Scout", 3: "Hunter", 4: "Insider", 5: "Founder's Circle"}
# Score needed to enter each rank; rank 5's subranks run up to TOP.
RANK_FLOORS = {1: 0, 2: 250, 3: 750, 4: 1750, 5: 3500}
TOP = 6000
BORROW_STANDARD_RATES_FROM_RANK = 4

EARN = {
    "order": {"label": "Paid order", "points": "50 + 1 per $1 (max 250); under $10: 1 per $1"},
    "sourcing_purchase": {"label": "Sourcing request that ends in a purchase", "points": "+100"},
    "deposit": {"label": "Paid sourcing deposit", "points": "+20"},
    "pool": {"label": "Group buy you joined gets paid", "points": "+50"},
    "share_buyer": {"label": "A link you shared brings a buyer", "points": "+30 each"},
    "consultation": {"label": "Consultation booked", "points": "+30"},
    "giveaway_entry": {"label": "Giveaway entered", "points": "+5"},
    "subscription": {"label": "Each paid month on Standard / Pro", "points": "+20 / +40"},
}
REWARDS = {"contact_credit": {"label": "1 supplier contact credit", "cost": 500, "credits": 1}}
SHARE_BUYERS_PER_ITEM = 10
SMALL_ORDER = 10  # orders under $10 earn 1 point per $1, without the 50-point base (no farming with tiny orders)
SUBSCRIPTION_POINTS = {"standard": 20, "pro": 40}  # per paid month (re-set with the $5.99 / $14.99 prices)


def _iso(value: Any) -> str:
    return str(value or "")


def _paid(status: Any) -> bool:
    return status in ("paid", "partially_refunded")


def step(score: int) -> tuple[int, int]:
    """(rank, subrank) the score qualifies for."""
    rank = max(r for r, floor in RANK_FLOORS.items() if score >= floor)
    low = RANK_FLOORS[rank]
    high = RANK_FLOORS.get(rank + 1, TOP)
    subrank = 1 + int((score - low) * 5 / max(high - low, 1))
    return rank, max(1, min(subrank, 5))


def step_index(rank: int, subrank: int) -> int:
    return (rank - 1) * 5 + subrank


def from_index(index: int) -> tuple[int, int]:
    index = max(1, min(index, 25))
    return (index - 1) // 5 + 1, (index - 1) % 5 + 1


def threshold(rank: int, subrank: int) -> int:
    low = RANK_FLOORS[rank]
    high = RANK_FLOORS.get(rank + 1, TOP)
    return low + int((high - low) * (subrank - 1) / 5)


# ---------------------------------------------------------------------------------------------
# Activity → ledger
# ---------------------------------------------------------------------------------------------
def collect(member_id: str) -> list[dict]:
    """Every qualifying activity of the member, with its current value (a refunded order is worth 0)."""
    events: list[dict] = []
    orders = rows(db().table("commerce_orders").select("id,shopify_order_id,financial_status,total,placed_at,cancelled_at")
                  .eq("member_id", member_id).limit(1000).execute())
    for order in orders:
        worth = 0
        if _paid(order.get("financial_status")) and not order.get("cancelled_at"):
            total = float(order.get("total") or 0)
            worth = int(total) if total < SMALL_ORDER else 50 + min(int(total), 200)
        events.append({"kind": "order", "source_key": str(order.get("shopify_order_id") or order["id"]),
                       "points": worth, "occurred_at": _iso(order.get("placed_at"))})
    invoices = rows(db().table("commerce_invoices").select("id,kind,status,request_id,trend_item_id,paid_at,created_at")
                    .eq("member_id", member_id).eq("status", "paid").limit(1000).execute())
    for invoice in invoices:
        when = _iso(invoice.get("paid_at") or invoice.get("created_at"))
        kind = invoice.get("kind") or "order"
        if kind == "order" and invoice.get("request_id"):
            events.append({"kind": "sourcing_purchase", "source_key": str(invoice["id"]), "points": 100, "occurred_at": when})
        elif kind == "order" and invoice.get("trend_item_id"):
            events.append({"kind": "pool", "source_key": str(invoice["id"]), "points": 50, "occurred_at": when})
        elif kind == "deposit":
            events.append({"kind": "deposit", "source_key": str(invoice["id"]), "points": 20, "occurred_at": when})
    for consultation in rows(db().table("member_consultations").select("id,status,created_at,updated_at")
                             .eq("member_id", member_id).limit(200).execute()):
        if consultation.get("status") in ("requested", "scheduled", "completed"):
            events.append({"kind": "consultation", "source_key": str(consultation["id"]), "points": 30,
                           "occurred_at": _iso(consultation.get("updated_at") or consultation.get("created_at"))})
    for entry in rows(db().table("commerce_giveaway_entries").select("giveaway_id,entered_at")
                      .eq("member_id", member_id).limit(1000).execute()):
        events.append({"kind": "giveaway_entry", "source_key": str(entry["giveaway_id"]), "points": 5,
                       "occurred_at": _iso(entry.get("entered_at"))})
    disputed = {str(d.get("stripe_invoice_id")) for d in rows(db().table("billing_disputes")
                                                                 .select("stripe_invoice_id,status").eq("member_id", member_id)
                                                                 .limit(200).execute()) if d.get("status") != "won"}
    for payment in rows(db().table("member_subscription_payments")
                        .select("stripe_invoice_id,plan,paid_at,amount,refunded_amount,dispute_lost_amount")
                        .eq("member_id", member_id).limit(200).execute()):
        # A refunded or disputed month earns nothing.
        lost = float(payment.get("refunded_amount") or 0) + float(payment.get("dispute_lost_amount") or 0)
        kept = lost < float(payment.get("amount") or 0) and str(payment["stripe_invoice_id"]) not in disputed
        events.append({"kind": "subscription", "source_key": str(payment["stripe_invoice_id"]),
                       "points": SUBSCRIPTION_POINTS.get(str(payment.get("plan")), 0) if kept else 0,
                       "occurred_at": _iso(payment.get("paid_at"))})
    events += _share_buyers(member_id)
    return [e for e in events if e["occurred_at"]]


def _share_buyers(member_id: str) -> list[dict]:
    """Other members who paid for a group buy on a link this member shared first."""
    shares = rows(db().table("commerce_trend_shares").select("trend_item_id,shared_at").eq("member_id", member_id)
                  .limit(500).execute())
    if not shares:
        return []
    shared_at = {str(s["trend_item_id"]): _iso(s.get("shared_at")) for s in shares}
    paid = rows(db().table("commerce_invoices").select("id,member_id,trend_item_id,paid_at,status,kind")
                .in_("trend_item_id", list(shared_at)).eq("status", "paid").limit(2000).execute())
    events, per_item = [], {}
    for invoice in sorted(paid, key=lambda i: plans_parse(i.get("paid_at")) or plans.now_utc()):
        item = str(invoice["trend_item_id"])
        paid_at, shared = plans_parse(invoice.get("paid_at")), plans_parse(shared_at.get(item))
        if str(invoice["member_id"]) == member_id or not paid_at or (shared and paid_at < shared):
            continue
        if per_item.get(item, 0) >= SHARE_BUYERS_PER_ITEM:
            continue
        per_item[item] = per_item.get(item, 0) + 1
        events.append({"kind": "share_buyer", "source_key": f"{item}:{invoice['member_id']}", "points": 30,
                       "occurred_at": _iso(invoice.get("paid_at"))})
    return events


def _ledger(member_id: str) -> list[dict]:
    return rows(db().table("member_activity_events").select("id,kind,source_key,points,occurred_at")
                .eq("member_id", member_id).order("occurred_at", desc=True).limit(5000).execute())


def sync_ledger(member_id: str) -> list[dict]:
    """Write new activity, update changed values (e.g. a refund drops an order to 0). Returns the ledger."""
    existing = {(r["kind"], r["source_key"]): r for r in _ledger(member_id)}
    for event in collect(member_id):
        key = (event["kind"], event["source_key"])
        row = existing.get(key)
        if row is None:
            if event["points"] <= 0:
                continue
            db().table("member_activity_events").upsert({"member_id": member_id, **event},
                                                        on_conflict="member_id,kind,source_key").execute()
        elif int(row.get("points") or 0) != event["points"]:
            db().table("member_activity_events").update({"points": event["points"]}).eq("id", row["id"]).execute()
    return _ledger(member_id)


# ---------------------------------------------------------------------------------------------
# Ledger → rank
# ---------------------------------------------------------------------------------------------
def recompute(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    now = now or plans.now_utc()
    ledger = sync_ledger(member_id)
    window_start = now - timedelta(days=WINDOW_DAYS)
    score = sum(int(r["points"]) for r in ledger if r["kind"] != "redeem" and int(r["points"]) > 0
                and (plans_parse(r["occurred_at"]) or window_start) >= window_start)
    balance = max(sum(int(r["points"]) for r in ledger), 0)
    found = rows(db().table("member_profiles").select("rank_level,subrank,rank_below_since")
                 .eq("user_id", member_id).limit(1).execute())
    profile = found[0] if found else {}
    current = step_index(int(profile.get("rank_level") or 1), int(profile.get("subrank") or 1))
    earned = step_index(*step(score))
    below_since = profile.get("rank_below_since")
    if earned >= current:
        new_index, below_since = earned, None
    else:
        started = plans_parse(below_since) if below_since else None
        if started is None:
            new_index, below_since = current, now.isoformat()
        elif now - started >= timedelta(days=GRACE_DAYS):
            new_index = max(current - 1, earned)
            below_since = None if new_index == earned else now.isoformat()
        else:
            new_index = current
    rank, subrank = from_index(new_index)
    db().table("member_profiles").update({
        "status_score": score, "points_balance": balance, "rank_level": rank, "subrank": subrank,
        "rank_below_since": below_since, "rank_checked_at": now.isoformat()}).eq("user_id", member_id).execute()
    return {"score": score, "balance": balance, "rank": rank, "subrank": subrank, "below_since": below_since,
            "ledger": ledger}


def plans_parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=plans.now_utc().tzinfo)


def safe_recompute(member_id: str | None) -> None:
    """Called after activity (orders, giveaway entries, consultations); never breaks the caller."""
    if not member_id:
        return
    try:
        recompute(str(member_id))
    except Exception:
        logger.exception("Could not update the rank of member %s", member_id)


def status(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    """Everything the Member tier and Virtual points pop-ups show."""
    now = now or plans.now_utc()
    result = recompute(member_id, now)
    rank, subrank, score = result["rank"], result["subrank"], result["score"]
    index = step_index(rank, subrank)
    nxt = from_index(index + 1) if index < 25 else None
    next_at = threshold(*nxt) if nxt else None
    floor_at = threshold(rank, subrank)
    grace_ends = None
    if result["below_since"]:
        started = plans_parse(result["below_since"])
        grace_ends = (started + timedelta(days=GRACE_DAYS)).isoformat() if started else None
    tier = plans.member_tier(member_id)
    perks = []
    if tier == "free":
        perks.append({"rank": BORROW_STANDARD_RATES_FROM_RANK, "label": "Standard rates on the Free plan: 25% sourcing deposit and $50 consultations",
                      "active": rank >= BORROW_STANDARD_RATES_FROM_RANK})
    perks.append({"rank": 1, "label": f"Spend points: {REWARDS['contact_credit']['cost']} points = {REWARDS['contact_credit']['label']}",
                  "active": True})
    recent = [{"kind": r["kind"], "label": EARN.get(r["kind"], {}).get("label", "Points spent"), "points": r["points"],
               "occurred_at": r["occurred_at"]} for r in result["ledger"] if int(r["points"]) != 0][:12]
    return {
        "rank": rank, "subrank": subrank, "name": RANK_NAMES[rank], "step": index, "score": score,
        "balance": result["balance"], "window_days": WINDOW_DAYS,
        "current_at": floor_at, "next": ({"rank": nxt[0], "subrank": nxt[1], "name": RANK_NAMES[nxt[0]], "at": next_at}
                                        if nxt else None),
        "grace": {"below": bool(result["below_since"]), "ends_at": grace_ends, "days": GRACE_DAYS},
        "ranks": [{"rank": r, "name": RANK_NAMES[r], "at": RANK_FLOORS[r]} for r in RANK_NAMES],
        "earn": [{"kind": k, **v} for k, v in EARN.items()],
        "rewards": [{"id": k, **v} for k, v in REWARDS.items()],
        "perks": perks, "recent": recent,
    }


def redeem(member_id: str, reward: str) -> dict[str, Any]:
    offer = REWARDS.get(reward)
    if not offer:
        raise ValueError("Choose a reward.")
    recompute(member_id)
    try:
        db().rpc("redeem_member_points", {"p_member_id": member_id, "p_cost": offer["cost"],
                                          "p_credits": offer["credits"]}).execute()
    except Exception as exc:
        if "not_enough_points" in str(exc):
            raise ValueError(f"You need {offer['cost']} points for this reward.") from exc
        raise
    return status(member_id)


# ---------------------------------------------------------------------------------------------
# Background sweep: keeps scores fresh as activity ages out of the 90-day window.
# ---------------------------------------------------------------------------------------------
def active_member_ids(now: datetime | None = None) -> set[str]:
    since = ((now or plans.now_utc()) - timedelta(days=WINDOW_DAYS + GRACE_DAYS)).isoformat()
    ids: set[str] = set()
    for table, column in (("member_activity_events", "occurred_at"), ("commerce_orders", "placed_at"),
                          ("member_subscription_payments", "paid_at"),
                          ("commerce_invoices", "created_at"), ("commerce_giveaway_entries", "entered_at"),
                          ("member_consultations", "created_at")):
        try:
            ids |= {str(r["member_id"]) for r in rows(db().table(table).select("member_id").gte(column, since)
                                                         .limit(5000).execute()) if r.get("member_id")}
        except Exception:
            logger.exception("Rank sweep could not read %s", table)
    ids |= {str(r["user_id"]) for r in rows(db().table("member_profiles").select("user_id").gte("rank_level", 2)
                                            .limit(5000).execute())}
    return ids


def sweep() -> int:
    count = 0
    for member_id in active_member_ids():
        safe_recompute(member_id)
        count += 1
    return count


async def rank_loop(interval_seconds: int = 6 * 3600) -> None:
    await asyncio.sleep(60)
    while True:
        try:
            updated = await asyncio.to_thread(sweep)
            logger.info("Member ranks refreshed for %s member(s)", updated)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Member rank sweep failed; will retry")
        await asyncio.sleep(interval_seconds)
