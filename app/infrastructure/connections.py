"""Control Center -> Infrastructure -> Connections: Shopify, Stripe and email at a glance, and Connect Stripe.

GET    /platform/connections         status of each outside service (never any secret)
PUT    /platform/connections/stripe  check a Stripe secret key with Stripe, save it encrypted (Supabase Vault), then
                                     create the plans, customer portal and webhook
DELETE /platform/connections/stripe  remove the saved key

A STRIPE_SECRET_KEY set on the server still wins; then the saved key can't be changed here.
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config.settings import settings
from app.directory.identity import trusted_platform_admin
from app.infrastructure import store

logger = logging.getLogger(__name__)
KEY_PATTERN = re.compile(r"^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$")


class StripeKey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    secret_key: str = Field(min_length=20, max_length=255)

    @field_validator("secret_key")
    @classmethod
    def shape(cls, value: str) -> str:
        value = value.strip()
        if value.startswith("pk_"):
            raise ValueError("That's the publishable key. Use the secret key (it starts with sk_test_ or sk_live_).")
        if not KEY_PATTERN.match(value):
            raise ValueError("A Stripe secret key starts with sk_test_ or sk_live_ (or rk_ for a restricted key).")
        return value


def _masked(key: str) -> str:
    return f"{key[:8]}…{key[-4:]}" if key else ""


def connections_status() -> dict:
    from app.billing import service as billing, stripe_api
    from app.commerce import shopify
    stripe_key = stripe_api.secret_key()
    stripe_status = billing.status() if stripe_key else {"ready": False, "problem": None}
    saved = store.get_integration("stripe") or {}
    return {
        "shopify": {
            "connected": shopify.admin_configured(),
            "store": shopify.shop_domain() or None,
            "webhooks": bool(shopify.webhook_secret()),
            "manage": "Control Center → Shop → Overview",
        },
        "stripe": {
            "connected": bool(stripe_key),
            "ready": bool(stripe_status.get("ready")),
            "mode": stripe_api.mode(),
            "source": stripe_api.key_source(),
            "key_hint": (saved.get("safe_settings") or {}).get("key_hint") if stripe_api.key_source() == "connections" else None,
            "problem": stripe_status.get("problem"),
            "saved_at": saved.get("updated_at"),
            "manage": "Control Center → Shop → Billing",
        },
        "email": {
            "connected": bool(settings.RESEND_API_KEY.strip()),
            "sending": bool(getattr(settings, "EMAIL_DELIVERY_ENABLED", False)),
            "from": settings.EMAIL_FROM,
            "manage": "Control Center → Email",
        },
    }


def create_connections_router() -> APIRouter:
    router = APIRouter(prefix="/platform/connections", tags=["platform connections"])

    def admin(authorization: str | None) -> str:
        found = trusted_platform_admin(authorization)
        if not found:
            raise HTTPException(status_code=403, detail="Platform administrator access is required.")
        return found["user_id"]

    @router.get("")
    def get_connections(authorization: str | None = Header(default=None)):
        admin(authorization)
        try:
            return connections_status()
        except Exception as exc:
            logger.exception("Connections could not be loaded")
            raise HTTPException(status_code=503, detail="Connections could not be loaded.") from exc

    @router.put("/stripe")
    def connect_stripe(payload: StripeKey, authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        from app.billing import service as billing, stripe_api
        if settings.STRIPE_SECRET_KEY.strip():
            raise HTTPException(status_code=409, detail="Stripe is set on the API server, so it can't be changed here.")
        try:
            mode = stripe_api.check_key(payload.secret_key)
        except stripe_api.StripeError as exc:
            store.audit(actor, "stripe.key_rejected", {"status": exc.status})
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        try:
            saved = store.save_integration_credentials(
                "stripe", {"secret_key": payload.secret_key},
                {"mode": mode, "key_hint": _masked(payload.secret_key)}, actor)
        except Exception as exc:
            logger.exception("Stripe key could not be saved")
            raise HTTPException(status_code=503, detail="The key could not be saved.") from exc
        if not saved:
            raise HTTPException(status_code=503, detail="The key could not be saved.")
        stripe_api.forget_stored_key()
        store.mark_integration("stripe", status="verified", error_code=None)
        store.audit(actor, "stripe.connected", {"mode": mode})
        try:
            billing.ensure_setup()  # plans, customer portal and webhook
        except Exception:
            logger.exception("Stripe setup after connecting failed")
        return connections_status()

    @router.delete("/stripe")
    def disconnect_stripe(authorization: str | None = Header(default=None)):
        actor = admin(authorization)
        from app.billing import stripe_api
        if settings.STRIPE_SECRET_KEY.strip():
            raise HTTPException(status_code=409, detail="Stripe is set on the API server, so it can't be removed here.")
        try:
            from app.database.client import supabase
            supabase.rpc("clear_platform_integration_credentials", {"p_provider": "stripe", "p_actor_id": actor}).execute()
        except Exception as exc:
            logger.exception("Stripe key could not be removed")
            raise HTTPException(status_code=503, detail="The key could not be removed.") from exc
        stripe_api.forget_stored_key()
        return connections_status()

    return router
