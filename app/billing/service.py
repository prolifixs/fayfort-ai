"""Member plan billing (Stripe). docs/MEMBERSHIP_PLAN.md, section 1 and 5.

Only STRIPE_SECRET_KEY is needed. `ensure_setup()` (run at start and from Control Center) creates, once:
- a "FayFort Standard" and a "FayFort Pro" product with a monthly price (MEMBER_*_MONTHLY_PRICE), found again by
  lookup key so nothing is duplicated;
- a customer-portal configuration (switch plan, update card, cancel at period end, invoice history);
- the webhook endpoint at PUBLIC_API_URL/billing/stripe/webhook, keeping its signing secret in billing_settings.

Stripe is the source of truth. Webhooks keep member_subscriptions current, and a reconcile pass every
BILLING_SYNC_INTERVAL_SECONDS repairs anything a missed webhook left behind. member_profiles.member_tier follows the
subscription: active, trialing and past_due (Stripe still retrying the card) keep the plan; anything else (and a
paused subscription) is Free.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.billing import stripe_api
from app.commerce.db import db, one, rows
from app.config.settings import settings

logger = logging.getLogger(__name__)

PLANS = ("standard", "pro")
PLAN_NAMES = {"standard": "FayFort Standard", "pro": "FayFort Pro"}
KEEPS_PLAN = ("active", "trialing", "past_due")
WEBHOOK_PATH = "/billing/stripe/webhook"
WEBHOOK_EVENTS = [
    "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed",
    "invoice.paid", "invoice.payment_failed",
]
SUBSCRIPTION_POINTS = {"standard": 50, "pro": 100}  # per paid month, toward rank (ranks.py)


class BillingError(Exception):
    """A problem the member or staff can act on (shown as-is)."""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _ts(value: Any) -> str | None:
    return datetime.fromtimestamp(int(value), timezone.utc).isoformat() if value else None


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------------------------
# Stored setup
# ---------------------------------------------------------------------------------------------
def get_setting(key: str) -> str | None:
    found = one(db().table("billing_settings").select("value").eq("key", key).limit(1).execute())
    return (found or {}).get("value")


def set_setting(key: str, value: str) -> None:
    db().table("billing_settings").upsert({"key": key, "value": value, "updated_at": now_utc().isoformat()},
                                          on_conflict="key").execute()


def monthly_amount(plan: str) -> float:
    return float(settings.MEMBER_PRO_MONTHLY_PRICE if plan == "pro" else settings.MEMBER_STANDARD_MONTHLY_PRICE)


def lookup_key(plan: str) -> str:
    cents = int(round(monthly_amount(plan) * 100))
    return f"fayfort_{plan}_monthly_{settings.BILLING_CURRENCY.lower()}_{cents}"


def price_ids() -> dict[str, str]:
    """plan -> Stripe price id (env override, else the one FayFort created)."""
    out = {}
    for plan in PLANS:
        override = (settings.STRIPE_PRICE_PRO if plan == "pro" else settings.STRIPE_PRICE_STANDARD).strip()
        stored = get_setting(f"price_{plan}")
        if override or stored:
            out[plan] = override or stored
    return out


def plan_for_price(price_id: str | None) -> str | None:
    for plan, pid in price_ids().items():
        if pid == price_id:
            return plan
    return None


def webhook_url() -> str | None:
    base = settings.PUBLIC_API_URL.strip().rstrip("/")
    return f"{base}{WEBHOOK_PATH}" if base.startswith("https://") else None


def webhook_secret() -> str:
    return settings.STRIPE_WEBHOOK_SECRET.strip() or (get_setting("webhook_secret") or "")


def _ensure_price(plan: str) -> str:
    override = (settings.STRIPE_PRICE_PRO if plan == "pro" else settings.STRIPE_PRICE_STANDARD).strip()
    if override:
        set_setting(f"price_{plan}", override)
        return override
    key = lookup_key(plan)
    found = stripe_api.request("GET", "/prices", params={"lookup_keys": [key], "active": True, "limit": 1})
    if found.get("data"):
        price_id = found["data"][0]["id"]
    else:
        product_id = get_setting(f"product_{plan}")
        if product_id:
            try:
                product = stripe_api.request("GET", f"/products/{product_id}")
                if not product.get("active", True):
                    product_id = None
            except stripe_api.StripeError:
                product_id = None
        if not product_id:
            product = stripe_api.request("POST", "/products", {
                "name": PLAN_NAMES[plan], "metadata": {"fayfort_plan": plan},
                "description": "FayFort member plan, billed monthly."}, idempotency_key=f"fayfort-product-{plan}-{stripe_api.mode()}")
            product_id = product["id"]
            set_setting(f"product_{plan}", product_id)
        price = stripe_api.request("POST", "/prices", {
            "product": product_id, "currency": settings.BILLING_CURRENCY.lower(),
            "unit_amount": int(round(monthly_amount(plan) * 100)), "recurring": {"interval": "month"},
            "lookup_key": key, "transfer_lookup_key": True, "metadata": {"fayfort_plan": plan}})
        price_id = price["id"]
    set_setting(f"price_{plan}", price_id)
    return price_id


def _ensure_portal(prices: dict[str, str]) -> str:
    signature = hashlib.sha256(",".join(f"{p}:{prices[p]}" for p in sorted(prices)).encode()).hexdigest()[:16]
    stored = get_setting("portal_configuration")
    if stored and get_setting("portal_signature") == signature:
        return stored
    products = []
    for plan, price_id in prices.items():
        price = stripe_api.request("GET", f"/prices/{price_id}")
        products.append({"product": price["product"], "prices": [price_id]})
    config = stripe_api.request("POST", "/billing_portal/configurations", {
        "business_profile": {"headline": "Manage your FayFort membership"},
        "default_return_url": settings.APP_PUBLIC_URL.rstrip("/") + "/member/chat",
        "features": {
            "invoice_history": {"enabled": True},
            "payment_method_update": {"enabled": True},
            "customer_update": {"enabled": True, "allowed_updates": ["email", "address"]},
            "subscription_cancel": {"enabled": True, "mode": "at_period_end",
                                    "cancellation_reason": {"enabled": True, "options": [
                                        "too_expensive", "unused", "missing_features", "other"]}},
            "subscription_update": {"enabled": True, "default_allowed_updates": ["price"],
                                    "proration_behavior": "create_prorations", "products": products},
        },
        "metadata": {"fayfort": "membership"},
    })
    set_setting("portal_configuration", config["id"])
    set_setting("portal_signature", signature)
    return config["id"]


def _ensure_webhook() -> str:
    if settings.STRIPE_WEBHOOK_SECRET.strip():
        return "env"
    url = webhook_url()
    if not url:
        raise BillingError("PUBLIC_API_URL must be an https address so Stripe can reach the webhook.")
    stored_id, stored_secret = get_setting("webhook_id"), get_setting("webhook_secret")
    if stored_id and stored_secret and get_setting("webhook_mode") == stripe_api.mode():
        try:
            endpoint = stripe_api.request("GET", f"/webhook_endpoints/{stored_id}")
            if endpoint.get("url") == url and endpoint.get("status") == "enabled":
                missing = [e for e in WEBHOOK_EVENTS if e not in endpoint.get("enabled_events", [])]
                if missing:
                    stripe_api.request("POST", f"/webhook_endpoints/{stored_id}", {"enabled_events": WEBHOOK_EVENTS})
                return stored_id
        except stripe_api.StripeError:
            pass
    # The signing secret is only shown at creation, so an endpoint we can't read the secret of is replaced.
    existing = stripe_api.request("GET", "/webhook_endpoints", params={"limit": 100}).get("data") or []
    for endpoint in existing:
        if endpoint.get("url") == url:
            stripe_api.request("DELETE", f"/webhook_endpoints/{endpoint['id']}")
    created = stripe_api.request("POST", "/webhook_endpoints", {
        "url": url, "enabled_events": WEBHOOK_EVENTS, "api_version": stripe_api.API_VERSION,
        "description": "FayFort member plans", "metadata": {"fayfort": "membership"}})
    set_setting("webhook_id", created["id"])
    set_setting("webhook_secret", created["secret"])
    set_setting("webhook_mode", stripe_api.mode())
    return created["id"]


def ensure_setup() -> dict[str, Any]:
    """Create (or find) everything FayFort needs in Stripe. Safe to run again at any time."""
    if not stripe_api.configured():
        return status()
    problems = []
    prices = {}
    try:
        prices = {plan: _ensure_price(plan) for plan in PLANS}
        _ensure_portal(prices)
    except (stripe_api.StripeError, BillingError) as exc:
        problems.append(f"Plans: {exc}")
    try:
        _ensure_webhook()
    except (stripe_api.StripeError, BillingError) as exc:
        problems.append(f"Webhook: {exc}")
    set_setting("setup_checked_at", now_utc().isoformat())
    set_setting("setup_mode", stripe_api.mode())
    set_setting("setup_problem", "; ".join(problems)[:1900] or "-")
    return status()


def status() -> dict[str, Any]:
    configured = stripe_api.configured()
    problem = get_setting("setup_problem") if configured else None
    prices = price_ids() if configured else {}
    subs = rows(db().table("member_subscriptions").select("plan,status").limit(10000).execute())
    counts = {plan: sum(1 for s in subs if s.get("plan") == plan and s.get("status") in KEEPS_PLAN) for plan in PLANS}
    return {
        "configured": configured, "mode": stripe_api.mode(),
        "ready": configured and len(prices) == 2 and bool(webhook_secret()) and problem in (None, "-"),
        "prices": {plan: {"id": prices.get(plan), "monthly": monthly_amount(plan),
                          "currency": settings.BILLING_CURRENCY.lower()} for plan in PLANS},
        "webhook": {"url": webhook_url(), "ready": bool(webhook_secret()),
                    "managed_by": "env" if settings.STRIPE_WEBHOOK_SECRET.strip() else "fayfort"},
        "problem": None if problem in (None, "-") else problem,
        "checked_at": get_setting("setup_checked_at") if configured else None,
        "subscribers": counts,
    }


# ---------------------------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------------------------
def subscription_row(member_id: str) -> dict | None:
    return one(db().table("member_subscriptions").select("*").eq("member_id", member_id).limit(1).execute())


def member_view(member_id: str) -> dict[str, Any]:
    row = subscription_row(member_id) or {}
    plan = row.get("plan") if row.get("status") in KEEPS_PLAN else None
    since = _parse(row.get("continuous_since"))
    months = 0
    if since and plan:
        months = max(1, int((now_utc() - since).days // 30) + 1)
    return {
        "available": stripe_api.configured() and len(price_ids()) == 2,
        "plan": plan, "status": row.get("status") or "none",
        "paused": row.get("status") == "paused",
        "current_period_end": row.get("current_period_end"),
        "cancel_at_period_end": bool(row.get("cancel_at_period_end")),
        "continuous_since": row.get("continuous_since"), "months": months,
        "has_customer": bool(row.get("stripe_customer_id")),
        "prices": {p: {"monthly": monthly_amount(p), "currency": settings.BILLING_CURRENCY.lower()} for p in PLANS},
        "max_pause_months": settings.SUBSCRIPTION_MAX_PAUSE_MONTHS,
    }


def _member_email(member_id: str) -> str | None:
    from app.commerce.service import member_email
    return member_email(member_id)


def customer_for(member_id: str) -> str:
    row = subscription_row(member_id)
    if row and row.get("stripe_customer_id"):
        return str(row["stripe_customer_id"])
    customer = stripe_api.request("POST", "/customers", {
        "email": _member_email(member_id), "metadata": {"fayfort_member_id": member_id}},
        idempotency_key=f"fayfort-customer-{member_id}-{stripe_api.mode()}")
    db().table("member_subscriptions").upsert({"member_id": member_id, "stripe_customer_id": customer["id"],
                                               "updated_at": now_utc().isoformat()}, on_conflict="member_id").execute()
    return str(customer["id"])


def start_checkout(member_id: str, plan: str) -> str:
    if plan not in PLANS:
        raise BillingError("Choose Standard or Pro.")
    prices = price_ids()
    if len(prices) < 2:
        raise BillingError("Plan upgrades aren't open yet. Please try again later.")
    row = subscription_row(member_id) or {}
    if row.get("status") in KEEPS_PLAN + ("paused",) and row.get("stripe_subscription_id"):
        raise BillingError("You already have a plan. Use Manage subscription to switch or change it.")
    app = settings.APP_PUBLIC_URL.rstrip("/")
    session = stripe_api.request("POST", "/checkout/sessions", {
        "mode": "subscription", "customer": customer_for(member_id), "client_reference_id": member_id,
        "line_items": [{"price": prices[plan], "quantity": 1}],
        "subscription_data": {"metadata": {"fayfort_member_id": member_id, "fayfort_plan": plan}},
        "metadata": {"fayfort_member_id": member_id, "fayfort_plan": plan},
        "allow_promotion_codes": True,
        "success_url": f"{app}/member/chat?billing=success",
        "cancel_url": f"{app}/member/chat?billing=cancelled",
    })
    return str(session["url"])


def portal_url(member_id: str) -> str:
    row = subscription_row(member_id) or {}
    if not row.get("stripe_customer_id"):
        raise BillingError("You don't have a subscription yet.")
    config = get_setting("portal_configuration")
    body = {"customer": row["stripe_customer_id"], "return_url": settings.APP_PUBLIC_URL.rstrip("/") + "/member/chat"}
    if config:
        body["configuration"] = config
    return str(stripe_api.request("POST", "/billing_portal/sessions", body)["url"])


def pause(member_id: str, months: int) -> dict:
    """Pause instead of cancelling: no charge, plan perks off, continuous-months count and history kept."""
    months = max(1, min(int(months), settings.SUBSCRIPTION_MAX_PAUSE_MONTHS))
    row = subscription_row(member_id) or {}
    if row.get("status") not in KEEPS_PLAN or not row.get("stripe_subscription_id"):
        raise BillingError("Only an active plan can be paused.")
    resumes = int((now_utc() + timedelta(days=30 * months)).timestamp())
    sub = stripe_api.request("POST", f"/subscriptions/{row['stripe_subscription_id']}", {
        "pause_collection": {"behavior": "void", "resumes_at": resumes}})
    sync_subscription(sub)
    return member_view(member_id)


def resume(member_id: str) -> dict:
    row = subscription_row(member_id) or {}
    if not row.get("stripe_subscription_id"):
        raise BillingError("There's no plan to resume.")
    sub = stripe_api.request("POST", f"/subscriptions/{row['stripe_subscription_id']}", {"pause_collection": ""})
    sync_subscription(sub)
    return member_view(member_id)


# ---------------------------------------------------------------------------------------------
# Sync (webhooks + reconcile)
# ---------------------------------------------------------------------------------------------
def _member_for(customer_id: str | None, metadata: dict | None) -> str | None:
    member_id = (metadata or {}).get("fayfort_member_id")
    if member_id:
        return str(member_id)
    if customer_id:
        found = one(db().table("member_subscriptions").select("member_id").eq("stripe_customer_id", customer_id)
                    .limit(1).execute())
        if found:
            return str(found["member_id"])
        try:
            customer = stripe_api.request("GET", f"/customers/{customer_id}")
            return (customer.get("metadata") or {}).get("fayfort_member_id")
        except stripe_api.StripeError:
            return None
    return None


def _set_tier(member_id: str, plan: str | None) -> None:
    db().table("member_profiles").update({"member_tier": plan or "free", "updated_at": now_utc().isoformat()}) \
        .eq("user_id", member_id).execute()


def sync_subscription(sub: dict) -> str | None:
    """Mirror one Stripe subscription onto the member. Returns the member id."""
    customer_id = sub.get("customer") if isinstance(sub.get("customer"), str) else (sub.get("customer") or {}).get("id")
    member_id = _member_for(customer_id, sub.get("metadata"))
    if not member_id:
        logger.warning("Stripe subscription %s has no FayFort member", sub.get("id"))
        return None
    items = ((sub.get("items") or {}).get("data") or [])
    price_id = ((items[0] if items else {}).get("price") or {}).get("id")
    plan = plan_for_price(price_id) or (sub.get("metadata") or {}).get("fayfort_plan")
    plan = plan if plan in PLANS else None
    status_value = str(sub.get("status") or "none")
    if sub.get("pause_collection") and status_value == "active":
        status_value = "paused"
    row = subscription_row(member_id) or {}
    # An old subscription's events must not overwrite the member's current one.
    if (row.get("stripe_subscription_id") and row["stripe_subscription_id"] != sub.get("id")
            and row.get("status") in KEEPS_PLAN + ("paused",) and status_value not in KEEPS_PLAN + ("paused",)):
        return member_id
    now = now_utc()
    values: dict[str, Any] = {
        "member_id": member_id, "stripe_customer_id": customer_id, "stripe_subscription_id": sub.get("id"),
        "plan": plan, "status": status_value, "current_period_end": _ts(sub.get("current_period_end")),
        "cancel_at_period_end": bool(sub.get("cancel_at_period_end")), "updated_at": now.isoformat(),
    }
    if status_value in KEEPS_PLAN:
        since, ended = _parse(row.get("continuous_since")), _parse(row.get("ended_at"))
        back_in_time = ended is None or now - ended <= timedelta(days=settings.SUBSCRIPTION_RETURN_GRACE_DAYS)
        if not since or not back_in_time:
            since = datetime.fromtimestamp(int(sub.get("start_date") or now.timestamp()), timezone.utc)
        values["continuous_since"] = since.isoformat()
        values["ended_at"] = None
    elif status_value == "paused":
        values["continuous_since"] = row.get("continuous_since")  # kept while paused
    else:
        values["ended_at"] = row.get("ended_at") or _ts(sub.get("ended_at")) or now.isoformat()
    db().table("member_subscriptions").upsert(values, on_conflict="member_id").execute()
    _set_tier(member_id, plan if status_value in KEEPS_PLAN else None)
    _refresh_rank(member_id)
    return member_id


def record_invoice_paid(invoice: dict) -> str | None:
    """A paid subscription invoice = one month subscribed (counts toward rank)."""
    if not invoice.get("subscription") or not invoice.get("id") or float(invoice.get("amount_paid") or 0) <= 0:
        return None
    customer_id = invoice.get("customer")
    lines = ((invoice.get("lines") or {}).get("data") or [])
    price_id = ((lines[0] if lines else {}).get("price") or {}).get("id")
    member_id = _member_for(customer_id, (invoice.get("subscription_details") or {}).get("metadata"))
    plan = plan_for_price(price_id)
    if not member_id or plan not in PLANS:
        return None
    paid_at = _ts((invoice.get("status_transitions") or {}).get("paid_at") or invoice.get("created"))
    db().table("member_subscription_payments").upsert({
        "stripe_invoice_id": invoice["id"], "member_id": member_id, "plan": plan,
        "amount": round(float(invoice.get("amount_paid") or 0) / 100, 2),
        "currency": invoice.get("currency") or settings.BILLING_CURRENCY, "paid_at": paid_at},
        on_conflict="stripe_invoice_id", ignore_duplicates=True).execute()
    _refresh_rank(member_id)
    return member_id


def _refresh_rank(member_id: str) -> None:
    from app.membership import ranks
    ranks.safe_recompute(member_id)


def handle_event(event: dict) -> str:
    """Process one verified webhook event once. Returns processed / ignored / duplicate."""
    event_id, kind = str(event.get("id") or ""), str(event.get("type") or "")
    if not event_id.startswith("evt_"):
        return "ignored"
    previous = one(db().table("billing_webhook_events").select("status").eq("stripe_event_id", event_id)
                   .limit(1).execute())
    if previous and previous.get("status") in ("processed", "ignored"):
        return "duplicate"
    if not previous:
        try:
            db().table("billing_webhook_events").insert({"stripe_event_id": event_id, "event_type": kind}).execute()
        except Exception as exc:  # a parallel delivery got there first; process anyway (handlers are idempotent)
            if "duplicate" not in str(exc).casefold() and "unique" not in str(exc).casefold():
                raise
    obj = (event.get("data") or {}).get("object") or {}
    try:
        result = "ignored"
        if kind == "checkout.session.completed" and obj.get("subscription"):
            sync_subscription(stripe_api.request("GET", f"/subscriptions/{obj['subscription']}"))
            result = "processed"
        elif kind.startswith("customer.subscription."):
            # Re-read: events can arrive out of order; the live object is the truth.
            sub = stripe_api.request("GET", f"/subscriptions/{obj['id']}") if obj.get("id") else obj
            sync_subscription(sub)
            result = "processed"
        elif kind == "invoice.paid":
            record_invoice_paid(obj)
            if obj.get("subscription"):
                sync_subscription(stripe_api.request("GET", f"/subscriptions/{obj['subscription']}"))
            result = "processed"
        elif kind == "invoice.payment_failed" and obj.get("subscription"):
            sync_subscription(stripe_api.request("GET", f"/subscriptions/{obj['subscription']}"))
            result = "processed"
        db().table("billing_webhook_events").update({"status": result, "error": None}) \
            .eq("stripe_event_id", event_id).execute()
        return result
    except Exception as exc:
        db().table("billing_webhook_events").update({"status": "failed", "error": str(exc)[:500]}) \
            .eq("stripe_event_id", event_id).execute()
        raise


def reconcile(limit: int = 500) -> int:
    """Re-read every known customer's subscriptions and paid invoices from Stripe."""
    synced = 0
    for row in rows(db().table("member_subscriptions").select("member_id,stripe_customer_id")
                    .limit(limit).execute()):
        customer = row.get("stripe_customer_id")
        if not customer:
            continue
        try:
            subs = stripe_api.request("GET", "/subscriptions", params={"customer": customer, "status": "all",
                                                                        "limit": 5}).get("data") or []
            current = sorted(subs, key=lambda s: (s.get("status") in KEEPS_PLAN, s.get("created") or 0), reverse=True)
            if current:
                sync_subscription(current[0])
            for invoice in stripe_api.request("GET", "/invoices", params={"customer": customer, "status": "paid",
                                                                           "limit": 12}).get("data") or []:
                record_invoice_paid(invoice)
            synced += 1
        except Exception:
            logger.exception("Could not reconcile Stripe customer %s", customer)
    return synced


async def billing_loop() -> None:
    await asyncio.sleep(30)
    while True:
        if stripe_api.configured():
            try:
                result = await asyncio.to_thread(ensure_setup)
                if result.get("problem"):
                    logger.warning("Stripe setup needs attention: %s", result["problem"])
                synced = await asyncio.to_thread(reconcile)
                logger.info("Stripe billing checked (%s, %s customer(s) reconciled)", stripe_api.mode(), synced)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Stripe billing check failed; will retry")
        await asyncio.sleep(max(int(settings.BILLING_SYNC_INTERVAL_SECONDS), 300))
