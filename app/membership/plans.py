"""Member plan rules (docs/MEMBERSHIP_PLAN.md) — the one place the prices and allowances live.

Readjusted with the owner on 2026-10-25 (Standard $5.99, Pro $14.99 a month through Stripe, app/billing):

| | Free | Standard | Pro |
|---|---|---|---|
| Sourcing deposit | 50% of the expected total | 25% | none for proven buyers in good standing (else 25%) |
| Consultation (1 hour) | $100 | $85 | $50 |
| Supplier contacts | $15 each, 5 for $50 | 1 included per paid month, then credits | 3 included per paid month |
| Hotels and restaurants | free | free | free |

Perks grow with loyalty: in the first paid month of a continuous run a member gets the plan one level below
(Pro -> Standard, Standard -> Free); full plan perks from the second paid month. Allowances count from the start of the
member's paid month (Stripe's current period), not the calendar month, and stop while a payment is overdue. A Free
member at rank 4+ pays Standard prices (not the allowance, which is a plan perk). A plan set by staff without a Stripe
subscription gets full perks and calendar-month allowances.

A deposit counts toward the order; FayFort keeps it if the member doesn't buy. member_profiles.member_tier is the
member's plan; app/billing keeps it in step with Stripe.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.commerce.db import db, rows

TIERS = ("free", "standard", "pro")
CURRENCY = "USD"
BELOW = {"pro": "standard", "standard": "free", "free": "free"}

DEPOSIT_RATE = {"free": 0.50, "standard": 0.25, "pro": 0.0}
CONSULTATION_PRICE = {"free": 100.0, "standard": 85.0, "pro": 50.0}
PRO_INCLUDED_CONSULTATIONS = 0  # no consultation is included any more (owner decision, 2026-10-25)

CONTACT_PACKS = {"single": {"credits": 1, "price": 15.0}, "pack5": {"credits": 5, "price": 50.0}}
CONTACT_ALLOWANCE = {"free": 0, "standard": 1, "pro": 3}  # included unlocks per paid month
PRO_CONTACTS_PER_MONTH = CONTACT_ALLOWANCE["pro"]
FULL_PERKS_FROM_PAID_MONTH = 2
PROVEN_BUYER_DAYS = 90
PAID_RECORD_TYPES = ("market", "service_provider")
FREE_RECORD_TYPES = ("hotel", "restaurant")

GOOD_STANDING_DAYS = 90
GOOD_STANDING_REQUESTS_PER_PURCHASE = 3


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def month_start(now: datetime | None = None) -> datetime:
    now = now or now_utc()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


RANK_FOR_STANDARD_RATES = 4  # Free members at this rank or higher borrow Standard rates (ranks.py)


def member_standing(member_id: str) -> tuple[str, int]:
    """(plan, rank level)."""
    found = rows(db().table("member_profiles").select("member_tier,rank_level").eq("user_id", member_id)
                 .limit(1).execute())
    profile = found[0] if found else {}
    tier = profile.get("member_tier") or "free"
    return (tier if tier in TIERS else "free"), int(profile.get("rank_level") or 1)


def member_tier(member_id: str) -> str:
    return member_standing(member_id)[0]


def good_standing(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    """Pro keeps deposit-free sourcing while sourcing turns into purchases: at least one paid order for
    every three sourcing requests over the last 90 days (fewer than three requests is always fine)."""
    since = ((now or now_utc()) - timedelta(days=GOOD_STANDING_DAYS)).isoformat()
    requests = len(rows(db().table("member_purchase_requests").select("id").eq("member_id", member_id)
                        .gte("created_at", since).limit(500).execute()))
    purchases = len(rows(db().table("commerce_orders").select("id").eq("member_id", member_id)
                         .in_("financial_status", ["paid", "partially_refunded"]).gte("placed_at", since)
                         .limit(500).execute()))
    ok = requests < GOOD_STANDING_REQUESTS_PER_PURCHASE or purchases * GOOD_STANDING_REQUESTS_PER_PURCHASE >= requests
    return {"ok": ok, "requests": requests, "purchases": purchases, "window_days": GOOD_STANDING_DAYS}


def subscription_state(member_id: str) -> dict[str, Any]:
    """The member's Stripe subscription as the plan rules see it. No row = a plan set by staff (full perks)."""
    found = rows(db().table("member_subscriptions").select("continuous_since,status,current_period_start,past_due_since")
                 .eq("member_id", member_id).limit(1).execute())
    if not found:
        return {"subscribed": False, "paid_months": None, "period_start": None, "overdue": False}
    row = found[0]
    since = _parse(row.get("continuous_since"))
    paid = 0
    if since:
        # A payment a few seconds before the run's start date still belongs to it.
        payments = rows(db().table("member_subscription_payments").select("amount,refunded_amount,dispute_lost_amount,paid_at")
                        .eq("member_id", member_id).gte("paid_at", (since - timedelta(days=1)).isoformat())
                        .limit(500).execute())
        paid = sum(1 for p in payments if float(p.get("refunded_amount") or 0) + float(p.get("dispute_lost_amount") or 0)
                   < float(p.get("amount") or 0))
    return {"subscribed": True, "paid_months": paid, "period_start": row.get("current_period_start"),
            "overdue": row.get("status") == "past_due" or bool(row.get("past_due_since"))}


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def in_first_month(member_id: str, now: datetime | None = None) -> bool:
    """True while a Stripe subscription hasn't paid for its second month yet (staff-set plans have no row)."""
    state = subscription_state(member_id)
    return bool(state["subscribed"]) and int(state["paid_months"] or 0) < FULL_PERKS_FROM_PAID_MONTH


def rate_detail(member_id: str) -> tuple[str, str, str]:
    """(plan, plan whose prices apply, why): 'plan', 'first_month' (the plan below) or 'rank' (Free at rank 4+)."""
    tier, rank = member_standing(member_id)
    if tier != "free" and in_first_month(member_id):
        return tier, BELOW[tier], "first_month"
    if tier == "free" and rank >= RANK_FOR_STANDARD_RATES:
        return tier, "standard", "rank"
    return tier, tier, "plan"


def rate_tier(member_id: str) -> tuple[str, str]:
    tier, rates, _why = rate_detail(member_id)
    return tier, rates


def proven_buyer(member_id: str, now: datetime | None = None) -> bool:
    """At least one paid order in the last 90 days: Pro's deposit-free sourcing needs it."""
    since = ((now or now_utc()) - timedelta(days=PROVEN_BUYER_DAYS)).isoformat()
    return bool(rows(db().table("commerce_orders").select("id").eq("member_id", member_id)
                     .in_("financial_status", ["paid", "partially_refunded"]).gte("placed_at", since).limit(1).execute()))


def deposit_terms(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    tier, rates, why = rate_detail(member_id)
    if why == "rank":
        return {"tier": tier, "rate": DEPOSIT_RATE["standard"], "reason": "rank_standard_rate"}
    if why == "first_month":
        # Perks grow with loyalty: the first paid month pays the deposit of the plan below.
        return {"tier": tier, "rate": DEPOSIT_RATE[rates], "reason": f"{tier}_first_month"}
    if tier == "pro":
        if not proven_buyer(member_id, now):
            return {"tier": tier, "rate": DEPOSIT_RATE["standard"], "reason": "pro_not_yet_proven"}
        standing = good_standing(member_id, now)
        if standing["ok"]:
            return {"tier": tier, "rate": 0.0, "reason": "pro_good_standing", "standing": standing}
        return {"tier": tier, "rate": DEPOSIT_RATE["standard"], "reason": "pro_below_good_standing", "standing": standing}
    return {"tier": tier, "rate": DEPOSIT_RATE[tier], "reason": f"{tier}_rate"}


def deposit_quote(member_id: str, expected_total: float, now: datetime | None = None) -> dict[str, Any]:
    terms = deposit_terms(member_id, now)
    return {**terms, "expected_total": round(expected_total, 2), "amount": round(expected_total * terms["rate"], 2)}


def consultation_quote(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    tier, rates, why = rate_detail(member_id)
    price = CONSULTATION_PRICE[rates]
    return {"tier": tier, "rank_rate": why == "rank", "first_month": why == "first_month", "price": price,
            "currency": CURRENCY, "included": False, "included_left": 0, "full_price": CONSULTATION_PRICE["free"]}


def allowance_window(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    """How many included unlocks the member has this paid month, and since when they count."""
    tier = member_tier(member_id)
    if tier == "free":
        return {"allowance": 0, "since": None}
    state = subscription_state(member_id)
    if not state["subscribed"]:  # a plan set by staff: calendar months
        return {"allowance": CONTACT_ALLOWANCE[tier], "since": month_start(now).isoformat()}
    if state["overdue"]:
        return {"allowance": 0, "since": None}
    plan = BELOW[tier] if int(state["paid_months"] or 0) < FULL_PERKS_FROM_PAID_MONTH else tier
    since = state["period_start"] or month_start(now).isoformat()
    return {"allowance": CONTACT_ALLOWANCE[plan], "since": since}


def contact_status(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    tier = member_tier(member_id)
    credits = sum(int(r.get("delta") or 0) for r in rows(db().table("member_contact_credits").select("delta")
                                                          .eq("member_id", member_id).limit(5000).execute()))
    window = allowance_window(member_id, now)
    allowance_left = 0
    if window["allowance"] and window["since"]:
        used = len(rows(db().table("member_contact_unlocks").select("id").eq("member_id", member_id)
                        .eq("method", "pro_allowance").gte("created_at", window["since"]).execute()))
        allowance_left = max(window["allowance"] - used, 0)
    return {"tier": tier, "credits": max(credits, 0), "pro_allowance_left": allowance_left,
            "pro_allowance": window["allowance"], "allowance_since": window["since"],
            "packs": [{"id": key, **value, "currency": CURRENCY} for key, value in CONTACT_PACKS.items()]}


def plan_summary(member_id: str) -> dict[str, Any]:
    now = now_utc()
    terms = deposit_terms(member_id, now)
    return {"tier": terms["tier"], "deposit": {"rate": terms["rate"], "reason": terms["reason"],
                                               "standing": terms.get("standing")},
            "consultation": consultation_quote(member_id, now), "contacts": contact_status(member_id, now)}
