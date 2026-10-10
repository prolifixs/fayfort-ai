from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts.router import create_accounts_router


MEMBER = "00000000-0000-0000-0000-000000000010"
PRODUCT = "00000000-0000-0000-0000-000000000101"


class Layer8MemberProductTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_member_catalog_returns_active_safe_projection_and_only_own_saved_ids(self, identity, get_user, table):
        saved_query = MagicMock()
        saved_query.select.return_value.eq.return_value.execute.return_value.data = [{"product_id": PRODUCT}]
        product_query = MagicMock()
        product_query.select.return_value.eq.return_value = product_query
        product_query.ilike.return_value = product_query
        product_query.eq.return_value = product_query
        product_query.in_.return_value = product_query
        product_query.order.return_value = product_query
        product_query.limit.return_value = product_query
        product_query.execute.return_value.data = [{
            "id": PRODUCT, "name": "Widget", "category_ref": "tools", "description": "A widget",
            "availability_status": "available", "media_url": "https://cdn.example.test/widget.jpg",
            "media_type": "image", "media_source": "url",
        }]
        category_query = MagicMock()
        category_query.select.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        table.side_effect = [saved_query, product_query, category_query]

        response = self.client.get(
            "/members/products?q=wid&category_ref=tools&saved_only=true&limit=20",
            headers={"Authorization": "Bearer member-token"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["saved_product_ids"], [PRODUCT])
        self.assertEqual(body["products"][0]["id"], PRODUCT)
        self.assertNotIn("media_storage_path", body["products"][0])
        saved_query.select.return_value.eq.assert_called_once_with("member_id", MEMBER)
        product_query.select.return_value.eq.assert_called_once_with("active", True)
        product_query.ilike.assert_called_once_with("name", "%wid%")
        product_query.eq.assert_called_with("category_ref", "tools")
        product_query.in_.assert_called_once_with("id", [PRODUCT])
        product_query.limit.assert_called_once_with(20)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at=None)))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_unverified_member_cannot_browse_or_save_products(self, identity, get_user, table):
        response = self.client.get("/members/products", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 403)
        table.assert_not_called()

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_saved_only_with_empty_member_list_does_not_query_catalog_rows(self, identity, get_user, table):
        saved_query = MagicMock()
        saved_query.select.return_value.eq.return_value.execute.return_value.data = []
        category_query = MagicMock()
        category_query.select.return_value.order.return_value.limit.return_value.execute.return_value.data = []
        table.side_effect = [saved_query, category_query]

        response = self.client.get("/members/products?saved_only=true", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["products"], [])
        self.assertEqual(table.call_args_list, [unittest.mock.call("member_saved_products"), unittest.mock.call("directory_categories")])

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_cannot_save_hidden_product(self, identity, get_user, table):
        product_query = MagicMock()
        product_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = None
        table.return_value = product_query

        response = self.client.post(f"/members/products/{PRODUCT}/saved", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 404)
        product_query.select.return_value.eq.assert_called_once_with("id", PRODUCT)
        product_query.select.return_value.eq.return_value.eq.assert_called_once_with("active", True)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_save_is_idempotent_and_scoped_to_verified_member(self, identity, get_user, table):
        product_query = MagicMock()
        product_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"id": PRODUCT}
        saved_query = MagicMock()
        saved_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {"product_id": PRODUCT}
        table.side_effect = [product_query, saved_query]

        response = self.client.post(f"/members/products/{PRODUCT}/saved", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"product_id": PRODUCT, "saved": True})
        saved_query.select.return_value.eq.assert_called_once_with("member_id", MEMBER)
        saved_query.select.return_value.eq.return_value.eq.assert_called_once_with("product_id", PRODUCT)
        self.assertEqual(table.call_count, 2)
        self.assertFalse(saved_query.insert.called)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_first_save_inserts_when_maybe_single_returns_no_row(self, identity, get_user, table):
        product_query = MagicMock()
        product_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = SimpleNamespace(data={"id": PRODUCT})
        saved_query = MagicMock()
        saved_query.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = None
        insert_query = MagicMock()
        table.side_effect = [product_query, saved_query, insert_query]

        response = self.client.post(f"/members/products/{PRODUCT}/saved", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"product_id": PRODUCT, "saved": True})
        insert_query.insert.assert_called_once_with({"member_id": MEMBER, "product_id": PRODUCT})
        insert_query.insert.return_value.execute.assert_called_once_with()
        self.assertEqual(table.call_count, 3)

    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="verified")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_unsave_deletes_only_current_members_relationship(self, identity, get_user, table):
        delete_query = MagicMock()
        table.return_value = delete_query

        response = self.client.delete(f"/members/products/{PRODUCT}/saved", headers={"Authorization": "Bearer member-token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"product_id": PRODUCT, "saved": False})
        delete_query.delete.assert_called_once_with()
        delete_query.delete.return_value.eq.assert_called_once_with("member_id", MEMBER)
        delete_query.delete.return_value.eq.return_value.eq.assert_called_once_with("product_id", PRODUCT)


if __name__ == "__main__":
    unittest.main()
