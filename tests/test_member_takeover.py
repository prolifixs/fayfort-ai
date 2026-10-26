"""Member chat: staff take over from the AI, and the AI stays quiet while staff help (app/handoffs/window.py)."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.handoffs import window

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
CHAT = "00000000-0000-0000-0000-0000000000c1"
WORKER = "00000000-0000-0000-0000-0000000000b1"


def ago(minutes: float) -> str:
    return (NOW - timedelta(minutes=minutes)).isoformat()


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.values = db, table, [], "select", None

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, c, v):
        self.filters.append((c, [str(v)]))
        return self

    def in_(self, c, v):
        self.filters.append((c, [str(x) for x in v]))
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def execute(self):
        rows = self.db[self.table]
        if self.op == "insert":
            rows.append({"created_at": NOW.isoformat(), **self.values})
            return SimpleNamespace(data=[self.values])
        found = [r for r in rows if all(str(r.get(c)) in allowed for c, allowed in self.filters)]
        if self.op == "update":
            for r in found:
                r.update(self.values)
        if self.table == "member_messages":
            found = sorted(found, key=lambda r: r["created_at"], reverse=True)
        return SimpleNamespace(data=found)


class Client:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return Query(self.tables, name)


class TakeoverTests(unittest.TestCase):
    def setUp(self):
        self.tables = {
            "member_conversations": [{"id": CHAT, "staff_takeover_at": None, "staff_takeover_by": None}],
            "operations_work_items": [],
            "member_messages": [],
        }
        patches = [patch.object(window, "_db", return_value=Client(self.tables)),
                   patch.object(window, "now_utc", return_value=NOW),
                   patch.multiple(window.settings, HANDOFF_WAIT_MINUTES=15, HANDOFF_IDLE_MINUTES=30,
                                  HANDOFF_HOLDING_INTERVAL_MINUTES=5)]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def message(self, sender, minutes_ago):
        self.tables["member_messages"].append({"conversation_id": CHAT, "sender_type": sender, "content": "x", "created_at": ago(minutes_ago)})

    def test_no_staff_work_means_the_ai_answers(self):
        self.assertIsNone(window.member_support_state(CHAT, NOW))

    def test_worker_reply_keeps_ai_quiet_even_after_the_item_was_updated_or_set_waiting(self):
        # The old rule compared with the item's "last updated" time, so any claim or status change woke the AI.
        self.tables["operations_work_items"].append({"id": "w1", "member_conversation_id": CHAT, "status": "waiting",
                                                     "created_at": ago(60), "updated_at": ago(1)})
        self.message("worker", 5)
        state = window.member_support_state(CHAT, NOW)
        self.assertEqual(state.phase, "human_active")

    def test_takeover_keeps_ai_quiet_until_idle_then_hands_back(self):
        self.assertTrue(window.take_over_member_chat(CHAT, WORKER))
        self.assertEqual(self.tables["member_messages"][-1]["content"], window.TAKEOVER_NOTE)
        self.assertFalse(window.take_over_member_chat(CHAT, WORKER))  # already taken over: no second note
        self.assertEqual(window.member_support_state(CHAT, NOW).phase, "human_active")
        later = NOW + timedelta(minutes=31)
        with patch.object(window, "now_utc", return_value=later):
            self.assertIsNone(window.member_support_state(CHAT, later))
        self.assertIsNone(self.tables["member_conversations"][0]["staff_takeover_at"])
        self.assertEqual(self.tables["member_messages"][-1]["content"], window.HAND_BACK_NOTE)

    def test_staff_messages_extend_the_takeover(self):
        self.tables["member_conversations"][0]["staff_takeover_at"] = ago(50)
        self.message("worker", 10)
        self.assertEqual(window.member_support_state(CHAT, NOW).phase, "human_active")

    def test_hand_back(self):
        window.take_over_member_chat(CHAT, WORKER, announce=False)
        window.release_member_takeover(CHAT)
        self.assertIsNone(window.member_support_state(CHAT, NOW))
        self.assertEqual(self.tables["member_messages"][-1]["content"], window.HAND_BACK_NOTE)


if __name__ == "__main__":
    unittest.main()
