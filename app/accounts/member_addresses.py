"""Member addresses (up to two), profile completion, the first-visit tour, and paying or cancelling invoices
from the dashboard.

Paying an order invoice needs a delivery address: the member picks one of their saved addresses, it is copied
onto the invoice (ship_to) and set on the Shopify draft order before the member is sent to pay.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.commerce.db import db, one, rows
from app.commerce.member_router import verified_member

logger = logging.getLogger(__name__)

ADDRESS_FIELDS = "id,label,recipient_name,phone,line1,line2,city,region,postal_code,country,is_default,created_at,updated_at"
MAX_ADDRESSES = 2
# Invoices for physical goods; these need a delivery address before the member pays in full.
SHIPPING_KINDS = {"order"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AddressInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(default="Home", max_length=40)
    recipient_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    line1: str = Field(min_length=1, max_length=160)
    line2: str | None = Field(default=None, max_length=160)
    city: str = Field(min_length=1, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=32)
    country: str = Field(min_length=1, max_length=100)
    make_default: bool = False

    @field_validator("label", "recipient_name", "line1", "line2", "city", "region", "postal_code", "country", mode="before")
    @classmethod
    def trim(cls, value: object) -> object:
        if isinstance(value, str):
            value = " ".join(value.split())
            return value or None
        return value

    @field_validator("phone", mode="before")
    @classmethod
    def clean_phone(cls, value: object) -> object:
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        text = str(value).strip()
        digits = re.sub(r"\D", "", text)
        if not re.fullmatch(r"[+0-9(). -]+", text) or not 7 <= len(digits) <= 15:
            raise ValueError("Enter a phone number with 7 to 15 digits.")
        return text

    @model_validator(mode="after")
    def required_parts(self) -> "AddressInput":
        if not self.line1 or not self.city or not self.country:
            raise ValueError("Add the street address, city and country.")
        if not self.label:
            self.label = "Home"
        return self


class PayInvoice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address_id: UUID | None = None


# ---------------------------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------------------------
def list_addresses(member_id: str) -> list[dict]:
    found = rows(db().table("member_addresses").select(ADDRESS_FIELDS).eq("member_id", member_id)
                 .order("created_at").execute())
    return sorted(found, key=lambda a: (not a.get("is_default"), str(a.get("created_at") or "")))


def _own_address(member_id: str, address_id: str) -> dict:
    found = one(db().table("member_addresses").select(ADDRESS_FIELDS).eq("id", address_id)
                .eq("member_id", member_id).limit(1).execute())
    if not found:
        raise LookupError("Address not found.")
    return found


def set_default(member_id: str, address_id: str) -> None:
    _own_address(member_id, address_id)
    db().table("member_addresses").update({"is_default": False, "updated_at": now_iso()}) \
        .eq("member_id", member_id).eq("is_default", True).execute()
    db().table("member_addresses").update({"is_default": True, "updated_at": now_iso()}) \
        .eq("id", address_id).eq("member_id", member_id).execute()


def add_address(member_id: str, payload: AddressInput) -> dict:
    existing = list_addresses(member_id)
    if len(existing) >= MAX_ADDRESSES:
        raise ValueError("You can save up to two addresses. Edit or remove one first.")
    values = payload.model_dump(exclude={"make_default"})
    created = one(db().table("member_addresses").insert({**values, "member_id": member_id, "is_default": False}).execute())
    if not created:
        raise RuntimeError("Address insert returned no row")
    if payload.make_default or not existing:
        set_default(member_id, str(created["id"]))
        created["is_default"] = True
    return created


def update_address(member_id: str, address_id: str, payload: AddressInput) -> dict:
    _own_address(member_id, address_id)
    values = {**payload.model_dump(exclude={"make_default"}), "updated_at": now_iso()}
    db().table("member_addresses").update(values).eq("id", address_id).eq("member_id", member_id).execute()
    if payload.make_default:
        set_default(member_id, address_id)
    return _own_address(member_id, address_id)


def delete_address(member_id: str, address_id: str) -> None:
    address = _own_address(member_id, address_id)
    db().table("member_addresses").delete().eq("id", address_id).eq("member_id", member_id).execute()
    if address.get("is_default"):
        rest = list_addresses(member_id)
        if rest:
            set_default(member_id, str(rest[0]["id"]))


def address_snapshot(address: dict) -> dict:
    return {key: address.get(key) for key in
            ("label", "recipient_name", "phone", "line1", "line2", "city", "region", "postal_code", "country")}


def one_line(address: dict | None) -> str:
    if not address:
        return ""
    parts = [address.get("line1"), address.get("line2"), address.get("city"), address.get("region"),
             address.get("postal_code"), address.get("country")]
    return ", ".join(str(p) for p in parts if p)


# ---------------------------------------------------------------------------------------------
# Profile completion
# ---------------------------------------------------------------------------------------------
def profile_completion(profile: dict, addresses: list[dict]) -> dict:
    """What the member has filled in. A shipping address is the one that blocks paying for an order."""
    default = next((a for a in addresses if a.get("is_default")), addresses[0] if addresses else None)
    items = [
        {"key": "email", "label": "Verify your email", "done": True},
        {"key": "name", "label": "Add your name, surname and username",
         "done": all(str(profile.get(key) or "").strip() for key in ("first_name", "last_name", "username")),
         "required": True, "why": "So our team knows who they're helping."},
        {"key": "address", "label": "Add a shipping address", "done": bool(addresses), "required": True,
         "why": "Needed before you pay for an order, so we know where to deliver."},
        {"key": "phone", "label": "Add a phone number for delivery", "done": bool(default and default.get("phone")),
         "why": "Couriers may call before they deliver."},
        {"key": "photo", "label": "Add a profile photo",
         "done": bool(profile.get("member_photo_path") or profile.get("profile_photo_url"))},
    ]
    done = sum(1 for item in items if item["done"])
    return {"percent": round(done * 100 / len(items)), "done": done, "total": len(items), "items": items,
            "address_ready": bool(addresses)}


# ---------------------------------------------------------------------------------------------
# Paying and cancelling invoices
# ---------------------------------------------------------------------------------------------
def _member_invoice(member_id: str, invoice_id: str) -> dict:
    invoice = one(db().table("commerce_invoices").select(
        "id,member_id,kind,status,invoice_url,shopify_draft_order_id,request_id,title,amount,currency,ship_to")
        .eq("id", invoice_id).eq("member_id", member_id).limit(1).execute())
    if not invoice:
        raise LookupError("Invoice not found.")
    return invoice


def pay_invoice(member_id: str, invoice_id: str, address_id: str | None) -> dict:
    """Get the payment link. Order invoices first need the delivery address the member chose."""
    from app.commerce import shopify
    invoice = _member_invoice(member_id, invoice_id)
    if invoice.get("status") != "sent" or not invoice.get("invoice_url"):
        raise ValueError("This invoice can't be paid right now.")
    if invoice.get("kind") not in SHIPPING_KINDS:
        return {"invoice_url": invoice["invoice_url"], "ship_to": None}
    if not address_id:
        raise PermissionError("Choose the address we should deliver to.")
    address = _own_address(member_id, address_id)
    snapshot = address_snapshot(address)
    if invoice.get("shopify_draft_order_id"):
        shopify.set_draft_shipping_address(str(invoice["shopify_draft_order_id"]), snapshot)
    db().table("commerce_invoices").update({"ship_to": snapshot, "ship_to_address_id": address["id"]}) \
        .eq("id", invoice["id"]).execute()
    return {"invoice_url": invoice["invoice_url"], "ship_to": snapshot}


def cancel_consultation_invoice(member_id: str, invoice_id: str) -> None:
    """A member cancels a consultation they haven't paid for. The Shopify invoice is deleted."""
    invoice = _member_invoice(member_id, invoice_id)
    if invoice.get("kind") != "consultation":
        raise ValueError("Only an unpaid consultation can be cancelled here.")
    if invoice.get("status") != "sent":
        raise ValueError("This consultation is already paid or closed.")
    consultation = one(db().table("member_consultations").select("id,status").eq("invoice_id", invoice_id)
                       .eq("member_id", member_id).limit(1).execute())
    if consultation and consultation.get("status") != "awaiting_payment":
        raise ValueError("This consultation has already started.")
    db().table("commerce_invoices").update({"status": "cancelled", "error": "The member cancelled the consultation."}) \
        .eq("id", invoice_id).eq("status", "sent").execute()
    if consultation:
        db().table("member_consultations").update({"status": "cancelled", "updated_at": now_iso()}) \
            .eq("id", consultation["id"]).execute()
    if invoice.get("shopify_draft_order_id"):
        from app.accounts import operations_flow
        operations_flow.withdraw_draft_orders(str(invoice.get("request_id") or ""), [str(invoice["shopify_draft_order_id"])])


class DeclineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(default="", max_length=300)


# ---------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------
def _http(exc: Exception, default: str) -> HTTPException:
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    if "up to two addresses" in str(exc).casefold():
        return HTTPException(status_code=409, detail="You can save up to two addresses. Edit or remove one first.")
    logger.exception(default)
    return HTTPException(status_code=503, detail=default)


def create_member_account_router() -> APIRouter:
    router = APIRouter(tags=["member account"])

    @router.get("/members/addresses")
    def get_addresses(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return {"addresses": list_addresses(member_id), "max": MAX_ADDRESSES}
        except Exception as exc:
            raise _http(exc, "Your addresses could not be loaded.") from exc

    @router.post("/members/addresses", status_code=201)
    def create_address(payload: AddressInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            add_address(member_id, payload)
            return {"addresses": list_addresses(member_id)}
        except Exception as exc:
            raise _http(exc, "Your address could not be saved.") from exc

    @router.put("/members/addresses/{address_id}")
    def edit_address(address_id: UUID, payload: AddressInput, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            update_address(member_id, str(address_id), payload)
            return {"addresses": list_addresses(member_id)}
        except Exception as exc:
            raise _http(exc, "Your address could not be saved.") from exc

    @router.post("/members/addresses/{address_id}/default")
    def make_default(address_id: UUID, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            set_default(member_id, str(address_id))
            return {"addresses": list_addresses(member_id)}
        except Exception as exc:
            raise _http(exc, "Your default address could not be changed.") from exc

    @router.delete("/members/addresses/{address_id}")
    def remove_address(address_id: UUID, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            delete_address(member_id, str(address_id))
            return {"addresses": list_addresses(member_id)}
        except Exception as exc:
            raise _http(exc, "Your address could not be removed.") from exc

    @router.post("/members/me/onboarding")
    def finish_onboarding(authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            db().table("member_profiles").update({"onboarding_completed_at": now_iso()}).eq("user_id", member_id).execute()
            return {"onboarding_completed": True}
        except Exception as exc:
            raise _http(exc, "The tour could not be marked as seen.") from exc

    @router.post("/members/invoices/{invoice_id}/pay")
    def pay(invoice_id: UUID, payload: PayInvoice, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            return pay_invoice(member_id, str(invoice_id), str(payload.address_id) if payload.address_id else None)
        except Exception as exc:
            from app.commerce import shopify
            if isinstance(exc, shopify.ShopifyError):
                logger.warning("Shopify refused the delivery address: %s", exc)
                raise HTTPException(status_code=502, detail="We couldn't add that address to your invoice. Check it and try again.") from exc
            raise _http(exc, "Your invoice could not be opened.") from exc

    @router.post("/members/invoices/{invoice_id}/cancel")
    def cancel(invoice_id: UUID, authorization: str | None = Header(default=None)):
        member_id = verified_member(authorization)
        try:
            cancel_consultation_invoice(member_id, str(invoice_id))
            return {"invoice_id": str(invoice_id), "status": "cancelled"}
        except Exception as exc:
            raise _http(exc, "Your consultation could not be cancelled.") from exc

    @router.post("/members/invoices/{invoice_id}/decline")
    def decline(invoice_id: UUID, payload: DeclineInput, authorization: str | None = Header(default=None)):
        """Decline an unpaid deposit, order or tour invoice; the team is told and the link stops working."""
        member_id = verified_member(authorization)
        try:
            from app.commerce import withdraw
            withdraw.decline(member_id, str(invoice_id), payload.reason)
            return {"invoice_id": str(invoice_id), "status": "cancelled"}
        except Exception as exc:
            raise _http(exc, "The invoice could not be declined.") from exc

    return router


def member_extras(member_id: str, profile: dict) -> dict[str, Any]:
    """Addresses and completion added to GET /members/me."""
    addresses = list_addresses(member_id)
    return {"addresses": addresses, "completion": profile_completion(profile, addresses),
            "onboarding_completed": bool(profile.get("onboarding_completed_at"))}
