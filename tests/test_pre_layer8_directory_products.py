from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dashboard.modules import create_workspace_modules_router

BUSINESS = "00000000-0000-0000-0000-000000000001"
PRODUCT = "00000000-0000-0000-0000-000000000002"


class ProductCatalogApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_business_member", return_value=None)
    def test_catalog_requires_business_membership(self, _member, table):
        response = self.client.get(f"/businesses/{BUSINESS}/directory/products")
        self.assertEqual(response.status_code, 401)
        table.assert_not_called()

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_platform_admin", return_value=None)
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "admin"})
    def test_product_creation_requires_platform_admin(self, _member, _platform_admin, table):
        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            headers={"Authorization": "Bearer member"},
            json={"name": "Widget", "category_ref": "cat-1"},
        )
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "member-1", "role": "member"})
    @patch("app.dashboard.modules.trusted_platform_admin", return_value=None)
    def test_member_catalog_only_returns_active_products(self, _platform_admin, _authorize, table):
        products = Mock()
        products.select.return_value = products
        products.eq.return_value = products
        products.order.return_value = products
        products.limit.return_value = products
        products.execute.return_value.data = [{"id": PRODUCT, "name": "Widget", "active": True}]
        categories = Mock()
        categories.select.return_value = categories
        categories.order.return_value = categories
        categories.limit.return_value = categories
        categories.execute.return_value.data = [{"source_ref": "cat-1", "category": "Tools", "product_type": "Widget"}]
        table.side_effect = [products, categories]

        response = self.client.get(f"/businesses/{BUSINESS}/directory/products", headers={"Authorization": "Bearer member"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["products"][0]["name"], "Widget")
        self.assertFalse(response.json()["can_manage"])
        products.eq.assert_called_once_with("active", True)

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "admin-1", "role": "admin"})
    @patch("app.dashboard.modules.trusted_platform_admin", return_value={"user_id": "admin-1"})
    def test_platform_admin_can_create_product_using_existing_category(self, _platform_admin, _member, table):
        category = Mock()
        category.select.return_value = category
        category.eq.return_value = category
        category.limit.return_value = category
        category.execute.return_value.data = [{"source_ref": "cat-1"}]
        products = Mock()
        products.insert.return_value = products
        product_row = {"id": PRODUCT, "name": "Widget", "category_ref": "cat-1", "created_by": "admin-1"}
        products.execute.return_value.data = [product_row]
        table.side_effect = [category, products]

        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            headers={"Authorization": "Bearer admin"},
            json={"name": " Widget ", "category_ref": "cat-1", "availability_status": "available"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["product"]["name"], "Widget")
        insert_payload = products.insert.call_args.args[0]
        self.assertEqual(insert_payload["created_by"], "admin-1")
        self.assertEqual(insert_payload["updated_by"], "admin-1")

    @patch("app.dashboard.modules.supabase.table")
    @patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "admin-1", "role": "admin"})
    @patch("app.dashboard.modules.trusted_platform_admin", return_value={"user_id": "admin-1"})
    def test_create_rejects_unknown_existing_category(self, _platform_admin, _member, table):
        category = Mock()
        category.select.return_value = category
        category.eq.return_value = category
        category.limit.return_value = category
        category.execute.return_value.data = []
        table.return_value = category

        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            headers={"Authorization": "Bearer admin"},
            json={"name": "Widget", "category_ref": "missing"},
        )

        self.assertEqual(response.status_code, 422)
        table.assert_called_once_with("directory_categories")

    def test_create_rejects_blank_name(self):
        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            json={"name": "   ", "category_ref": "cat-1"},
        )
        self.assertEqual(response.status_code, 422)

    def test_product_media_requires_https_and_valid_source_fields(self):
        response = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            json={"name": "Widget", "category_ref": "cat-1", "media_url": "http://cdn.example/item.jpg", "media_type": "image", "media_source": "url"},
        )
        self.assertEqual(response.status_code, 422)

    def test_instagram_media_accepts_post_url_and_rejects_non_instagram_url(self):
        valid = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            json={"name": "Widget", "category_ref": "cat-1", "media_url": "https://www.instagram.com/p/abc123/", "media_type": "image", "media_source": "instagram"},
        )
        invalid = self.client.post(
            f"/businesses/{BUSINESS}/directory/products",
            json={"name": "Widget", "category_ref": "cat-1", "media_url": "https://example.com/p/abc123/", "media_type": "image", "media_source": "instagram"},
        )
        self.assertEqual(valid.status_code, 401)  # Valid payload reaches the authorization boundary.
        self.assertEqual(invalid.status_code, 422)

    def test_update_rejects_empty_patch(self):
        response = self.client.patch(
            f"/businesses/{BUSINESS}/directory/products/{PRODUCT}",
            json={},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
