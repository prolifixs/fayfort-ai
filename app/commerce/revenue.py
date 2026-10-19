"""Revenue from Shopify and Stripe (Control Center -> Shop -> Revenue; docs/WORKFORCE_AND_REVENUE_PLAN.md).

GET  /platform/revenue            tiles, the series by stream, mix, top products, countries, memberships
GET  /platform/revenue.csv        the sales behind it
POST /platform/revenue/backfill   one-off import of past Shopify orders (and Stripe invoices when connected)

Everything comes from the `revenue_entries` view: each Shopify sale once (store orders and paid invoices) and each
Stripe membership payment, with refunds. Net = gross - refunds. Amounts are in the store currency (USD); other
currencies are reported beside it, never converted. Days are China time, like the rest of FayFort's reporting.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response

from app.commerce.db import audit, db, rows
from app.directory.identity import trusted_platform_admin

logger = logging.getLogger(__name__)

CHINA = ZoneInfo("Asia/Shanghai")
CURRENCY = "USD"
STREAMS = ("shop", "sourcing", "deposits", "consultations", "contact_credits", "memberships", "other")
STREAM_LABELS = {"shop": "Shop", "sourcing": "Sourcing orders", "deposits": "Deposits", "consultations": "Consultations",
                 "contact_credits": "Contact credits", "memberships": "Memberships", "other": "Other"}
RANGES = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}
MAX_ROWS = 50000
Range = Literal["7d", "30d", "90d", "12m", "custom"]


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        found = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return found if found.tzinfo else found.replace(tzinfo=timezone.utc)


def period(range_key: str, start: date | None, end: date | None, today: date | None = None) -> tuple[date, date]:
    today = today or datetime.now(CHINA).date()
    if range_key == "custom":
        if not start or not end or end < start:
            raise HTTPException(status_code=422, detail="Choose a start and an end date.")
        if (end - start).days > 731:
            raise HTTPException(status_code=422, detail="Choose up to two years at a time.")
        return start, end
    days = RANGES.get(range_key, 30)
    return today - timedelta(days=days - 1), today


def bucket_for(start: date, end: date) -> str:
    span = (end - start).days + 1
    return "day" if span <= 45 else "week" if span <= 190 else "month"


def bucket_key(day: date, bucket: str) -> str:
    if bucket == "week":
        return (day - timedelta(days=day.weekday())).isoformat()
    if bucket == "month":
        return day.replace(day=1).isoformat()
    return day.isoformat()


def bucket_keys(start: date, end: date, bucket: str) -> list[str]:
    keys, cursor = [], start
    while cursor <= end:
        key = bucket_key(cursor, bucket)
        if key not in keys:
            keys.append(key)
        cursor += timedelta(days=1)
    return keys


def entries(start: date, end: date) -> list[dict]:
    since = datetime.combine(start, time(0), CHINA).astimezone(timezone.utc).isoformat()
    until = datetime.combine(end + timedelta(days=1), time(0), CHINA).astimezone(timezone.utc).isoformat()
    return rows(db().table("revenue_entries").select("*").gte("occurred_at", since).lt("occurred_at", until)
                .order("occurred_at").limit(MAX_ROWS).execute())


def _money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _day(entry: dict) -> date | None:
    found = _parse(entry.get("occurred_at"))
    return found.astimezone(CHINA).date() if found else None


def mrr() -> dict:
    """Monthly recurring revenue from active memberships, at the current plan prices."""
    from app.billing.service import KEEPS_PLAN, monthly_amount
    subs = rows(db().table("member_subscriptions").select("plan,status").limit(10000).execute())
    counts = {plan: sum(1 for s in subs if s.get("plan") == plan and s.get("status") in KEEPS_PLAN) for plan in ("standard", "pro")}
    return {"amount": round(sum(monthly_amount(plan) * count for plan, count in counts.items()), 2), "members": counts}


def report(start: date, end: date) -> dict:
    found = entries(start, end)
    span = (end - start).days + 1
    previous = entries(start - timedelta(days=span), start - timedelta(days=1))
    bucket = bucket_for(start, end)
    keys = bucket_keys(start, end, bucket)
    series = {key: {stream: 0.0 for stream in STREAMS} for key in keys}
    mix = {stream: {"gross": 0.0, "refunds": 0.0, "net": 0.0, "count": 0} for stream in STREAMS}
    other_currencies: dict[str, float] = {}
    gross = refunds = 0.0
    customers: set[str] = set()
    orders = 0
    products: dict[str, dict] = {}
    countries: dict[str, float] = {}
    for entry in found:
        currency = str(entry.get("currency") or CURRENCY).upper()
        g, r = _money(entry.get("gross")), _money(entry.get("refunded"))
        if currency != CURRENCY:
            other_currencies[currency] = round(other_currencies.get(currency, 0) + g - r, 2)
            continue
        stream = entry.get("stream") if entry.get("stream") in STREAMS else "other"
        day = _day(entry)
        if day:
            key = bucket_key(day, bucket)
            if key in series:
                series[key][stream] = round(series[key][stream] + g - r, 2)
        gross, refunds = gross + g, refunds + r
        mix[stream]["gross"] += g
        mix[stream]["refunds"] += r
        mix[stream]["net"] += g - r
        mix[stream]["count"] += 1
        orders += 1
        if entry.get("member_id"):
            customers.add(str(entry["member_id"]))
        if entry.get("country"):
            countries[entry["country"]] = countries.get(entry["country"], 0) + g - r
        if stream == "shop":
            for line in entry.get("line_items") or []:
                title = str(line.get("title") or "").strip()
                if not title:
                    continue
                quantity = int(line.get("quantity") or 1)
                item = products.setdefault(title, {"title": title, "revenue": 0.0, "quantity": 0})
                item["revenue"] += _money(line.get("price")) * quantity
                item["quantity"] += quantity
    previous_net = sum(_money(e.get("gross")) - _money(e.get("refunded")) for e in previous
                       if str(e.get("currency") or CURRENCY).upper() == CURRENCY)
    net = gross - refunds
    sources = {"shopify": round(sum(v["net"] for k, v in mix.items() if k != "memberships"), 2),
               "stripe": round(mix["memberships"]["net"], 2)}
    from app.billing import stripe_api
    earliest = rows(db().table("revenue_entries").select("occurred_at").order("occurred_at").limit(1).execute())
    return {
        "range": {"start": start.isoformat(), "end": end.isoformat(), "bucket": bucket, "time_zone": "China time"},
        "currency": CURRENCY,
        "tiles": {
            "gross": round(gross, 2), "refunds": round(refunds, 2), "net": round(net, 2), "sales": orders,
            "average_sale": round(net / orders, 2) if orders else None, "paying_customers": len(customers),
            "previous_net": round(previous_net, 2),
            "change": round((net - previous_net) / previous_net, 4) if previous_net else None,
            "mrr": mrr(),
        },
        "streams": [{"key": key, "label": STREAM_LABELS[key]} for key in STREAMS],
        "series": [{"bucket": key, **{stream: round(value, 2) for stream, value in series[key].items()}} for key in keys],
        "mix": [{"key": key, "label": STREAM_LABELS[key], **{k: round(v, 2) if isinstance(v, float) else v
                                                             for k, v in mix[key].items()}} for key in STREAMS],
        "sources": sources,
        "top_products": sorted(({**p, "revenue": round(p["revenue"], 2)} for p in products.values()),
                               key=lambda p: -p["revenue"])[:8],
        "countries": sorted(({"country": c, "net": round(v, 2)} for c, v in countries.items()), key=lambda c: -c["net"])[:10],
        "other_currencies": other_currencies,
        "stripe_connected": stripe_api.configured(),
        "data_since": (earliest[0]["occurred_at"] if earliest else None),
    }


def backfill(days: int = 365) -> dict:
    """Import past Shopify orders that aren't saved yet, and past Stripe membership invoices."""
    from app.commerce import shopify
    from app.commerce.service import record_order
    result = {"shopify_imported": 0, "shopify_seen": 0, "stripe_customers": 0, "notes": []}
    if shopify.admin_configured():
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        try:
            for order in shopify.iter_orders(since):
                result["shopify_seen"] += 1
                if record_order(order, backfill=True).get("imported"):
                    result["shopify_imported"] += 1
        except shopify.ShopifyError as exc:
            result["notes"].append(str(exc))
        if result["shopify_seen"] and days > 60:
            result["notes"].append("Shopify shares the last 60 days of orders unless the app has the read_all_orders "
                                   "permission. Approve it in Shopify to import older orders.")
    else:
        result["notes"].append("Shopify isn't connected.")
    from app.billing import service as billing, stripe_api
    if stripe_api.configured():
        result["stripe_customers"] = billing.reconcile()
    else:
        result["notes"].append("Stripe isn't connected, so there are no membership payments to import.")
    return result


def create_revenue_router() -> APIRouter:
    router = APIRouter(tags=["revenue"])

    def admin(authorization: str | None) -> str:
        found = trusted_platform_admin(authorization)
        if not found:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return found["user_id"]

    @router.get("/platform/revenue")
    def get_revenue(range: Range = Query(default="30d"), start: date | None = None, end: date | None = None,
                    authorization: str | None = Header(default=None)):
        admin(authorization)
        first, last = period(range, start, end)
        try:
            return report(first, last)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Revenue could not be loaded")
            raise HTTPException(status_code=503, detail="Revenue could not be loaded.") from exc

    @router.get("/platform/revenue.csv")
    def revenue_csv(range: Range = Query(default="30d"), start: date | None = None, end: date | None = None,
                    authorization: str | None = Header(default=None)):
        admin(authorization)
        first, last = period(range, start, end)
        try:
            found = entries(first, last)
        except Exception as exc:
            logger.exception("Revenue export failed")
            raise HTTPException(status_code=503, detail="The export could not be made.") from exc
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["Date (China time)", "Stream", "Source", "Reference", "Gross", "Refunded", "Net", "Currency", "Country"])
        for entry in found:
            when = _parse(entry.get("occurred_at"))
            g, r = _money(entry.get("gross")), _money(entry.get("refunded"))
            writer.writerow([when.astimezone(CHINA).strftime("%Y-%m-%d %H:%M") if when else "",
                             STREAM_LABELS.get(entry.get("stream"), "Other"), entry.get("source"), entry.get("reference") or "",
                             f"{g:.2f}", f"{r:.2f}", f"{g - r:.2f}", entry.get("currency"), entry.get("country") or ""])
        return Response(out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="fayfort-revenue-{first}-{last}.csv"'})

    @router.post("/platform/revenue/backfill")
    def run_backfill(authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        try:
            result = backfill()
        except Exception as exc:
            logger.exception("Revenue history import failed")
            raise HTTPException(status_code=503, detail="The history import failed. Try again in a minute.") from exc
        audit(actor, "revenue.backfill", {k: v for k, v in result.items() if k != "notes"})
        return result

    return router
