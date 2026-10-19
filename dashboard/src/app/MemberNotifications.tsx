import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { apiRequest } from "../lib/api";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";
import { playMemberSound } from "./memberSound";
import { useDismiss } from "./ui/useDismiss";
import { BrandMark, FayfortLoader } from "./brand/FayfortLogo";
import { NoticeGroups, NoticeIcon, NoticeToast, timeAgo, type NoticeTone, type ToastNotice } from "./notificationUi";
import { openChat } from "./member/activeChat";
import "./notifications.css";

export type MemberNotification = {
  id: string;
  notification_type: "request_milestone" | "worker_reply" | "photo_review_status" | "recurring_schedule_update" | "review_invite" | "worker_rating";
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

const MEMBER_TONE: Record<MemberNotification["notification_type"], NoticeTone> = {
  worker_reply: "message",
  request_milestone: "order",
  photo_review_status: "photo",
  recurring_schedule_update: "repeat",
  review_invite: "review",
  worker_rating: "review",
};
function chatOf(href: string): string | null {
  try {
    return new URL(href, window.location.origin).searchParams.get("conversation");
  } catch {
    return null;
  }
}

function MemberNoticeItem({ item, busy, onOpen, onRead }: {
  item: MemberNotification;
  busy: boolean;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, item: MemberNotification) => void;
  onRead: (item: MemberNotification) => void;
}) {
  return <li className={item.read_at ? "is-read" : "is-unread"}>
    <a href={item.href} onClick={event => onOpen(event, item)}>
      <NoticeIcon tone={MEMBER_TONE[item.notification_type] || "info"} />
      <span><strong>{item.title}</strong><small>{item.body}</small><time dateTime={item.created_at}>{timeAgo(item.created_at)}</time></span>
    </a>
    {!item.read_at && <button type="button" className="notice-read" disabled={busy} aria-label={`Mark read: ${item.title}`} title="Mark read" onClick={() => onRead(item)}><span aria-hidden="true">✓</span></button>}
  </li>;
}

export function MemberNotificationsBar({ accessToken, header = false }: { accessToken: string | null; header?: boolean }) {
  const [data, setData] = useState<NotificationResponse>({ notifications: [], unread_count: 0 });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ringing, setRinging] = useState(false);
  // Everything seen so far, so only notices that arrive while the page is open pop up (once, together).
  const known = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<(ToastNotice & { href: string; ids: string[] }) | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [controlRef]);
  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      let next = normalizeNotifications(await apiRequest<NotificationResponse>("/members/notifications?limit=30", accessToken));
      const fresh = known.current
        ? next.notifications.filter(item => !known.current!.has(item.id) && !item.read_at)
        : [];
      known.current = new Set(next.notifications.map(item => item.id));
      // A reply in the chat already on screen is read where it is: no pop-up, no badge.
      const onScreen = openChat();
      const seenHere = fresh.filter(item => onScreen && item.notification_type !== "request_milestone" && chatOf(item.href) === onScreen);
      if (seenHere.length) {
        await Promise.all(seenHere.map(item => apiRequest(`/members/notifications/${item.id}/read`, accessToken, { method: "POST" }).catch(() => undefined)));
        const readIds = new Set(seenHere.map(item => item.id));
        const stamp = new Date().toISOString();
        next = { notifications: next.notifications.map(item => readIds.has(item.id) ? { ...item, read_at: stamp } : item),
                 unread_count: Math.max(0, next.unread_count - seenHere.length) };
      }
      const popUp = fresh.filter(item => !seenHere.includes(item));
      setData(next);
      setError("");
      if (popUp.length) {
        const first = popUp[0];
        playMemberSound();
        setRinging(true);
        window.setTimeout(() => setRinging(false), 900);
        if (header) setToast({ key: popUp.map(item => item.id).join(","), tone: MEMBER_TONE[first.notification_type] || "info",
          title: first.title, body: first.body, count: popUp.length, href: first.href, ids: popUp.map(item => item.id) });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notifications are unavailable.");
    }
  }, [accessToken, header]);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [load]);
  const closeToast = useCallback(() => setToast(null), []);

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
  async function viewToast() {
    if (!toast || !accessToken) return;
    const current = toast;
    setToast(null);
    if (current.count > 1) { setOpen(true); return; }
    try { await apiRequest(`/members/notifications/${current.ids[0]}/read`, accessToken, { method: "POST" }); }
    catch { /* Opening still works; it stays unread in the list. */ }
    window.location.assign(current.href);
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
  // On the notifications page (not the app bar) the newest unread notice stays as a banner until dismissed.
  const banner = header ? undefined : data.notifications.find(item => !item.read_at && !item.banner_dismissed_at);
  return <div className={header ? "member-notification-area member-notification-area-header" : "member-notification-area"}>
    <div className="member-notification-control" ref={controlRef}>
      <button className={`member-notification-bell${ringing ? " is-ringing" : ""}`} type="button" aria-label={`Notifications${data.unread_count ? `, ${data.unread_count} unread` : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setToast(null); setOpen(value => !value); }}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg><span>Notifications</span>{data.unread_count > 0 && <b>{data.unread_count > 99 ? "99+" : data.unread_count}</b>}
      </button>
      {open && <section className="member-notification-popover" role="dialog" aria-label="Notifications">
        <div className="member-notification-heading"><div><h2>Notifications</h2><p>{data.unread_count ? `${data.unread_count} unread` : "You’re all caught up."}</p></div><button type="button" disabled={busy || data.unread_count === 0} onClick={() => void markAllRead()}>Mark all read</button></div>
        {error && <p className="member-notification-error" role="status">{error}</p>}
        {data.notifications.length === 0
          ? <p className="member-notification-popover-empty"><NoticeIcon tone="info" />No notifications yet. Order updates and messages from the FayFort team show up here.</p>
          : <NoticeGroups items={data.notifications} render={item => <MemberNoticeItem key={item.id} item={item} busy={busy} onOpen={(event, row) => void openNotification(event, row)} onRead={row => void markRead(row)} />} />}
      </section>}
    </div>
    {error && <p className="member-notification-error" role="status">{error}</p>}
    {header && <NoticeToast toast={toast} onView={() => void viewToast()} onClose={closeToast} className="member-toast" />}
    {banner && <aside className="member-activity-banner" aria-label="Recent activity">
      <NoticeIcon tone={MEMBER_TONE[banner.notification_type] || "info"} /><div><strong>{banner.title}</strong><p>{banner.body}</p></div>
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
    <header className="member-chat-header"><BrandMark href="/member/account" label="Member account" /><div><small>FAYFORT MEMBER</small><h1>Notifications</h1></div><a className="secondary-button" href="/member/products">Back to dashboard</a></header>
    {!accessToken && !loading ? <div className="member-chat-empty"><h2>Sign in to view notifications</h2><a className="primary-button" href="/member/account">Member sign in</a></div> : <>
      <MemberNotificationsBar accessToken={accessToken} />
      <section className="member-notification-inbox" aria-label="Your notifications">
        <div className="member-notification-heading"><div><h2>Your activity</h2><p>{data.unread_count ? `${data.unread_count} unread` : "You’re all caught up."}</p></div><button type="button" disabled={busy || loading || data.unread_count === 0} onClick={() => void markAllRead()}>Mark all read</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <FayfortLoader label="Loading notifications…" /> : data.notifications.length === 0 ? <p className="member-chat-empty">No notifications yet. Request milestones and worker replies will appear here.</p> : <NoticeGroups items={data.notifications} render={item => <MemberNoticeItem key={item.id} item={item} busy={busy} onOpen={(event, row) => { event.preventDefault(); void open(row); }} onRead={row => void markRead(row)} />} />}
      </section>
    </>}
  </section></main>;
}
