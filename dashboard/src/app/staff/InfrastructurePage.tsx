import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

type Tunnel = {
  id: string;
  name: string | null;
  status: string;
  conns_active_at?: string | null;
  connections: { colo_name?: string | null; opened_at?: string | null; client_version?: string | null }[];
  hostnames?: { hostname: string; service: string }[];
  hostnames_error?: string;
};
type PreflightResult = { name: string; ok: boolean; detail: string };
type WebhookEndpoint = {
  channel: "instagram" | "messenger";
  public_url: string | null;
  suggested_public_url: string | null;
  callback_url: string | null;
  last_preflight_at: string | null;
  last_preflight_ok: boolean | null;
  last_preflight_results: PreflightResult[];
  last_event_at: string | null;
};
type InfrastructureStatus = {
  cloudflare: {
    status: "not_configured" | "configured" | "verified" | "error";
    safe_settings: { account_id?: string; zone_name?: string; zone_status?: string; name_servers?: string[] };
    health_checked_at?: string | null;
    health_error_code?: string | null;
  };
  tunnels: Tunnel[];
  cloudflare_error_code: string | null;
  webhooks: WebhookEndpoint[];
  local_api: { base_url: string; public_api_url: string | null };
  recent_events: { id?: string; action: string; details: Record<string, unknown>; created_at?: string }[];
};

const BASE = "/platform/infrastructure";
const channelLabel = { instagram: "Instagram", messenger: "Facebook Messenger" } as const;

function when(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "never";
}

function statusTone(status: string) {
  return status === "healthy" || status === "verified" || status === "active" ? "ok" : status === "degraded" || status === "pending" ? "warn" : "bad";
}

export function InfrastructurePage({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<InfrastructureStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [zoneName, setZoneName] = useState("fayfort.com");
  const [tunnelName, setTunnelName] = useState("fayfort-api-dev");
  const [routeLabel, setRouteLabel] = useState<Record<string, string>>({});
  const [routeConfirm, setRouteConfirm] = useState<Record<string, boolean>>({});
  const [installCommand, setInstallCommand] = useState<{ tunnelId: string; command: string } | null>(null);
  const [webhookUrls, setWebhookUrls] = useState<Record<string, string>>({});

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const next = await apiRequest<InfrastructureStatus>(`${BASE}${refresh ? "?refresh=true" : ""}`, accessToken);
        setData(next);
        setWebhookUrls((current) => {
          const merged = { ...current };
          for (const endpoint of next.webhooks)
            merged[endpoint.channel] ??= endpoint.public_url || endpoint.suggested_public_url || "";
          return merged;
        });
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Infrastructure status could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (message) setNotice(message);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function saveCloudflare(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await apiRequest(`${BASE}/cloudflare/credentials`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ api_token: token.trim(), account_id: accountId.trim(), zone_name: zoneName.trim() }),
      });
      setToken("");
      return "Cloudflare connected and verified. The API token is stored in the vault and is never shown again.";
    });
  }

  function createTunnel(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await apiRequest(`${BASE}/cloudflare/tunnels`, accessToken, { method: "POST", body: JSON.stringify({ name: tunnelName.trim() }) });
      return `Tunnel ${tunnelName.trim()} created. Route a hostname to it, then install its connector.`;
    });
  }

  function routeHostname(tunnel: Tunnel) {
    const label = routeLabel[tunnel.id] || "api-dev";
    void run(async () => {
      const result = await apiRequest<{ public_url: string; dns: string }>(`${BASE}/cloudflare/hostnames`, accessToken, {
        method: "POST",
        body: JSON.stringify({ tunnel_id: tunnel.id, label, confirm: routeConfirm[tunnel.id] === true }),
      });
      setRouteConfirm((current) => ({ ...current, [tunnel.id]: false }));
      return `${result.public_url} now routes to this tunnel (DNS ${result.dns}).`;
    });
  }

  function showInstallCommand(tunnel: Tunnel, platform: "windows" | "linux") {
    void run(async () => {
      const result = await apiRequest<{ command: string }>(`${BASE}/cloudflare/tunnels/${tunnel.id}/install-command`, accessToken, {
        method: "POST",
        body: JSON.stringify({ platform }),
      });
      setInstallCommand({ tunnelId: tunnel.id, command: result.command });
    });
  }

  function saveWebhook(channel: WebhookEndpoint["channel"]) {
    void run(async () => {
      const result = await apiRequest<{ callback_url: string }>(`${BASE}/webhooks/${channel}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ public_url: (webhookUrls[channel] || "").trim() }),
      });
      return `Saved. Meta callback URL: ${result.callback_url}`;
    });
  }

  function preflight(channel: WebhookEndpoint["channel"]) {
    void run(async () => {
      const result = await apiRequest<{ ok: boolean }>(`${BASE}/webhooks/${channel}/preflight`, accessToken, { method: "POST" });
      return result.ok ? `${channelLabel[channel]} webhook is reachable and verified.` : `${channelLabel[channel]} preflight found problems; see the checks below.`;
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied.");
    } catch {
      setNotice("Copy failed; select the text and copy it manually.");
    }
  }

  const cloudflare = data?.cloudflare;
  const connected = cloudflare?.status === "verified";

  return (
    <div className="infrastructure-page">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status" className="quiet-note">{notice}</p>}

      <section className="control-panel" aria-label="Cloudflare connection">
        <div className="panel-heading">
          <div>
            <h2>Cloudflare</h2>
            <p>
              DNS, tunnels and public hostnames for {cloudflare?.safe_settings.zone_name || "fayfort.com"}. The API token is kept
              in the credential vault and is never displayed.
            </p>
          </div>
          <button type="button" disabled={busy || loading} onClick={() => void load(true)}>
            Refresh
          </button>
        </div>
        {loading && !data ? (
          <p>Loading infrastructure…</p>
        ) : (
          <>
            <div className="record-list">
              <div className="record">
                <div>
                  <strong>
                    Connection <span className={`infra-pill ${statusTone(cloudflare?.status || "")}`}>{(cloudflare?.status || "not_configured").replaceAll("_", " ")}</span>
                  </strong>
                  {cloudflare?.safe_settings.zone_name && (
                    <small>
                      Zone {cloudflare.safe_settings.zone_name} · {cloudflare.safe_settings.zone_status || "unknown"}
                      {cloudflare.safe_settings.zone_status === "pending" && " — waiting for the nameserver change at Hostinger"}
                    </small>
                  )}
                  {cloudflare?.safe_settings.name_servers?.length ? (
                    <small>Cloudflare nameservers: {cloudflare.safe_settings.name_servers.join(", ")}</small>
                  ) : null}
                  {cloudflare?.health_error_code && <small>Last issue: {cloudflare.health_error_code.replaceAll("_", " ")}</small>}
                  {data?.cloudflare_error_code && <small>Live status unavailable: {data.cloudflare_error_code.replaceAll("_", " ")}</small>}
                  <small>Local API {data?.local_api.base_url} · public address {data?.local_api.public_api_url || "not set (PUBLIC_API_URL)"}</small>
                </div>
                {connected && (
                  <div className="record-actions">
                    <button type="button" disabled={busy} onClick={() => void run(async () => {
                      await apiRequest(`${BASE}/cloudflare/verify`, accessToken, { method: "POST" });
                      return "Cloudflare re-verified.";
                    })}>
                      Re-verify
                    </button>
                  </div>
                )}
              </div>
            </div>
            <form className="inline-form" onSubmit={saveCloudflare} aria-label="Cloudflare credentials">
              <label>
                API token
                <input required type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={connected ? "Replace token" : "Cloudflare API token"} />
              </label>
              <label>
                Account ID
                <input required autoComplete="off" pattern="[0-9a-f]{32}" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={cloudflare?.safe_settings.account_id || "32-character account ID"} />
              </label>
              <label>
                Domain
                <input required value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
              </label>
              <button className="primary-button" disabled={busy}>
                {connected ? "Replace and verify" : "Connect and verify"}
              </button>
            </form>
            <p className="quiet-note">
              Token permissions: Account › Cloudflare Tunnel › Edit, and Zone › DNS › Edit for this domain only.
            </p>
          </>
        )}
      </section>

      {connected && (
        <section className="control-panel" aria-label="Cloudflare tunnels">
          <div className="panel-heading">
            <div>
              <h2>Tunnels</h2>
              <p>Each machine that runs the API connects through a named tunnel. FayFort only manages api and api-&lt;name&gt; hostnames.</p>
            </div>
          </div>
          <form className="inline-form" onSubmit={createTunnel}>
            <label>
              New tunnel name
              <input required value={tunnelName} onChange={(e) => setTunnelName(e.target.value)} />
            </label>
            <button className="primary-button" disabled={busy}>Create tunnel</button>
          </form>
          {data?.tunnels.length === 0 ? (
            <p className="empty-copy">No tunnels in this Cloudflare account yet.</p>
          ) : (
            <div className="record-list">
              {data?.tunnels.map((tunnel) => (
                <div className="record" key={tunnel.id}>
                  <div>
                    <strong>
                      {tunnel.name} <span className={`infra-pill ${statusTone(tunnel.status)}`}>{tunnel.status}</span>
                    </strong>
                    <small>
                      {tunnel.connections.length
                        ? `${tunnel.connections.length} connector link(s): ${tunnel.connections.map((c) => c.colo_name).join(", ")} · cloudflared ${tunnel.connections[0]?.client_version || "?"}`
                        : "No connector running"}
                    </small>
                    {(tunnel.hostnames || []).map((route) => (
                      <small key={route.hostname}>
                        https://{route.hostname} → {route.service}
                      </small>
                    ))}
                  </div>
                  <div className="record-actions">
                    <label>
                      Hostname
                      <select value={routeLabel[tunnel.id] || "api-dev"} onChange={(e) => setRouteLabel((c) => ({ ...c, [tunnel.id]: e.target.value }))}>
                        <option value="api-dev">api-dev.{cloudflare?.safe_settings.zone_name}</option>
                        <option value="api">api.{cloudflare?.safe_settings.zone_name}</option>
                      </select>
                    </label>
                    <label className="infra-confirm">
                      <input type="checkbox" checked={routeConfirm[tunnel.id] === true} onChange={(e) => setRouteConfirm((c) => ({ ...c, [tunnel.id]: e.target.checked }))} />
                      I confirm this DNS change
                    </label>
                    <button type="button" disabled={busy || routeConfirm[tunnel.id] !== true} onClick={() => routeHostname(tunnel)}>
                      Route hostname
                    </button>
                    <button type="button" disabled={busy} onClick={() => showInstallCommand(tunnel, "windows")}>
                      Install command (Windows)
                    </button>
                    <button type="button" disabled={busy} onClick={() => showInstallCommand(tunnel, "linux")}>
                      Install command (Linux)
                    </button>
                  </div>
                  {installCommand?.tunnelId === tunnel.id && (
                    <div className="infra-secret">
                      <p>Run once, as administrator, on the machine that hosts the API. Treat it like a password.</p>
                      <textarea readOnly rows={3} value={installCommand.command} aria-label="Connector install command" />
                      <div className="record-actions">
                        <button type="button" onClick={() => void copy(installCommand.command)}>Copy</button>
                        <button type="button" onClick={() => setInstallCommand(null)}>Hide</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="control-panel" aria-label="Webhook endpoints">
        <div className="panel-heading">
          <div>
            <h2>Webhook endpoints</h2>
            <p>The public address providers call. Save it once; paste the callback URL into Meta; run the preflight any time.</p>
          </div>
        </div>
        <div className="record-list">
          {data?.webhooks.map((endpoint) => (
            <div className="record" key={endpoint.channel}>
              <div>
                <strong>
                  {channelLabel[endpoint.channel]}{" "}
                  {endpoint.last_preflight_ok !== null && (
                    <span className={`infra-pill ${endpoint.last_preflight_ok ? "ok" : "bad"}`}>{endpoint.last_preflight_ok ? "reachable" : "failing"}</span>
                  )}
                </strong>
                {endpoint.callback_url ? (
                  <small>
                    Callback URL: <code>{endpoint.callback_url}</code>{" "}
                    <button type="button" className="text-button" onClick={() => void copy(endpoint.callback_url!)}>Copy</button>
                  </small>
                ) : (
                  <small>Not saved yet.</small>
                )}
                <small>Last preflight {when(endpoint.last_preflight_at)} · last inbound event {when(endpoint.last_event_at)}</small>
                {endpoint.last_preflight_results.length > 0 && (
                  <ul className="infra-checks">
                    {endpoint.last_preflight_results.map((check) => (
                      <li key={check.name} className={check.ok ? "ok" : "bad"}>
                        {check.ok ? "✓" : "✗"} {check.name} — {check.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="record-actions">
                <label>
                  Public HTTPS address
                  <input value={webhookUrls[endpoint.channel] || ""} onChange={(e) => setWebhookUrls((c) => ({ ...c, [endpoint.channel]: e.target.value }))} placeholder="https://api-dev.fayfort.com" />
                </label>
                <button type="button" disabled={busy || !(webhookUrls[endpoint.channel] || "").trim()} onClick={() => saveWebhook(endpoint.channel)}>
                  Save address
                </button>
                <button type="button" disabled={busy || !endpoint.public_url} onClick={() => preflight(endpoint.channel)}>
                  Run preflight
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {data && data.recent_events.length > 0 && (
        <section className="control-panel" aria-label="Infrastructure activity">
          <div className="panel-heading">
            <div>
              <h2>Recent infrastructure activity</h2>
            </div>
          </div>
          <ul className="infra-activity">
            {data.recent_events.map((event, index) => (
              <li key={event.id || index}>
                <strong>{event.action.replaceAll(/[._]/g, " ")}</strong> <small>{when(event.created_at)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
