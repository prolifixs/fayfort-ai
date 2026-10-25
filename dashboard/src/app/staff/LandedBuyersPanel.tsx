import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";

/** Control Center → Emails → LANDED buyers (app/membership/landed.py): the Baserow tables close on 30 November 2026.
 * Read buyers from Shopify, see who has signed up, and send the notice and the reminder (at most ~95 a day). */
type Summary = {
  buyers: number;
  orders: number;
  signed_up: number;
  notice_sent: number;
  reminder_sent: number;
  refunded_orders: number;
  snapshot: Record<string, number>;
  baserow_closes: string;
  daily_limit: number;
};
type Kind = "notice" | "reminder";
type DryRun = { kind: Kind; waiting: number; would_send: number };

const EMAIL_LABEL: Record<Kind, string> = {
  notice: "“Your LANDED directory is moving to FayFort”",
  reminder: "Reminder before 30 November (only buyers who haven't signed up)",
};

export function LandedBuyersPanel({ accessToken }: { accessToken: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<DryRun | null>(null);
  const load = useCallback(async () => {
    try {
      setSummary(await apiRequest<Summary>("/platform/landed", accessToken));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "LANDED buyers could not be loaded.");
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  async function sync() {
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ orders_scanned: number; created: number; earliest_order: string | null; product_found: boolean; summary: Summary }>(
        "/platform/landed/sync",
        accessToken,
        { method: "POST", body: JSON.stringify({}) },
      );
      setSummary(result.summary);
      const earliest = result.earliest_order ? ` Oldest order Shopify returned: ${result.earliest_order.slice(0, 10)}.` : "";
      setNotice(`Checked ${result.orders_scanned} Shopify orders; ${result.created} new LANDED buyers.${earliest}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shopify could not be read.");
    } finally {
      setBusy("");
    }
  }
  async function preview(kind: Kind) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<DryRun>("/platform/landed/send", accessToken, {
        method: "POST",
        body: JSON.stringify({ kind, dry_run: true }),
      });
      if (!result.waiting) setNotice("Everyone has already had this email.");
      else setConfirm({ ...result, kind });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That email could not be checked.");
    } finally {
      setBusy("");
    }
  }
  async function send() {
    if (!confirm) return;
    setBusy("send");
    setError("");
    try {
      const result = await apiRequest<{ queued: number; still_waiting: number }>("/platform/landed/send", accessToken, {
        method: "POST",
        body: JSON.stringify({ kind: confirm.kind, dry_run: false }),
      });
      setNotice(
        `${result.queued} emails queued.` + (result.still_waiting ? ` ${result.still_waiting} left for tomorrow (daily limit).` : ""),
      );
      setConfirm(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The emails could not be queued.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="LANDED buyers">
      <div className="panel-heading">
        <div>
          <h2>LANDED buyers</h2>
          <p>
            The Baserow tables close on {summary?.baserow_closes || "30 November 2026"}. Buyers who sign up with their purchase email see the
            directory addresses free.
          </p>
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
      {!summary ? (
        !error && <FayfortLoader label="Loading…" />
      ) : (
        <>
          <dl className="landed-stats">
            <div>
              <dt>Buyers</dt>
              <dd>{summary.buyers}</dd>
            </div>
            <div>
              <dt>Signed up</dt>
              <dd>{summary.signed_up}</dd>
            </div>
            <div>
              <dt>Notice sent</dt>
              <dd>{summary.notice_sent}</dd>
            </div>
            <div>
              <dt>Reminder sent</dt>
              <dd>{summary.reminder_sent}</dd>
            </div>
          </dl>
          <p className="muted">
            Snapshot: {summary.snapshot.market ?? 0} markets and {summary.snapshot.service_provider ?? 0} service providers. Addresses only;
            supplier contacts still use credits.
          </p>
          <div className="newsletter-actions">
            <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void sync()}>
              {busy === "sync" ? "Reading Shopify…" : "Read buyers from Shopify"}
            </button>
            <button type="button" className="primary-button" disabled={!!busy || !summary.buyers} onClick={() => void preview("notice")}>
              Send the notice…
            </button>
            <button type="button" className="secondary-button" disabled={!!busy || !summary.notice_sent} onClick={() => void preview("reminder")}>
              Send the reminder…
            </button>
          </div>
          {confirm && (
            <div className="worker-confirm" role="alertdialog" aria-label="Confirm LANDED email">
              <p>
                Send {EMAIL_LABEL[confirm.kind]} to <strong>{confirm.would_send}</strong> buyer{confirm.would_send === 1 ? "" : "s"}?
                {confirm.waiting > confirm.would_send && ` The other ${confirm.waiting - confirm.would_send} go tomorrow (daily limit).`}
              </p>
              <div className="newsletter-actions">
                <button type="button" className="primary-button" disabled={busy === "send"} onClick={() => void send()}>
                  {busy === "send" ? "Queuing…" : "Send"}
                </button>
                <button type="button" className="secondary-button" disabled={busy === "send"} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
