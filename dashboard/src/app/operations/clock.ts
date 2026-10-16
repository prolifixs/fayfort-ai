import { useEffect, useState } from "react";

/**
 * The deadline clock on every piece of work (docs/OPERATIONS_CENTER_PLAN.md, "Deadlines").
 * Work starts green and turns amber then red as its deadline gets closer. Past the deadline it is red and says
 * how long it has been overdue, so nothing is left untouched.
 */
export type WorkClock = {
  state: "none" | "running" | "overdue";
  /** 0 when the work opened, 1 at the deadline (capped). */
  progress: number;
  /** HSL hue: 142 (green) down to 0 (red). */
  hue: number;
  tone: "fresh" | "steady" | "soon" | "late" | "overdue";
  label: string;
  dueLabel: string;
};

const MINUTE = 60_000;

/** "45m", "3h 20m", "2d 4h". */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function workClock(
  item: { status: string; due_at: string | null; created_at: string },
  now: number = Date.now(),
): WorkClock {
  const finished = item.status === "completed" || item.status === "cancelled";
  const due = item.due_at ? new Date(item.due_at).getTime() : NaN;
  if (finished || Number.isNaN(due)) {
    return { state: "none", progress: 0, hue: 142, tone: "fresh", label: "", dueLabel: "" };
  }
  const start = new Date(item.created_at).getTime();
  const span = Math.max(due - (Number.isNaN(start) ? due - 24 * 60 * MINUTE : start), MINUTE);
  const left = due - now;
  const dueLabel = shortDate(item.due_at as string);
  if (left <= 0) {
    return { state: "overdue", progress: 1, hue: 0, tone: "overdue", label: `Overdue ${formatSpan(left)}`, dueLabel };
  }
  const progress = Math.min(1, Math.max(0, 1 - left / span));
  const hue = Math.round(142 * (1 - progress));
  const tone = progress < 0.5 ? "fresh" : progress < 0.75 ? "steady" : progress < 0.9 ? "soon" : "late";
  return { state: "running", progress, hue, tone, label: `${formatSpan(left)} left`, dueLabel };
}

/** Re-render once a minute so clocks move while the page is open. */
export function useNow(intervalMs = MINUTE): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** A value for <input type="datetime-local"> in the viewer's own time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * MINUTE);
  return local.toISOString().slice(0, 16);
}
