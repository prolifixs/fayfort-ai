import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Connection } from "./types";

export function ConnectionsPage({
  accessToken,
  businessId,
  canManage = true,
}: {
  accessToken: string;
  businessId: string;
  canManage?: boolean;
}) {
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("instagram");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accessTokenValue, setAccessTokenValue] = useState("");
  const [messengerPageId, setMessengerPageId] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{ connections: Connection[] }>(
        `/businesses/${businessId}/connections`,
        accessToken,
      );
      setItems(data.connections);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connections could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/connections`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          provider,
          display_name: name,
          safe_settings: { inbound_enabled: true, outbound_enabled: false },
        }),
      });
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function saveInstagramCredentials(event: FormEvent, item: Connection) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/credentials/instagram`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ app_id: appId, app_secret: appSecret, access_token: accessTokenValue }),
      });
      setAppId("");
      setAppSecret("");
      setAccessTokenValue("");
      setEditingCredentials("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Instagram credentials could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function verifyInstagram(item: Connection) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/verify-instagram`, accessToken, {
        method: "POST",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Instagram account could not be verified.");
    } finally {
      setBusy(false);
    }
  }
  async function saveMessengerCredentials(event: FormEvent, item: Connection) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/credentials/messenger`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
          page_id: messengerPageId,
          page_access_token: accessTokenValue,
        }),
      });
      setAppId("");
      setAppSecret("");
      setAccessTokenValue("");
      setMessengerPageId("");
      setEditingCredentials("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Messenger credentials could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function verifyMessenger(item: Connection) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/verify-messenger`, accessToken, {
        method: "POST",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Messenger Page could not be verified.");
    } finally {
      setBusy(false);
    }
  }
  function openCredentialEditor(item: Connection) {
    setAppId("");
    setAppSecret("");
    setAccessTokenValue("");
    setMessengerPageId("");
    setEditingCredentials(editingCredentials === item.id ? "" : item.id);
  }
  async function transition(item: Connection, action: string) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/${action}`, accessToken, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection status could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  async function toggleInbound(item: Connection) {
    setBusy(true);
    setError("");
    try {
      const enabled = item.safe_settings?.inbound_enabled !== true;
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/settings`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ safe_settings: { inbound_enabled: enabled } }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inbound setting could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  async function toggleOutboundSetting(item: Connection, key: "outbound_enabled" | "auto_reply_enabled") {
    setBusy(true);
    setError("");
    try {
      const enabled = item.safe_settings?.[key] !== true;
      await apiRequest(`/businesses/${businessId}/connections/${item.id}/settings`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ safe_settings: { [key]: enabled } }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Outbound setting could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel" aria-label="Connection lifecycle">
      <div className="panel-heading">
        <div>
          <h2>Channel connections</h2>
          <p>
            Connect and verify provider accounts, then enable outbound delivery and automatic replies explicitly when
            ready. Both remain off by default.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form className="inline-form" onSubmit={create}>
        <label>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="instagram">Instagram</option>
            <option value="messenger">Facebook Messenger</option>
          </select>
        </label>
        <label>
          Display name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Instagram support"
          />
        </label>
        <button className="primary-button" disabled={busy || !canManage}>
          Add connection
        </button>
      </form>
      {!canManage && (
        <p className="quiet-note">Only a business owner or admin can change channel setup or credentials.</p>
      )}
      {loading ? (
        <p>Loading connections...</p>
      ) : items.length === 0 ? (
        <p className="empty-copy">No saved channel connections yet.</p>
      ) : (
        <div className="record-list">
          {items.map((item) => (
            <div className="record" key={item.id}>
              <div>
                <strong>{item.display_name}</strong>
                <small>
                  {item.provider} - {item.status} - credentials {item.credential_status}
                </small>
                {item.health_checked_at && (
                  <small>Last provider check: {new Date(item.health_checked_at).toLocaleString()}</small>
                )}
                {item.health_error_code && <small>Health issue: {item.health_error_code.replaceAll("_", " ")}</small>}
                {item.provider_username && (
                  <small>
                    {item.provider === "messenger" ? "Verified Messenger Page: " : "Verified Instagram account: @"}
                    {item.provider_username}
                  </small>
                )}
              </div>
              <div className="record-actions">
                <button disabled={busy || !canManage} onClick={() => void toggleInbound(item)}>
                  {item.safe_settings?.inbound_enabled === true ? "Disable inbound" : "Enable inbound"}
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !canManage ||
                    !["instagram", "messenger"].includes(item.provider) ||
                    item.status !== "connected" ||
                    item.credential_status !== "configured"
                  }
                  onClick={() => void toggleOutboundSetting(item, "outbound_enabled")}
                >
                  {item.safe_settings?.outbound_enabled === true ? "Disable outbound" : "Enable outbound"}
                </button>
                {item.safe_settings?.outbound_enabled === true && (
                  <button
                    type="button"
                    disabled={busy || !canManage || item.status !== "connected"}
                    onClick={() => void toggleOutboundSetting(item, "auto_reply_enabled")}
                  >
                    {item.safe_settings?.auto_reply_enabled === true ? "Disable auto-replies" : "Enable auto-replies"}
                  </button>
                )}
                <small>
                  Automatic replies send only when enabled and accepted by the provider within its response window.
                </small>
                {item.provider === "instagram" && (
                  <>
                    {item.credential_status === "configured" && (
                      <button
                        type="button"
                        disabled={busy || !canManage || ["paused", "disconnected"].includes(item.status)}
                        onClick={() => void verifyInstagram(item)}
                      >
                        Verify account
                      </button>
                    )}
                    <button type="button" disabled={busy || !canManage} onClick={() => openCredentialEditor(item)}>
                      {item.credential_status === "configured" ? "Replace credentials" : "Add credentials"}
                    </button>
                  </>
                )}
                {item.provider === "messenger" && (
                  <>
                    {item.credential_status === "configured" && (
                      <button
                        type="button"
                        disabled={busy || !canManage || ["paused", "disconnected"].includes(item.status)}
                        onClick={() => void verifyMessenger(item)}
                      >
                        Verify Page
                      </button>
                    )}
                    <button type="button" disabled={busy || !canManage} onClick={() => openCredentialEditor(item)}>
                      {item.credential_status === "configured" ? "Replace credentials" : "Add credentials"}
                    </button>
                  </>
                )}
                {item.status !== "paused" && item.status !== "disconnected" && (
                  <button onClick={() => void transition(item, "pause")}>Pause</button>
                )}
                {["paused", "disconnected", "error"].includes(item.status) && (
                  <button onClick={() => void transition(item, "resume")}>Resume setup</button>
                )}
                {item.status !== "disconnected" && (
                  <button onClick={() => void transition(item, "disconnect")}>Disconnect</button>
                )}
              </div>
              {editingCredentials === item.id && item.provider === "messenger" && (
                <form className="inline-form" onSubmit={(event) => void saveMessengerCredentials(event, item)}>
                  <label>
                    Meta App ID
                    <input required autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} />
                  </label>
                  <label>
                    Meta App Secret
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                    />
                  </label>
                  <label>
                    Facebook Page ID
                    <input
                      required
                      autoComplete="off"
                      value={messengerPageId}
                      onChange={(e) => setMessengerPageId(e.target.value)}
                    />
                  </label>
                  <label>
                    Page Access Token
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={accessTokenValue}
                      onChange={(e) => setAccessTokenValue(e.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={busy || !canManage}>
                    {busy ? "Saving..." : "Save credentials"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => openCredentialEditor(item)}>
                    Cancel
                  </button>
                  <small>
                    Uses the Page access token and pages_messaging permission. Values are stored in the credential vault
                    and never displayed again.
                  </small>
                </form>
              )}
              {editingCredentials === item.id && item.provider === "instagram" && (
                <form className="inline-form" onSubmit={(event) => void saveInstagramCredentials(event, item)}>
                  <label>
                    Instagram App ID
                    <input required autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} />
                  </label>
                  <label>
                    Instagram App Secret
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                    />
                  </label>
                  <label>
                    Access Token
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={accessTokenValue}
                      onChange={(e) => setAccessTokenValue(e.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={busy || !canManage}>
                    {busy ? "Saving..." : "Save credentials"}
                  </button>
                  <button type="button" disabled={busy} onClick={() => openCredentialEditor(item)}>
                    Cancel
                  </button>
                  <small>
                    Saving replaces the current token for this connection. Values are never displayed again.
                  </small>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
