import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { relativeTime } from "./WorkforcePage";

type Category = "conversations" | "fulfillment" | "notifications" | "newsletter" | "account_security";

interface CategoryRow {
  category: Category;
  label: string;
  description: string;
  enabled: boolean;
  locked: boolean;
  last_7_days: { sent?: number; skipped?: number; failed?: number; queued?: number };
}
interface Overview {
  delivery: { configured: boolean; enabled: boolean; from: string; reply_to: string };
  categories: CategoryRow[];
}
interface EmailRow {
  id: string;
  category: Category;
  template: string;
  recipient: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  skip_reason: string | null;
  subject: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}
interface Newsletter {
  id: string;
  subject: string;
  body_text: string;
  status: "draft" | "sending" | "sent";
  recipient_count: number;
  created_at: string;
  sent_at: string | null;
  delivery: Record<string, number>;
}

const STATUS_LABEL: Record<EmailRow["status"], string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
};
const CATEGORY_SHORT: Record<Category, string> = {
  conversations: "Conversation",
  fulfillment: "Fulfilment",
  notifications: "Notification",
  newsletter: "Newsletter",
  account_security: "Security",
};

type Tab = "settings" | "log" | "newsletter";

/** Control Center → Emails: category switches, delivery log and a simple newsletter. */
export function EmailCenterPage({ accessToken }: { accessToken: string }) {
  const [tab, setTab] = useState<Tab>("settings");
  return (
    <div className="email-center">
      <div className="email-tabs" role="tablist" aria-label="Email sections">
        {(
          [
            ["settings", "Email types"],
            ["log", "Sent emails"],
            ["newsletter", "Newsletter"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "settings" && <EmailTypesPanel accessToken={accessToken} />}
      {tab === "log" && <EmailLogPanel accessToken={accessToken} />}
      {tab === "newsletter" && <NewsletterPanel accessToken={accessToken} />}
    </div>
  );
}

function DeliveryBanner({ delivery }: { delivery: Overview["delivery"] }) {
  if (delivery.configured && delivery.enabled)
    return (
      <p className="email-delivery ok" role="status">
        Sending is on, from {delivery.from}. Replies go to {delivery.reply_to}.
      </p>
    );
  return (
    <p className="email-delivery off" role="status">
      Sending is off on the server, so emails wait in the queue.
      {!delivery.configured ? " The Resend API key isn't set yet." : " EMAIL_DELIVERY_ENABLED isn't on yet."}
    </p>
  );
}

function EmailTypesPanel({ accessToken }: { accessToken: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Category | null>(null);
  const load = useCallback(async () => {
    try {
      setOverview(await apiRequest<Overview>("/platform/email/overview", accessToken));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Email settings could not be loaded.");
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(row: CategoryRow) {
    setSaving(row.category);
    setError("");
    try {
      await apiRequest(`/platform/email/categories/${row.category}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The setting could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="control-panel" aria-label="Email types">
      <div className="panel-heading">
        <div>
          <h2>Email types</h2>
          <p>
            Turn a type off and nothing of that kind is emailed to anyone; members still see the alert in the app.
            Members can also turn types off for themselves in Settings. Counts cover the last 7 days.
          </p>
        </div>
      </div>
      {overview && <DeliveryBanner delivery={overview.delivery} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!overview && !error && <p role="status">Loading email settings…</p>}
      {overview && (
        <ul className="email-type-list">
          {overview.categories.map((row) => (
            <li key={row.category}>
              <div>
                <strong>{row.label}</strong>
                <small>{row.description}</small>
                <span className="email-counts">
                  {row.last_7_days.sent || 0} sent · {row.last_7_days.skipped || 0} skipped ·{" "}
                  {row.last_7_days.failed || 0} failed · {row.last_7_days.queued || 0} waiting
                </span>
              </div>
              <label className="email-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${row.label} emails`}
                  checked={row.enabled}
                  disabled={row.locked || saving === row.category}
                  onChange={() => void toggle(row)}
                />
                <span>{row.locked ? "Always on" : row.enabled ? "On" : "Off"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmailLogPanel({ accessToken }: { accessToken: string }) {
  const [rows, setRows] = useState<EmailRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "150" });
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    try {
      const result = await apiRequest<{ emails: EmailRow[] }>(`/platform/email/log?${params.toString()}`, accessToken);
      setRows(result.emails);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The email log could not be loaded.");
    }
  }, [accessToken, status, category]);
  useEffect(() => {
    void load();
  }, [load]);

  async function retry(row: EmailRow) {
    setNotice("");
    try {
      await apiRequest(`/platform/email/log/${row.id}/retry`, accessToken, { method: "POST" });
      setNotice("Queued again. It will go out within a minute if sending is on.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The email could not be retried.");
    }
  }

  return (
    <section className="control-panel" aria-label="Sent emails">
      <div className="panel-heading">
        <div>
          <h2>Sent emails</h2>
          <p>Every email FayFort sends or decides not to send, newest first. Sign-in emails are sent by Supabase and aren't listed here.</p>
        </div>
      </div>
      <div className="workforce-filters">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All</option>
            {Object.entries(CATEGORY_SHORT).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {rows && rows.length === 0 && <p className="empty-copy">No emails yet.</p>}
      {rows && rows.length > 0 && (
        <table className="workforce-table email-log">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">To</th>
              <th scope="col">Type</th>
              <th scope="col">Subject</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td data-label="When">
                  <time dateTime={row.sent_at || row.created_at} title={new Date(row.sent_at || row.created_at).toLocaleString()}>
                    {relativeTime(row.sent_at || row.created_at)}
                  </time>
                </td>
                <td data-label="To">{row.recipient || "—"}</td>
                <td data-label="Type">{CATEGORY_SHORT[row.category]}</td>
                <td data-label="Subject">{row.subject || <span className="muted">Not sent</span>}</td>
                <td data-label="Status">
                  <span className={`status-chip email-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                  {row.skip_reason && <small>{row.skip_reason}</small>}
                  {row.last_error && row.status !== "sent" && <small className="invite-expired">{row.last_error}</small>}
                  {row.status === "failed" && row.category !== "account_security" && (
                    <button type="button" className="text-button" onClick={() => void retry(row)}>
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewsletterPanel({ accessToken }: { accessToken: string }) {
  const [letters, setLetters] = useState<Newsletter[] | null>(null);
  const [editing, setEditing] = useState<Newsletter | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ html: string; recipients: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setLetters((await apiRequest<{ newsletters: Newsletter[] }>("/platform/newsletters", accessToken)).newsletters);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Newsletters could not be loaded.");
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  function startNew() {
    setEditing({ id: "", subject: "", body_text: "", status: "draft", recipient_count: 0, created_at: "", sent_at: null, delivery: {} });
    setSubject("");
    setBody("");
    setPreview(null);
    setConfirming(false);
    setNotice("");
    setError("");
  }

  async function save(): Promise<Newsletter | null> {
    if (!editing) return null;
    const payload = JSON.stringify({ subject: subject.trim(), body_text: body.trim() });
    const result = editing.id
      ? await apiRequest<{ newsletter: Newsletter }>(`/platform/newsletters/${editing.id}`, accessToken, { method: "PUT", body: payload })
      : await apiRequest<{ newsletter: Newsletter }>("/platform/newsletters", accessToken, { method: "POST", body: payload });
    setEditing(result.newsletter);
    return result.newsletter;
  }

  async function run(action: "save" | "preview" | "test" | "send", event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await save();
      if (!saved) return;
      if (action === "save") setNotice("Draft saved.");
      if (action === "preview") {
        const result = await apiRequest<{ html: string; recipients: number }>(`/platform/newsletters/${saved.id}/preview`, accessToken);
        setPreview({ html: result.html, recipients: result.recipients });
      }
      if (action === "test") {
        const result = await apiRequest<{ sent_to: string }>(`/platform/newsletters/${saved.id}/test`, accessToken, { method: "POST" });
        setNotice(`Test sent to ${result.sent_to}.`);
      }
      if (action === "send") {
        const result = await apiRequest<{ recipients: number }>(`/platform/newsletters/${saved.id}/send`, accessToken, { method: "POST" });
        setNotice(`Sending to ${result.recipients} member${result.recipients === 1 ? "" : "s"}. Follow progress in Sent emails.`);
        setEditing(null);
        setConfirming(false);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="control-panel" aria-label="Newsletter">
      <div className="panel-heading">
        <div>
          <h2>Newsletter</h2>
          <p>
            Write a subject and a message. Leave a blank line between paragraphs; links like https://fayfort.com become
            clickable. It goes to every member with a confirmed email who hasn't unsubscribed. Staff accounts are left out.
          </p>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!editing && (
        <button type="button" className="primary-button" onClick={startNew}>
          New newsletter
        </button>
      )}
      {editing && (
        <form className="newsletter-form" onSubmit={(event) => void run("save", event)}>
          <label htmlFor="newsletter-subject">Subject</label>
          <input
            id="newsletter-subject"
            required
            maxLength={150}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <label htmlFor="newsletter-body">Message</label>
          <textarea
            id="newsletter-body"
            required
            rows={12}
            maxLength={20000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="newsletter-actions">
            <button className="secondary-button" disabled={busy || !subject.trim() || !body.trim()}>
              Save draft
            </button>
            <button type="button" className="secondary-button" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void run("preview")}>
              Preview
            </button>
            <button type="button" className="secondary-button" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void run("test")}>
              Send a test to me
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={async () => {
                await run("preview");
                setConfirming(true);
              }}
            >
              Send to members…
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          {confirming && preview && (
            <div className="worker-confirm" role="alertdialog" aria-label="Confirm newsletter send">
              <p>
                Send “{subject.trim()}” to {preview.recipients} member{preview.recipients === 1 ? "" : "s"} now? This can't be
                undone.
              </p>
              <div>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void run("send")}>
                  {busy ? "Sending…" : `Send to ${preview.recipients}`}
                </button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {preview && (
            <iframe className="newsletter-preview" title="Newsletter preview" sandbox="" srcDoc={preview.html} />
          )}
        </form>
      )}
      <h3 className="newsletter-history-title">History</h3>
      {letters && letters.length === 0 && <p className="empty-copy">No newsletters yet.</p>}
      {letters && letters.length > 0 && (
        <ul className="worker-list">
          {letters.map((letter) => (
            <li key={letter.id}>
              <strong>{letter.subject}</strong>
              <small>
                {letter.status === "draft" ? (
                  <>
                    Draft · saved {relativeTime(letter.created_at)} ·{" "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setEditing(letter);
                        setSubject(letter.subject);
                        setBody(letter.body_text);
                        setPreview(null);
                        setConfirming(false);
                      }}
                    >
                      Edit
                    </button>
                  </>
                ) : (
                  <>
                    Sent {relativeTime(letter.sent_at)} to {letter.recipient_count} · {letter.delivery.sent || 0} delivered ·{" "}
                    {letter.delivery.skipped || 0} skipped · {letter.delivery.failed || 0} failed ·{" "}
                    {(letter.delivery.queued || 0) + (letter.delivery.sending || 0)} waiting
                  </>
                )}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
