"""Shop pages that publish schema.org Product data fill the link preview (app/commerce/links.py)."""
import unittest

from app.commerce import links

PAGE = """<html><head><title>Shop</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
{"@type":"Product","name":"Velvet accent chair","image":["https://img.shop.example/c.jpg"],
"offers":{"@type":"Offer","price":"189.50","priceCurrency":"USD"}}]}</script></head><body></body></html>"""


class LinkProductDataTests(unittest.TestCase):
    def test_json_ld_product_fills_title_image_and_price(self):
        found = links.parse_open_graph(PAGE, "https://shop.example/p/1")
        self.assertEqual(found["image_url"], "https://img.shop.example/c.jpg")
        self.assertEqual((found["price"], found["currency"]), ("189.50", "USD"))
        self.assertEqual(found["title"], "Velvet accent chair")

    def test_open_graph_still_wins_when_present(self):
        page = '<meta property="og:title" content="OG chair"><meta property="og:image" content="https://img/og.jpg">' + PAGE
        found = links.parse_open_graph(page, "https://shop.example/p/1")
        self.assertEqual((found["title"], found["image_url"]), ("OG chair", "https://img/og.jpg"))

    def test_private_addresses_are_never_fetched_for_images(self):
        self.assertIsNone(links.fetch_image("https://intranet.example/x.jpg", resolver=lambda _h: ["10.0.0.5"]))
        self.assertIsNone(links.fetch_image("http://shop.example/x.jpg", resolver=lambda _h: ["93.184.216.34"]))
