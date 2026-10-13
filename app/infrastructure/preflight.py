"""Read-only reachability checks for a public webhook URL (shared by the CLI and the admin API)."""
from __future__ import annotations

import secrets

import httpx

WEBHOOK_CHANNELS = ("instagram", "messenger")


def webhook_preflight(public_url: str, verify_token: str, channel: str = "instagram") -> list[tuple[str, bool, str]]:
    """Check HTTPS, API health, the Meta verification challenge and signature enforcement.

    Never sends the verify token anywhere except the target webhook, never returns it, and never calls Meta.
    """
    if channel not in WEBHOOK_CHANNELS:
        raise ValueError("unsupported webhook channel")
    base = public_url.rstrip("/")
    checks: list[tuple[str, bool, str]] = [("public URL uses HTTPS", base.startswith("https://"), base)]
    try:
        health = httpx.get(f"{base}/health", timeout=15)
        contract = health.json().get("api_contract") if health.status_code == 200 else None
        checks.append(("API health through the public URL", health.status_code == 200,
                       f"HTTP {health.status_code}; contract={contract or 'unknown'}"))
    except (httpx.HTTPError, ValueError) as exc:
        checks.append(("API health through the public URL", False, type(exc).__name__))
    challenge = secrets.token_hex(8)
    try:
        verify = httpx.get(f"{base}/webhooks/{channel}", params={
            "hub.mode": "subscribe", "hub.verify_token": verify_token, "hub.challenge": challenge,
        }, timeout=15)
        detail = f"HTTP {verify.status_code}"
        if verify.status_code == 403:
            detail += "; META_VERIFY_TOKEN does not match the API"
        checks.append(("webhook verification challenge", verify.status_code == 200 and verify.text == challenge, detail))
    except httpx.HTTPError as exc:
        checks.append(("webhook verification challenge", False, type(exc).__name__))
    try:
        unsigned = httpx.post(f"{base}/webhooks/{channel}", json={"object": "page", "entry": []}, timeout=15)
        checks.append(("unsigned webhook POST is rejected", unsigned.status_code == 401, f"HTTP {unsigned.status_code}"))
    except httpx.HTTPError as exc:
        checks.append(("unsigned webhook POST is rejected", False, type(exc).__name__))
    return checks
