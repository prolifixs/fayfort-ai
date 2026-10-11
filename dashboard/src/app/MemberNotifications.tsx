import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { apiRequest } from "../lib/api";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";
import { playMemberSound } from "./memberSound";

export type MemberNotification = {
  id: string;
  notification_type: "request_milestone" | "worker_reply" | "photo_review_status";
  title: string;
  body: string;
  href: string;
  source_id: string;
  created_at: string;
  read_at: string | null;
  banner_dismissed_at: string | null;
};

type NotificationResponse = { notifications: MemberNotification[]; unread_count: number };
function normalizeNotifications(value: Partial<NotificationResponse> | null | undefined): NotificationResponse {
  return {
    notifications: Array.isArray(value?.notifications) ? value.notifications : [],
    unread_count: Number.isFinite(value?.unread_count) ? Math.max(0, Number(value?.unread_count)) : 0,
  };
}

export function MemberNotificationsBar({ accessToken, header = false }: { accessToken: string | null; header?: boolean }) {
  const [data, setData] = useState<NotificationResponse>({ notifications: [], unread_count: 0 });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const previousUnreadIds = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = normalizeNotifications(await apiRequest<NotificationResponse>("/members/notifications?limit=30", accessToken));
      const unreadIds = new Set(next.notifications.filter(item => !item.read_at).map(item => item.id));
      if (previousUnreadIds.current && [...unreadIds].some(id => !previousUnreadIds.current?.has(id))) playMemberSound();
      previousUnreadIds.current = unreadIds;
      setData(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notifications are unavailable.");
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [load]);

  async function openNotification(event: MouseEvent<HTMLAnchorElement>, item: MemberNotification) {
    event.preventDefault();
    setOpen(false);
    try {
      await apiRequest(`/members/notifications/${item.id}/read`, accessToken!, { method: "POST" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The notification could not be marked read.");
    }
    window.location.assign(item.href);
  }
  async function markRead(item: MemberNotification) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await apiRequest(`/members/notifications/${item.id}/read`, accessToken, { method: "POST" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The notification could not be marked read.");
    } finally { setBusy(false); }
  }
  async function markAllRead() {
    if (!accessToken) return;
    setBusy(true);
    try {
      await apiRequest("/members/notifications/read-all", accessToken, { method: "POST" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notifications could not be marked read.");
    } finally { setBusy(false); }
  }
  async function dismiss(item: MemberNotification) {
    try {
      await apiRequest(`/members/notifications/${item.id}/dismiss-banner`, accessToken!, { method: "POST" });
      setData(current => ({ ...current, notifications: current.notifications.map(row => row.id === item.id
        ? { ...row, banner_dismissed_at: new Date().toISOString() } : row) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The activity banner could not be dismissed.");
    }
  }
  if (!accessToken) return null;
  const banner = data.notifications.find(item => !item.read_at && !item.banner_dismissed_at);
  return <div className={header ? "member-notification-area member-notification-area-header" : "member-notification-area"}>
    <div className="member-notification-control">
      <button className="member-notification-bell" type="button" aria-label={`Notifications${data.unread_count ? `, ${data.unread_count} unread` : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
        <span aria-hidden="true">🔔</span><span>Notifications</span>{data.unread_count > 0 && <b>{data.unread_count > 99 ? "99+" : data.unread_count}</b>}
      </button>
      {open && <section className="member-notification-popover" role="dialog" aria-label="Notifications">
        <div className="member-notification-heading"><div><h2>Notifications</h2><p>{data.unread_count ? `${data.unread_count} unread` : "You’re all caught up."}</p></div><button type="button" disabled={busy || data.unread_count === 0} onClick={() => void markAllRead()}>Mark all read</button></div>
        {error && <p className="member-notification-error" role="status">{error}</p>}
        {data.notifications.length === 0 ? <p className="member-notification-popover-empty">No notifications yet.</p> : <ol className="member-notification-list">{data.notifications.map(item => <li key={item.id} className={item.read_at ? "is-read" : "is-unread"}>
          <a href={item.href} onClick={event => void openNotification(event, item)}><span className="member-notification-dot" aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.body}</small><time>{new Date(item.created_at).toLocaleString()}</time></span></a>
          {!item.read_at && <button type="button" disabled={busy} onClick={() => void markRead(item)}>Mark read</button>}
        </li>)}</ol>}
      </section>}
    </div>
    {error && <p className="member-notification-error" role="status">{error}</p>}
    {banner && <aside className="member-activity-banner" aria-label="Recent activity">
      <span aria-hidden="true">●</span><div><strong>{banner.title}</strong><p>{banner.body}</p></div>
      <a href={banner.href} onClick={event => void openNotification(event, banner)}>View</a>
      <button type="button" aria-label="Dismiss activity banner" onClick={() => void dismiss(banner)}>×</button>
    </aside>}
  </div>;
}

export function MemberNotificationsPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<NotificationResponse>({ notifications: [], unread_count: 0 });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (token: string) => {
    setLoading(true);
    setError("");
    try {
      await apiRequest("/members/me", token);
      setAccessToken(token);
      setData(normalizeNotifications(await apiRequest<NotificationResponse>("/members/notifications?limit=100", token)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabaseClient) { setLoading(false); return; }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data: sessionData }) => {
      if (mounted && sessionData.session) void load(sessionData.session.access_token);
      else if (mounted) setLoading(false);
    });
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) void load(session.access_token);
      else { setAccessToken(null); setData({ notifications: [], unread_count: 0 }); setLoading(false); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [load]);

  async function open(item: MemberNotification) {
    if (!accessToken) return;
    try { await apiRequest(`/members/notifications/${item.id}/read`, accessToken, { method: "POST" }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Notification state could not be updated."); }
    window.location.assign(item.href);
  }
  async function markRead(item: MemberNotification) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await apiRequest(`/members/notifications/${item.id}/read`, accessToken, { method: "POST" });
      await load(accessToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Notification could not be marked read."); }
    finally { setBusy(false); }
  }
  async function markAllRead() {
    if (!accessToken) return;
    setBusy(true);
    try {
      await apiRequest("/members/notifications/read-all", accessToken, { method: "POST" });
      await load(accessToken);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Notifications could not be marked read."); }
    finally { setBusy(false); }
  }
  if (!dashboardAuthConfigured) return <main className="auth-page"><section className="auth-card"><h1>Member sign-in is not configured</h1><p>Set up the member authentication environment before viewing notifications.</p></section></main>;
  return <main className="auth-page member-chat-page"><section className="member-chat-shell member-notifications-page">
    <header className="member-chat-header"><a className="brand-mark" href="/member/account" aria-label="Member account">F</a><div><small>FAYFORT MEMBER</small><h1>Notifications</h1></div><a className="secondary-button" href="/member/products">Back to dashboard</a></header>
    {!accessToken && !loading ? <div className="member-chat-empty"><h2>Sign in to view notifications</h2><a className="primary-button" href="/member/account">Member sign in</a></div> : <>
      <MemberNotificationsBar accessToken={accessToken} />
      <section className="member-notification-inbox" aria-label="Your notifications">
        <div className="member-notification-heading"><div><h2>Your activity</h2><p>{data.unread_count ? `${data.unread_count} unread` : "You’re all caught up."}</p></div><button type="button" disabled={busy || loading || data.unread_count === 0} onClick={() => void markAllRead()}>Mark all read</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <p role="status">Loading notifications…</p> : data.notifications.length === 0 ? <p className="member-chat-empty">No notifications yet. Request milestones and worker replies will appear here.</p> : <ol className="member-notification-list">{data.notifications.map(item => <li key={item.id} className={item.read_at ? "is-read" : "is-unread"}>
          <a href={item.href} onClick={event => { event.preventDefault(); void open(item); }}><span className="member-notification-dot" aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.body}</small><time>{new Date(item.created_at).toLocaleString()}</time></span></a>
          {!item.read_at && <button type="button" disabled={busy} onClick={() => void markRead(item)}>Mark read</button>}
        </li>)}</ol>}
      </section>
    </>}
  </section></main>;
}
