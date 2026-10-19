import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "../../lib/api";

/** Control Center → Infrastructure → Connections: Shopify, Stripe and email at a glance, and Connect Stripe.
 * The Stripe key is checked with Stripe, then kept encrypted in the database vault; only a hint is ever shown. */

type Connections = {
  shopify: { connected: boolean; store: string | null; webhooks: boolean; manage: string };
  stripe: {
    connected: boolean;
    ready: boolean;
    mode: "test" | "live" | "not_configured";
    source: "server" | "connections" | "none";
    key_hint: string | null;
    problem: string | null;
    saved_at: string | null;
    manage: string;
  };
  email: { connected: boolean; sending: boolean; from: string; manage: string };
};

function Pill({ tone, children }: { tone: "good" | "warn" | "off"; children: string }) {
  return <span className={`status-pill ${tone === "good" ? "is-good" : tone === "warn" ? "is-warn" : ""}`.trim()}>{children}</span>;
}

export function ConnectionsSection({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<Connections | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Connections>("/platform/connections", accessToken));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so Connections aren't available yet."
          : reason instanceof Error
            ? reason.message
            : "Connections could not be loaded.",
      );
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await apiRequest<Connections>(
        "/platform/connections/stripe",
        accessToken,
        { method: "PUT", body: JSON.stringify({ secret_key: key.trim() }) },
        60_000,
      );
      setData(next);
      setKey("");
      setOpen(false);
      setNotice(
        next.stripe.ready
          ? `Stripe is connected in ${next.stripe.mode} mode. Plans, the customer portal and the webhook are set up.`
          : "Stripe is connected. Finish setup in Shop → Member plans (Run setup and sync now).",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stripe could not be connected.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      setData(await apiRequest<Connections>("/platform/connections/stripe", accessToken, { method: "DELETE" }));
      setNotice("The Stripe key was removed. Members can't start or change plans until Stripe is connected again.");
      setConfirmRemove(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The key could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const stripe = data?.stripe;
  return (
    <section className="control-panel connections-panel" aria-label="Connections">
      <div className="panel-heading">
        <div>
          <h2>Connections</h2>
          <p>The outside services FayFort runs on. Keys are kept encrypted and never shown again after saving.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-delivery ok" role="status">
          {notice}
        </p>
      )}
      {data && stripe && (
        <ul className="connections-list">
          <li>
            <div>
              <strong>Shopify</strong>
              <small>{data.shopify.connected ? `${data.shopify.store} · ${data.shopify.webhooks ? "order updates on" : "order updates not set up"}` : "Not connected"}</small>
              <small className="muted">Manage in {data.shopify.manage}</small>
            </div>
            <Pill tone={data.shopify.connected ? (data.shopify.webhooks ? "good" : "warn") : "off"}>
              {data.shopify.connected ? (data.shopify.webhooks ? "Connected" : "Needs webhooks") : "Not connected"}
            </Pill>
          </li>
          <li className="connections-stripe">
            <div>
              <strong>Stripe</strong>
              <small>
                {stripe.connected
                  ? `${stripe.mode === "live" ? "Live" : "Test"} mode · ${stripe.source === "server" ? "set on the API server" : `key ${stripe.key_hint || "saved"}`}`
                  : "Memberships (Standard and Pro) are paid through Stripe. Not connected yet."}
              </small>
              {stripe.problem && <small className="form-error">{stripe.problem}</small>}
              <small className="muted">Plans and payments: {stripe.manage}</small>
            </div>
            <div className="connections-actions">
              <Pill tone={stripe.connected ? (stripe.ready ? "good" : "warn") : "off"}>
                {stripe.connected ? (stripe.ready ? (stripe.mode === "live" ? "Live" : "Test mode") : "Setup needed") : "Not connected"}
              </Pill>
              {stripe.source !== "server" && !open && (
                <button type="button" className={stripe.connected ? "secondary-button" : "primary-button"} onClick={() => setOpen(true)}>
                  {stripe.connected ? "Replace key" : "Connect Stripe"}
                </button>
              )}
              {stripe.source === "connections" &&
                (confirmRemove ? (
                  <>
                    <button type="button" className="secondary-button danger" disabled={busy} onClick={() => void disconnect()}>
                      Yes, remove
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setConfirmRemove(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="secondary-button" onClick={() => setConfirmRemove(true)}>
                    Remove
                  </button>
                ))}
            </div>
            {open && (
              <form className="connections-form" onSubmit={connect} aria-label="Connect Stripe">
                <ol>
                  <li>In Stripe, open Developers → API keys.</li>
                  <li>
                    Copy the <b>Secret key</b> (starts with <code>sk_test_</code> while testing, <code>sk_live_</code> when you go live). Not the publishable key.
                  </li>
                  <li>Paste it here. FayFort checks it with Stripe, saves it encrypted, then creates the plans and the webhook.</li>
                </ol>
                <label>
                  Stripe secret key
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    value={key}
                    placeholder="sk_test_…"
                    onChange={(event) => setKey(event.target.value)}
                  />
                </label>
                {key.trim().startsWith("sk_live_") && (
                  <p className="email-delivery off" role="note">
                    This is a live key: members will be charged real money once it's saved.
                  </p>
                )}
                <div className="connections-actions">
                  <button className="primary-button" disabled={busy || key.trim().length < 20}>
                    {busy ? "Checking with Stripe…" : "Check and connect"}
                  </button>
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => (setOpen(false), setKey(""))}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </li>
          <li>
            <div>
              <strong>Email (Resend)</strong>
              <small>{data.email.connected ? `Sending as ${data.email.from}` : "Not connected"}</small>
              <small className="muted">Manage in {data.email.manage}</small>
            </div>
            <Pill tone={data.email.connected ? (data.email.sending ? "good" : "warn") : "off"}>
              {data.email.connected ? (data.email.sending ? "Sending" : "Paused") : "Not connected"}
            </Pill>
          </li>
        </ul>
      )}
    </section>
  );
}
