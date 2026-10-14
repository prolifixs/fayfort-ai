import { supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { SetPasswordForm } from "../auth/SetPasswordForm";
import { RequestSourceSummary, type WorkerRequestRow, requestNextStages } from "../requests/requestShared";

export function PlatformRequestAssignmentPage({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<{
    requests: {
      id: string;
      request_title: string;
      product_name_snapshot: string | null;
      created_at: string;
      assigned_worker_id: string | null;
    }[];
    active_workers: { user_id: string; email: string | null }[];
  }>({ requests: [], active_workers: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await apiRequest<typeof data>("/platform/requests", accessToken));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request queue could not be loaded.");
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  async function assign(requestId: string, workerId: string) {
    setBusy(requestId);
    setError("");
    try {
      await apiRequest(`/platform/requests/${requestId}/assignment`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ worker_id: workerId || null }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment could not be saved.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="Member request assignment">
      <div className="panel-heading">
        <div>
          <h2>Assign member requests</h2>
          <p>Only platform administrators can assign requests. Workers see only requests assigned to them.</p>
        </div>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data.requests.length === 0 ? (
        <p>No member requests have been submitted.</p>
      ) : (
        data.requests.map((row) => (
          <article className="member-request-card" key={row.id}>
            <h3>{row.request_title}</h3>
            {row.product_name_snapshot && <small>{row.product_name_snapshot}</small>}
            <div className="record-actions">
              <label>
                Assigned worker
                <select
                  aria-label={`Assign ${row.request_title}`}
                  value={row.assigned_worker_id || ""}
                  disabled={busy === row.id}
                  onChange={(event) => void assign(row.id, event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {data.active_workers.map((worker) => (
                    <option key={worker.user_id} value={worker.user_id}>
                      {worker.email || worker.user_id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

export function WorkerRequestsPage({ accessToken }: { accessToken: string }) {
  const [requests, setRequests] = useState<WorkerRequestRow[]>([]);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [shipment, setShipment] = useState<Record<string, { carrier: string; number: string; url: string }>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ requests: WorkerRequestRow[] }>("/workers/requests", accessToken);
      setRequests(result.requests || []);
      setStages((previous) =>
        Object.fromEntries(
          (result.requests || []).map((row) => {
            const next = requestNextStages[row.events.at(-1)?.stage || "submitted"] || [];
            const selected = previous[row.id];
            return [row.id, next.includes(selected) ? selected : next[0] || ""];
          }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assigned requests could not be loaded.");
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  async function update(row: WorkerRequestRow) {
    setBusy(row.id);
    setError("");
    try {
      const stage = stages[row.id];
      const shipping = shipment[row.id] || { carrier: "", number: "", url: "" };
      await apiRequest(`/workers/requests/${row.id}/events`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          stage,
          member_note: notes[row.id] || null,
          ...(stage === "shipped"
            ? {
                carrier_name: shipping.carrier || null,
                tracking_number: shipping.number,
                tracking_url: shipping.url || null,
              }
            : {}),
        }),
      });
      setNotes((previous) => ({ ...previous, [row.id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Milestone could not be saved.");
    } finally {
      setBusy("");
    }
  }
  async function uploadEvidence(row: WorkerRequestRow) {
    const file = files[row.id];
    if (!file) return;
    setBusy(row.id);
    setError("");
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("Evidence files must be 100 MiB or smaller.");
      const path = `/workers/requests/${row.id}/evidence?filename=${encodeURIComponent(file.name)}`;
      await apiRequest(path, accessToken, { method: "POST", body: file, headers: { "Content-Type": file.type } });
      setFiles((previous) => ({ ...previous, [row.id]: null }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evidence upload failed.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="Assigned member requests">
      <div className="panel-heading">
        <div>
          <h2>Assigned member requests</h2>
          <p>Record factual, member-visible milestones. Purchase confirmation means payment is complete.</p>
        </div>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {requests.length === 0 ? (
        <p>No requests are assigned to your worker account.</p>
      ) : (
        requests.map((row) => {
          const current = row.events.at(-1)?.stage || "submitted";
          const next = requestNextStages[current] || [];
          const shipping = shipment[row.id] || { carrier: "", number: "", url: "" };
          return (
            <article className="member-request-card" key={row.id}>
              <h3>{row.request_title}</h3>
              <RequestSourceSummary
                sourceType={row.source_type}
                sourceUrl={row.source_url}
                sourceMedia={row.source_media}
                productName={row.product_name_snapshot}
              />
              {row.request_description && <p>{row.request_description}</p>}
              <ol>
                {row.events.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {event.stage === "purchase_confirmed"
                        ? "Purchase confirmed · paid"
                        : event.stage.replaceAll("_", " ")}
                    </strong>
                    {event.member_note && <p>{event.member_note}</p>}
                    {event.stage === "shipped" && event.details?.tracking_number && (
                      <p>
                        Tracking number: {event.details.tracking_number}
                        {event.details.carrier_name ? ` · ${event.details.carrier_name}` : ""}
                      </p>
                    )}
                    {event.media?.map((media) => (
                      <div className="request-evidence" key={media.id}>
                        {media.content_type.startsWith("video/") ? (
                          <video src={media.url} controls preload="metadata" aria-label={media.original_filename} />
                        ) : (
                          <img src={media.url} alt={media.original_filename} />
                        )}
                        <small>{media.original_filename}</small>
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
              {current === "item_in_warehouse" && (
                <div className="record-actions">
                  <label>
                    Warehouse photo/video
                    <input
                      aria-label={`Warehouse evidence for ${row.request_title}`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                      onChange={(event) =>
                        setFiles((previous) => ({ ...previous, [row.id]: event.target.files?.[0] || null }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy === row.id || !files[row.id]}
                    onClick={() => void uploadEvidence(row)}
                  >
                    {busy === row.id ? "Uploading…" : "Upload evidence"}
                  </button>
                </div>
              )}
              {next.length > 0 && (
                <div className="record-actions">
                  <select
                    aria-label={`Next milestone for ${row.request_title}`}
                    value={stages[row.id] || next[0]}
                    onChange={(event) => setStages((previous) => ({ ...previous, [row.id]: event.target.value }))}
                  >
                    {next.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage === "purchase_confirmed" ? "purchase confirmed · paid" : stage.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                  {stages[row.id] === "shipped" && (
                    <>
                      <input
                        aria-label={`Carrier for ${row.request_title}`}
                        maxLength={100}
                        placeholder="Carrier (optional)"
                        value={shipping.carrier}
                        onChange={(event) =>
                          setShipment((previous) => ({
                            ...previous,
                            [row.id]: { ...shipping, carrier: event.target.value },
                          }))
                        }
                      />
                      <input
                        aria-label={`Tracking number for ${row.request_title}`}
                        required
                        maxLength={120}
                        placeholder="Tracking number (required)"
                        value={shipping.number}
                        onChange={(event) =>
                          setShipment((previous) => ({
                            ...previous,
                            [row.id]: { ...shipping, number: event.target.value },
                          }))
                        }
                      />
                      <input
                        aria-label={`Tracking URL for ${row.request_title}`}
                        type="url"
                        placeholder="HTTPS tracking link (optional)"
                        value={shipping.url}
                        onChange={(event) =>
                          setShipment((previous) => ({
                            ...previous,
                            [row.id]: { ...shipping, url: event.target.value },
                          }))
                        }
                      />
                    </>
                  )}
                  <input
                    aria-label={`Member update for ${row.request_title}`}
                    maxLength={1000}
                    placeholder="Member-visible update"
                    value={notes[row.id] || ""}
                    onChange={(event) => setNotes((previous) => ({ ...previous, [row.id]: event.target.value }))}
                  />
                  <button
                    className="primary-button"
                    disabled={busy === row.id || (stages[row.id] === "shipped" && !shipping.number.trim())}
                    onClick={() => void update(row)}
                  >
                    {busy === row.id ? "Saving…" : "Add milestone"}
                  </button>
                </div>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}

/** Sets a new password for the signed-in worker (kept for the recovery flow and its tests). */
export function WorkerPasswordResetPage() {
  const [message, setMessage] = useState("");
  return (
    <div className="auth-page">
      <section className="auth-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT WORKER ACCOUNT</label>
        <h1>Set your password</h1>
        <p>Choose a password for your FayFort worker account.</p>
        <SetPasswordForm
          onDone={() => setMessage("Your password has been updated. You can now sign in to your FayFort worker account.")}
        />
        {message && <p role="status">{message}</p>}
        <a href="/">Return to FayFort Control Center</a>
      </section>
    </div>
  );
}

export function WorkerInvitationAcceptancePage({ accessToken }: { accessToken: string }) {
  const [worker, setWorker] = useState<{ status: string; created_at?: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    setError("");
    apiRequest<{ worker: { status: string; created_at?: string } }>("/workers/me", accessToken)
      .then((result) => {
        if (mounted) {
          setWorker(result.worker);
          setError("");
        }
      })
      .catch((reason) => {
        if (mounted) setError(reason instanceof Error ? reason.message : "Worker account could not be checked.");
      });
    return () => {
      mounted = false;
    };
  }, [accessToken, attempt]);
  const title =
    worker?.status === "active"
      ? "Invitation accepted"
      : worker?.status === "invited"
        ? "Email verified"
        : worker?.status === "inactive"
          ? "Worker account inactive"
          : error
            ? "Unable to confirm worker account"
            : "Checking your invitation";
  return (
    <div className="auth-page">
      <section className="auth-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT WORKER ACCOUNT</label>
        <h1>{title}</h1>
        {worker?.status === "active" ? (
          <p role="status">
            Your FayFort worker account is verified and active. Worker tools will be available when they are assigned.
          </p>
        ) : worker?.status === "invited" ? (
          <p role="status">Your email is verified. Your worker account is waiting for activation by FayFort.</p>
        ) : worker?.status === "inactive" ? (
          <p role="status">Your FayFort worker account is inactive. Contact a platform administrator for help.</p>
        ) : error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Retry
            </button>
          </>
        ) : (
          <p>Confirming your verified worker account.</p>
        )}
        <a href="/">Return to FayFort Control Center</a>
      </section>
    </div>
  );
}

export function WorkerProvisioningPage({ accessToken }: { accessToken: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await apiRequest<{ worker: { email: string; status: string } }>(
        "/platform/workers",
        accessToken,
        { method: "POST", body: JSON.stringify({ email }) },
      );
      setResult(`Invitation sent to ${response.worker.email}. Worker status: ${response.worker.status}.`);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Worker invitation could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel" aria-label="FayFort worker provisioning">
      <div className="panel-heading">
        <div>
          <h2>Provision FayFort worker</h2>
          <p>
            Only a platform administrator can invite a worker. The invitation creates a separate worker identity and
            does not grant business membership.
          </p>
        </div>
      </div>
      <form className="inline-form" onSubmit={invite}>
        <label htmlFor="worker-email">
          Worker email
          <input
            id="worker-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? "Sending invitation…" : "Invite worker"}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && <p role="status">{result}</p>}
    </section>
  );
}
