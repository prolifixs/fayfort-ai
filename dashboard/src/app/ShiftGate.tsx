import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiRequestError, apiRequest } from "../lib/api";
import { BrandMark } from "./brand/FayfortLogo";
import { hours, type ShiftView } from "./staff/WorkerTeam";
import "./shift-control.css";

type ShiftState = { shift: ShiftView | null; today_seconds: number; week_seconds: number; server_time: string };

/** ShiftControl announces every change so the gate follows clock-out without waiting for the next poll. */
export const SHIFT_CHANGED_EVENT = "fayfort:shift-changed";

/**
 * Workers must be clocked in to use the Control Center or the Operations Center. Administrators are never gated.
 * The gate reappears on clock-out, or when a forgotten shift ends by itself after 30 minutes away.
 */
export function ShiftGate({
  accessToken,
  required,
  pending = false,
  onSignOut,
  children,
}: {
  accessToken: string;
  /** True for an active worker who isn't an administrator. */
  required: boolean;
  /** Still finding out whether the person is a worker: show nothing yet rather than flash the page. */
  pending?: boolean;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const [state, setState] = useState<ShiftState | null>(null);
  const [failed, setFailed] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await apiRequest<ShiftState>("/workers/me/shift", accessToken);
      // Anything that isn't a shift answer means the API predates shifts: don't lock anyone out.
      if (!next || typeof next !== "object" || !("shift" in next)) setLegacy(true);
      else setState(next);
      setFailed("");
    } catch (reason) {
      // An API without shifts yet must not lock everyone out.
      if (reason instanceof ApiRequestError && reason.status === 404) setLegacy(true);
      else setFailed(reason instanceof Error ? reason.message : "Your shift couldn't be checked.");
    }
  }, [accessToken]);
  useEffect(() => {
    if (!required) return;
    void load();
    const poll = window.setInterval(() => void load(), 60_000);
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ShiftState>).detail;
      if (detail && "shift" in detail) setState(detail);
      else void load();
    };
    window.addEventListener(SHIFT_CHANGED_EVENT, onChange);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener(SHIFT_CHANGED_EVENT, onChange);
    };
  }, [required, load]);
  async function clockIn() {
    setBusy(true);
    setFailed("");
    try {
      const next = await apiRequest<ShiftState>("/workers/me/shift/clock-in", accessToken, { method: "POST" });
      setState(next);
      window.dispatchEvent(new CustomEvent(SHIFT_CHANGED_EVENT, { detail: next }));
    } catch (reason) {
      setFailed(reason instanceof Error ? reason.message : "You couldn't be clocked in. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (pending) return <div className="shift-gate-wait" aria-busy="true" />;
  if (!required || legacy || state?.shift) return <>{children}</>;
  return (
    <main className="shift-gate">
      <section className="shift-gate-card" aria-labelledby="shift-gate-title">
        <BrandMark />
        <h1 id="shift-gate-title">Clock in to start</h1>
        <p>
          The Control Center and the Operations Center open once you're on shift, so your hours and your work line up.
        </p>
        {state && (
          <dl className="shift-gate-hours">
            <div>
              <dt>Today</dt>
              <dd>{hours(state.today_seconds)}</dd>
            </div>
            <div>
              <dt>This week</dt>
              <dd>{hours(state.week_seconds)}</dd>
            </div>
          </dl>
        )}
        <button type="button" className="primary-button shift-gate-button" disabled={busy || (!state && !failed)} onClick={() => void clockIn()}>
          {busy ? "Clocking in…" : !state && !failed ? "Checking your shift…" : "Clock in"}
        </button>
        {failed && (
          <p className="form-error" role="alert">
            {failed}{" "}
            <button type="button" className="text-button" onClick={() => void load()}>
              Check again
            </button>
          </p>
        )}
        <small>
          Take breaks and clock out from the shift button at the top of the page. If you close the dashboard and forget, your shift
          ends by itself after 30 minutes.
        </small>
        {onSignOut && (
          <button type="button" className="text-button" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </section>
    </main>
  );
}
