import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { API_BASE, apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";
import { ChartFrame, HBars, Heatmap, Stars, StatTile, TrendLine } from "../charts/Charts";

/** Worker photos, customer ratings (with the fresh start) and working hours, shared by Control Center → Workforce,
 * the worker's own Account page and the Operations header (docs/WORKFORCE_AND_REVENUE_PLAN.md). */

export type RatingSummary = {
  count: number;
  average: number | null;
  average_90_days: number | null;
  is_new: boolean;
  current: number;
  current_count: number;
  fresh_start: { every: number; completed_tasks: number; resets: number; last_reset_at: string | null; tasks_to_go: number | null };
  distribution: Record<string, number>;
  monthly: { month: string; average: number; count: number }[];
};
type RatingDetail = {
  summary: RatingSummary;
  ratings: { id: string; stars: number; comment: string | null; source: "chat" | "request"; created_at: string; about: string | null }[];
};
export type ShiftView = {
  id: string;
  worker_id: string;
  started_at: string;
  ended_at: string | null;
  on_break: boolean;
  on_break_since: string | null;
  break_seconds: number;
  worked_seconds: number;
  ended_by: "worker" | "auto" | "admin" | null;
  note: string | null;
  flag: "auto_ended" | "capped" | "edited" | null;
  correction_pending?: boolean;
};
type TimesheetWorker = {
  user_id: string;
  name?: string;
  first_name?: string;
  photo_url?: string | null;
  days: Record<string, number>;
  total_seconds: number;
  on_shift: boolean;
  on_break: boolean;
  shifts: ShiftView[];
};
type Correction = {
  id: string;
  shift_id: string;
  previous_started_at: string;
  previous_ended_at: string | null;
  proposed_started_at: string;
  proposed_ended_at: string;
  reason: string;
  created_at: string;
  worker: { name?: string; photo_url?: string | null };
};
type Timesheet = {
  start: string;
  days: string[];
  workers: TimesheetWorker[];
  on_shift_now: (ShiftView & { name?: string; photo_url?: string | null })[];
  corrections: Correction[];
  coverage: { weekday: number; hour: number; covered: number }[];
  support_hours: { days: string; start: string; end: string; time_zone: string };
};

const CHINA = "Asia/Shanghai";
export const hours = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};
const chinaTime = (value: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { timeZone: CHINA, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const chinaClock = (value: string | null) => (value ? new Date(value).toLocaleTimeString(undefined, { timeZone: CHINA, hour: "2-digit", minute: "2-digit" }) : "—");
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
/** A UTC instant as the value of a datetime-local input showing China time. */
export const toChinaInput = (value: string | null) => {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CHINA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
export const fromChinaInput = (value: string) => (value ? new Date(`${value}:00+08:00`).toISOString() : "");
const FLAG: Record<string, string> = { auto_ended: "Ended automatically", capped: "Stopped at 16 hours", edited: "Corrected" };

export function Avatar({ name, photo, size = 36, onShift }: { name?: string | null; photo?: string | null; size?: number; onShift?: boolean }) {
  const initials = (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
  return (
    <span className={`team-avatar${onShift ? " is-on-shift" : ""}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : initials}
    </span>
  );
}

export function RatingBadge({ rating }: { rating: RatingSummary | null | undefined }) {
  if (!rating) return <span className="muted">—</span>;
  return (
    <span className="team-rating-badge" title={`Current ${rating.current.toFixed(1)} · ${rating.count} rating${rating.count === 1 ? "" : "s"} in all`}>
      <Stars value={rating.current} />
      <b>{rating.current.toFixed(1)}</b>
      {rating.current_count === 0 && <small>fresh start</small>}
    </span>
  );
}

/** How the fresh start works, with the worker's progress to the next one. */
export function FreshStart({ summary, audience }: { summary: RatingSummary; audience: "admin" | "worker" }) {
  const fs = summary.fresh_start;
  if (!fs.every)
    return (
      <p className="team-fresh-start is-off">
        Fresh start is off: {audience === "worker" ? "your" : "the"} current rating counts every rating so far.
      </p>
    );
  const done = fs.every - (fs.tasks_to_go ?? fs.every);
  return (
    <div className="team-fresh-start" role="note" aria-label="How the fresh start works">
      <div>
        <strong>Fresh start every {fs.every} completed tasks</strong>
        <p>
          {audience === "worker" ? "Your" : "The"} current rating counts only the customer ratings since the last fresh start. After every {fs.every} tasks
          {audience === "worker" ? " you complete, it goes" : " completed, it goes"} back to a perfect 5.0, so a hard week never follows {audience === "worker" ? "you" : "anyone"} for
          long. Every rating is still kept in the history.
        </p>
      </div>
      <div className="team-fresh-progress">
        <span>
          <b>{fs.tasks_to_go}</b> task{fs.tasks_to_go === 1 ? "" : "s"} to the next fresh start
        </span>
        <span className="team-progress" aria-hidden="true">
          <i style={{ width: `${(done / fs.every) * 100}%` }} />
        </span>
        <small>
          {done} of {fs.every} done{fs.resets ? ` · ${fs.resets} fresh start${fs.resets === 1 ? "" : "s"} so far` : ""}
        </small>
      </div>
    </div>
  );
}

export function RatingsSection({ accessToken, workerId, audience }: { accessToken: string; workerId?: string; audience: "admin" | "worker" }) {
  const [data, setData] = useState<RatingDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<RatingDetail>(audience === "admin" ? `/platform/workers/${workerId}/ratings` : "/workers/me/ratings", accessToken)
      .then((result) => (result?.summary && Array.isArray(result.ratings) ? setData(result) : setError("Ratings aren't available yet.")))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Ratings could not be loaded."));
  }, [accessToken, workerId, audience]);
  if (error)
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  if (!data) return <FayfortLoader label="Loading ratings…" />;
  const s = data.summary;
  return (
    <div className="team-ratings">
      <div className="viz viz-stats">
        <div className="viz-stat team-current">
          <span>Current rating</span>
          <strong>{s.current.toFixed(1)}</strong>
          <Stars value={s.current} />
          <small>{s.current_count ? `from ${s.current_count} rating${s.current_count === 1 ? "" : "s"} since the last fresh start` : "Fresh start: no ratings since"}</small>
        </div>
        <StatTile label="All ratings" value={String(s.count)} sub={s.is_new ? "Averages show after 5 ratings" : undefined} />
        <StatTile label="All-time average" value={s.average === null ? "New" : s.average.toFixed(2)} sub={s.average_90_days === null ? undefined : `Last 90 days ${s.average_90_days.toFixed(2)}`} />
      </div>
      <FreshStart summary={s} audience={audience} />
      {s.count > 0 && (
        <div className="team-ratings-charts">
          <ChartFrame
            title="Average rating by month"
            subtitle="All ratings, China time"
            table={{ columns: ["Month", "Average", "Ratings"], rows: s.monthly.map((m) => [m.month, m.average.toFixed(2), m.count]) }}
          >
            <TrendLine label="Average rating" min={1} max={5} format={(v) => v.toFixed(1)} points={s.monthly.map((m) => ({ label: m.month.slice(2), value: m.average }))} />
          </ChartFrame>
          <ChartFrame
            title="Stars given"
            table={{ columns: ["Stars", "Ratings"], rows: ["5", "4", "3", "2", "1"].map((n) => [`${n} stars`, s.distribution[n] || 0]) }}
          >
            <HBars label="Stars given" format={(v) => String(v)} data={["5", "4", "3", "2", "1"].map((n) => ({ label: `${n} ★`, value: s.distribution[n] || 0 }))} />
          </ChartFrame>
        </div>
      )}
      <div className="team-comments">
        <h3>What customers said</h3>
        {data.ratings.filter((r) => r.comment).length === 0 ? (
          <p className="muted">No comments yet.</p>
        ) : (
          <ul>
            {data.ratings
              .filter((r) => r.comment)
              .slice(0, 30)
              .map((r) => (
                <li key={r.id}>
                  <Stars value={r.stars} />
                  <blockquote>{r.comment}</blockquote>
                  <small>
                    {r.source === "chat" ? "Chat" : "Order"}
                    {r.about ? `: ${r.about}` : ""} · {new Date(r.created_at).toLocaleDateString()}
                  </small>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Admin: how many completed tasks before ratings go back to 5.0. */
export function FreshStartSetting({ accessToken }: { accessToken: string }) {
  const [value, setValue] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    apiRequest<{ rating_reset_tasks: number }>("/platform/workforce/settings", accessToken)
      .then((result) => {
        setValue(result.rating_reset_tasks);
        setDraft(String(result.rating_reset_tasks));
      })
      .catch(() => setValue(null));
  }, [accessToken]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      const result = await apiRequest<{ rating_reset_tasks: number }>("/platform/workforce/settings", accessToken, {
        method: "PUT",
        body: JSON.stringify({ rating_reset_tasks: Number(draft) }),
      });
      setValue(result.rating_reset_tasks);
      setMessage(result.rating_reset_tasks ? `Saved. Ratings reset to 5.0 after every ${result.rating_reset_tasks} completed tasks.` : "Saved. Fresh start is off.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The setting could not be saved.");
    }
  }
  if (value === null) return null;
  return (
    <form className="team-setting" onSubmit={save} aria-label="Rating fresh start">
      <div>
        <strong>Rating fresh start</strong>
        <p>
          A worker's current rating goes back to a perfect 5.0 after this many completed tasks, to keep everyone encouraged. Workers see how it works
          and how many tasks they have to go. Set 0 to turn it off; the full history is always kept.
        </p>
      </div>
      <label>
        Completed tasks
        <input type="number" min={0} max={500} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <button className="secondary-button" disabled={draft === String(value) || draft === ""}>
        Save
      </button>
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
    </form>
  );
}

function weekStart(date: Date) {
  const china = new Date(date.toLocaleString("en-US", { timeZone: CHINA }));
  const offset = (china.getDay() + 6) % 7;
  china.setDate(china.getDate() - offset);
  return `${china.getFullYear()}-${String(china.getMonth() + 1).padStart(2, "0")}-${String(china.getDate()).padStart(2, "0")}`;
}
function shiftWeek(start: string, weeks: number) {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

/** Control Center → Workforce → Timesheets. */
export function TimesheetsPanel({ accessToken }: { accessToken: string }) {
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<Timesheet | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openWorker, setOpenWorker] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShiftView | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Timesheet>(`/platform/workforce/timesheets?start=${start}&days=7`, accessToken));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Timesheets could not be loaded.");
    }
  }, [accessToken, start]);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(correction: Correction, decision: "approve" | "reject") {
    try {
      await apiRequest(`/platform/workforce/corrections/${correction.id}`, accessToken, { method: "POST", body: JSON.stringify({ decision }) });
      setNotice(decision === "approve" ? "Correction approved." : "Correction declined.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That couldn't be saved.");
    }
  }
  async function exportCsv() {
    const response = await fetch(`${API_BASE}/platform/workforce/shifts.csv?start=${start}&days=7`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return setError("The export could not be made.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `fayfort-shifts-${start}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const days = data?.days || [];
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hoursList = data ? Array.from(new Set(data.coverage.map((c) => c.hour))).sort((a, b) => a - b) : [];
  const total = data?.workers.reduce((sum, w) => sum + w.total_seconds, 0) || 0;
  const flagged = data?.workers.reduce((sum, w) => sum + w.shifts.filter((s) => s.flag === "auto_ended" || s.flag === "capped").length, 0) || 0;
  return (
    <section className="control-panel team-timesheets" id="timesheets" aria-label="Timesheets">
      <div className="panel-heading">
        <div>
          <h2>Timesheets</h2>
          <p>
            Clock-ins and clock-outs from the Operations Center, by day in China time. A shift ends by itself 30 minutes after the worker's
            dashboard goes quiet, and those are flagged for you to check.
          </p>
        </div>
        <div className="team-week-nav">
          <button type="button" className="secondary-button" aria-label="Previous week" onClick={() => setStart((s) => shiftWeek(s, -1))}>
            ←
          </button>
          <strong>Week of {new Date(`${start}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</strong>
          <button type="button" className="secondary-button" aria-label="Next week" onClick={() => setStart((s) => shiftWeek(s, 1))}>
            →
          </button>
          <button type="button" className="secondary-button" onClick={() => void exportCsv()}>
            Export CSV
          </button>
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
      {!data ? (
        !error && <FayfortLoader label="Loading timesheets…" />
      ) : (
        <>
          <div className="viz viz-stats">
            <StatTile label="On shift now" value={String(data.on_shift_now.length)} sub={data.on_shift_now.map((s) => s.name?.split(" ")[0]).join(", ") || "Nobody"} />
            <StatTile label="Hours this week" value={hours(total)} sub={`${data.workers.filter((w) => w.total_seconds).length} worked`} />
            <StatTile label="To check" value={String(flagged + data.corrections.length)} sub={`${flagged} auto-ended · ${data.corrections.length} correction request${data.corrections.length === 1 ? "" : "s"}`} tone={flagged + data.corrections.length ? "bad" : undefined} />
          </div>
          {data.corrections.length > 0 && (
            <div className="team-corrections" aria-label="Correction requests">
              <h3>Correction requests</h3>
              <ul>
                {data.corrections.map((c) => (
                  <li key={c.id}>
                    <Avatar name={c.worker.name} photo={c.worker.photo_url} size={30} />
                    <div>
                      <strong>{c.worker.name}</strong>
                      <span>
                        {chinaTime(c.previous_started_at)}–{chinaClock(c.previous_ended_at)} → <b>{chinaTime(c.proposed_started_at)}–{chinaClock(c.proposed_ended_at)}</b>
                      </span>
                      <small>“{c.reason}”</small>
                    </div>
                    <button type="button" className="primary-button" onClick={() => void decide(c, "approve")}>
                      Approve
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void decide(c, "reject")}>
                      Decline
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="team-sheet-wrap">
            <table className="team-sheet">
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  {days.map((day) => (
                    <th scope="col" key={day}>
                      {dayLabel(day)}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.workers.map((w) => (
                  <Fragment key={w.user_id}>
                    <tr>
                      <th scope="row">
                        <button type="button" className="team-sheet-name" aria-expanded={openWorker === w.user_id} onClick={() => setOpenWorker((v) => (v === w.user_id ? null : w.user_id))}>
                          <Avatar name={w.name} photo={w.photo_url} size={28} onShift={w.on_shift} />
                          <span>
                            {w.name}
                            {w.on_shift && <small className="online-text">{w.on_break ? "On a break" : "On shift"}</small>}
                          </span>
                        </button>
                      </th>
                      {days.map((day) => (
                        <td key={day} className={w.days[day] ? "" : "is-zero"}>
                          {w.days[day] ? hours(w.days[day]) : "–"}
                        </td>
                      ))}
                      <td className="team-sheet-total">{hours(w.total_seconds)}</td>
                    </tr>
                    {openWorker === w.user_id && (
                      <tr className="team-sheet-detail">
                        <td colSpan={days.length + 2}>
                          {w.shifts.length === 0 ? (
                            <p className="muted">No shifts this week.</p>
                          ) : (
                            <ul className="team-shifts">
                              {w.shifts.map((s) => (
                                <li key={s.id} className={s.flag && s.flag !== "edited" ? "is-flagged" : ""}>
                                  <span>
                                    <b>{chinaTime(s.started_at)}</b> – {s.ended_at ? chinaClock(s.ended_at) : "now"}
                                  </span>
                                  <span>{hours(s.worked_seconds)} worked{s.break_seconds ? ` · ${hours(s.break_seconds)} break` : ""}</span>
                                  {s.flag && <span className="status-pill is-warn">{FLAG[s.flag]}</span>}
                                  {s.note && <small>“{s.note}”</small>}
                                  {s.ended_at && (
                                    <button type="button" className="secondary-button" onClick={() => setEditing(s)}>
                                      Correct
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {editing && (
            <ShiftEditor
              shift={editing}
              title="Correct this shift"
              hint="The original times stay in the record with your reason."
              onCancel={() => setEditing(null)}
              onSave={async (body) => {
                await apiRequest(`/platform/workforce/shifts/${editing.id}`, accessToken, { method: "PUT", body: JSON.stringify(body) });
                setEditing(null);
                setNotice("Shift corrected.");
                await load();
              }}
            />
          )}
          <div className="team-sheet-charts">
            <ChartFrame
              title="Hours this week"
              subtitle="Worked time per person"
              table={{ columns: ["Worker", "Hours"], rows: data.workers.map((w) => [w.name || "", hours(w.total_seconds)]) }}
            >
              <HBars label="Hours this week" format={(v) => hours(v)} data={data.workers.filter((w) => w.total_seconds).map((w) => ({ label: w.name || "", value: w.total_seconds }))} />
              {!data.workers.some((w) => w.total_seconds) && <p className="muted">Nobody has clocked in this week yet.</p>}
            </ChartFrame>
            <ChartFrame
              title="Support hours covered"
              subtitle={`${data.support_hours.days} ${data.support_hours.start}–${data.support_hours.end} ${data.support_hours.time_zone}: how much of each hour had someone on shift`}
              table={{
                columns: ["Day", ...hoursList.map((h) => `${h}:00`)],
                rows: weekdays.map((day, d) => [day, ...hoursList.map((h) => {
                  const cell = data.coverage.find((c) => c.weekday === d && c.hour === h);
                  return cell ? `${Math.round(cell.covered * 100)}%` : "—";
                })]),
              }}
            >
              <Heatmap
                label="Support hours covered"
                rows={weekdays}
                columns={hoursList.map((h) => `${h}`)}
                value={(r, c) => data.coverage.find((cell) => cell.weekday === r && cell.hour === hoursList[c])?.covered ?? null}
                format={(v) => (v === null ? "not yet" : v === 0 ? "nobody on shift" : `${Math.round(v * 100)}% covered`)}
              />
            </ChartFrame>
          </div>
        </>
      )}
    </section>
  );
}

export function ShiftEditor({
  shift,
  title,
  hint,
  onSave,
  onCancel,
}: {
  shift: ShiftView;
  title: string;
  hint: string;
  onSave: (body: { started_at: string; ended_at: string; reason: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [startedAt, setStartedAt] = useState(toChinaInput(shift.started_at));
  const [endedAt, setEndedAt] = useState(toChinaInput(shift.ended_at));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({ started_at: fromChinaInput(startedAt), ended_at: fromChinaInput(endedAt), reason: reason.trim() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That couldn't be saved.");
      setBusy(false);
    }
  }
  return (
    <form className="team-editor" onSubmit={submit} aria-label={title}>
      <strong>{title}</strong>
      <small className="muted">{hint} Times are China time.</small>
      <div className="team-editor-row">
        <label>
          Started
          <input type="datetime-local" required value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
        </label>
        <label>
          Ended
          <input type="datetime-local" required value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
        </label>
      </div>
      <label>
        Reason
        <input required minLength={3} maxLength={500} value={reason} placeholder="Forgot to clock out after the market visit" onChange={(event) => setReason(event.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="team-editor-row">
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The worker's own photo, hours and ratings (Control Center → My account). */
export function MyTeamProfile({ accessToken }: { accessToken: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftView[] | null>(null);
  const [editing, setEditing] = useState<ShiftView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const loadShifts = useCallback(() => {
    apiRequest<{ shifts: ShiftView[] }>("/workers/me/shifts?weeks=2", accessToken)
      .then((result) => setShifts(result.shifts))
      .catch(() => setShifts([]));
  }, [accessToken]);
  useEffect(() => {
    loadShifts();
    apiRequest<{ worker: { photo_url?: string | null } }>("/workers/me/profile", accessToken)
      .then((result) => setPhoto(result.worker.photo_url || null))
      .catch(() => undefined);
  }, [accessToken, loadShifts]);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await apiRequest<{ photo_url: string }>("/workers/me/photo", accessToken, { method: "POST", body: file, headers: { "Content-Type": file.type } }, 60_000);
      setPhoto(result.photo_url);
      setMessage("Photo saved. Colleagues and customers you help will see it.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Your photo couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await apiRequest("/workers/me/photo", accessToken, { method: "DELETE" });
      setPhoto(null);
      setMessage("Photo removed.");
    } finally {
      setBusy(false);
    }
  }
  const week = (shifts || []).reduce((sum, s) => sum + s.worked_seconds, 0);
  return (
    <>
      <section className="control-panel team-me" aria-label="Your photo">
        <div className="panel-heading">
          <div>
            <h2>Your photo</h2>
            <p>Shown to colleagues, and with your first name to customers when you reply to them.</p>
          </div>
        </div>
        <div className="team-photo-row">
          <Avatar name="You" photo={photo} size={72} />
          <label className="primary-button team-upload">
            {busy ? "Saving…" : photo ? "Change photo" : "Upload a photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void upload(event.target.files?.[0])} />
          </label>
          {photo && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void remove()}>
              Remove
            </button>
          )}
          {message && (
            <p role="status" className="muted">
              {message}
            </p>
          )}
        </div>
      </section>
      <section className="control-panel team-me" aria-label="Your rating">
        <div className="panel-heading">
          <div>
            <h2>Your rating</h2>
            <p>Customers you help can rate you after a chat goes quiet or their order is delivered. Only you and administrators see this.</p>
          </div>
        </div>
        <RatingsSection accessToken={accessToken} audience="worker" />
      </section>
      <section className="control-panel team-me" aria-label="Your hours">
        <div className="panel-heading">
          <div>
            <h2>Your hours</h2>
            <p>Clock in and out from the Operations Center header. Last two weeks, China time. If a time is wrong, ask for a correction.</p>
          </div>
          <strong className="team-me-total">{hours(week)}</strong>
        </div>
        {!shifts ? (
          <FayfortLoader label="Loading…" />
        ) : !shifts.length ? (
          <p className="muted">No shifts yet. Use Clock in in the Operations Center when you start work.</p>
        ) : (
          <ul className="team-shifts">
            {shifts.map((s) => (
              <li key={s.id} className={s.flag && s.flag !== "edited" ? "is-flagged" : ""}>
                <span>
                  <b>{chinaTime(s.started_at)}</b> – {s.ended_at ? chinaClock(s.ended_at) : "now"}
                </span>
                <span>{hours(s.worked_seconds)}{s.break_seconds ? ` · ${hours(s.break_seconds)} break` : ""}</span>
                {s.flag && <span className="status-pill is-warn">{FLAG[s.flag]}</span>}
                {s.correction_pending ? (
                  <span className="status-pill">Correction asked</span>
                ) : (
                  s.ended_at && (
                    <button type="button" className="secondary-button" onClick={() => setEditing(s)}>
                      Ask for a correction
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {editing && (
          <ShiftEditor
            shift={editing}
            title="Ask for a correction"
            hint="An administrator checks it before it changes your hours."
            onCancel={() => setEditing(null)}
            onSave={async (body) => {
              await apiRequest(`/workers/me/shifts/${editing.id}/correction`, accessToken, { method: "POST", body: JSON.stringify(body) });
              setEditing(null);
              setMessage("Correction sent to an administrator.");
              loadShifts();
            }}
          />
        )}
      </section>
    </>
  );
}
