import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { WorkerProvisioningPage } from "./WorkerPages";

export interface WorkerSummary {
  user_id: string;
  email: string | null;
  display_name: string | null;
  status: "active" | "invited" | "inactive";
  online: boolean;
  last_seen_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  handoff_availability: string;
  mfa_enrolled: boolean;
  email_confirmed: boolean;
  open_work_count: number;
  invitation: { sent_at: string | null; expires_at: string | null; expired: boolean; count: number } | null;
}

interface WorkerProfile extends WorkerSummary {
  departments: string[];
  current_work: { id: string; summary: string; department: string; status: string; priority: string; updated_at: string }[];
  recent_activity: { work_item_id: string; event_type: string; next_status: string | null; reason: string | null; created_at: string }[];
  audit?: { action: string; actor_id: string | null; detail: Record<string, unknown>; created_at: string }[];
  auth_events?: { event_action: string; ip_address: string | null; created_at: string }[];
  banned?: boolean;
}

interface Directory {
  workers: WorkerSummary[];
  summary: { total: number; active: number; online: number; invited: number; inactive: number; without_mfa: number };
  online_window_seconds: number;
  generated_at: string;
}

export const DIRECTORY_REFRESH_MS = 30_000;

/** "just now", "4 min ago", "3 h ago", "2 days ago"; exact time is shown on hover. */
export function relativeTime(value: string | null, now = Date.now()): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "Unknown";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function departmentLabel(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function exact(value: string | null): string | undefined {
  return value ? new Date(value).toLocaleString() : undefined;
}

function TimeAgo({ value }: { value: string | null }) {
  return (
    <time dateTime={value || undefined} title={exact(value)}>
      {relativeTime(value)}
    </time>
  );
}

const STATUS_LABEL: Record<string, string> = { active: "Active", invited: "Invited", inactive: "Inactive" };
const ACTION_LABEL: Record<string, string> = {
  invited: "Invited",
  invitation_resent: "Invitation resent",
  invitation_revoked: "Invitation revoked",
  activated: "Activated",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
  password_reset_sent: "Password reset sent",
  mfa_reset: "Two-step verification reset",
  assignments_released: "Assignments released",
};

function PresenceDot({ worker }: { worker: Pick<WorkerSummary, "online" | "status"> }) {
  const label = worker.status !== "active" ? STATUS_LABEL[worker.status] : worker.online ? "Online" : "Offline";
  return (
    <span className={`presence-dot ${worker.online ? "online" : "offline"}`} role="img" aria-label={label} title={label} />
  );
}

/** Control Center → FayFort Workers: invite form, live directory and per-worker profile. */
export function WorkforcePage({ accessToken }: { accessToken: string }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "invited" | "inactive">("all");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("worker"));
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<Directory>("/platform/workers", accessToken);
      setDirectory(result);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The worker directory could not be loaded.");
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, DIRECTORY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  function open(workerId: string | null) {
    setSelected(workerId);
    const url = new URL(window.location.href);
    if (workerId) url.searchParams.set("worker", workerId);
    else url.searchParams.delete("worker");
    window.history.replaceState({}, "", url.toString());
  }

  const workers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (directory?.workers || []).filter(
      (worker) =>
        (statusFilter === "all" || worker.status === statusFilter) &&
        (!onlineOnly || worker.online) &&
        (!needle || `${worker.display_name || ""} ${worker.email || ""}`.toLowerCase().includes(needle)),
    );
  }, [directory, query, statusFilter, onlineOnly]);

  if (selected)
    return (
      <WorkerProfilePage
        accessToken={accessToken}
        workerId={selected}
        onBack={() => {
          open(null);
          setRefreshKey((value) => value + 1);
        }}
      />
    );

  return (
    <div className="workforce-page">
      <WorkerProvisioningPage accessToken={accessToken} />
      <section className="control-panel" aria-label="FayFort worker directory">
        <div className="panel-heading">
          <div>
            <h2>Workers</h2>
            <p>
              Online means the worker had the Control Center or Operations Center open in the last{" "}
              {directory?.online_window_seconds ?? 90} seconds. The list refreshes every 30 seconds.
            </p>
          </div>
        </div>
        {directory && (
          <dl className="workforce-summary">
            <div>
              <dt>Online now</dt>
              <dd>{directory.summary.online}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{directory.summary.active}</dd>
            </div>
            <div>
              <dt>Invited</dt>
              <dd>{directory.summary.invited}</dd>
            </div>
            <div>
              <dt>Inactive</dt>
              <dd>{directory.summary.inactive}</dd>
            </div>
            <div className={directory.summary.without_mfa ? "warn" : ""}>
              <dt>Active without two-step</dt>
              <dd>{directory.summary.without_mfa}</dd>
            </div>
          </dl>
        )}
        <div className="workforce-filters">
          <label>
            Search
            <input
              type="search"
              placeholder="Name or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="workforce-online-filter">
            <input type="checkbox" checked={onlineOnly} onChange={(event) => setOnlineOnly(event.target.checked)} />{" "}
            Online only
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
        {!directory && !error && <p role="status">Loading workers…</p>}
        {directory && workers.length === 0 && (
          <p className="empty-copy">{directory.workers.length ? "No workers match these filters." : "No workers yet."}</p>
        )}
        {workers.length > 0 && (
          <table className="workforce-table">
            <thead>
              <tr>
                <th scope="col">Worker</th>
                <th scope="col">Status</th>
                <th scope="col">Last seen</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Open work</th>
                <th scope="col">Two-step</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.user_id}>
                  <td>
                    <button type="button" className="workforce-name" onClick={() => open(worker.user_id)}>
                      <PresenceDot worker={worker} />
                      <span>
                        <strong>{worker.display_name || worker.email || "Unnamed worker"}</strong>
                        {worker.display_name && <small>{worker.email}</small>}
                      </span>
                    </button>
                  </td>
                  <td data-label="Status">
                    <span className={`status-chip ${worker.status}`}>{STATUS_LABEL[worker.status] || worker.status}</span>
                    {worker.invitation && (
                      <small className={worker.invitation.expired ? "invite-expired" : ""}>
                        {worker.invitation.expired ? "Link expired" : "Link sent"} <TimeAgo value={worker.invitation.sent_at} />
                      </small>
                    )}
                  </td>
                  <td data-label="Last seen">{worker.online ? <strong className="online-text">Online now</strong> : <TimeAgo value={worker.last_seen_at} />}</td>
                  <td data-label="Last sign-in">
                    <TimeAgo value={worker.last_sign_in_at} />
                  </td>
                  <td data-label="Open work">{worker.open_work_count}</td>
                  <td data-label="Two-step">{worker.mfa_enrolled ? "On" : <span className="mfa-off">Not set up</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

type PendingAction = "deactivate" | "reactivate" | "resend" | "revoke" | "password" | "mfa";

/** One worker in detail, with audited admin actions. */
export function WorkerProfilePage({
  accessToken,
  workerId,
  onBack,
}: {
  accessToken: string;
  workerId: string;
  onBack: () => void;
}) {
  const [worker, setWorker] = useState<WorkerProfile | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ worker: WorkerProfile }>(`/platform/workers/${workerId}`, accessToken);
      setWorker(result.worker);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The worker profile could not be loaded.");
    }
  }, [accessToken, workerId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, DIRECTORY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError("");
    setNotice("");
    const base = `/platform/workers/${workerId}`;
    try {
      if (pending === "deactivate") {
        const result = await apiRequest<{ released: { handoffs?: number; work_items?: number; member_requests?: number } }>(
          `${base}/deactivate`,
          accessToken,
          { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
        );
        const released = result.released || {};
        const total = (released.handoffs || 0) + (released.work_items || 0) + (released.member_requests || 0);
        setNotice(
          `Deactivated. They were signed out and ${total} assignment${total === 1 ? "" : "s"} went back to the queue.`,
        );
      } else if (pending === "reactivate") {
        await apiRequest(`${base}/reactivate`, accessToken, { method: "POST" });
        setNotice("Reactivated. They can sign in again.");
      } else if (pending === "resend") {
        await apiRequest(`${base}/resend-invitation`, accessToken, { method: "POST" });
        setNotice("A new invitation email is on its way.");
      } else if (pending === "revoke") {
        await apiRequest(`${base}/invitation`, accessToken, { method: "DELETE" });
        setPending(null);
        onBack();
        return;
      } else if (pending === "password") {
        await apiRequest(`${base}/password-reset`, accessToken, { method: "POST" });
        setNotice("Password reset email sent.");
      } else if (pending === "mfa") {
        await apiRequest(`${base}/mfa-reset`, accessToken, { method: "POST" });
        setNotice("Two-step verification was reset. They'll set it up again at their next sign-in.");
      }
      setPending(null);
      setReason("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const confirmText: Record<PendingAction, string> = {
    deactivate: "Deactivate this worker? They are signed out everywhere and their open work returns to the queue.",
    reactivate: "Reactivate this worker so they can sign in again?",
    resend: "Send a new invitation email? Earlier links stop working.",
    revoke: "Revoke this invitation? The unused account is deleted.",
    password: "Email this worker a password reset link?",
    mfa: "Reset two-step verification? They'll have to set up their authenticator app again.",
  };

  return (
    <section className="control-panel worker-profile" aria-label="Worker profile">
      <button type="button" className="text-button" onClick={onBack}>
        ← All workers
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!worker && !error && <p role="status">Loading worker…</p>}
      {worker && (
        <>
          <header className="worker-profile-header">
            <PresenceDot worker={worker} />
            <div>
              <h2>{worker.display_name || worker.email || "Unnamed worker"}</h2>
              <p>
                {worker.email} · <span className={`status-chip ${worker.status}`}>{STATUS_LABEL[worker.status]}</span>{" "}
                {worker.status === "active" &&
                  (worker.online ? <strong className="online-text">Online now</strong> : <>Last seen <TimeAgo value={worker.last_seen_at} /></>)}
              </p>
            </div>
          </header>

          <dl className="worker-facts">
            <div>
              <dt>Invited</dt>
              <dd title={exact(worker.invited_at)}>{worker.invited_at ? new Date(worker.invited_at).toLocaleDateString() : "—"}</dd>
            </div>
            <div>
              <dt>Activated</dt>
              <dd title={exact(worker.activated_at)}>
                {worker.activated_at ? new Date(worker.activated_at).toLocaleDateString() : "—"}
              </dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>
                <TimeAgo value={worker.last_sign_in_at} />
              </dd>
            </div>
            <div>
              <dt>Two-step verification</dt>
              <dd>{worker.mfa_enrolled ? "On" : "Not set up"}</dd>
            </div>
            <div>
              <dt>Handoff availability</dt>
              <dd>{worker.handoff_availability.charAt(0).toUpperCase() + worker.handoff_availability.slice(1)}</dd>
            </div>
            <div>
              <dt>Departments</dt>
              <dd>{worker.departments.length ? worker.departments.map(departmentLabel).join(", ") : "None"}</dd>
            </div>
            {worker.deactivated_at && (
              <div>
                <dt>Deactivated</dt>
                <dd title={exact(worker.deactivated_at)}>{new Date(worker.deactivated_at).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>

          <div className="worker-actions" aria-label="Account actions">
            {worker.status === "invited" && (
              <>
                <button type="button" className="secondary-button" onClick={() => setPending("resend")}>
                  Resend invitation
                </button>
                <button type="button" className="secondary-button danger" onClick={() => setPending("revoke")}>
                  Revoke invitation
                </button>
              </>
            )}
            {worker.status === "active" && (
              <>
                <button type="button" className="secondary-button" onClick={() => setPending("password")}>
                  Send password reset
                </button>
                <button type="button" className="secondary-button" onClick={() => setPending("mfa")}>
                  Reset two-step verification
                </button>
              </>
            )}
            {worker.status !== "inactive" ? (
              <button type="button" className="secondary-button danger" onClick={() => setPending("deactivate")}>
                Deactivate
              </button>
            ) : (
              <button type="button" className="secondary-button" onClick={() => setPending("reactivate")}>
                Reactivate
              </button>
            )}
          </div>

          {pending && (
            <form className="worker-confirm" onSubmit={run} aria-label="Confirm account action">
              <p>{confirmText[pending]}</p>
              {pending === "deactivate" && (
                <>
                  <label htmlFor="deactivate-reason">Reason (kept in the audit log)</label>
                  <input
                    id="deactivate-reason"
                    required
                    minLength={3}
                    maxLength={300}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </>
              )}
              <div>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Working…" : "Confirm"}
                </button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <section aria-label="Current work">
            <h3>Current work ({worker.current_work.length})</h3>
            {worker.current_work.length === 0 ? (
              <p className="empty-copy">Nothing assigned right now.</p>
            ) : (
              <ul className="worker-list">
                {worker.current_work.map((item) => (
                  <li key={item.id}>
                    <strong>{item.summary}</strong>
                    <small>
                      {departmentLabel(item.department)} · {item.status} · updated <TimeAgo value={item.updated_at} />
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Recent activity">
            <h3>Recent activity</h3>
            {worker.recent_activity.length === 0 ? (
              <p className="empty-copy">No recorded work activity yet.</p>
            ) : (
              <ul className="worker-list">
                {worker.recent_activity.map((event, index) => (
                  <li key={`${event.work_item_id}-${index}`}>
                    <strong>{event.event_type.replace(/_/g, " ")}</strong>
                    <small>
                      {event.next_status ? `→ ${event.next_status} · ` : ""}
                      <TimeAgo value={event.created_at} />
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {worker.auth_events && (
            <section aria-label="Sign-in history">
              <h3>Sign-in history</h3>
              {worker.auth_events.length === 0 ? (
                <p className="empty-copy">No sign-in events recorded.</p>
              ) : (
                <ul className="worker-list">
                  {worker.auth_events.map((event, index) => (
                    <li key={`${event.created_at}-${index}`}>
                      <strong>{event.event_action.replace(/_/g, " ")}</strong>
                      <small>
                        <TimeAgo value={event.created_at} />
                        {event.ip_address ? ` · ${event.ip_address}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {worker.audit && (
            <section aria-label="Account audit">
              <h3>Account audit</h3>
              {worker.audit.length === 0 ? (
                <p className="empty-copy">No admin actions recorded.</p>
              ) : (
                <ul className="worker-list">
                  {worker.audit.map((entry, index) => (
                    <li key={`${entry.created_at}-${index}`}>
                      <strong>{ACTION_LABEL[entry.action] || entry.action}</strong>
                      <small>
                        <TimeAgo value={entry.created_at} />
                        {typeof entry.detail?.reason === "string" ? ` · ${entry.detail.reason}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
