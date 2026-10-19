import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { useDismiss } from "./ui/useDismiss";
import { hours, type ShiftView } from "./staff/WorkerTeam";
import "./shift-control.css";

/** Operations header: Clock in, then a running shift timer with Break and Clock out (docs/WORKFORCE_AND_REVENUE_PLAN.md).
 * Claiming work while clocked out shows a one-tap reminder; it never blocks the claim. */

type State = { shift: ShiftView | null; today_seconds: number; week_seconds: number; server_time: string };

function liveSeconds(shift: ShiftView, fetchedAt: number) {
  return shift.on_break ? shift.worked_seconds : shift.worked_seconds + Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
}

export function ShiftControl({ accessToken }: { accessToken: string }) {
  const [state, setState] = useState<State | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const onShift = useRef<boolean | null>(null);
  onShift.current = state ? Boolean(state.shift) : null;
  useDismiss(open || nudge, () => (setOpen(false), setNudge(false)), [wrap]);

  const apply = useCallback((next: State) => {
    setState(next);
    setFetchedAt(Date.now());
    setError("");
  }, []);
  const load = useCallback(async () => {
    try {
      apply(await apiRequest<State>("/workers/me/shift", accessToken));
    } catch {
      setState((current) => current);
    }
  }, [accessToken, apply]);
  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 60_000);
    const clock = window.setInterval(() => tick((value) => value + 1), 30_000);
    return () => (window.clearInterval(poll), window.clearInterval(clock));
  }, [load]);
  useEffect(() => {
    const onClaim = () => {
      if (onShift.current === false) setNudge(true);
    };
    window.addEventListener("fayfort:work-claimed", onClaim);
    return () => window.removeEventListener("fayfort:work-claimed", onClaim);
  }, []);

  async function act(path: string, body?: object) {
    setBusy(true);
    setError("");
    try {
      apply(await apiRequest<State>(`/workers/me/shift/${path}`, accessToken, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function clockOut(event: FormEvent) {
    event.preventDefault();
    if (await act("clock-out", { note: note.trim() || null })) {
      setNote("");
      setOpen(false);
    }
  }

  if (!state) return null;
  const shift = state.shift;
  if (!shift)
    return (
      <div className="shift-control" ref={wrap}>
        <button type="button" className="ops-head-button shift-clock-in" disabled={busy} onClick={() => void act("clock-in").then(() => setNudge(false))}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
          </svg>
          <span>{busy ? "Clocking in…" : "Clock in"}</span>
        </button>
        {nudge && (
          <div className="shift-pop shift-nudge" role="dialog" aria-label="Clock in reminder">
            <strong>You're not clocked in</strong>
            <p>You just claimed work. Clock in so your hours count.</p>
            <div>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void act("clock-in").then(() => setNudge(false))}>
                Clock in now
              </button>
              <button type="button" className="secondary-button" onClick={() => setNudge(false)}>
                Not now
              </button>
            </div>
          </div>
        )}
        {error && <span className="shift-error" role="alert">{error}</span>}
      </div>
    );
  const seconds = liveSeconds(shift, fetchedAt);
  return (
    <div className="shift-control" ref={wrap}>
      <button
        type="button"
        className={`ops-head-button shift-on${shift.on_break ? " is-break" : ""}`}
        aria-expanded={open}
        aria-label={`${shift.on_break ? "On a break" : "On shift"}, ${hours(seconds)}. Shift options`}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="shift-dot" aria-hidden="true" />
        <span>{shift.on_break ? "On a break" : "On shift"}</span>
        <b>{hours(seconds)}</b>
      </button>
      {open && (
        <div className="shift-pop" role="dialog" aria-label="Your shift">
          <dl>
            <div>
              <dt>Started</dt>
              <dd>{new Date(shift.started_at).toLocaleTimeString(undefined, { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })} China time</dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd>{hours(state.today_seconds + (shift.on_break ? 0 : Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))))}</dd>
            </div>
            <div>
              <dt>This week</dt>
              <dd>{hours(state.week_seconds + (shift.on_break ? 0 : Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))))}</dd>
            </div>
          </dl>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("break")}>
            {shift.on_break ? "End break" : "Take a break"}
          </button>
          <form onSubmit={clockOut}>
            <label>
              Note for this shift (optional)
              <input maxLength={500} value={note} placeholder="Packed 6 orders, two supplier calls" onChange={(event) => setNote(event.target.value)} />
            </label>
            <button className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Clock out"}
            </button>
          </form>
          <small className="muted">If you close the dashboard and forget, your shift ends by itself after 30 minutes.</small>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
