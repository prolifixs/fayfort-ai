from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accounts import member_theme_tries as tries
from app.accounts.router import create_accounts_router

MEMBER = "00000000-0000-0000-0000-000000000010"
NOW = datetime(2026, 10, 19, 18, 0, tzinfo=timezone.utc)


class FakeTries:
    """member_theme_tries as a list; the query chain just filters by the cutoff it was given."""
    def __init__(self, rows):
        self.rows = rows
        self.inserted = []

    def table(self, name):
        assert name == "member_theme_tries"
        outer = self

        class Query:
            def __init__(self):
                self.cut = None
                self.theme = None

            def select(self, *_):
                return self

            def eq(self, key, value):
                if key == "theme_id":
                    self.theme = value
                return self

            def gte(self, _key, value):
                self.cut = datetime.fromisoformat(value)
                return self

            def order(self, *_):
                return self

            def limit(self, *_):
                return self

            def insert(self, row):
                outer.inserted.append(row)
                outer.rows.append(row)
                return self

            def execute(self):
                data = [r for r in outer.rows if (self.cut is None or datetime.fromisoformat(r["started_at"]) >= self.cut)
                        and (self.theme is None or r.get("theme_id") == self.theme)]
                return SimpleNamespace(data=sorted(data, key=lambda r: r["started_at"]))
        return Query()


def at(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).isoformat()


def test_three_tries_an_hour_then_the_next_free_time():
    fake = FakeTries([{"theme_id": "odogwu", "started_at": at(70)}])  # older than an hour: doesn't count
    with patch.object(tries, "supabase", fake):
        first = tries.start_try(MEMBER, "odogwu", NOW)
        assert first["until"] == (NOW + timedelta(seconds=15)).isoformat()
        assert first["tries"]["left"] == 2
        tries.start_try(MEMBER, "girl-boss", NOW + timedelta(minutes=5))
        third = tries.start_try(MEMBER, "odogwu", NOW + timedelta(minutes=10))
        assert third["tries"]["left"] == 0
        assert third["tries"]["next_at"] == (NOW + timedelta(hours=1)).isoformat()
        with pytest.raises(PermissionError) as refused:
            tries.start_try(MEMBER, "odogwu", NOW + timedelta(minutes=20))
        assert str(refused.value) == (NOW + timedelta(hours=1)).isoformat()
        # An hour after the first try, one frees up.
        assert tries.tries_status(MEMBER, NOW + timedelta(minutes=61))["left"] == 1


def test_preview_only_while_the_try_runs():
    fake = FakeTries([{"theme_id": "odogwu", "started_at": NOW.isoformat()}])
    with patch.object(tries, "supabase", fake):
        assert tries.try_running(MEMBER, "odogwu", NOW + timedelta(seconds=10))
        assert tries.try_running(MEMBER, "odogwu", NOW + timedelta(seconds=17))  # reload grace
        assert not tries.try_running(MEMBER, "odogwu", NOW + timedelta(seconds=20))
        assert not tries.try_running(MEMBER, "girl-boss", NOW + timedelta(seconds=5))


class TryEndpointTests(TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_accounts_router())
        self.client = TestClient(app)

    @patch("app.accounts.router.start_try", side_effect=PermissionError("2026-10-19T19:00:00+00:00"))
    @patch("app.accounts.router.supabase.table")
    @patch("app.accounts.router.supabase.auth.get_user", return_value=SimpleNamespace(user=SimpleNamespace(email_confirmed_at="2026-10-10")))
    @patch("app.accounts.router.trusted_user_id", return_value=MEMBER)
    def test_a_fourth_try_is_refused_with_the_next_time(self, identity, get_user, table, start):
        theme = MagicMock()
        theme.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "theme_id": "odogwu", "status": "published", "published_revision": 1}
        table.return_value = theme
        response = self.client.post("/members/themes/odogwu/try", headers={"Authorization": "Bearer member-token"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"], {"message": "You've used your 3 theme tries for this hour.", "retry_at": "2026-10-19T19:00:00+00:00"})
