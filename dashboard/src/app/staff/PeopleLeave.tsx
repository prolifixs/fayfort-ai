import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import "./hr.css";

/* HR H6 (docs/HR_AND_HIRING_PLAN.md section 3.5): time off in My HR, People → Time off, and the leave settings. */

type Balance = { key: string; name: string; allowance: number | null; used: number; pending: number; left: number | null };
type Leave = {
  id: string; worker_id: string; leave_type: string; type_name: string; status: "requested" | "approved" | "declined" | "cancelled";
  start_date: string; end_date: string; half_day: "morning" | "afternoon" | null; days: number; note: string | null;
  decided_at: string | null; decision_note: string | null; name: string; approver_name: string | null; clashing_bookings?: number;
};
type Mine = { types: { key: string; name: string }[]; balances: Balance[]; requests: Leave[]; to_answer: Leave[]; work_days: number[] };
type Calendar = { month: string; first: string; last: string; leave: Leave[]; waiting: Leave[]; holidays: { day: string; name: string }[]; work_days: number[] };
type LeaveType = { key: string; name: string; yearly_days: number | null; needs_approval: boolean; active: boolean };

const STATUS: Record<Leave["status"], string> = { requested: "Waiting for an answer", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const msg = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);
const short = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const plural = (n: number) => `${n % 1 ? n : n.toFixed(0)} day${n === 1 ? "" : "s"}`;
export const dates = (row: Pick<Leave, "start_date" | "end_date" | "half_day">) =>
  row.start_date === row.end_date ? `${short(row.start_date)}${row.half_day ? `, ${row.half_day}` : ""}` : `${short(row.start_date)} to ${short(row.end_date)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

function Decide({ row, accessToken, onDone }: { row: Leave; accessToken: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function answer(decision: "approve" | "decline") {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/hr/time-off/${row.id}/decide`, accessToken, { method: "POST", body: JSON.stringify({ decision, note: note.trim() || null }) });
      onDone();
    } catch (reason) {
      setError(msg(reason, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="leave-request">
      <div><strong>{row.name}</strong> · {row.type_name} · {dates(row)} <span className="muted">({plural(Number(row.days))})</span></div>
      {row.note && <p className="muted">“{row.note}”</p>}
      {Boolean(row.clashing_bookings) && <p className="hr-flag is-due">{row.clashing_bookings} booking{row.clashing_bookings === 1 ? "" : "s"} in those days: move or hand them over if you approve.</p>}
      <div className="hr-inline">
        <input aria-label={`Note to ${row.name}`} placeholder="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void answer("decline")}>Decline</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void answer("approve")}>Approve</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </li>
  );
}

// ---- My HR: my time off ---------------------------------------------------------------------------------------------
export function MyTimeOff({ accessToken }: { accessToken: string }) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState({ leave_type: "", start_date: "", end_date: "", half_day: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const load = useCallback(() => {
    apiRequest<Mine>("/hr/my/time-off", accessToken).then((m) => { setMine(m); setForm((f) => ({ ...f, leave_type: f.leave_type || m.types[0]?.key || "" })); })
      .catch((reason) => setError(msg(reason, "Your time off could not be loaded.")));
  }, [accessToken]);
  useEffect(load, [load]);
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setMine(await apiRequest<Mine>("/hr/my/time-off", accessToken, { method: "POST", body: JSON.stringify({
        leave_type: form.leave_type, start_date: form.start_date, end_date: form.end_date || form.start_date,
        half_day: form.half_day && (!form.end_date || form.end_date === form.start_date) ? form.half_day : null, note: form.note.trim() || null }) }));
      setAsking(false);
      setForm({ ...form, start_date: "", end_date: "", half_day: "", note: "" });
      setDone("Request sent. You'll get a notice when it's answered.");
    } catch (reason) {
      setError(msg(reason, "Your request couldn't be sent."));
    } finally {
      setBusy(false);
    }
  }
  if (!mine) return error ? <p className="form-error" role="alert">{error}</p> : null;
  const oneDay = form.start_date && (!form.end_date || form.end_date === form.start_date);
  const upcoming = mine.requests.filter((r) => r.status !== "cancelled" && r.end_date >= todayIso());
  const past = mine.requests.filter((r) => !upcoming.includes(r)).slice(0, 5);
  return (
    <section className="my-hr-card my-time-off" aria-label="Time off">
      <div className="hr-jobs-head"><h3>Time off</h3>{!asking && <button type="button" className="primary-button" onClick={() => { setAsking(true); setDone(""); }}>Ask for time off</button>}</div>
      <ul className="leave-balances">
        {mine.balances.map((b) => (
          <li key={b.key}>
            <span><strong>{b.name}</strong><small className="muted">{b.allowance === null ? `${plural(b.used)} taken this year` : `${plural(Math.max(0, b.left ?? 0))} left of ${plural(b.allowance)}`}{b.pending ? ` · ${plural(b.pending)} waiting` : ""}</small></span>
            {b.allowance ? (
              <span className="leave-bar" role="img" aria-label={`${b.used} used, ${b.pending} waiting, of ${b.allowance}`}>
                <i style={{ width: `${Math.min(100, (b.used / b.allowance) * 100)}%` }} />
                <i className="is-pending" style={{ width: `${Math.min(100, (b.pending / b.allowance) * 100)}%` }} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {asking && (
        <form className="hr-record-form" onSubmit={send} aria-label="Ask for time off">
          <div className="hr-grid">
            <label>Type<select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>{mine.types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
            <label>First day<input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
            <label>Last day<input type="date" min={form.start_date || undefined} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            {oneDay && (
              <label>Length<select value={form.half_day} onChange={(e) => setForm({ ...form, half_day: e.target.value })}><option value="">Whole day</option><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option></select></label>
            )}
          </div>
          <label>Note (optional)<input maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything your manager should know" /></label>
          <p className="muted">Weekends and public holidays aren't counted. Sick leave can be asked for after the day.</p>
          <div className="hr-links">
            <button type="button" className="secondary-button" onClick={() => setAsking(false)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={busy || !form.start_date}>{busy ? "Sending…" : "Send request"}</button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {done && <p className="email-delivery ok" role="status">{done}</p>}
      {upcoming.length > 0 && (
        <ul className="hr-doc-list">{upcoming.map((r) => (
          <li key={r.id}><span><strong>{r.type_name} · {dates(r)}</strong><small className="muted">{plural(Number(r.days))} · {STATUS[r.status]}{r.decision_note ? ` · “${r.decision_note}”` : ""}</small></span>
            {(r.status === "requested" || (r.status === "approved" && r.start_date > todayIso())) && (
              <button type="button" className="text-link-button" onClick={async () => { try { setMine(await apiRequest<Mine>(`/hr/my/time-off/${r.id}/cancel`, accessToken, { method: "POST" })); } catch (reason) { setError(msg(reason, "That didn't work.")); } }}>Cancel</button>
            )}</li>
        ))}</ul>
      )}
      {past.length > 0 && <p className="muted">Earlier: {past.map((r) => `${r.type_name} ${dates(r)} (${STATUS[r.status].toLowerCase()})`).join("; ")}</p>}
      {mine.to_answer.length > 0 && (
        <div className="leave-to-answer"><h3>Requests from your team</h3><ul className="leave-requests">{mine.to_answer.map((r) => <Decide key={r.id} row={r} accessToken={accessToken} onDone={load} />)}</ul></div>
      )}
    </section>
  );
}

// ---- People → Time off ------------------------------------------------------------------------------------------------
export function TimeOffPanel({ accessToken }: { accessToken: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [team, setTeam] = useState<{ worker_id: string; name: string }[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState({ worker_id: "", leave_type: "sick", start_date: "", end_date: "", note: "" });
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    apiRequest<Calendar>(`/hr/time-off?month=${month}`, accessToken).then(setData).catch((reason) => setError(msg(reason, "Time off could not be loaded.")));
  }, [accessToken, month]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!recording || team.length) return;
    apiRequest<{ people: { worker_id: string; name: string }[] }>("/hr/people", accessToken).then((r) => setTeam(r.people)).catch(() => undefined);
    apiRequest<{ leave_types: LeaveType[] }>("/hr/leave-settings", accessToken).then((r) => setTypes(r.leave_types.filter((t) => t.active))).catch(() => undefined);
  }, [recording, team.length, accessToken]);

  const days = useMemo(() => {
    if (!data) return [];
    const out: { iso: string; weekday: number }[] = [];
    for (let d = new Date(`${data.first}T12:00:00Z`); d.toISOString().slice(0, 10) <= data.last; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push({ iso: d.toISOString().slice(0, 10), weekday: (d.getUTCDay() + 6) % 7 });
    }
    return out;
  }, [data]);
  const shift = (by: number) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + by);
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthName = new Date(`${data?.month || month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="hr-time-off">
      {data && data.waiting.length > 0 && (
        <section className="control-panel"><h2>Waiting for an answer</h2><ul className="leave-requests">{data.waiting.map((r) => <Decide key={r.id} row={r} accessToken={accessToken} onDone={load} />)}</ul></section>
      )}
      <section className="control-panel">
        <div className="hr-jobs-head">
          <div className="leave-month"><button type="button" className="secondary-button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button><h2>{monthName}</h2><button type="button" className="secondary-button" aria-label="Next month" onClick={() => shift(1)}>›</button></div>
          <button type="button" className="secondary-button" onClick={() => setRecording(!recording)}>Record leave for someone</button>
        </div>
        {recording && (
          <form className="hr-record-form" aria-label="Record leave" onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await apiRequest<{ time_off: { clashing_bookings: number } }>(`/hr/people/${form.worker_id}/time-off`, accessToken, { method: "POST", body: JSON.stringify({ leave_type: form.leave_type, start_date: form.start_date, end_date: form.end_date || form.start_date, note: form.note || null }) });
              setNotice(r.time_off.clashing_bookings ? `Recorded. They have ${r.time_off.clashing_bookings} booking(s) in those days to move or hand over.` : "Recorded.");
              setRecording(false);
              load();
            } catch (reason) { setError(msg(reason, "The leave couldn't be recorded.")); }
          }}>
            <div className="hr-grid">
              <label>Person<select required value={form.worker_id} onChange={(e) => setForm({ ...form, worker_id: e.target.value })}><option value="">Choose</option>{team.map((p) => <option key={p.worker_id} value={p.worker_id}>{p.name}</option>)}</select></label>
              <label>Type<select value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })}>{types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
              <label>First day<input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
              <label>Last day<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            </div>
            <p className="muted">Recorded leave is approved straight away, and can be in the past (for example sick days).</p>
            <button type="submit" className="primary-button" disabled={!form.worker_id || !form.start_date}>Record leave</button>
          </form>
        )}
        {notice && <p className="email-delivery ok" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data ? <p className="muted">Loading…</p> : (
          <div className="leave-calendar" role="grid" aria-label={`Who's away in ${monthName}`}>
            {WEEKDAYS.map((w) => <div key={w} className="leave-head" role="columnheader">{w}</div>)}
            {Array.from({ length: days[0]?.weekday || 0 }).map((_, i) => <div key={`pad${i}`} className="leave-pad" />)}
            {days.map((d) => {
              const away = data.leave.filter((l) => l.start_date <= d.iso && l.end_date >= d.iso);
              const holiday = data.holidays.find((h) => h.day === d.iso);
              const off = !data.work_days.includes(d.weekday);
              return (
                <div key={d.iso} role="gridcell" className={`leave-day${off ? " is-off" : ""}${holiday ? " is-holiday" : ""}${d.iso === todayIso() ? " is-today" : ""}`} aria-label={`${short(d.iso)}${away.length ? `: ${away.map((a) => a.name).join(", ")} away` : ""}`}>
                  <span className="leave-date">{Number(d.iso.slice(8))}</span>
                  {holiday && <small className="leave-holiday">{holiday.name}</small>}
                  {away.map((a) => <span key={a.id} className={`leave-chip${a.status === "requested" ? " is-pending" : ""}`} title={`${a.name}: ${a.type_name}${a.status === "requested" ? " (waiting)" : ""}`}>{a.name.split(" ")[0]}</span>)}
                </div>
              );
            })}
          </div>
        )}
        <p className="muted leave-legend"><span className="leave-chip">Approved</span> <span className="leave-chip is-pending">Waiting</span> Grey days aren't working days.</p>
      </section>
    </div>
  );
}

// ---- People → Settings: leave -------------------------------------------------------------------------------------------
export function LeaveSettingsPanel({ accessToken }: { accessToken: string }) {
  const [types, setTypes] = useState<LeaveType[] | null>(null);
  const [work, setWork] = useState<number[]>([]);
  const [holidays, setHolidays] = useState<{ day: string; name: string; region: string }[]>([]);
  const [state, setState] = useState("");
  const [error, setError] = useState("");
  const take = (r: { leave_types: LeaveType[]; work_days: number[]; holidays: { day: string; name: string; region: string }[] }) => {
    setTypes(r.leave_types); setWork(r.work_days); setHolidays(r.holidays);
  };
  useEffect(() => {
    apiRequest<Parameters<typeof take>[0]>("/hr/leave-settings", accessToken).then(take).catch((reason) => setError(msg(reason, "Leave settings could not be loaded.")));
  }, [accessToken]);
  if (!types) return error ? <p className="form-error" role="alert">{error}</p> : null;
  return (
    <form className="control-panel hr-editor" aria-label="Leave settings" onSubmit={async (e) => {
      e.preventDefault();
      setState("Saving…");
      setError("");
      try {
        take(await apiRequest<Parameters<typeof take>[0]>("/hr/leave-settings", accessToken, { method: "PUT", body: JSON.stringify({
          leave_types: types.map((t) => ({ key: t.key, yearly_days: t.yearly_days, active: t.active, needs_approval: t.needs_approval })),
          work_days: work, holidays: holidays.filter((h) => h.day && h.name.trim()) }) }));
        setState("Saved.");
      } catch (reason) { setState(""); setError(msg(reason, "Leave settings could not be saved.")); }
    }}>
      <div className="panel-heading"><h2>Leave</h2><p className="muted">Days a year for each type, pro-rated for people who start during the year. Leave empty to not count a type.</p></div>
      <table className="leave-types">
        <thead><tr><th>Type</th><th>Days a year</th><th>Needs approval</th><th>In use</th></tr></thead>
        <tbody>{types.map((t, i) => (
          <tr key={t.key}>
            <th scope="row">{t.name}</th>
            <td><input type="number" min={0} max={365} step={0.5} aria-label={`${t.name} days a year`} value={t.yearly_days ?? ""} placeholder="Not counted"
              onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, yearly_days: e.target.value === "" ? null : Number(e.target.value) } : x)))} /></td>
            <td><input type="checkbox" aria-label={`${t.name} needs approval`} checked={t.needs_approval} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, needs_approval: e.target.checked } : x)))} /></td>
            <td><input type="checkbox" aria-label={`${t.name} in use`} checked={t.active} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} /></td>
          </tr>
        ))}</tbody>
      </table>
      <fieldset className="hr-questions"><legend>Working days</legend>
        <div className="hr-chips">{WEEKDAYS.map((w, i) => (
          <label key={w} className="hr-check"><input type="checkbox" checked={work.includes(i)} onChange={(e) => setWork(e.target.checked ? [...work, i].sort() : work.filter((d) => d !== i))} />{w}</label>
        ))}</div>
      </fieldset>
      <fieldset className="hr-questions"><legend>Public holidays (not counted as leave)</legend>
        {holidays.map((h, i) => (
          <div key={i} className="hr-question">
            <input type="date" aria-label={`Holiday ${i + 1} date`} value={h.day} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} />
            <input aria-label={`Holiday ${i + 1} name`} placeholder="Name" value={h.name} onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button type="button" className="text-link-button" onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="secondary-button" onClick={() => setHolidays([...holidays, { day: "", name: "", region: "china" }])}>Add a holiday</button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="hr-editor-actions">{state && <span className="muted" role="status">{state}</span>}<button type="submit" className="primary-button">Save leave settings</button></div>
    </form>
  );
}
