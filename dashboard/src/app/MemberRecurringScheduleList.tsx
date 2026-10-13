import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type ScheduleOccurrence = { id: string; occurrence_number: number; request_id: string | null; due_at: string; status: "created" | "skipped" };
type MemberSchedule = {
  id: string; originating_request_id: string; cadence: string; interval_count: number; interval_unit: string;
  units_per_order: number; occurrence_limit: number; time_zone: string; next_occurrence_number: number;
  next_due_at: string; expires_at: string; status: "active" | "paused" | "cancelled" | "completed";
  version: number; occurrences: ScheduleOccurrence[];
  events: { id: string; sequence_no: number; event_type: string; occurrence_number: number | null; created_at: string }[];
};

export function MemberRecurringScheduleList({ accessToken }: { accessToken: string }) {
  const [schedules, setSchedules] = useState<MemberSchedule[]>([]);
  const [resumeTimes, setResumeTimes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editUnits, setEditUnits] = useState<Record<string, string>>({});
  const [editDates, setEditDates] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ schedules: MemberSchedule[] }>("/members/recurring-schedules", accessToken);
      setSchedules(result.schedules || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recurring schedules could not be loaded.");
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("member-recurring-schedules-refresh", refresh);
    return () => window.removeEventListener("member-recurring-schedules-refresh", refresh);
  }, [load]);

  async function changeState(schedule: MemberSchedule, action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !window.confirm("Cancel future requests in this schedule? Existing requests remain open.")) return;
    setBusy(schedule.id);
    setError("");
    setNotice("");
    try {
      const localResume = resumeTimes[schedule.id];
      if (action === "resume" && !localResume) throw new Error("Choose the next local date and time first.");
      await apiRequest(`/members/recurring-schedules/${schedule.id}/state`, accessToken, {
        method: "POST",
        body: JSON.stringify({ action, expected_version: schedule.version, resume_at: action === "resume" ? localResume : null }),
      });
      setNotice(action === "cancel" ? "Future requests in this schedule are cancelled." : action === "pause" ? "Schedule paused." : "Schedule resumed.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The recurring schedule could not be updated.");
    } finally {
      setBusy("");
    }
  }

  function localDateValue(value: string, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
    const part = (type: string) => parts.find(item => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  }

  async function saveEdit(schedule: MemberSchedule) {
    setBusy(schedule.id); setError(""); setNotice("");
    const units = editUnits[schedule.id]?.trim();
    const nextDate = editDates[schedule.id]?.trim();
    try {
      await apiRequest(`/members/recurring-schedules/${schedule.id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ expected_version: schedule.version, ...(units ? { units_per_order: Number(units) } : {}), ...(nextDate ? { next_due_local: nextDate } : {}) }),
      });
      setNotice("Future cycle updated. The change is recorded in schedule history.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The future cycle could not be edited.");
    } finally { setBusy(""); }
  }

  if (!schedules.length && !error) return null;
  return <section className="member-recurring-schedules" aria-label="Your recurring request schedules">
    <div className="panel-heading"><div><h3>Recurring request schedules</h3><p>Each cycle creates a sourcing request. No order or charge is automatic.</p></div><button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status" className="member-recurring-summary">{notice}</p>}
    {schedules.map(schedule => <article className="member-recurring-schedule" key={schedule.id}>
      <div><strong>{schedule.cadence === "custom" ? `Every ${schedule.interval_count} ${schedule.interval_unit}` : schedule.cadence[0].toUpperCase() + schedule.cadence.slice(1)} · {schedule.units_per_order} {schedule.units_per_order === 1 ? "unit" : "units"}</strong><span className={`member-schedule-status is-${schedule.status}`}>{schedule.status}</span></div>
      <p>Time zone: {schedule.time_zone} · {schedule.occurrences.filter(item => item.status === "created").length} of {schedule.occurrence_limit} requests created</p>
      {schedule.status === "active" && <p>Next request: {new Date(schedule.next_due_at).toLocaleString(undefined, { timeZone: schedule.time_zone })}. Due requests are created when the schedule processor runs.</p>}
      {(schedule.status === "active" || schedule.status === "paused") && <details className="member-recurring-edit"><summary>Edit future cycle</summary><div><label>Units per cycle<input aria-label={`Units per cycle for ${schedule.id}`} type="number" min={1} max={10000} value={editUnits[schedule.id] ?? String(schedule.units_per_order)} onChange={event => setEditUnits(old => ({ ...old, [schedule.id]: event.target.value }))} /></label>{schedule.status === "active" && <label>Next request date and time ({schedule.time_zone})<input aria-label={`Next request date for ${schedule.id}`} type="datetime-local" min={localDateValue(new Date().toISOString(), schedule.time_zone)} value={editDates[schedule.id] ?? localDateValue(schedule.next_due_at, schedule.time_zone)} onChange={event => setEditDates(old => ({ ...old, [schedule.id]: event.target.value }))} /></label>}</div><p>Changing the date resets the recurring calendar anchor for later cycles. The next cycle must not already be due. No order or charge is created by saving.</p><button className="secondary-button" type="button" disabled={busy === schedule.id} onClick={() => void saveEdit(schedule)}>{busy === schedule.id ? "Saving…" : "Save future cycle"}</button></details>}
      <ol>{schedule.occurrences.map(item => <li key={item.id}>Cycle {item.occurrence_number}: {item.status === "skipped" ? "skipped after a missed cycle" : <a href={`/member/products#request-${item.request_id}`}>View sourcing request</a>}</li>)}</ol>
      {schedule.events?.length > 0 && <details className="member-recurring-history"><summary>Schedule updates ({schedule.events.length})</summary><ol>{schedule.events.map(event => <li key={event.id}><strong>{({activated:"Schedule activated",paused:"Schedule paused",resumed:"Schedule resumed",cancelled:"Future cycles cancelled",occurrence_created:"Sourcing request created",occurrence_skipped:"Missed cycle skipped",quote_accepted:"Quote selected",completed:"Schedule completed",schedule_edited:"Future cycle edited"} as Record<string,string>)[event.event_type]||event.event_type.replaceAll("_"," ")}{event.occurrence_number?` · cycle ${event.occurrence_number}`:""}</strong><time>{new Date(event.created_at).toLocaleString()}</time></li>)}</ol></details>}
      {schedule.status === "active" && <button className="secondary-button" type="button" disabled={busy === schedule.id} onClick={() => void changeState(schedule, "pause")}>Pause schedule</button>}
      {schedule.status === "paused" && <div className="member-schedule-resume"><label>Next local date and time<input aria-label={`Resume date for ${schedule.id}`} type="datetime-local" value={resumeTimes[schedule.id] || ""} onChange={event => setResumeTimes(old => ({ ...old, [schedule.id]: event.target.value }))} /></label><button className="secondary-button" type="button" disabled={busy === schedule.id} onClick={() => void changeState(schedule, "resume")}>Resume schedule</button></div>}
      {(schedule.status === "active" || schedule.status === "paused") && <button className="secondary-button" type="button" disabled={busy === schedule.id} onClick={() => void changeState(schedule, "cancel")}>Cancel future requests</button>}
    </article>)}
  </section>;
}
