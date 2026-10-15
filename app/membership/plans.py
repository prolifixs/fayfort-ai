"""Member plan rules (docs/MEMBERSHIP_PLAN.md) — the one place the prices and allowances live.

| | Free | Standard | Pro |
|---|---|---|---|
| Sourcing deposit | 50% of the expected total | 25% | none while in good standing (else 25%) |
| Consultation | $100 | $50 | 1 included per month, then $50 |
| Supplier contacts | $15 each, 5 for $50 | same | 10 included per month, then credits |
| Hotels and restaurants | free | free | free |

A deposit counts toward the order; FayFort keeps it if the member doesn't buy. Plan billing (Stripe) is
not built yet, so the plan is read from member_profiles.member_tier.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.commerce.db import db, rows

TIERS = ("free", "standard", "pro")
CURRENCY = "USD"

DEPOSIT_RATE = {"free": 0.50, "standard": 0.25, "pro": 0.0}
CONSULTATION_PRICE = {"free": 100.0, "standard": 50.0, "pro": 50.0}  # Pro: after the included one
PRO_INCLUDED_CONSULTATIONS = 1

CONTACT_PACKS = {"single": {"credits": 1, "price": 15.0}, "pack5": {"credits": 5, "price": 50.0}}
PRO_CONTACTS_PER_MONTH = 10
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


def rate_tier(member_id: str) -> tuple[str, str]:
    """(plan, plan whose rates apply). A Free member at rank 4+ pays Standard rates while the rank holds."""
    tier, rank = member_standing(member_id)
    if tier == "free" and rank >= RANK_FOR_STANDARD_RATES:
        return tier, "standard"
    return tier, tier


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


FIRST_MONTH_DAYS = 30


def in_first_month(member_id: str, now: datetime | None = None) -> bool:
    """True while a Stripe subscription's continuous run is younger than 30 days (manual plans have no row)."""
    found = rows(db().table("member_subscriptions").select("continuous_since,status").eq("member_id", member_id)
                 .limit(1).execute())
    since = found[0].get("continuous_since") if found else None
    if not since:
        return False
    try:
        started = datetime.fromisoformat(str(since).replace("Z", "+00:00"))
    except ValueError:
        return False
    if not started.tzinfo:
        started = started.replace(tzinfo=timezone.utc)
    return (now or now_utc()) - started < timedelta(days=FIRST_MONTH_DAYS)


def deposit_terms(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    tier, rates = rate_tier(member_id)
    if rates != tier:
        return {"tier": tier, "rate": DEPOSIT_RATE[rates], "reason": "rank_standard_rate"}
    if tier == "pro" and in_first_month(member_id, now):
        # Perks grow with continuous months subscribed: a new Pro member pays the Standard deposit in month 1.
        return {"tier": tier, "rate": DEPOSIT_RATE["standard"], "reason": "pro_first_month"}
    if tier == "pro":
        standing = good_standing(member_id, now)
        if standing["ok"]:
            return {"tier": tier, "rate": 0.0, "reason": "pro_good_standing", "standing": standing}
        return {"tier": tier, "rate": DEPOSIT_RATE["standard"], "reason": "pro_below_good_standing", "standing": standing}
    return {"tier": tier, "rate": DEPOSIT_RATE[tier], "reason": f"{tier}_rate"}


def deposit_quote(member_id: str, expected_total: float, now: datetime | None = None) -> dict[str, Any]:
    terms = deposit_terms(member_id, now)
    return {**terms, "expected_total": round(expected_total, 2), "amount": round(expected_total * terms["rate"], 2)}


def consultation_quote(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    tier, rates = rate_tier(member_id)
    used = 0
    if tier == "pro":
        used = len(rows(db().table("member_consultations").select("id").eq("member_id", member_id)
                        .eq("included", True).neq("status", "cancelled")
                        .gte("created_at", month_start(now).isoformat()).execute()))
    included_left = max(PRO_INCLUDED_CONSULTATIONS - used, 0) if tier == "pro" else 0
    price = 0.0 if included_left else CONSULTATION_PRICE[rates]
    return {"tier": tier, "rank_rate": rates != tier, "price": price, "currency": CURRENCY, "included": bool(included_left),
            "included_left": included_left, "full_price": CONSULTATION_PRICE["free"]}


def contact_status(member_id: str, now: datetime | None = None) -> dict[str, Any]:
    tier = member_tier(member_id)
    credits = sum(int(r.get("delta") or 0) for r in rows(db().table("member_contact_credits").select("delta")
                                                          .eq("member_id", member_id).limit(5000).execute()))
    allowance_left = 0
    if tier == "pro":
        used = len(rows(db().table("member_contact_unlocks").select("id").eq("member_id", member_id)
                        .eq("method", "pro_allowance").gte("created_at", month_start(now).isoformat()).execute()))
        allowance_left = max(PRO_CONTACTS_PER_MONTH - used, 0)
    return {"tier": tier, "credits": max(credits, 0), "pro_allowance_left": allowance_left,
            "pro_allowance": PRO_CONTACTS_PER_MONTH if tier == "pro" else 0,
            "packs": [{"id": key, **value, "currency": CURRENCY} for key, value in CONTACT_PACKS.items()]}


def plan_summary(member_id: str) -> dict[str, Any]:
    now = now_utc()
    terms = deposit_terms(member_id, now)
    return {"tier": terms["tier"], "deposit": {"rate": terms["rate"], "reason": terms["reason"],
                                               "standing": terms.get("standing")},
            "consultation": consultation_quote(member_id, now), "contacts": contact_status(member_id, now)}
