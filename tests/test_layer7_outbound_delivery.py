from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.channels.outbound import deliver_instagram_text
from app.dashboard.modules import create_workspace_modules_router


BUSINESS = "00000000-0000-0000-0000-000000000001"
CONNECTION = "00000000-0000-0000-0000-000000000002"
CONVERSATION = "00000000-0000-0000-0000-000000000003"
MESSAGE = "00000000-0000-0000-0000-000000000004"
DELIVERY = "00000000-0000-0000-0000-000000000005"


def fixtures():
    connection = {
        "id": CONNECTION,
        "business_id": BUSINESS,
        "provider": "instagram",
        "status": "connected",
        "safe_settings": {"outbound_enabled": True},
    }
    credentials = {"access_token": "test-token"}
    conversation = {
        "id": CONVERSATION,
        "customer_external_id": "test-recipient",
    }
    message = {"id": MESSAGE, "content": "Safe delivery test", "sender_type": "agent"}
    return connection, credentials, conversation, message


class InstagramOutboundDeliveryTests(unittest.TestCase):
    @patch("app.channels.outbound.requests.post")
    @patch("app.channels.outbound.finish_delivery_attempt")
    @patch("app.channels.outbound._latest_customer_message_at")
    @patch("app.channels.outbound.begin_delivery_attempt")
    def test_expired_instagram_response_window_is_recorded_without_provider_send(
        self, begin, latest_customer, finish, post
    ):
        connection, credentials, conversation, message = fixtures()
        latest_customer.return_value = datetime.now(timezone.utc) - timedelta(hours=25)
        begin.return_value = ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True)
        finish.return_value = {"id": DELIVERY, "status": "rejected"}

        result = deliver_instagram_text(
            connection=connection, credentials=credentials,
            conversation=conversation, message=message,
        )

        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["safe_error_code"], "response_window_expired")
        post.assert_not_called()
        finish.assert_called_once_with(DELIVERY, 1, "rejected", "response_window_expired")

    @patch("app.channels.outbound.requests.post")
    @patch("app.channels.outbound.finish_delivery_attempt")
    @patch("app.channels.outbound._latest_customer_message_at")
    @patch("app.channels.outbound.begin_delivery_attempt")
    def test_connect_timeout_is_explicitly_rejected_and_retryable(
        self, begin, latest_customer, finish, post
    ):
        connection, credentials, conversation, message = fixtures()
        latest_customer.return_value = datetime.now(timezone.utc)
        begin.side_effect = [
            ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True),
            ({"id": DELIVERY, "attempt_count": 2, "status": "sending"}, True),
        ]
        accepted = Mock(status_code=200)
        accepted.json.return_value = {"message_id": "provider-message-id"}
        post.side_effect = [requests.ConnectTimeout("connect timed out"), accepted]
        finish.side_effect = [
            {"id": DELIVERY, "status": "rejected"},
            {"id": DELIVERY, "status": "sent"},
        ]

        first = deliver_instagram_text(
            connection=connection, credentials=credentials,
            conversation=conversation, message=message,
        )
        retry = deliver_instagram_text(
            connection=connection, credentials=credentials,
            conversation=conversation, message=message, retry_rejected=True,
        )

        self.assertEqual(first["safe_error_code"], "connect_timeout")
        self.assertEqual(first["status"], "rejected")
        self.assertEqual(retry["status"], "sent")
        self.assertEqual(post.call_count, 2)

    @patch("app.channels.outbound.requests.post")
    @patch("app.channels.outbound.finish_delivery_attempt")
    @patch("app.channels.outbound._latest_customer_message_at")
    @patch("app.channels.outbound.begin_delivery_attempt")
    def test_server_error_and_missing_success_receipt_stay_unknown(
        self, begin, latest_customer, finish, post
    ):
        connection, credentials, conversation, message = fixtures()
        latest_customer.return_value = datetime.now(timezone.utc)
        for response in (
            Mock(status_code=408),
            Mock(status_code=425),
            Mock(status_code=500),
            Mock(status_code=200),
        ):
            with self.subTest(status=response.status_code):
                begin.reset_mock()
                begin.side_effect = [
                    ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True),
                    ({"id": DELIVERY, "attempt_count": 1, "status": "unknown"}, False),
                ]
                finish.reset_mock()
                finish.return_value = {"id": DELIVERY, "status": "unknown"}
                post.reset_mock()
                post.return_value = response

                first = deliver_instagram_text(
                    connection=connection, credentials=credentials,
                    conversation=conversation, message=message,
                )
                second = deliver_instagram_text(
                    connection=connection, credentials=credentials,
                    conversation=conversation, message=message,
                )

                self.assertEqual(first["status"], "unknown")
                self.assertEqual(second["status"], "unknown")
                self.assertTrue(second["duplicate"])
                self.assertEqual(post.call_count, 1)

    @patch("app.channels.outbound.requests.post")
    @patch("app.channels.outbound.finish_delivery_attempt")
    @patch("app.channels.outbound._latest_customer_message_at")
    @patch("app.channels.outbound.begin_delivery_attempt")
    def test_provider_auth_and_rate_limit_errors_are_safe_explicit_rejections(
        self, begin, latest_customer, finish, post
    ):
        connection, credentials, conversation, message = fixtures()
        latest_customer.return_value = datetime.now(timezone.utc)
        for status_code in (401, 429):
            with self.subTest(status=status_code):
                begin.reset_mock()
                begin.return_value = ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True)
                finish.reset_mock()
                finish.return_value = {"id": DELIVERY, "status": "rejected"}
                response = Mock(status_code=status_code)
                response.json.return_value = {"error": {"message": "private provider body"}}
                post.reset_mock()
                post.return_value = response

                result = deliver_instagram_text(
                    connection=connection, credentials=credentials,
                    conversation=conversation, message=message,
                )

                self.assertEqual(result["status"], "rejected")
                self.assertEqual(result["safe_error_code"], f"meta_http_{status_code}")
                self.assertNotIn("private provider body", str(result))

    @patch("app.channels.outbound.requests.post")
    @patch("app.channels.outbound.finish_delivery_attempt")
    @patch("app.channels.outbound._latest_customer_message_at")
    @patch("app.channels.outbound.begin_delivery_attempt")
    def test_unknown_outcome_is_not_replayed(
        self, begin, latest_customer, finish, post
    ):
        connection, credentials, conversation, message = fixtures()
        latest_customer.return_value = datetime.now(timezone.utc)
        begin.side_effect = [
            ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True),
            ({"id": DELIVERY, "attempt_count": 1, "status": "unknown"}, False),
        ]
        finish.return_value = {"id": DELIVERY, "status": "unknown"}
        post.side_effect = requests.ReadTimeout("ambiguous provider response")

        first = deliver_instagram_text(
            connection=connection,
            credentials=credentials,
            conversation=conversation,
            message=message,
        )
        second = deliver_instagram_text(
            connection=connection,
            credentials=credentials,
            conversation=conversation,
            message=message,
        )

        self.assertEqual(first["status"], "unknown")
        self.assertEqual(second["status"], "unknown")
        self.assertTrue(second["duplicate"])
        self.assertEqual(post.call_count, 1)

    @patch("app.channels.outbound.requests.post")
    @patch("app.channels.outbound.finish_delivery_attempt")
    @patch("app.channels.outbound._latest_customer_message_at")
    @patch("app.channels.outbound.begin_delivery_attempt")
    def test_explicit_rejection_can_be_retried_once(
        self, begin, latest_customer, finish, post
    ):
        connection, credentials, conversation, message = fixtures()
        latest_customer.return_value = datetime.now(timezone.utc)
        begin.side_effect = [
            ({"id": DELIVERY, "attempt_count": 1, "status": "sending"}, True),
            ({"id": DELIVERY, "attempt_count": 2, "status": "sending"}, True),
        ]
        rejected = Mock(status_code=400)
        rejected.json.return_value = {"error": {"code": 100, "error_subcode": 2534038}}
        accepted = Mock(status_code=200)
        accepted.json.return_value = {"message_id": "provider-message-id"}
        post.side_effect = [rejected, accepted]
        finish.side_effect = [
            {"id": DELIVERY, "status": "rejected"},
            {"id": DELIVERY, "status": "sent"},
        ]

        first = deliver_instagram_text(
            connection=connection,
            credentials=credentials,
            conversation=conversation,
            message=message,
        )
        retry = deliver_instagram_text(
            connection=connection,
            credentials=credentials,
            conversation=conversation,
            message=message,
            retry_rejected=True,
        )

        self.assertEqual(first["status"], "rejected")
        self.assertEqual(retry["status"], "sent")
        self.assertEqual(retry["provider_message_id"], "provider-message-id")
        self.assertEqual(post.call_count, 2)
        self.assertEqual(
            [entry.kwargs["retry_rejected"] for entry in begin.call_args_list],
            [False, True],
        )
        self.assertEqual(
            [entry.args[2] for entry in finish.call_args_list],
            ["rejected", "sent"],
        )


class DeliveryRetryApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_workspace_modules_router())
        self.client = TestClient(app)

    def test_retry_route_allows_explicit_rejection_and_publishes_receipt(self):
        rejected = {
            "id": DELIVERY,
            "status": "rejected",
            "connection_id": CONNECTION,
            "conversation_id": CONVERSATION,
            "message_id": MESSAGE,
        }
        conversation = {"id": CONVERSATION, "business_id": BUSINESS}
        message = {"id": MESSAGE, "conversation_id": CONVERSATION, "sender_type": "agent"}
        connection = {"id": CONNECTION, "provider": "instagram"}
        result = {"status": "sent", "delivery_id": DELIVERY}
        with (
            patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-id", "role": "owner"}),
            patch("app.dashboard.modules.get_delivery", return_value=rejected),
            patch("app.dashboard.modules.get_conversation", return_value=conversation),
            patch("app.dashboard.modules.get_message", return_value=message),
            patch("app.dashboard.modules.get_connection", return_value=connection),
            patch("app.dashboard.modules.get_connection_credentials", return_value={"access_token": "test-token"}),
            patch("app.dashboard.modules.deliver_instagram_text", return_value=result) as deliver,
            patch("app.dashboard.modules.publish_business_event") as publish,
        ):
            response = self.client.post(
                f"/businesses/{BUSINESS}/channel-deliveries/{DELIVERY}/retry",
                headers={"Authorization": "Bearer test"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["delivery"]["status"], "sent")
        self.assertTrue(deliver.call_args.kwargs["retry_rejected"])
        publish.assert_called_once()

    def test_retry_route_refuses_unknown_outcome_without_sending(self):
        uncertain = {"id": DELIVERY, "status": "unknown"}
        with (
            patch("app.dashboard.modules.trusted_business_member", return_value={"user_id": "owner-id", "role": "owner"}),
            patch("app.dashboard.modules.get_delivery", return_value=uncertain),
            patch("app.dashboard.modules.deliver_instagram_text") as deliver,
            patch("app.dashboard.modules.publish_business_event") as publish,
        ):
            response = self.client.post(
                f"/businesses/{BUSINESS}/channel-deliveries/{DELIVERY}/retry",
                headers={"Authorization": "Bearer test"},
            )

        self.assertEqual(response.status_code, 409)
        deliver.assert_not_called()
        publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
