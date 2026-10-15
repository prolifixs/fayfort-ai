"""P4 the FayFort intent score. Pure functions so the maths can be tested and studied on its own.

score = relevance to the session intent
        x availability (in stock now beats sourcing)
        x price fit (the member's usual price band)
        x social proof (Heat: unique members acting on it recently)
        x urgency (sale ending soon, low stock, pool close to full)

Intent is built from the member's last two hours of signals. Stronger signals count more
(pasted link > add to cart > repeat view > search > category tap) and every signal fades with a
30-minute half-life, so the feed follows the member's attention instead of their history.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from statistics import median
from typing import Any, Iterable

EVENT_WEIGHTS = {
    "paste_link": 5.0,
    "want": 4.0,
    "add_to_cart": 4.0,
    "checkout": 3.0,
    "save": 3.0,
    "view": 1.5,
    "search": 2.0,
    "category": 1.0,
}
INTENT_HALF_LIFE_MINUTES = 30.0
INTENT_WINDOW_MINUTES = 120
HEAT_HALF_LIFE_HOURS = 48.0
HEAT_WINDOW_DAYS = 7
_WORD = re.compile(r"[a-z0-9]+")
STOP_WORDS = {"the", "and", "for", "with", "you", "your", "this", "that", "from", "are", "have", "want", "need",
              "looking", "find", "can", "get", "how", "what", "any", "some", "please", "like", "http", "https", "www",
              "com"}


def parse_time(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def terms(text: str | None) -> list[str]:
    words = [w for w in _WORD.findall((text or "").casefold()) if len(w) > 2 and w not in STOP_WORDS]
    return list(dict.fromkeys(words))[:12]


def decay(age_minutes: float, half_life: float) -> float:
    return math.pow(0.5, max(age_minutes, 0.0) / half_life)


@dataclass
class Intent:
    categories: dict[str, float] = field(default_factory=dict)
    groups: dict[str, float] = field(default_factory=dict)
    words: dict[str, float] = field(default_factory=dict)
    products: dict[str, float] = field(default_factory=dict)
    price_band: tuple[float, float] | None = None
    strength: float = 0.0

    @property
    def active(self) -> bool:
        return self.strength >= 1.0

    def summary(self) -> dict:
        top = lambda d: [k for k, _ in sorted(d.items(), key=lambda kv: -kv[1])[:3]]
        return {"active": self.active, "strength": round(self.strength, 2), "categories": top(self.categories),
                "groups": top(self.groups), "words": top(self.words),
                "price_band": [round(self.price_band[0], 2), round(self.price_band[1], 2)] if self.price_band else None}


def build_intent(events: Iterable[dict], *, products: dict[str, dict] | None = None,
                 category_groups: dict[str, str] | None = None, now: datetime | None = None) -> Intent:
    """events: rows of commerce_intent_events (newest first or any order)."""
    now = now or datetime.now(timezone.utc)
    products = products or {}
    category_groups = category_groups or {}
    intent = Intent()
    prices: list[float] = []
    for event in events:
        age = (now - parse_time(event.get("created_at"))).total_seconds() / 60.0
        if age > INTENT_WINDOW_MINUTES:
            continue
        weight = EVENT_WEIGHTS.get(str(event.get("event_type")), 0.5) * decay(age, INTENT_HALF_LIFE_MINUTES)
        intent.strength += weight
        product = products.get(str(event.get("product_id") or "")) if event.get("product_id") else None
        category = event.get("category_ref") or (product or {}).get("category_ref")
        if category:
            intent.categories[category] = intent.categories.get(category, 0.0) + weight
            group = category_groups.get(category)
            if group:
                intent.groups[group] = intent.groups.get(group, 0.0) + weight
        if event.get("product_id"):
            key = str(event["product_id"])
            intent.products[key] = intent.products.get(key, 0.0) + weight
        for word in terms(event.get("query")) + terms((product or {}).get("name")):
            intent.words[word] = intent.words.get(word, 0.0) + weight
        price = event.get("price") or (product or {}).get("price_min")
        if price:
            try:
                prices.append(float(price))
            except (TypeError, ValueError):
                pass
    if prices:
        middle = median(prices)
        intent.price_band = (middle * 0.5, middle * 1.6)
    return intent


def heat_scores(events: Iterable[dict], *, now: datetime | None = None) -> dict[str, float]:
    """FayFort-wide Heat per product: unique members acting on it, recent actions counting more."""
    now = now or datetime.now(timezone.utc)
    best: dict[tuple[str, str], float] = {}
    for event in events:
        product_id = event.get("product_id")
        if not product_id:
            continue
        age_hours = (now - parse_time(event.get("created_at"))).total_seconds() / 3600.0
        if age_hours > HEAT_WINDOW_DAYS * 24:
            continue
        weight = EVENT_WEIGHTS.get(str(event.get("event_type")), 0.5) * decay(age_hours, HEAT_HALF_LIFE_HOURS)
        key = (str(product_id), str(event.get("member_id")))
        best[key] = max(best.get(key, 0.0), weight)  # one member can't inflate an item by repeating clicks
    heat: dict[str, float] = defaultdict(float)
    for (product_id, _member), weight in best.items():
        heat[product_id] += weight
    return dict(heat)


def relevance(product: dict, intent: Intent, query_terms: list[str] | None = None) -> float:
    """0..1-ish match between a product and the intent (or an explicit query)."""
    text = " ".join(str(product.get(k) or "") for k in ("name", "description", "category_ref", "product_type",
                                                          "vendor")).casefold()
    text += " " + " ".join(str(t).casefold() for t in product.get("tags") or [])
    score = 0.0
    if query_terms:
        hits = sum(1 for word in query_terms if word in text)
        name_hits = sum(1 for word in query_terms if word in str(product.get("name") or "").casefold())
        score += (hits + 0.5 * name_hits) / max(len(query_terms), 1)
    if intent.categories:
        total = sum(intent.categories.values()) or 1.0
        score += 0.6 * intent.categories.get(str(product.get("category_ref")), 0.0) / total
    if intent.groups:
        total = sum(intent.groups.values()) or 1.0
        score += 0.25 * intent.groups.get(str(product.get("group_name")), 0.0) / total
    if intent.words:
        total = sum(intent.words.values()) or 1.0
        score += 0.4 * sum(weight for word, weight in intent.words.items() if word in text) / total
    if intent.products.get(str(product.get("id"))):
        score += 0.2  # recently viewed items stay reachable, without dominating
    return score


def availability_factor(product: dict) -> float:
    if product.get("source") == "shopify":
        return 1.0 if product.get("in_stock") else 0.45
    status = product.get("availability_status")
    return {"available": 0.9, "sourcing": 0.7}.get(str(status), 0.3)


def price_fit(product: dict, intent: Intent) -> float:
    price = product.get("sale_price") or product.get("price_min")
    if not intent.price_band or not price:
        return 1.0
    low, high = intent.price_band
    price = float(price)
    if low <= price <= high:
        return 1.0
    distance = (low - price) / low if price < low else (price - high) / high
    return max(0.55, 1.0 - 0.5 * distance)


def social_factor(heat: float) -> float:
    return 1.0 + 0.35 * math.log1p(max(heat, 0.0))


def urgency_factor(product: dict, *, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    factor = 1.0
    sale = product.get("sale")
    if sale and sale.get("ends_at"):
        hours_left = (parse_time(sale["ends_at"]) - now).total_seconds() / 3600.0
        if 0 < hours_left <= 24:
            factor += 0.25
        elif 0 < hours_left <= 72:
            factor += 0.1
    quantity = product.get("total_inventory")
    if product.get("in_stock") and isinstance(quantity, int) and 0 < quantity <= 5:
        factor += 0.1
    return factor


def score(product: dict, intent: Intent, *, heat: float = 0.0, query_terms: list[str] | None = None,
          now: datetime | None = None) -> float:
    base = relevance(product, intent, query_terms)
    if not query_terms and not intent.active:
        base = 0.05  # no intent yet: Heat and urgency decide
    return (base + 0.05) * availability_factor(product) * price_fit(product, intent) * social_factor(heat) \
        * urgency_factor(product, now=now)


def diversify(ranked: list[dict], *, max_run: int = 2) -> list[dict]:
    """No more than `max_run` cards in a row from one category, keeping the ranking otherwise."""
    result: list[dict] = []
    waiting = list(ranked)
    while waiting:
        for index, item in enumerate(waiting):
            tail = [r.get("category_ref") for r in result[-max_run:]]
            if len(tail) < max_run or any(c != item.get("category_ref") for c in tail) or not item.get("category_ref"):
                result.append(waiting.pop(index))
                break
        else:
            result.append(waiting.pop(0))
    return result


def sale_price(price: float | None, sale: dict | None) -> float | None:
    if price is None or not sale:
        return None
    value = float(sale.get("value") or 0)
    if sale.get("discount_type") == "percentage":
        return round(max(price * (1 - value / 100.0), 0.0), 2)
    return round(max(price - value, 0.0), 2)
