import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { useDismiss } from "./ui/useDismiss";

/** Operations header: whether this worker takes customer chats (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R1). The same setting
 * as Human agents → Your availability, which workers no longer open. Going available lasts 8 hours, or until changed. */
type Status = "available" | "away" | "offline";
type Availability = { availability: Status; available_until: string | null; max_active_handoffs: number };
const LABEL: Record<Status, string> = { available: "Taking chats", away: "Away from chats", offline: "Not taking chats" };
const SHIFT_HOURS = 8;

export function ChatAvailability({ accessToken }: { accessToken: string }) {
  const [businessId, setBusinessId] = useState("");
  const [state, setState] = useState<Availability | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [wrap]);

  const load = useCallback(async () => {
    try {
      const found = await apiRequest<{ businesses?: { business_id: string }[] }>("/dashboard/businesses", accessToken);
      const id = found.businesses?.[0]?.business_id;
      if (!id) return;
      setBusinessId(id);
      setState(await apiRequest<Availability>(`/businesses/${id}/handoffs/availability`, accessToken));
    } catch {
      setState(null); // Not a worker with a chat seat: the control stays hidden.
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  async function choose(availability: Status) {
    if (!state || !businessId) return;
    setBusy(true);
    setError("");
    try {
      const until = availability === "available" ? new Date(Date.now() + SHIFT_HOURS * 3600_000).toISOString() : null;
      setState(
        await apiRequest<Availability>(`/businesses/${businessId}/handoffs/availability`, accessToken, {
          method: "PATCH",
          body: JSON.stringify({ availability, available_until: until, max_active_handoffs: state.max_active_handoffs || 3 }),
        }),
      );
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const expired = state.availability === "available" && state.available_until && new Date(state.available_until).getTime() < Date.now();
  const status: Status = expired ? "offline" : state.availability;
  return (
    <div className="shift-control chat-availability" ref={wrap}>
      <button
        type="button"
        className={`ops-head-button chat-status is-${status}`}
        aria-expanded={open}
        aria-label={`${LABEL[status]}. Change chat availability`}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="shift-dot" aria-hidden="true" />
        <span>{LABEL[status]}</span>
      </button>
      {open && (
        <div className="shift-pop" role="dialog" aria-label="Chat availability">
          <strong>Customer chats</strong>
          <p className="muted">When you're taking chats, customers who ask for a person can be handed to you.</p>
          {(["available", "away", "offline"] as Status[]).map((option) => (
            <button
              key={option}
              type="button"
              className={option === status ? "primary-button" : "secondary-button"}
              aria-pressed={option === status}
              disabled={busy}
              onClick={() => void choose(option)}
            >
              {option === "available" ? `Take chats for ${SHIFT_HOURS} hours` : LABEL[option]}
            </button>
          ))}
          {status === "available" && state.available_until && (
            <small className="muted">
              Until {new Date(state.available_until).toLocaleTimeString(undefined, { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })} China time
            </small>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
