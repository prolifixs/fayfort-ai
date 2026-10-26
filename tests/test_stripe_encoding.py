"""Stripe calls send nested form fields (a[b][0]=v) as a real form body. httpx 0.28 refuses a list of pairs as data,
which broke the live Stripe setup (products, prices, webhook)."""
from unittest.mock import patch

import httpx

from app.billing import stripe_api


def test_post_sends_nested_form_body():
    seen = {}

    def handler(request):
        seen.update(body=request.content.decode(), type=request.headers.get("content-type"),
                    key=request.headers.get("idempotency-key"))
        return httpx.Response(200, json={"id": "prod_1"})

    with patch.object(stripe_api, "secret_key", return_value="sk_test_x"):
        result = stripe_api.request("POST", "/products", {"name": "Standard", "metadata": {"fayfort_plan": "standard"},
                                                           "enabled_events": ["invoice.paid", "customer.subscription.updated"]},
                                    idempotency_key="k1", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert result == {"id": "prod_1"}
    assert seen["type"] == "application/x-www-form-urlencoded"
    assert seen["key"] == "k1"
    assert seen["body"] == ("name=Standard&metadata%5Bfayfort_plan%5D=standard"
                            "&enabled_events%5B0%5D=invoice.paid&enabled_events%5B1%5D=customer.subscription.updated")


def test_get_sends_query_params_and_no_body():
    seen = {}

    def handler(request):
        seen.update(query=request.url.query.decode(), body=request.content)
        return httpx.Response(200, json={"data": []})

    with patch.object(stripe_api, "secret_key", return_value="sk_test_x"):
        stripe_api.request("GET", "/prices", params={"lookup_keys": ["fayfort_standard"], "limit": 1},
                           client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert seen["query"] == "lookup_keys%5B0%5D=fayfort_standard&limit=1"
    assert seen["body"] == b""
