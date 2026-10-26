"""Shopify API client: Admin GraphQL (catalog, discounts, draft-order invoices, setup), Storefront
GraphQL (checkout carts), and webhook signature checks. Secrets are never logged."""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import threading
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config.settings import settings

logger = logging.getLogger(__name__)


class ShopifyError(Exception):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


def shop_domain() -> str:
    domain = settings.SHOPIFY_STORE_DOMAIN.strip().lower()
    for prefix in ("https://", "http://"):
        if domain.startswith(prefix):
            domain = domain[len(prefix):]
    return domain.strip("/")


def admin_configured() -> bool:
    return bool(shop_domain()) and bool(
        settings.SHOPIFY_ADMIN_ACCESS_TOKEN.strip()
        or (settings.SHOPIFY_CLIENT_ID.strip() and settings.SHOPIFY_CLIENT_SECRET.strip()))


def storefront_configured() -> bool:
    return bool(shop_domain()) and bool(settings.SHOPIFY_STOREFRONT_ACCESS_TOKEN.strip())


def webhook_secret() -> str:
    return (settings.SHOPIFY_WEBHOOK_SECRET or settings.SHOPIFY_CLIENT_SECRET).strip()


def verify_webhook(raw_body: bytes, signature: str | None) -> bool:
    secret = webhook_secret()
    if not secret or not signature:
        return False
    digest = base64.b64encode(hmac.new(secret.encode(), raw_body, hashlib.sha256).digest()).decode()
    return hmac.compare_digest(digest, signature.strip())


def gid(kind: str, value: str | int) -> str:
    text = str(value)
    return text if text.startswith("gid://") else f"gid://shopify/{kind}/{text}"


def numeric_id(value: str | int | None) -> str:
    return str(value or "").rsplit("/", 1)[-1]


class _TokenCache:
    def __init__(self) -> None:
        self.token: str | None = None
        self.expires_at = 0.0
        self.lock = threading.Lock()


_token_cache = _TokenCache()


def _http(client: httpx.Client | None) -> tuple[httpx.Client, bool]:
    return (client, False) if client is not None else (httpx.Client(timeout=30), True)


def admin_token(client: httpx.Client | None = None) -> str:
    """Legacy token if set, else a client-credentials token renewed a few minutes before it expires."""
    if settings.SHOPIFY_ADMIN_ACCESS_TOKEN.strip():
        return settings.SHOPIFY_ADMIN_ACCESS_TOKEN.strip()
    if not admin_configured():
        raise ShopifyError("Shopify isn't connected yet: set the store domain and the app's client id and secret.")
    with _token_cache.lock:
        if _token_cache.token and time.time() < _token_cache.expires_at - 300:
            return _token_cache.token
        http, owned = _http(client)
        try:
            response = http.post(
                f"https://{shop_domain()}/admin/oauth/access_token",
                data={"grant_type": "client_credentials", "client_id": settings.SHOPIFY_CLIENT_ID.strip(),
                      "client_secret": settings.SHOPIFY_CLIENT_SECRET.strip()},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError as exc:
            raise ShopifyError(f"Could not reach Shopify for an access token: {type(exc).__name__}", retryable=True) from exc
        finally:
            if owned:
                http.close()
        if response.status_code != 200:
            if "app_not_installed" in response.text:
                raise ShopifyError("The FayFort app isn't installed on this store yet. In the Shopify Dev Dashboard, open the "
                                   "app, release a version, then choose Install app and pick this store.")
            raise ShopifyError(f"Shopify refused the app credentials (HTTP {response.status_code}). "
                               "Check the client id and secret, and that the app is installed on the store.")
        body = response.json()
        _token_cache.token = str(body.get("access_token") or "")
        _token_cache.expires_at = time.time() + float(body.get("expires_in") or 86399)
        if not _token_cache.token:
            raise ShopifyError("Shopify returned no access token.")
        return _token_cache.token


def _post_graphql(url: str, headers: dict[str, str], query: str, variables: dict | None,
                  client: httpx.Client | None) -> dict[str, Any]:
    http, owned = _http(client)
    try:
        for attempt in range(3):
            try:
                response = http.post(url, json={"query": query, "variables": variables or {}}, headers=headers)
            except httpx.HTTPError as exc:
                if attempt == 2:
                    raise ShopifyError(f"Network error reaching Shopify: {type(exc).__name__}", retryable=True) from exc
                time.sleep(0.5 * (attempt + 1))
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == 2:
                    raise ShopifyError(f"Shopify is busy (HTTP {response.status_code}).", retryable=True)
                time.sleep(float(response.headers.get("Retry-After") or (attempt + 1)))
                continue
            if response.status_code in (401, 403):
                _token_cache.token = None
                raise ShopifyError(f"Shopify refused the request (HTTP {response.status_code}). Check the app's access scopes.")
            if response.status_code != 200:
                raise ShopifyError(f"Shopify returned HTTP {response.status_code}.")
            body = response.json()
            errors = body.get("errors")
            if errors:
                throttled = any((e.get("extensions") or {}).get("code") == "THROTTLED" for e in errors if isinstance(e, dict))
                if throttled and attempt < 2:
                    time.sleep(1.0 * (attempt + 1))
                    continue
                message = "; ".join(str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in errors)[:300]
                raise ShopifyError(f"Shopify GraphQL error: {message}", retryable=throttled)
            return body.get("data") or {}
        raise ShopifyError("Shopify request failed after retries.", retryable=True)
    finally:
        if owned:
            http.close()


def admin_graphql(query: str, variables: dict | None = None, *, client: httpx.Client | None = None) -> dict[str, Any]:
    url = f"https://{shop_domain()}/admin/api/{settings.SHOPIFY_API_VERSION}/graphql.json"
    headers = {"X-Shopify-Access-Token": admin_token(client), "Content-Type": "application/json"}
    return _post_graphql(url, headers, query, variables, client)


def storefront_graphql(query: str, variables: dict | None = None, *, buyer_ip: str | None = None,
                       client: httpx.Client | None = None) -> dict[str, Any]:
    if not storefront_configured():
        raise ShopifyError("The Shopify Storefront token isn't set.")
    url = f"https://{shop_domain()}/api/{settings.SHOPIFY_API_VERSION}/graphql.json"
    headers = {"Shopify-Storefront-Private-Token": settings.SHOPIFY_STOREFRONT_ACCESS_TOKEN.strip(),
               "Content-Type": "application/json"}
    if buyer_ip:
        headers["Shopify-Storefront-Buyer-IP"] = buyer_ip
    return _post_graphql(url, headers, query, variables, client)


def user_errors(payload: dict | None) -> str | None:
    errors = (payload or {}).get("userErrors") or []
    if not errors:
        return None
    return "; ".join(str(e.get("message")) for e in errors if isinstance(e, dict))[:300] or "Shopify rejected the change."


# ---------------------------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------------------------
PRODUCT_FIELDS = """
  id handle title description productType vendor tags status updatedAt onlineStoreUrl totalInventory
  category: metafield(namespace: "fayfort", key: "category_ref") { value }
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  media(first: 20) {
    nodes {
      mediaContentType alt
      preview { image { url } }
      ... on MediaImage { image { url } }
      ... on Video { sources { url mimeType } }
      ... on ExternalVideo { originUrl }
    }
  }
  variants(first: 100) {
    nodes {
      id title sku price compareAtPrice availableForSale inventoryQuantity position
      selectedOptions { name value }
      image { url }
    }
  }
"""

PRODUCT_QUERY = "query Product($id: ID!) { product(id: $id) { " + PRODUCT_FIELDS + " } }"
PRODUCTS_PAGE_QUERY = ("query Products($after: String) { products(first: 50, after: $after) { "
                       "pageInfo { hasNextPage endCursor } nodes { " + PRODUCT_FIELDS + " } } }")


def fetch_product(product_gid: str, *, client: httpx.Client | None = None) -> dict | None:
    return admin_graphql(PRODUCT_QUERY, {"id": gid("Product", product_gid)}, client=client).get("product")


def iter_products(*, client: httpx.Client | None = None):
    cursor = None
    while True:
        page = admin_graphql(PRODUCTS_PAGE_QUERY, {"after": cursor}, client=client).get("products") or {}
        for node in page.get("nodes") or []:
            yield node
        info = page.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            return
        cursor = info.get("endCursor")


def set_product_category(product_gid: str, category_ref: str, *, client: httpx.Client | None = None) -> None:
    data = admin_graphql(
        "mutation Set($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }",
        {"m": [{"ownerId": gid("Product", product_gid), "namespace": "fayfort", "key": "category_ref",
                "type": "single_line_text_field", "value": category_ref}]}, client=client)
    problem = user_errors(data.get("metafieldsSet"))
    if problem:
        raise ShopifyError(problem)


def create_draft_product(*, title: str, description: str, price: str, category_ref: str | None,
                         client: httpx.Client | None = None) -> str:
    """Draft product for a sourced item; staff finish photos and stock in Shopify, then set it Active."""
    product_input: dict[str, Any] = {"title": title, "descriptionHtml": description, "status": "DRAFT"}
    if category_ref:
        product_input["metafields"] = [{"namespace": "fayfort", "key": "category_ref",
                                        "type": "single_line_text_field", "value": category_ref}]
    data = admin_graphql(
        "mutation Create($product: ProductCreateInput!) { productCreate(product: $product) { "
        "product { id variants(first: 1) { nodes { id } } } userErrors { field message } } }",
        {"product": product_input}, client=client)
    payload = data.get("productCreate") or {}
    problem = user_errors(payload)
    if problem:
        raise ShopifyError(problem)
    product = payload.get("product") or {}
    variants = ((product.get("variants") or {}).get("nodes") or [])
    if variants:
        price_data = admin_graphql(
            "mutation Price($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { "
            "productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }",
            {"productId": product["id"], "variants": [{"id": variants[0]["id"], "price": price}]}, client=client)
        problem = user_errors(price_data.get("productVariantsBulkUpdate"))
        if problem:
            logger.warning("Draft product created but its price could not be set: %s", problem)
    return str(product.get("id") or "")


def admin_product_url(product_gid: str) -> str:
    store = shop_domain().removesuffix(".myshopify.com")
    return f"https://admin.shopify.com/store/{store}/products/{numeric_id(product_gid)}"


# ---------------------------------------------------------------------------------------------
# Store team listings (docs/CATALOG_MERCHANDISING_PLAN.md): a worker's listing becomes a DRAFT product; only an
# administrator's Publish sets it ACTIVE. Stock is tracked from zero: the administrator enters it in Shopify.
# ---------------------------------------------------------------------------------------------
def _listing_media(media: list[dict]) -> list[dict]:
    out = []
    for item in media[:10]:
        url = str(item.get("url") or "")
        if not url.startswith("https://") or item.get("source") == "instagram":
            continue  # Shopify can't import an Instagram embed; those stay FayFort-only
        out.append({"originalSource": url, "alt": str(item.get("alt") or "")[:512],
                    "mediaContentType": "VIDEO" if item.get("media_type") == "video" else "IMAGE"})
    return out


def _variant_inputs(listing: dict) -> list[dict]:
    price = f"{float(listing['price']):.2f}"
    compare = f"{float(listing['compare_at_price']):.2f}" if listing.get("compare_at_price") else None
    item: dict[str, Any] = {"tracked": True}
    if listing.get("cost") is not None:
        item["cost"] = f"{float(listing['cost']):.2f}"
    values = [v for v in (listing.get("option_values") or []) if str(v).strip()]
    base = {"price": price, "inventoryItem": item, **({"compareAtPrice": compare} if compare else {})}
    if listing.get("option_name") and values:
        return [{**base, "optionValues": [{"optionName": listing["option_name"], "name": str(value)[:255]}]}
                for value in values]
    return [base]


def create_listing_product(listing: dict, *, client: httpx.Client | None = None) -> str:
    """Create the Shopify DRAFT for a Store team listing: title, description, FayFort category, options, prices,
    cost and media. Returns the product gid. Nothing is visible to customers until it is published."""
    product_input: dict[str, Any] = {"title": str(listing["title"])[:255],
                                     "descriptionHtml": _plain_to_html(listing.get("description") or ""),
                                     "status": "DRAFT"}
    if listing.get("category_ref"):
        product_input["metafields"] = [{"namespace": "fayfort", "key": "category_ref",
                                        "type": "single_line_text_field", "value": listing["category_ref"]}]
    values = [v for v in (listing.get("option_values") or []) if str(v).strip()]
    if listing.get("option_name") and values:
        product_input["productOptions"] = [{"name": listing["option_name"],
                                            "values": [{"name": str(v)[:255]} for v in values]}]
    data = admin_graphql(
        "mutation Create($product: ProductCreateInput!, $media: [CreateMediaInput!]) { "
        "productCreate(product: $product, media: $media) { product { id } userErrors { field message } } }",
        {"product": product_input, "media": _listing_media(listing.get("media") or []) or None}, client=client)
    payload = data.get("productCreate") or {}
    problem = user_errors(payload)
    if problem:
        raise ShopifyError(problem)
    product_gid = str((payload.get("product") or {}).get("id") or "")
    if not product_gid:
        raise ShopifyError("Shopify didn't return the new product.")
    result = admin_graphql(
        "mutation Variants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { "
        "productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) { "
        "userErrors { field message } } }",
        {"productId": product_gid, "variants": _variant_inputs(listing)}, client=client)
    problem = user_errors(result.get("productVariantsBulkCreate"))
    if problem:
        logger.warning("Draft product created but its prices could not be set: %s", problem)
        raise ShopifyError(f"The draft was created but its prices weren't saved: {problem}")
    return product_gid


def update_listing_product(listing: dict, *, client: httpx.Client | None = None) -> None:
    """Apply an approved edit: title, description, category, price on every variant, and any new media."""
    product_gid = gid("Product", listing["shopify_product_id"])
    product_input: dict[str, Any] = {"id": product_gid, "title": str(listing["title"])[:255],
                                     "descriptionHtml": _plain_to_html(listing.get("description") or "")}
    if listing.get("category_ref"):
        product_input["metafields"] = [{"namespace": "fayfort", "key": "category_ref",
                                        "type": "single_line_text_field", "value": listing["category_ref"]}]
    data = admin_graphql(
        "mutation Update($product: ProductUpdateInput!, $media: [CreateMediaInput!]) { "
        "productUpdate(product: $product, media: $media) { product { id variants(first: 100) { nodes { id } } } "
        "userErrors { field message } } }",
        {"product": product_input, "media": _listing_media(listing.get("new_media") or []) or None}, client=client)
    payload = data.get("productUpdate") or {}
    problem = user_errors(payload)
    if problem:
        raise ShopifyError(problem)
    if listing.get("price"):
        nodes = (((payload.get("product") or {}).get("variants") or {}).get("nodes") or [])
        price = f"{float(listing['price']):.2f}"
        compare = f"{float(listing['compare_at_price']):.2f}" if listing.get("compare_at_price") else None
        variants = [{"id": node["id"], "price": price, "compareAtPrice": compare} for node in nodes]
        if variants:
            result = admin_graphql(
                "mutation Price($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { "
                "productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }",
                {"productId": product_gid, "variants": variants}, client=client)
            problem = user_errors(result.get("productVariantsBulkUpdate"))
            if problem:
                raise ShopifyError(f"The details were saved but the price wasn't: {problem}")


def set_product_status(product_gid: str, status: str, *, client: httpx.Client | None = None) -> None:
    """ACTIVE (publish) or ARCHIVED (retire). Only called from administrator actions."""
    if status not in ("ACTIVE", "ARCHIVED", "DRAFT"):
        raise ValueError("Unknown product status")
    data = admin_graphql(
        "mutation Status($product: ProductUpdateInput!) { productUpdate(product: $product) { "
        "product { id status } userErrors { field message } } }",
        {"product": {"id": gid("Product", product_gid), "status": status}}, client=client)
    problem = user_errors(data.get("productUpdate"))
    if problem:
        raise ShopifyError(problem)


def publish_to_sales_channels(product_gid: str, *, client: httpx.Client | None = None) -> bool:
    """Best effort: put the product on every sales channel (the Headless storefront FayFort sells through, TikTok,
    Instagram). Needs the app's read_publications and write_publications scopes; without them this returns False and
    the administrator ticks the sales channels in Shopify instead."""
    try:
        found = admin_graphql("query { publications(first: 20) { nodes { id } } }", client=client)
        ids = [node["id"] for node in ((found.get("publications") or {}).get("nodes") or []) if node.get("id")]
        if not ids:
            return False
        data = admin_graphql(
            "mutation Publish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { "
            "userErrors { field message } } }",
            {"id": gid("Product", product_gid), "input": [{"publicationId": pid} for pid in ids]}, client=client)
        return not user_errors(data.get("publishablePublish"))
    except ShopifyError as exc:
        logger.info("Could not publish to sales channels (scopes?): %s", exc)
        return False


def _plain_to_html(text: str) -> str:
    import html as _html
    paragraphs = [p.strip() for p in str(text).split("\n\n") if p.strip()]
    return "".join(f"<p>{_html.escape(p).replace(chr(10), '<br>')}</p>" for p in paragraphs)[:20000]


# ---------------------------------------------------------------------------------------------
# Setup (P0): category metafield definition and webhook subscriptions
# ---------------------------------------------------------------------------------------------
WEBHOOK_TOPICS = ("PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "ORDERS_CREATE", "ORDERS_UPDATED",
                  "INVENTORY_LEVELS_UPDATE")


def ensure_category_definition(*, client: httpx.Client | None = None) -> str:
    data = admin_graphql(
        "mutation Def($d: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $d) { "
        "createdDefinition { id } userErrors { field message code } } }",
        {"d": {"name": "FayFort category", "namespace": "fayfort", "key": "category_ref",
               "description": "FayFort category reference (one of the 968 FayFort categories).",
               "type": "single_line_text_field", "ownerType": "PRODUCT",
               "access": {"storefront": "PUBLIC_READ"}}}, client=client)
    payload = data.get("metafieldDefinitionCreate") or {}
    errors = payload.get("userErrors") or []
    if any(str(e.get("code")) == "TAKEN" or "taken" in str(e.get("message", "")).casefold() for e in errors):
        return "exists"
    problem = user_errors(payload)
    if problem:
        raise ShopifyError(problem)
    return "created"


def ensure_webhooks(callback_url: str, *, client: httpx.Client | None = None) -> dict[str, str]:
    existing = admin_graphql(
        "query { webhookSubscriptions(first: 100) { nodes { id topic endpoint { "
        "... on WebhookHttpEndpoint { callbackUrl } } } } }", client=client)
    have = {(n.get("topic"), ((n.get("endpoint") or {}).get("callbackUrl"))) for n in
            ((existing.get("webhookSubscriptions") or {}).get("nodes") or [])}
    result: dict[str, str] = {}
    for topic in WEBHOOK_TOPICS:
        if (topic, callback_url) in have:
            result[topic] = "exists"
            continue
        data = admin_graphql(
            "mutation Hook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) { "
            "webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { "
            "webhookSubscription { id } userErrors { field message } } }",
            {"topic": topic, "sub": {"callbackUrl": callback_url, "format": "JSON"}}, client=client)
        problem = user_errors(data.get("webhookSubscriptionCreate"))
        result[topic] = f"failed: {problem}" if problem else "created"
    return result


# ---------------------------------------------------------------------------------------------
# Discounts (flash sales, influencer codes, giveaway prizes)
# ---------------------------------------------------------------------------------------------
def _customer_gets(discount_type: str, value: float, product_gids: list[str]) -> dict:
    if discount_type == "percentage":
        amount: dict = {"percentage": round(value / 100.0, 4)}
    else:
        amount = {"discountAmount": {"amount": f"{value:.2f}", "appliesOnEachItem": True}}
    return {"value": amount, "items": {"products": {"productsToAdd": product_gids}}}


def create_discount(*, title: str, discount_type: str, value: float, product_gids: list[str], starts_at: str,
                    ends_at: str | None, code: str | None = None, usage_limit: int | None = None,
                    client: httpx.Client | None = None) -> str:
    gets = _customer_gets(discount_type, value, product_gids)
    if code:
        discount: dict[str, Any] = {"title": title, "code": code, "startsAt": starts_at, "endsAt": ends_at,
                                    "customerSelection": {"all": True}, "customerGets": gets,
                                    "appliesOncePerCustomer": True}
        if usage_limit:
            discount["usageLimit"] = usage_limit
        data = admin_graphql(
            "mutation Code($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { "
            "codeDiscountNode { id } userErrors { field message } } }", {"d": discount}, client=client)
        payload = data.get("discountCodeBasicCreate") or {}
        node = payload.get("codeDiscountNode")
    else:
        discount = {"title": title, "startsAt": starts_at, "endsAt": ends_at, "customerGets": gets}
        data = admin_graphql(
            "mutation Auto($d: DiscountAutomaticBasicInput!) { discountAutomaticBasicCreate(automaticBasicDiscount: $d) { "
            "automaticDiscountNode { id } userErrors { field message } } }", {"d": discount}, client=client)
        payload = data.get("discountAutomaticBasicCreate") or {}
        node = payload.get("automaticDiscountNode")
    problem = user_errors(payload)
    if problem:
        raise ShopifyError(problem)
    return str((node or {}).get("id") or "")


def delete_discount(discount_gid: str, *, automatic: bool, client: httpx.Client | None = None) -> None:
    if automatic:
        data = admin_graphql("mutation D($id: ID!) { discountAutomaticDelete(id: $id) { userErrors { message } } }",
                             {"id": discount_gid}, client=client)
        problem = user_errors(data.get("discountAutomaticDelete"))
    else:
        data = admin_graphql("mutation D($id: ID!) { discountCodeDelete(id: $id) { userErrors { message } } }",
                             {"id": discount_gid}, client=client)
        problem = user_errors(data.get("discountCodeDelete"))
    if problem:
        raise ShopifyError(problem)


# ---------------------------------------------------------------------------------------------
# Draft-order invoices (sourcing quotes and pools)
# ---------------------------------------------------------------------------------------------
def create_invoice(*, invoice_id: str, email: str, title: str, unit_price: float, currency: str, quantity: int,
                   note: str, kind: str = "order", requires_shipping: bool = True, credit: float = 0.0,
                   credit_title: str = "Sourcing deposit paid", client: httpx.Client | None = None) -> tuple[str, str]:
    """Create and email a Shopify draft-order invoice. `credit` is taken off the total (a paid deposit)."""
    draft_input: dict[str, Any] = {
        "email": email,
        "note": note,
        "tags": ["fayfort-invoice", f"fayfort-{kind.replace('_', '-')}"],
        "presentmentCurrencyCode": currency,
        "customAttributes": [{"key": "fayfort_invoice_id", "value": invoice_id},
                             {"key": "fayfort_invoice_kind", "value": kind}],
        "lineItems": [{"title": title[:255], "quantity": quantity, "requiresShipping": requires_shipping,
                       "taxable": True, "originalUnitPrice": f"{unit_price:.2f}"}],
    }
    if credit > 0:
        draft_input["appliedDiscount"] = {"title": credit_title[:255], "description": credit_title[:255],
                                          "value": round(credit, 2), "valueType": "FIXED_AMOUNT"}
    data = admin_graphql(
        "mutation Draft($input: DraftOrderInput!) { draftOrderCreate(input: $input) { "
        "draftOrder { id invoiceUrl } userErrors { field message } } }",
        {"input": draft_input}, client=client)
    payload = data.get("draftOrderCreate") or {}
    problem = user_errors(payload)
    if problem:
        raise ShopifyError(problem)
    draft = payload.get("draftOrder") or {}
    draft_id = str(draft.get("id") or "")
    sent = admin_graphql(
        "mutation Send($id: ID!) { draftOrderInvoiceSend(id: $id) { draftOrder { invoiceUrl } userErrors { message } } }",
        {"id": draft_id}, client=client)
    problem = user_errors(sent.get("draftOrderInvoiceSend"))
    if problem:
        logger.warning("Draft order created but Shopify could not email the invoice: %s", problem)
    url = ((sent.get("draftOrderInvoiceSend") or {}).get("draftOrder") or {}).get("invoiceUrl") or draft.get("invoiceUrl")
    return draft_id, str(url or "")


def delete_draft_order(draft_order_gid: str, *, client: httpx.Client | None = None) -> None:
    """Remove an unpaid draft order so its invoice link can't be paid any more (an expired booking hold)."""
    data = admin_graphql("mutation D($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { "
                         "deletedId userErrors { message } } }", {"input": {"id": draft_order_gid}}, client=client)
    problem = user_errors(data.get("draftOrderDelete"))
    if problem:
        raise ShopifyError(problem)


def set_draft_shipping_address(draft_order_gid: str, address: dict, *, client: httpx.Client | None = None) -> None:
    """Put the member's chosen delivery address on an unpaid draft order before they pay."""
    name = str(address.get("recipient_name") or "").strip()
    first, _, last = name.partition(" ")
    shipping = {key: value for key, value in {
        "firstName": first or None, "lastName": last or None, "phone": address.get("phone"),
        "address1": address.get("line1"), "address2": address.get("line2"), "city": address.get("city"),
        "province": address.get("region"), "zip": address.get("postal_code"), "country": address.get("country"),
    }.items() if value}
    data = admin_graphql(
        "mutation Ship($id: ID!, $input: DraftOrderInput!) { draftOrderUpdate(id: $id, input: $input) { "
        "draftOrder { id } userErrors { field message } } }",
        {"id": draft_order_gid, "input": {"shippingAddress": shipping}}, client=client)
    problem = user_errors(data.get("draftOrderUpdate"))
    if problem:
        raise ShopifyError(problem)


def delete_draft_order(draft_order_gid: str, *, client: httpx.Client | None = None) -> None:
    """Delete an unpaid draft order so its invoice link can no longer be paid."""
    data = admin_graphql(
        "mutation Del($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId userErrors { message } } }",
        {"input": {"id": draft_order_gid}}, client=client)
    problem = user_errors(data.get("draftOrderDelete"))
    if problem:
        raise ShopifyError(problem)


# ---------------------------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------------------------
def create_checkout(*, lines: list[tuple[str, int]], member_id: str, email: str | None, buyer_ip: str | None = None,
                    client: httpx.Client | None = None) -> tuple[str, str]:
    """Return (cart id, checkout URL). Storefront cart when the token is set, else a cart permalink."""
    if storefront_configured():
        cart_input: dict[str, Any] = {
            "lines": [{"merchandiseId": gid("ProductVariant", variant), "quantity": quantity} for variant, quantity in lines],
            "attributes": [{"key": "fayfort_member_id", "value": member_id}],
        }
        if email:
            cart_input["buyerIdentity"] = {"email": email}
        data = storefront_graphql(
            "mutation Cart($input: CartInput!) { cartCreate(input: $input) { cart { id checkoutUrl } "
            "userErrors { field message } } }", {"input": cart_input}, buyer_ip=buyer_ip, client=client)
        payload = data.get("cartCreate") or {}
        problem = user_errors(payload)
        if problem:
            raise ShopifyError(problem)
        cart = payload.get("cart") or {}
        return str(cart.get("id") or ""), str(cart.get("checkoutUrl") or "")
    if not shop_domain():
        raise ShopifyError("Shopify isn't connected yet.")
    path = ",".join(f"{numeric_id(variant)}:{quantity}" for variant, quantity in lines)
    query = {"attributes[fayfort_member_id]": member_id}
    if email:
        query["checkout[email]"] = email
    return f"permalink:{path}", f"https://{shop_domain()}/cart/{path}?{urlencode(query)}"


def iter_orders(created_at_min: str, *, client: httpx.Client | None = None):
    """Every order since a date, as the Admin REST API (and the order webhooks) shape it. Without the
    read_all_orders scope Shopify only returns the last 60 days."""
    http, owned = _http(client)
    url: str | None = (f"https://{shop_domain()}/admin/api/{settings.SHOPIFY_API_VERSION}/orders.json?"
                       + urlencode({"status": "any", "limit": 250, "created_at_min": created_at_min}))
    try:
        while url:
            response = http.get(url, headers={"X-Shopify-Access-Token": admin_token(http)})
            if response.status_code == 429:
                time.sleep(float(response.headers.get("Retry-After") or 2))
                continue
            if response.status_code in (401, 403):
                raise ShopifyError("Shopify refused the order list. The app needs the read_orders scope.")
            if response.status_code != 200:
                raise ShopifyError(f"Shopify returned HTTP {response.status_code} for the order list.")
            for order in response.json().get("orders") or []:
                yield order
            url = None
            for part in response.headers.get("Link", "").split(","):
                if 'rel="next"' in part:
                    url = part.split(";")[0].strip().strip("<>")
    finally:
        if owned:
            http.close()
