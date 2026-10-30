import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import "./hr.css";

/* HR H7 (docs/HR_AND_HIRING_PLAN.md sections 3.8 and 3.9): reviews and finishing employment. */

export type Review = {
  id: string; worker_id: string; kind: "probation" | "regular"; due_on: string; status: "open" | "completed" | "cancelled";
  self_review: string | null; self_submitted_at: string | null; scores: Record<string, number>; manager_note: string | null;
  decision: "pass" | "extend" | "end" | null; completed_at: string | null; name?: string; context?: ReviewContext;
};
export type ReviewContext = { rating: number | null; rating_count: number; hours: number; shifts: number; finished_work: number; leave_days: number };
export type Offboarding = {
  worker_id: string; last_day: string; reason_kind: string; reason_label: string; reason: string | null; exit_note: string | null;
  open_work: number; future_bookings: number; deactivated_at: string | null; steps_list: { key: string; label: string; done: boolean }[];
};

const SCORES: [string, string, string][] = [["speed", "Speed", "Answers and finishes work on time"], ["care", "Care", "Treats members and the team well"], ["accuracy", "Accuracy", "Gets details right the first time"]];
const DECISION: Record<string, string> = { pass: "Passed probation", extend: "Probation extended", end: "Probation not passed" };
const REASONS: [string, string][] = [["resigned", "Resigned"], ["contract_ended", "Contract ended"], ["probation_ended", "Probation not passed"], ["dismissed", "Dismissed"], ["other", "Other"]];
const msg = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);
const longDate = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
export const reviewTitle = (r: Pick<Review, "kind" | "due_on">) => `${r.kind === "probation" ? "Probation review" : "Review"} · due ${longDate(r.due_on)}`;

export function ContextFacts({ context }: { context: ReviewContext }) {
  return (
    <dl className="hr-facts review-context" aria-label="Last 90 days">
      <div><dt>Customer rating</dt><dd>{context.rating ? `${context.rating} ★ (${context.rating_count})` : "Not enough ratings"}</dd></div>
      <div><dt>Hours worked</dt><dd>{context.hours} h in {context.shifts} shifts</dd></div>
      <div><dt>Work finished</dt><dd>{context.finished_work}</dd></div>
      <div><dt>Leave taken</dt><dd>{context.leave_days} days</dd></div>
    </dl>
  );
}

export function CompletedReview({ review }: { review: Review }) {
  return (
    <div className="review-done">
      <p><strong>{reviewTitle(review)}</strong> · finished {longDate(review.completed_at)}{review.decision ? ` · ${DECISION[review.decision]}` : ""}</p>
      <p className="review-scores">{SCORES.map(([key, label]) => <span key={key}>{label} <b>{review.scores[key] ?? "–"}/4</b></span>)}</p>
      {review.manager_note && <p className="review-note">{review.manager_note}</p>}
      {review.self_review && <details><summary>Self-review</summary><p className="review-note">{review.self_review}</p></details>}
    </div>
  );
}

/** The manager's (or HR's) part: three scores, a note and, for probation, the decision. */
export function ReviewForm({ review, context, name, accessToken, onDone }: { review: Review; context?: ReviewContext | null; name: string; accessToken: string; onDone: (result: Review & { next?: string }) => void }) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState("");
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ review: Review & { next?: string } }>(`/hr/reviews/${review.id}/complete`, accessToken, { method: "POST", body: JSON.stringify({
        scores, note, decision: review.kind === "probation" ? decision || null : null, extend_months: decision === "extend" ? months : null }) });
      onDone(result.review);
    } catch (reason) {
      setError(msg(reason, "The review couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }
  const ready = SCORES.every(([key]) => scores[key]) && note.trim() && (review.kind !== "probation" || decision);
  return (
    <form className="review-form" aria-label={`${reviewTitle(review)} for ${name}`} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h4>{name}: {reviewTitle(review)}</h4>
      {context && <ContextFacts context={context} />}
      {review.self_review ? <blockquote className="review-note">{review.self_review}</blockquote> : <p className="muted">{name.split(" ")[0]} hasn't written a self-review yet.</p>}
      {SCORES.map(([key, label, hint]) => (
        <div key={key} className="hr-rating" role="radiogroup" aria-label={label}>
          <span>{label}<small className="muted"> · {hint}</small></span>
          <div className="hr-segment">{[1, 2, 3, 4].map((n) => (
            <label key={n} className={scores[key] === n ? "is-active" : ""}><input type="radio" name={`${review.id}-${key}`} aria-label={`${label}: ${n}`} checked={scores[key] === n} onChange={() => setScores({ ...scores, [key]: n })} />{n}</label>
          ))}</div>
        </div>
      ))}
      <label>Note for {name.split(" ")[0]} (they'll read it)<textarea rows={3} maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {review.kind === "probation" && (
        <div className="hr-rating" role="radiogroup" aria-label="Probation decision">
          <span>Decision</span>
          <div className="hr-segment">{[["pass", "Pass"], ["extend", "Extend"], ["end", "End"]].map(([key, label]) => (
            <label key={key} className={decision === key ? "is-active" : ""}><input type="radio" name={`${review.id}-decision`} checked={decision === key} onChange={() => setDecision(key)} />{label}</label>
          ))}</div>
        </div>
      )}
      {decision === "extend" && <label>Extend by<select value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[1, 2, 3].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}</select></label>}
      {decision === "end" && <p className="hr-flag is-due">After saving, start “Finish employment” on their record to set the last day.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy || !ready}>{busy ? "Saving…" : "Finish the review"}</button>
    </form>
  );
}

/** My HR: reviews of the team this person manages (HR also does these in People → Records). */
export function ReviewsToDo({ accessToken }: { accessToken: string }) {
  const [list, setList] = useState<Review[] | null>(null);
  const load = useCallback(() => {
    apiRequest<{ reviews: Review[] }>("/hr/reviews/to-do", accessToken).then((r) => setList(r.reviews)).catch(() => setList([]));
  }, [accessToken]);
  useEffect(load, [load]);
  if (!list || list.length === 0) return null;
  return (
    <section className="my-hr-card"><h3>Reviews to do</h3>
      {list.map((r) => <ReviewForm key={r.id} review={r} context={r.context} name={r.name || "Team member"} accessToken={accessToken} onDone={load} />)}
    </section>
  );
}

/** My HR: my own reviews: write a self-review while open, read the result when finished. */
export function MyReviews({ reviews, accessToken, onChanged }: { reviews: Review[]; accessToken: string; onChanged: (r: Review) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  if (reviews.length === 0) return null;
  return (
    <section className="my-hr-card"><h3>My reviews</h3>
      {reviews.map((r) => r.status === "completed" ? <CompletedReview key={r.id} review={r} /> : (
        <form key={r.id} className="review-form" aria-label={reviewTitle(r)} onSubmit={async (e) => {
          e.preventDefault();
          try { onChanged((await apiRequest<{ review: Review }>(`/hr/my/reviews/${r.id}/self`, accessToken, { method: "POST", body: JSON.stringify({ text: drafts[r.id] ?? r.self_review ?? "" }) })).review); }
          catch (reason) { setError(msg(reason, "Your self-review couldn't be saved.")); }
        }}>
          <h4>{reviewTitle(r)}</h4>
          <label>How is it going? What went well, and what would help you?<textarea rows={4} maxLength={3000} value={drafts[r.id] ?? r.self_review ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} /></label>
          {r.self_submitted_at && <p className="muted">Saved {longDate(r.self_submitted_at)}. You can change it until the review is finished.</p>}
          <button type="submit" className="secondary-button">Save my self-review</button>
        </form>
      ))}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

/** People → Records → a person: finishing employment. */
export function FinishEmployment({ workerId, name, offboarding, accessToken, onPerson, isActive }: {
  workerId: string; name: string; offboarding: Offboarding | null; accessToken: string; isActive: boolean; onPerson: (person: unknown) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [form, setForm] = useState({ last_day: "", reason_kind: "resigned", reason: "" });
  const [note, setNote] = useState(offboarding?.exit_note || "");
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setNote(offboarding?.exit_note || ""), [offboarding?.exit_note]);
  async function call(path: string, method: string, body?: object) {
    setBusy(true);
    setError("");
    try {
      onPerson((await apiRequest<{ person: unknown }>(path, accessToken, { method, body: body ? JSON.stringify(body) : undefined })).person);
      setStarting(false);
      setConfirmStop(false);
    } catch (reason) {
      setError(msg(reason, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }
  const base = `/hr/people/${workerId}/offboarding`;
  if (!offboarding && !isActive) return null;
  return (
    <section className="hr-offboarding"><h3>Finish employment</h3>
      {offboarding ? offboarding.deactivated_at ? (
        <p className="muted">{name} left on {longDate(offboarding.last_day)} ({offboarding.reason_label.toLowerCase()}). Their account is closed and this record is kept as it was.</p>
      ) : (
        <>
          <p><strong>Last day {longDate(offboarding.last_day)}</strong> · {offboarding.reason_label}{offboarding.reason ? ` · ${offboarding.reason}` : ""}</p>
          <p className="muted">Their account is closed automatically after the last day, and their open work goes back to the desks.</p>
          <ul className="offboarding-steps">
            <li>
              <span>{offboarding.open_work ? `${offboarding.open_work} piece${offboarding.open_work > 1 ? "s" : ""} of open work` : "No open work"}</span>
              <button type="button" className="secondary-button" disabled={busy || !offboarding.open_work} onClick={() => void call(`${base}/release`, "POST")}>Hand back to the desks</button>
            </li>
            <li>
              <span>{offboarding.future_bookings ? `${offboarding.future_bookings} future booking${offboarding.future_bookings > 1 ? "s" : ""}: move or cancel them in Bookings` : "No future bookings"}</span>
              <a className="secondary-button" href="/operations?view=bookings">Open Bookings</a>
            </li>
            {offboarding.steps_list.map((step) => (
              <li key={step.key}><label className="hr-check"><input type="checkbox" checked={step.done} disabled={busy} onChange={(e) => void call(base, "PUT", { steps: { [step.key]: e.target.checked } })} />{step.label}</label></li>
            ))}
          </ul>
          <label className="hr-record-form">Exit note (for HR only)<textarea rows={3} maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="hr-links">
            <button type="button" className="secondary-button" disabled={busy || note === (offboarding.exit_note || "")} onClick={() => void call(base, "PUT", { exit_note: note })}>Save note</button>
            {confirmStop ? (
              <>
                <span className="muted">Keep {name.split(" ")[0]} on the team?</span>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void call(base, "DELETE")}>Yes, stop</button>
                <button type="button" className="secondary-button" onClick={() => setConfirmStop(false)}>No</button>
              </>
            ) : <button type="button" className="text-link-button" onClick={() => setConfirmStop(true)}>Stop finishing employment</button>}
          </div>
        </>
      ) : starting ? (
        <form className="hr-record-form" aria-label="Finish employment" onSubmit={(e) => { e.preventDefault(); void call(base, "POST", { ...form, reason: form.reason || null }); }}>
          <div className="hr-grid">
            <label>Last day<input type="date" required value={form.last_day} onChange={(e) => setForm({ ...form, last_day: e.target.value })} /></label>
            <label>Reason<select value={form.reason_kind} onChange={(e) => setForm({ ...form, reason_kind: e.target.value })}>{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <label>Details (HR only)<input maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <div className="hr-links">
            <button type="button" className="secondary-button" onClick={() => setStarting(false)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy || !form.last_day}>Start finishing employment</button>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary-button danger" onClick={() => setStarting(true)}>Finish employment…</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
