import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import "./operations-notifications.css";
import "./notifications.css";
import { useDismiss } from "./ui/useDismiss";
import { NoticeGroups, NoticeIcon, NoticeToast, timeAgo, type NoticeTone, type ToastNotice } from "./notificationUi";
import { playChosen } from "./notifySounds";
import { SoundPicker } from "./SoundPicker";

type Notice = { id: string; work_item_id: string | null; notification_type: string; title: string; body: string; href: string; read_at: string | null; created_at: string };
type Inbox = { notifications: Notice[]; unread_count: number; sound_enabled: boolean };

const TONE: Record<string, NoticeTone> = {
  assigned: "assign",
  reassigned: "assign",
  member_replied: "message",
  mentioned: "message",
  work_due: "due",
  work_overdue: "alert",
  automation_failed: "alert",
  infrastructure_alert: "alert",
  review_needed: "review",
  review_done: "review",
  member_message: "message",
  new_work: "assign",
  payment_received: "review",
  booking: "due",
  tour_booking: "due",
  work_done: "review",
};
/** These play the urgent sound. */
const URGENT = new Set(["work_overdue", "automation_failed", "infrastructure_alert"]);

export function OperationsNotifications({ accessToken }: { accessToken: string }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [wrapRef]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ringing, setRinging] = useState(false);
  const [toast, setToast] = useState<(ToastNotice & { href: string; id: string }) | null>(null);
  const seenIds = useRef<Set<string> | null>(null);
  const [toastHost, setToastHost] = useState<Element | null>(null);
  useEffect(() => setToastHost(wrapRef.current?.closest(".operations-center-page, .staff-app") || document.body), []);
  const load = useCallback(
    async (announce: boolean) => {
      try {
        const next = await apiRequest<Inbox>("/operations/me/notifications", accessToken);
        const prior = seenIds.current;
        const fresh = prior ? next.notifications.filter((item) => !prior.has(item.id) && !item.read_at) : [];
        seenIds.current = new Set(next.notifications.map((item) => item.id));
        setInbox(next);
        setError("");
        if (announce && fresh.length) {
          const first = fresh[0];
          setToast({ key: fresh.map((item) => item.id).join(","), tone: TONE[first.notification_type] || "info", title: first.title,
            body: first.body, count: fresh.length, href: first.href, id: first.id });
          setRinging(true);
          window.setTimeout(() => setRinging(false), 900);
          if (next.sound_enabled) playChosen("staff", fresh.some((item) => URGENT.has(item.notification_type)));
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Notifications unavailable.");
      }
    },
    [accessToken],
  );
  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 20000);
    return () => window.clearInterval(timer);
  }, [load]);
  const closeToast = useCallback(() => setToast(null), []);

  async function setSound(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/operations/me/notification-preferences", accessToken, { method: "PUT", body: JSON.stringify({ sound_enabled: enabled }) });
      await load(false);
      if (enabled) playChosen("staff");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sound preference could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function updateNotice(item: Notice, action: "read" | "dismiss") {
    try {
      await apiRequest(`/operations/me/notifications/${item.id}`, accessToken, { method: "PATCH", body: JSON.stringify({ action }) });
      await load(false);
      if (action === "read") window.location.assign(item.href);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notification could not be updated.");
    }
  }
  async function markAllRead() {
    setBusy(true);
    try {
      await apiRequest("/operations/me/notifications/read-all", accessToken, { method: "POST" });
      await load(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notifications could not be marked read.");
    } finally {
      setBusy(false);
    }
  }
  async function viewToast() {
    const current = toast;
    setToast(null);
    if (!current) return;
    if (current.count > 1) {
      setOpen(true);
      return;
    }
    const item = inbox?.notifications.find((row) => row.id === current.id);
    if (item) await updateNotice(item, "read");
    else window.location.assign(current.href);
  }
  const unread = inbox?.unread_count || 0;
  return (
    <div className="operations-notifications" ref={wrapRef}>
      <button
        className={`ops-head-button operations-notifications-toggle${ringing ? " is-ringing" : ""}`}
        type="button"
        aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => {
          setToast(null);
          setOpen((value) => !value);
          void load(false);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
        <span>Notifications</span>
        {unread ? <b className="ops-badge">{unread > 99 ? "99+" : unread}</b> : null}
      </button>
      {open && (
        <section className="operations-notifications-popover" aria-label="Worker notifications">
          <header>
            <div>
              <strong>Notifications</strong>
              <small>{unread ? `${unread} unread` : "You're all caught up."}</small>
            </div>
            <button type="button" className="ops-link-button" disabled={busy || !unread} onClick={() => void markAllRead()}>
              Mark all read
            </button>
          </header>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="operations-notifications-body">
            {inbox && !inbox.notifications.length ? (
              <p className="operations-notifications-empty">
                <NoticeIcon tone="info" />
                Nothing yet. Assignments, member replies, mentions, deadlines, reviews and alerts show up here.
              </p>
            ) : inbox?.notifications.length ? (
              <NoticeGroups
                items={inbox.notifications}
                render={(item) => (
                  <li key={item.id} className={item.read_at ? "is-read" : "is-unread"}>
                    <button type="button" className="notice-open operations-notification-open" onClick={() => void updateNotice(item, "read")}>
                      <NoticeIcon tone={TONE[item.notification_type] || "info"} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.body}</small>
                        <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>
                          {timeAgo(item.created_at)}
                        </time>
                      </span>
                    </button>
                    <button type="button" className="notice-dismiss" aria-label="Dismiss notification" onClick={() => void updateNotice(item, "dismiss")}>
                      ×
                    </button>
                  </li>
                )}
              />
            ) : null}
          </div>
          <footer className="operations-notifications-sound">
            <label className="operations-sound-setting">
              <input type="checkbox" checked={inbox?.sound_enabled ?? false} disabled={busy} onChange={(event) => void setSound(event.target.checked)} />
              Sound for new notifications
            </label>
            <details className="operations-sound-options">
              <summary>Sound options</summary>
              <SoundPicker audience="staff" withUrgent disabled={!inbox?.sound_enabled} />
            </details>
          </footer>
        </section>
      )}
      <NoticeToast toast={toast} onView={() => void viewToast()} onClose={closeToast} viewLabel="Open" className="staff-toast" container={toastHost} />
    </div>
  );
}
