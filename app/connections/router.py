from __future__ import annotations
import logging
import requests
from fastapi import APIRouter, Header, HTTPException
from app.database.connections import create_connection, list_connections, get_connection, transition_connection, update_connection_settings, save_connection_credentials, get_connection_credentials, mark_connection_instagram_verified, mark_connection_instagram_error, mark_connection_messenger_verified, mark_connection_messenger_error
from app.directory.identity import has_trusted_business_identity, trusted_business_member
from app.database.events import publish_business_event
from app.schemas.connection import ConnectionCreate, ConnectionSettingsUpdate, InstagramCredentials, MessengerCredentials

logger = logging.getLogger(__name__)


def _record_instagram_health_error(business_id: str, connection_id: str, error_code: str) -> None:
    try:
        mark_connection_instagram_error(business_id, connection_id, error_code)
    except Exception:
        logger.exception("Instagram health failure could not be saved for business %s connection %s", business_id, connection_id)


def create_connections_router() -> APIRouter:
    router = APIRouter(prefix="/businesses/{business_id}/connections", tags=["connections"])

    def authorize(business_id: str, authorization: str | None) -> None:
        if not has_trusted_business_identity(authorization, business_id):
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")

    @router.get("")
    def get_connections(business_id: str, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            return {"connections": list_connections(business_id)}
        except Exception:
            logger.exception("Connections could not be loaded for business %s", business_id)
            raise HTTPException(status_code=503, detail="Connections could not be loaded.")

    @router.post("", status_code=201)
    def add_connection(business_id: str, payload: ConnectionCreate, authorization: str | None = Header(default=None)):
        authorize(business_id, authorization)
        try:
            connection = create_connection(business_id, payload.provider, payload.display_name, payload.safe_settings)
            publish_business_event(business_id, "connection.created", "business_connection", str(connection["id"]), {"connection_id":str(connection["id"]), "status":connection["status"]})
            return {"connection": connection}
        except Exception:
            raise HTTPException(status_code=503, detail="Connection could not be created.")

    @router.put("/{connection_id}/credentials/instagram")
    def save_instagram_credentials(business_id: str, connection_id: str, payload: InstagramCredentials, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required for this action.")
        try:
            connection = next((item for item in list_connections(business_id) if item["id"] == connection_id), None)
            if connection is None:
                raise HTTPException(status_code=404, detail="Connection not found.")
            if connection["provider"] != "instagram":
                raise HTTPException(status_code=409, detail="Instagram credentials can only be saved to an Instagram connection.")
            saved = save_connection_credentials(business_id, connection_id, payload.model_dump())
            if not saved:
                raise HTTPException(status_code=404, detail="Connection not found.")
            return {"credential_status": "configured", "status": "setup_required"}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Instagram credentials could not be saved for business %s connection %s", business_id, connection_id)
            raise HTTPException(status_code=503, detail="Instagram credentials could not be saved.")

    @router.post("/{connection_id}/verify-instagram")
    def verify_instagram_connection(business_id: str, connection_id: str, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required for this action.")
        try:
            connection = next((item for item in list_connections(business_id) if item["id"] == connection_id), None)
            if connection is None:
                raise HTTPException(status_code=404, detail="Connection not found.")
            if connection["provider"] != "instagram":
                raise HTTPException(status_code=409, detail="Only Instagram connections can be verified here.")
            if connection["status"] in {"paused", "disconnected"}:
                raise HTTPException(status_code=409, detail="Resume the connection before verifying its Instagram account.")
            credentials = get_connection_credentials(business_id, connection_id)
            if not credentials or not credentials.get("access_token"):
                raise HTTPException(status_code=409, detail="Save Instagram credentials before verifying the account.")
        except HTTPException:
            raise
        except Exception:
            logger.exception("Instagram credentials could not be loaded for verification")
            raise HTTPException(status_code=503, detail="Instagram credentials could not be loaded.")
        try:
            response = requests.get(
                "https://graph.instagram.com/me",
                params={"fields": "user_id,username"},
                headers={"Authorization": f"Bearer {credentials['access_token']}"},
                timeout=15,
            )
        except requests.RequestException as exc:
            logger.warning("Instagram verification request failed: %s", type(exc).__name__)
            _record_instagram_health_error(business_id, connection_id, "meta_unreachable")
            raise HTTPException(status_code=502, detail="Meta could not be reached to verify Instagram.")
        if response.status_code != 200:
            code = "token_rejected" if response.status_code in {400, 401, 403} else "meta_unreachable"
            _record_instagram_health_error(business_id, connection_id, code)
            raise HTTPException(status_code=422, detail="Meta rejected the token. Check the account type, token, and Instagram permissions.")
        try:
            profile = response.json()
            account_id = str(profile["user_id"])
            username = str(profile["username"])
        except (ValueError, KeyError, TypeError):
            _record_instagram_health_error(business_id, connection_id, "profile_incomplete")
            raise HTTPException(status_code=502, detail="Meta returned an incomplete Instagram profile.")
        try:
            subscription = requests.post(
                "https://graph.instagram.com/v26.0/me/subscribed_apps",
                params={"subscribed_fields": "messages"},
                headers={"Authorization": f"Bearer {credentials['access_token']}"},
                timeout=15,
            )
        except requests.RequestException as exc:
            logger.warning("Instagram webhook subscription request failed: %s", type(exc).__name__)
            _record_instagram_health_error(business_id, connection_id, "meta_unreachable")
            raise HTTPException(status_code=502, detail="Meta could not be reached to subscribe Instagram messages.")
        if subscription.status_code != 200:
            logger.warning("Meta rejected Instagram webhook subscription with status %s", subscription.status_code)
            code = "subscription_rejected" if subscription.status_code < 500 else "meta_unreachable"
            _record_instagram_health_error(business_id, connection_id, code)
            raise HTTPException(status_code=422, detail="Meta rejected the messages subscription. Check instagram_business_manage_messages access and the messages webhook field.")
        try:
            subscription_result = subscription.json()
        except ValueError:
            _record_instagram_health_error(business_id, connection_id, "subscription_response_invalid")
            raise HTTPException(status_code=502, detail="Meta returned an invalid messages subscription response.")
        if not isinstance(subscription_result, dict) or subscription_result.get("success") is not True:
            logger.warning("Meta did not confirm Instagram webhook subscription")
            _record_instagram_health_error(business_id, connection_id, "subscription_unconfirmed")
            raise HTTPException(status_code=502, detail="Meta did not confirm the Instagram messages subscription.")
        try:
            verified = mark_connection_instagram_verified(business_id, connection_id, account_id, username)
        except Exception:
            logger.exception("Verified Instagram profile could not be saved")
            _record_instagram_health_error(business_id, connection_id, "profile_persistence_failed")
            raise HTTPException(status_code=503, detail="Instagram was verified, but its profile could not be saved.")
        if verified is None:
            raise HTTPException(status_code=404, detail="Connection not found.")
        return {"verified": True, "webhook_subscribed": True, "account_id": account_id, "username": username, "status": verified["status"]}

    @router.put("/{connection_id}/credentials/messenger")
    def save_messenger_credentials(business_id: str, connection_id: str, payload: MessengerCredentials, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required for this action.")
        try:
            connection = next((item for item in list_connections(business_id) if item["id"] == connection_id), None)
            if connection is None:
                raise HTTPException(status_code=404, detail="Connection not found.")
            if connection["provider"] != "messenger":
                raise HTTPException(status_code=409, detail="Messenger credentials can only be saved to a Messenger connection.")
            saved = save_connection_credentials(business_id, connection_id, payload.model_dump())
            if not saved:
                raise HTTPException(status_code=404, detail="Connection not found.")
            return {"credential_status": "configured", "status": "setup_required"}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Messenger credentials could not be saved for business %s connection %s", business_id, connection_id)
            raise HTTPException(status_code=503, detail="Messenger credentials could not be saved.")

    @router.post("/{connection_id}/verify-messenger")
    def verify_messenger_connection(business_id: str, connection_id: str, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required for this action.")
        try:
            connection = next((item for item in list_connections(business_id) if item["id"] == connection_id), None)
            if connection is None:
                raise HTTPException(status_code=404, detail="Connection not found.")
            if connection["provider"] != "messenger":
                raise HTTPException(status_code=409, detail="Only Messenger connections can be verified here.")
            if connection["status"] in {"paused", "disconnected"}:
                raise HTTPException(status_code=409, detail="Resume the connection before verifying its Messenger Page.")
            credentials = get_connection_credentials(business_id, connection_id)
            if not credentials or not credentials.get("page_access_token") or not credentials.get("page_id"):
                raise HTTPException(status_code=409, detail="Save Messenger Page credentials before verification.")
        except HTTPException:
            raise
        except Exception:
            logger.exception("Messenger credentials could not be loaded for verification")
            raise HTTPException(status_code=503, detail="Messenger credentials could not be loaded.")
        try:
            response = requests.get(
                f"https://graph.facebook.com/v26.0/{credentials['page_id']}",
                params={"fields": "id,name"},
                headers={"Authorization": f"Bearer {credentials['page_access_token']}"}, timeout=15,
            )
        except requests.RequestException as exc:
            logger.warning("Messenger verification request failed: %s", type(exc).__name__)
            mark_connection_messenger_error(business_id, connection_id, "meta_unreachable")
            raise HTTPException(status_code=502, detail="Meta could not be reached to verify Messenger.")
        if response.status_code != 200:
            code = "token_rejected" if response.status_code in {400, 401, 403} else "meta_unreachable"
            mark_connection_messenger_error(business_id, connection_id, code)
            raise HTTPException(status_code=422, detail="Meta rejected the Page token. Check Page access and pages_messaging permission.")
        try:
            profile = response.json()
            page_id, page_name = str(profile["id"]), str(profile["name"])
        except (ValueError, KeyError, TypeError):
            mark_connection_messenger_error(business_id, connection_id, "page_profile_incomplete")
            raise HTTPException(status_code=502, detail="Meta returned an incomplete Page profile.")
        if page_id != str(credentials["page_id"]):
            mark_connection_messenger_error(business_id, connection_id, "page_id_mismatch")
            raise HTTPException(status_code=422, detail="The verified Page ID does not match the saved connection.")
        try:
            subscription = requests.post(
                f"https://graph.facebook.com/v26.0/{page_id}/subscribed_apps",
                params={"subscribed_fields": "messages"},
                headers={"Authorization": f"Bearer {credentials['page_access_token']}"}, timeout=15,
            )
        except requests.RequestException as exc:
            logger.warning("Messenger webhook subscription request failed: %s", type(exc).__name__)
            mark_connection_messenger_error(business_id, connection_id, "meta_unreachable")
            raise HTTPException(status_code=502, detail="Meta could not be reached to subscribe Messenger messages.")
        if subscription.status_code != 200:
            code = "subscription_rejected" if subscription.status_code < 500 else "meta_unreachable"
            mark_connection_messenger_error(business_id, connection_id, code)
            raise HTTPException(status_code=422, detail="Meta rejected the Messenger messages subscription. Check Page webhook configuration.")
        try:
            subscription_result = subscription.json()
        except ValueError:
            mark_connection_messenger_error(business_id, connection_id, "subscription_response_invalid")
            raise HTTPException(status_code=502, detail="Meta returned an invalid messages subscription response.")
        if not isinstance(subscription_result, dict) or subscription_result.get("success") is not True:
            mark_connection_messenger_error(business_id, connection_id, "subscription_unconfirmed")
            raise HTTPException(status_code=502, detail="Meta did not confirm the Messenger messages subscription.")
        try:
            verified = mark_connection_messenger_verified(business_id, connection_id, page_id, page_name)
        except Exception:
            logger.exception("Verified Messenger Page could not be saved")
            mark_connection_messenger_error(business_id, connection_id, "page_persistence_failed")
            raise HTTPException(status_code=503, detail="Messenger was verified, but its Page profile could not be saved.")
        if verified is None:
            raise HTTPException(status_code=404, detail="Connection not found.")
        return {"verified": True, "webhook_subscribed": True, "account_id": page_id, "page_name": page_name, "status": verified["status"]}

    @router.patch("/{connection_id}/settings")
    def update_settings(business_id: str, connection_id: str, payload: ConnectionSettingsUpdate, authorization: str | None = Header(default=None)):
        member = trusted_business_member(authorization, business_id)
        if not member:
            raise HTTPException(status_code=401, detail="A valid signed-in business member is required.")
        if member.get("role") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="An active business owner or admin is required for this action.")
        try:
            current = get_connection(business_id, connection_id)
            if current is None:
                raise HTTPException(status_code=404, detail="Connection not found.")
            settings_update = dict(payload.safe_settings)
            merged_settings = {**(current.get("safe_settings") or {}), **settings_update}
            if settings_update.get("outbound_enabled") is True or settings_update.get("auto_reply_enabled") is True:
                if current.get("provider") not in {"instagram", "messenger"}:
                    raise HTTPException(status_code=409, detail="No outbound adapter is available for this provider.")
                if current.get("status") != "connected" or current.get("credential_status") != "configured":
                    raise HTTPException(status_code=409, detail="Verify the connected provider account and credentials before enabling outbound delivery or automatic replies.")
                credentials = get_connection_credentials(business_id, connection_id)
                token_key = "access_token" if current.get("provider") == "instagram" else "page_access_token"
                if not credentials or not credentials.get(token_key):
                    raise HTTPException(status_code=409, detail="Provider access credentials are unavailable.")
            if settings_update.get("outbound_enabled") is False:
                merged_settings["auto_reply_enabled"] = False
                settings_update["auto_reply_enabled"] = False
            if merged_settings.get("auto_reply_enabled") is True and merged_settings.get("outbound_enabled") is not True:
                raise HTTPException(status_code=422, detail="Enable outbound delivery before enabling automatic replies.")
            connection = update_connection_settings(business_id, connection_id, settings_update)
            if connection is None:
                raise HTTPException(status_code=404, detail="Connection not found.")
            publish_business_event(business_id, "connection.settings_updated", "business_connection", str(connection["id"]),
                {"connection_id": str(connection["id"]), "updated_fields": ",".join(sorted(payload.safe_settings)), "updated_by": member["user_id"]})
            return {"connection": connection}
        except HTTPException:
            raise
        except Exception:
            logger.exception(
                "Connection settings update failed for business %s connection %s",
                business_id,
                connection_id,
            )
            raise HTTPException(status_code=503, detail="Connection settings could not be updated.")

    def transition(business_id: str, connection_id: str, action: str, authorization: str | None):
        authorize(business_id, authorization)
        try:
            outcome, connection = transition_connection(business_id, connection_id, action)
        except Exception:
            raise HTTPException(status_code=503, detail="Connection status could not be updated.")
        if outcome == "not_found":
            raise HTTPException(status_code=404, detail="Connection not found.")
        if outcome == "conflict":
            raise HTTPException(status_code=409, detail="That connection status transition is not allowed.")
        publish_business_event(business_id, "connection.status_changed", "business_connection", str(connection["id"]), {"connection_id":str(connection["id"]), "status":connection["status"]})
        return {"connection": connection}

    @router.post("/{connection_id}/pause")
    def pause_connection(business_id: str, connection_id: str, authorization: str | None = Header(default=None)):
        return transition(business_id, connection_id, "pause", authorization)

    @router.post("/{connection_id}/resume")
    def resume_connection(business_id: str, connection_id: str, authorization: str | None = Header(default=None)):
        # Resume to setup_required: only a verified provider handshake may mark connected.
        return transition(business_id, connection_id, "resume", authorization)

    @router.post("/{connection_id}/disconnect")
    def disconnect_connection(business_id: str, connection_id: str, authorization: str | None = Header(default=None)):
        return transition(business_id, connection_id, "disconnect", authorization)

    return router
