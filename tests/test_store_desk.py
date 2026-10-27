"""Operations restructure R6 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): the Store team desk's cards."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests import test_store_team as store_tests
from tests.test_store_team import ago, ahead

H = {"Authorization": "Bearer x"}


class StoreDeskTests(store_tests.Base):
    client = store_tests.RouterTests.client

    def setUp(self):
        super().setUp()
        now = datetime.now(timezone.utc)
        self.db.rows.update({
            "find_drops": [
                {"id": "d0", "title": "Finds · 19 Oct", "early_at": (now - timedelta(days=10)).isoformat(),
                 "release_at": (now - timedelta(days=8)).isoformat(), "catalog_at": (now - timedelta(days=1)).isoformat(), "target_count": 10},
                {"id": "d1", "title": "Finds · 2 Nov", "early_at": (now + timedelta(days=3)).isoformat(),
                 "release_at": (now + timedelta(days=5)).isoformat(), "catalog_at": (now + timedelta(days=12)).isoformat(), "target_count": 10},
            ],
            "finds": [{"id": "f1", "status": "scouted", "drop_id": None}, {"id": "f2", "status": "checked", "drop_id": None},
                      {"id": "f3", "status": "scheduled", "drop_id": "d1"}, {"id": "f4", "status": "in_review", "drop_id": None}],
            "store_listings": [{"id": "l1", "status": "draft", "updated_at": ago(days=1)}, {"id": "l2", "status": "in_review", "updated_at": ago(days=1)},
                               {"id": "l3", "status": "changes_requested", "updated_at": ago(days=2)},
                               {"id": "l4", "status": "published", "updated_at": ago(days=2)}, {"id": "l5", "status": "published", "updated_at": ago(days=20)}],
            "commerce_sales": [{"id": "s1", "title": "Weekend wig sale", "starts_at": ahead(days=2), "ends_at": ahead(days=4), "status": "scheduled"}],
        })
        self.product(name="Unmapped wig", category_needs_mapping=True)

    def test_overview(self):
        found = self.client().get("/operations/store/overview", headers=H)
        self.assertEqual(found.status_code, 200, found.text)
        body = found.json()
        self.assertEqual(body["next_drop"]["id"], "d1")
        self.assertEqual(body["next_drop"]["count"], 1)
        self.assertEqual(body["finds_in_research"], {"scouted": 1, "checked": 1, "in_review": 1})
        self.assertEqual(body["listings"], {"draft": 1, "in_review": 1, "changes_requested": 1, "failed": 0, "published_this_week": 1})
        self.assertEqual(body["unmapped_products"], 1)
        self.assertIsInstance(body["coming_up"], list)

    def test_only_the_store_team(self):
        self.assertEqual(self.client(departments=("sourcing",)).get("/operations/store/overview", headers=H).status_code, 403)
