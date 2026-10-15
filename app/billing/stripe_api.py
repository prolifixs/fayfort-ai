"""Minimal Stripe REST client (httpx, no SDK) and webhook signature check.

The API version is pinned so the object shapes FayFort reads (subscription.current_period_end, invoice.subscription)
don't change under us when Stripe moves the account's default version.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

import httpx

from app.config.settings import settings

API = "https://api.stripe.com/v1"
API_VERSION = "2024-06-20"


class StripeError(Exception):
    def __init__(self, message: str, status: int = 0, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


def secret_key() -> str:
    return settings.STRIPE_SECRET_KEY.strip()


def configured() -> bool:
    return bool(secret_key())


def mode() -> str:
    key = secret_key()
    if not key:
        return "not_configured"
    return "live" if "_live_" in key else "test"


def encode(data: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Stripe's form encoding: a[b][0][c]=v."""
    pairs: list[tuple[str, str]] = []
    if isinstance(data, dict):
        for key, value in data.items():
            pairs += encode(value, f"{prefix}[{key}]" if prefix else str(key))
    elif isinstance(data, (list, tuple)):
        for index, value in enumerate(data):
            pairs += encode(value, f"{prefix}[{index}]")
    elif data is None:
        pass
    elif isinstance(data, bool):
        pairs.append((prefix, "true" if data else "false"))
    else:
        pairs.append((prefix, str(data)))
    return pairs


def request(method: str, path: str, data: dict | None = None, *, params: dict | None = None,
            idempotency_key: str | None = None, client: httpx.Client | None = None) -> dict:
    if not configured():
        raise StripeError("Stripe isn't configured. Set STRIPE_SECRET_KEY on the API server.")
    headers = {"Stripe-Version": API_VERSION}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    owned = client is None
    client = client or httpx.Client(timeout=20.0)
    try:
        response = client.request(method, f"{API}{path}", auth=(secret_key(), ""), headers=headers,
                                  params=encode(params) if params else None,
                                  data=encode(data) if data else None)
    except httpx.HTTPError as exc:
        raise StripeError(f"Stripe could not be reached: {exc.__class__.__name__}") from exc
    finally:
        if owned:
            client.close()
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code >= 400:
        error = body.get("error") or {}
        raise StripeError(str(error.get("message") or f"Stripe error {response.status_code}"),
                          response.status_code, error.get("code"))
    return body


def verify_signature(payload: bytes, header: str | None, secret: str, *, tolerance: int = 300,
                     now: float | None = None) -> bool:
    """Check a Stripe-Signature header (t=…,v1=…) against the endpoint's signing secret."""
    if not header or not secret:
        return False
    parts: dict[str, list[str]] = {}
    for item in header.split(","):
        key, _, value = item.strip().partition("=")
        parts.setdefault(key, []).append(value)
    try:
        timestamp = int(parts.get("t", ["0"])[0])
    except ValueError:
        return False
    if abs((now or time.time()) - timestamp) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, candidate) for candidate in parts.get("v1", []))
