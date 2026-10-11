from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.accounts.member_chat_review import create_member_chat_review_router

MEMBER = "00000000-0000-0000-0000-000000000010"
CONVERSATION = "00000000-0000-0000-0000-000000000020"


class Layer8MemberChatReviewTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        def member(authorization: str | None) -> str:
            if authorization != "Bearer member-token":
                raise HTTPException(status_code=401)
            return MEMBER

        def worker(authorization: str | None) -> str:
            if authorization != "Bearer worker-token":
                raise HTTPException(status_code=401)
            return "00000000-0000-0000-0000-000000000030"

        app.include_router(create_member_chat_review_router(member, worker))
        self.client = TestClient(app)

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_upload_requires_explicit_consent(self, table):
        response = self.client.post(
            f"/members/conversations/{CONVERSATION}/review-media",
            headers={"Authorization": "Bearer member-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nimage-data",
        )
        self.assertEqual(response.status_code, 422)
        table.assert_not_called()

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_upload_rejects_mismatched_file_signature(self, table):
        response = self.client.post(
            f"/members/conversations/{CONVERSATION}/review-media?consent=true",
            headers={"Authorization": "Bearer member-token", "Content-Type": "image/png"},
            content=b"not a png",
        )
        self.assertEqual(response.status_code, 415)
        table.assert_not_called()

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_upload_rejects_video_type(self, table):
        response = self.client.post(
            f"/members/conversations/{CONVERSATION}/review-media?consent=true",
            headers={"Authorization": "Bearer member-token", "Content-Type": "video/mp4"},
            content=b"video",
        )
        self.assertEqual(response.status_code, 415)
        table.assert_not_called()

    @patch("app.accounts.member_chat_review.supabase.table")
    def test_upload_requires_owned_conversation(self, table):
        owner = MagicMock()
        owner.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        table.return_value = owner
        response = self.client.post(
            f"/members/conversations/{CONVERSATION}/review-media?consent=true",
            headers={"Authorization": "Bearer member-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nimage-data",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(table.call_count, 1)

    @patch("app.accounts.member_chat_review.supabase.storage.from_")
    @patch("app.accounts.member_chat_review.supabase.table")
    def test_request_linked_chat_rejects_new_review_media(self, table, storage):
        conversation = MagicMock()
        conversation.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": CONVERSATION, "retention_hold": True,
        }
        table.return_value = conversation
        response = self.client.post(
            f"/members/conversations/{CONVERSATION}/review-media?consent=true",
            headers={"Authorization": "Bearer member-token", "Content-Type": "image/png"},
            content=b"\x89PNG\r\n\x1a\nimage-data",
        )
        self.assertEqual(response.status_code, 409)
        storage.assert_not_called()

    @patch("app.accounts.member_chat_review_retention.supabase.storage.from_")
    @patch("app.accounts.member_chat_review_retention.supabase.table")
    def test_expired_photo_object_is_removed_before_metadata(self, table, storage):
        from app.accounts.member_chat_review_retention import purge_expired_member_review_media

        actions = []
        media = MagicMock()
        media.select.return_value.lte.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "media-1", "review_id": "review-1", "storage_path": "review-1/image.png",
             "expires_at": "2026-10-09T00:00:00+00:00"}
        ]
        review = MagicMock()
        review.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "conversation_id": "conversation-1", "reviewed_at": "2026-09-01T00:00:00+00:00",
            "created_at": "2026-09-01T00:00:00+00:00",
        }
        conversation = MagicMock()
        conversation.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "linked_request_id": None, "retention_hold": False,
        }
        deletion = MagicMock()
        deletion.delete.return_value.eq.return_value.execute.side_effect = lambda: actions.append("metadata")
        table.side_effect = [media, review, conversation, deletion]
        storage.return_value.remove.side_effect = lambda paths: actions.append("object")
        result = purge_expired_member_review_media(now=datetime(2026, 10, 10, tzinfo=timezone.utc))
        self.assertEqual(result, {"eligible": 1, "deleted": 1, "failed": 0})
        self.assertEqual(actions, ["object", "metadata"])

    @patch("app.accounts.member_chat_review_retention.supabase.storage.from_")
    @patch("app.accounts.member_chat_review_retention.supabase.table")
    def test_expired_photo_is_kept_while_linked_request_is_active(self, table, storage):
        from app.accounts.member_chat_review_retention import purge_expired_member_review_media

        media = MagicMock()
        media.select.return_value.lte.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "media-1", "review_id": "review-1", "storage_path": "review-1/image.png",
             "expires_at": "2026-10-09T00:00:00+00:00"}
        ]
        review = MagicMock()
        review.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "conversation_id": "conversation-1", "reviewed_at": "2026-09-01T00:00:00+00:00",
            "created_at": "2026-09-01T00:00:00+00:00",
        }
        conversation = MagicMock()
        conversation.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "linked_request_id": "request-1", "retention_hold": True,
        }
        events = MagicMock()
        events.select.return_value.eq.return_value.order.return_value.limit.return_value.maybe_single.return_value.execute.return_value.data = {
            "stage": "sourcing", "created_at": "2026-10-01T00:00:00+00:00",
        }
        update = MagicMock()
        table.side_effect = [media, review, conversation, events, update]

        result = purge_expired_member_review_media(now=datetime(2026, 10, 10, tzinfo=timezone.utc))

        self.assertEqual(result, {"eligible": 1, "deleted": 0, "failed": 0})
        update.update.assert_called_once_with({"expires_at": "2026-11-09T00:00:00+00:00"})
        storage.assert_not_called()

    @patch("app.accounts.member_chat_review_retention.supabase.storage.from_")
    @patch("app.accounts.member_chat_review_retention.supabase.table")
    def test_expired_photo_waits_30_days_after_request_resolution(self, table, storage):
        from app.accounts.member_chat_review_retention import purge_expired_member_review_media

        media = MagicMock()
        media.select.return_value.lte.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "media-1", "review_id": "review-1", "storage_path": "review-1/image.png",
             "expires_at": "2026-10-09T00:00:00+00:00"}
        ]
        review = MagicMock()
        review.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "conversation_id": "conversation-1", "reviewed_at": "2026-09-01T00:00:00+00:00",
            "created_at": "2026-09-01T00:00:00+00:00",
        }
        conversation = MagicMock()
        conversation.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "linked_request_id": "request-1", "retention_hold": True,
        }
        events = MagicMock()
        events.select.return_value.eq.return_value.order.return_value.limit.return_value.maybe_single.return_value.execute.return_value.data = {
            "stage": "delivered", "created_at": "2026-10-05T00:00:00+00:00",
        }
        update = MagicMock()
        table.side_effect = [media, review, conversation, events, update]

        result = purge_expired_member_review_media(now=datetime(2026, 10, 10, tzinfo=timezone.utc))

        self.assertEqual(result, {"eligible": 1, "deleted": 0, "failed": 0})
        update.update.assert_called_once_with({"expires_at": "2026-11-04T00:00:00+00:00"})
        storage.assert_not_called()

    @patch("app.accounts.member_chat_review_retention.supabase.storage.from_")
    @patch("app.accounts.member_chat_review_retention.supabase.table")
    def test_cancelled_request_stays_held_until_manual_release(self, table, storage):
        from app.accounts.member_chat_review_retention import purge_expired_member_review_media

        media = MagicMock()
        media.select.return_value.lte.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "media-1", "review_id": "review-1", "storage_path": "review-1/image.png",
             "expires_at": "2026-10-09T00:00:00+00:00"}
        ]
        review = MagicMock()
        review.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "conversation_id": "conversation-1", "reviewed_at": "2026-09-01T00:00:00+00:00",
            "created_at": "2026-09-01T00:00:00+00:00",
        }
        conversation = MagicMock()
        conversation.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "linked_request_id": "request-1", "retention_hold": True,
        }
        events = MagicMock()
        events.select.return_value.eq.return_value.order.return_value.limit.return_value.maybe_single.return_value.execute.return_value.data = {
            "stage": "cancelled", "created_at": "2026-10-05T00:00:00+00:00",
        }
        update = MagicMock()
        table.side_effect = [media, review, conversation, events, update]

        result = purge_expired_member_review_media(now=datetime(2026, 10, 10, tzinfo=timezone.utc))

        self.assertEqual(result, {"eligible": 1, "deleted": 0, "failed": 0})
        update.update.assert_called_once_with({"expires_at": "2026-11-09T00:00:00+00:00"})
        storage.assert_not_called()


if __name__ == "__main__":
    unittest.main()
