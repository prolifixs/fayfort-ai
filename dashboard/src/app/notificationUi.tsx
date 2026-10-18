/** Shared pieces for member and staff notifications: icons, "12 min ago" times, Today/Earlier groups and the
 * pop-up that shows new notices together, for 5 seconds, pausing while the pointer is over it. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type NoticeTone = "message" | "order" | "photo" | "repeat" | "assign" | "due" | "review" | "alert" | "info";

const ICONS: Record<NoticeTone, string> = {
  message: "M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.4-3.5A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z",
  order: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  photo: "M4 5h16v14H4zM9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM20 16l-5-5-9 8",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  assign: "M5 12h12M13 6l6 6-6 6",
  due: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  review: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  alert: "M12 4l9 16H3zM12 10v4M12 17.5v.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.5",
};

export function NoticeIcon({ tone }: { tone: NoticeTone }) {
  return (
    <span className={`notice-icon tone-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d={ICONS[tone]} />
      </svg>
    </span>
  );
}

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const date = new Date(iso);
  const days = Math.round(hours / 24);
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Splits newest-first notices into Today and Earlier. */
export function byDay<T extends { created_at: string }>(items: T[], now = new Date()): { label: string; items: T[] }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = items.filter((item) => new Date(item.created_at) >= start);
  const earlier = items.filter((item) => new Date(item.created_at) < start);
  return [
    ...(today.length ? [{ label: "Today", items: today }] : []),
    ...(earlier.length ? [{ label: "Earlier", items: earlier }] : []),
  ];
}

export type ToastNotice = { key: string; tone: NoticeTone; title: string; body: string; count: number };

const TOAST_MS = 5000;

/** One pop-up for everything that arrived together. Closes after 5 seconds, paused while hovered or focused. */
export function NoticeToast({
  toast,
  onView,
  onClose,
  viewLabel = "View",
  className = "",
  container = null,
}: {
  toast: ToastNotice | null;
  onView: () => void;
  onClose: () => void;
  viewLabel?: string;
  className?: string;
  /** Render into this element (keeps the pop-up above sticky headers while inheriting the page's colours). */
  container?: Element | null;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_MS);
  const started = useRef(0);
  const [barKey, setBarKey] = useState(0);
  useEffect(() => {
    remaining.current = TOAST_MS;
    setPaused(false);
    setBarKey((value) => value + 1);
  }, [toast?.key]);
  useEffect(() => {
    if (!toast || paused) return;
    started.current = Date.now();
    const timer = window.setTimeout(onClose, Math.max(remaining.current, 300));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started.current;
    };
  }, [toast, paused, onClose]);
  if (!toast) return null;
  const node = (
    <aside
      className={`notice-toast ${className}`}
      role="status"
      aria-live="polite"
      aria-label="New notification"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <NoticeIcon tone={toast.tone} />
      <div className="notice-toast-text">
        <strong>{toast.count > 1 ? `${toast.count} new updates` : toast.title}</strong>
        <p>{toast.count > 1 ? `${toast.title} and ${toast.count - 1} more.` : toast.body}</p>
        <button type="button" className="notice-toast-view" onClick={onView}>
          {toast.count > 1 ? "See all" : viewLabel}
        </button>
      </div>
      <button type="button" className="notice-toast-close" aria-label="Close notification" onClick={onClose}>
        ×
      </button>
      <span className="notice-toast-bar" aria-hidden="true">
        <i
          key={barKey}
          style={{
            animationDuration: `${TOAST_MS}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      </span>
    </aside>
  );
  return container ? createPortal(node, container) : node;
}

export function NoticeGroups<T extends { id: string; created_at: string }>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => ReactNode;
}) {
  return (
    <>
      {byDay(items).map((group) => (
        <section key={group.label} className="notice-group" aria-label={group.label}>
          <h3>{group.label}</h3>
          <ol className="notice-list">{group.items.map(render)}</ol>
        </section>
      ))}
    </>
  );
}
