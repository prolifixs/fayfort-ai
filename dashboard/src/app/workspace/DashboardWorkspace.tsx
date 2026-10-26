import { ThemeStudioPage } from "../ThemeStudioPage";
import { KnowledgePage } from "../KnowledgePage";
import { ApiRequestError, apiRequest, websocketUrl } from "../../lib/api";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NavIcon, PageErrorBoundary, readable } from "../staff/StaffChrome";
import { DESKTOP, useDismiss, useMediaQuery } from "../ui/useDismiss";
import type { Business, ConversationRow, EventRecord, WorkspaceProps } from "./types";
import { PlatformRequestAssignmentPage } from "../staff/WorkerPages";
import { WorkforcePage } from "../staff/WorkforcePage";
import { StaffAccountPage } from "../staff/StaffAccountPage";
import { EmailCenterPage } from "../staff/EmailCenterPage";
import { CommercePage } from "../staff/CommercePage";
import { AdsPage } from "../staff/AdsPage";
import { WebsitePage } from "../staff/WebsitePage";
import { RevenueTile } from "../staff/RevenuePanel";
import { ConnectionsPage } from "./ConnectionsPage";
import { AutomationsPage } from "./AutomationsPage";
import { AgentAvailabilityPanel, HandoffsPage } from "./HandoffsPage";
import { WorkspaceDataPage } from "./WorkspaceDataPage";
import { DirectoryToolsPage, EntitlementsPage } from "./DirectoryPages";
import { VerificationPage } from "./VerificationPage";
import { SettingsPage } from "./SettingsPage";
import { OperationalModulePage } from "./OperationalModulePage";
import { AnalyticsPage } from "./AnalyticsPage";
import { InfrastructurePage } from "../staff/InfrastructurePage";
import { StaffThemeToggle, useStaffTheme } from "../staff/staffTheme";
import { BrandMark } from "../brand/FayfortLogo";
import { PageHelp } from "../staff/PageHelp";
import { ShiftGate } from "../ShiftGate";
import { ShiftControl } from "../ShiftControl";

export const modules = [
  ["Overview", "Workspace"],
  ["Conversations", "Workspace"],
  ["Customers", "Workspace"],
  ["Requests", "Workspace"],
  ["Directory & Tools", "Operations"],
  ["Channels & Connections", "Operations"],
  ["Automations", "Operations"],
  ["Entitlements", "Operations"],
  ["Verification", "Operations"],
  ["Human Agents", "Operations"],
  ["Knowledge", "Manage"],
  ["Analytics", "Manage"],
  ["Settings", "Manage"],
] as const;

export const descriptions: Record<string, string> = {
  Overview: "Today at a glance for this client account.",
  Conversations: "Customers waiting for a person, and chats a person is handling. Every chat, including ones the AI handled alone, is under Customers → Read chat.",
  Customers: "Customer profiles with their conversations and requests.",
  Requests: "Structured requests, missing information, and lifecycle status.",
  "Directory & Tools": "Curated supplier directory data and who can use it.",
  Channels: "Channel behavior and receiving, auto-reply, and handoff controls.",
  "Channels & Connections": "Connect and verify customer channels like Instagram and Messenger, then watch what they receive.",
  Connections: "External accounts, connection health, and provider lifecycle.",
  Automations: "Rules, schedules, execution history, retries, and failures.",
  Entitlements: "Access grants for this business's directory tools.",
  Verification: "Review unverified directory fields and record approval history.",
  "Human Agents": "Human availability, assignment, takeover, and return to automation.",
  Knowledge: "Business-approved FAQ answers with exact question matching and version history.",
  Analytics: "Saved business-event history with bounded counts and time-window filters.",
  Settings: "Safe business configuration managed through the FayFort control plane.",
  Shop: "Shopify connection, the trend queue and pools, invoices, flash sales, giveaways and orders.",
  "Member Requests": "Assigned member sourcing and purchasing requests with verified milestone updates.",
  "Theme Studio": "Create, preview, publish, and archive member themes using safe design tokens.",
  Infrastructure: "Cloudflare tunnels, public hostnames and webhook endpoints for the FayFort platform.",
  "FayFort Workers": "Add staff (from an existing account or by email), roles, who is online, and each worker's account.",
  "My account": "Your password, sign-in email, sessions and two-step verification.",
  Emails: "What FayFort emails customers, what was sent, and the newsletter.",
};

/** Workers report presence from anywhere in the Control Center, not only Operations Center. */
export const PRESENCE_HEARTBEAT_MS = 45_000;

export const groups = ["Workspace", "Operations", "Manage"];

export function DashboardWorkspace({
  accessToken,
  signedInEmail,
  platformAdmin = false,
  onSignOut,
  eventStreaming = true,
}: WorkspaceProps) {
  const linkedPage = new URLSearchParams(window.location.search).get("page");
  const [active, setActive] = useState(linkedPage === "shop" ? "Shop" : linkedPage === "website" ? "Website" : linkedPage === "workforce" ? "FayFort Workers" : linkedPage === "infrastructure" ? "Infrastructure" : "Overview");
  const [conversationTarget, setConversationTarget] = useState<ConversationRow | null>(null);
  const [requestTargetId, setRequestTargetId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [businessError, setBusinessError] = useState("");
  const [invalidSession, setInvalidSession] = useState(false);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [activeWorker, setActiveWorker] = useState(false);
  const [workerChecked, setWorkerChecked] = useState(false);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventStatus, setEventStatus] = useState("Connecting");
  const [waitingHandoffs, setWaitingHandoffs] = useState<number | null>(null);
  const [pendingWork, setPendingWork] = useState<{ pending: number; overdue: number } | null>(null);
  const [staffTheme, setStaffTheme] = useStaffTheme();
  const [acknowledgedWaiting, setAcknowledgedWaiting] = useState<Record<string, number>>({});
  const eventCursors = useRef<Record<string, number>>({});
  const currentBusiness = businesses.find((item) => item.business_id === businessId);
  const isDesktop = useMediaQuery(DESKTOP);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  useDismiss(drawerOpen && !isDesktop, () => setDrawerOpen(false), [sidebarRef]);
  /** Opens a page and closes the phone menu. */
  const go = (page: string) => {
    setActive(page);
    setDrawerOpen(false);
    document.documentElement.scrollTop = 0;
  };
  useEffect(() => {
    if (!activeWorker || platformAdmin) return;
    const beat = () => {
      if (document.visibilityState === "hidden") return;
      apiRequest("/operations/presence", accessToken, { method: "POST" }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [activeWorker, platformAdmin, accessToken]);

  const loadBusinesses = useCallback(async () => {
    setBusinessLoading(true);
    try {
      const data = await apiRequest<{ businesses: Business[] }>("/dashboard/businesses", accessToken);
      setBusinesses(data.businesses);
      setBusinessError("");
      setInvalidSession(false);
      const operationsLink = new URLSearchParams(window.location.search);
      const linkedBusinessId = operationsLink.get("operationsBusiness");
      const linkedConversationId = operationsLink.get("operationsConversation");
      const linkedBusiness = data.businesses.find((item) => item.business_id === linkedBusinessId);
      setBusinessId(
        (previous) =>
          linkedBusiness?.business_id ||
          (data.businesses.some((item) => item.business_id === previous)
            ? previous
            : data.businesses[0]?.business_id || ""),
      );
      if (linkedBusiness && linkedConversationId) {
        setConversationTarget({ id: linkedConversationId, status: "open", created_at: new Date().toISOString() });
        setActive("Conversations");
      }
    } catch (error) {
      const unauthorized = error instanceof ApiRequestError && error.status === 401;
      setInvalidSession(unauthorized);
      setBusinessError(
        unauthorized
          ? "Your sign-in session could not be verified. Sign out, then sign in again to reconnect this workspace."
          : error instanceof Error
            ? error.message
            : "Could not load client accounts.",
      );
    } finally {
      setBusinessLoading(false);
    }
  }, [accessToken]);
  useEffect(() => {
    void loadBusinesses();
  }, [loadBusinesses]);
  useEffect(() => {
    let alive = true;
    apiRequest<{ worker: { status: string } }>("/workers/me", accessToken)
      .then((result) => {
        if (alive) setActiveWorker(result.worker.status === "active");
      })
      .catch(() => {
        if (alive) setActiveWorker(false);
      })
      .finally(() => {
        if (alive) setWorkerChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!businessId) {
      setWaitingHandoffs(null);
      return;
    }
    let alive = true;
    const refreshWaitingHandoffs = async () => {
      try {
        const data = await apiRequest<{ total: number }>(
          `/businesses/${businessId}/handoffs?status=waiting&limit=1`,
          accessToken,
        );
        if (alive) setWaitingHandoffs(data.total);
      } catch {
        if (alive) setWaitingHandoffs(null);
      }
    };
    void refreshWaitingHandoffs();
    const timer = window.setInterval(() => void refreshWaitingHandoffs(), 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [accessToken, businessId]);

  useEffect(() => {
    if (!businessId) return;
    try {
      const stored = Number(window.sessionStorage.getItem(`fayfort.handoffAck.${businessId}`) || 0);
      setAcknowledgedWaiting((previous) => ({
        ...previous,
        [businessId]: Number.isSafeInteger(stored) && stored >= 0 ? stored : 0,
      }));
    } catch {
      setAcknowledgedWaiting((previous) => ({ ...previous, [businessId]: 0 }));
    }
  }, [businessId]);
  useEffect(() => {
    if (!businessId || waitingHandoffs === null) return;
    const acknowledged = acknowledgedWaiting[businessId] || 0;
    if (waitingHandoffs < acknowledged) {
      setAcknowledgedWaiting((previous) => ({ ...previous, [businessId]: 0 }));
      try {
        window.sessionStorage.setItem(`fayfort.handoffAck.${businessId}`, "0");
      } catch {
        /* Acknowledgement remains in memory for this view. */
      }
    }
  }, [businessId, waitingHandoffs, acknowledgedWaiting]);
  const acknowledgeWaiting = () => {
    if (!businessId || waitingHandoffs === null) return;
    setAcknowledgedWaiting((previous) => ({ ...previous, [businessId]: waitingHandoffs }));
    try {
      window.sessionStorage.setItem(`fayfort.handoffAck.${businessId}`, String(waitingHandoffs));
    } catch {
      /* Acknowledgement remains in memory for this view. */
    }
  };

  useEffect(() => {
    setEvents([]);
    if (!businessId) {
      setEventStatus("Offline");
      return;
    }
    const cursorStorageKey = `fayfort.eventCursor.${businessId}`;
    let storedCursor = 0;
    try {
      storedCursor = Number(window.sessionStorage.getItem(cursorStorageKey) || 0);
    } catch {
      /* Cursor persistence is best-effort when browser storage is blocked. */
    }
    if (Number.isSafeInteger(storedCursor) && storedCursor >= 0)
      eventCursors.current[businessId] = Math.max(eventCursors.current[businessId] || 0, storedCursor);
    if (!eventStreaming) {
      setEventStatus("Disabled");
      return;
    }
    setEventStatus("Connecting");
    let alive = true;
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    const connect = async () => {
      try {
        const { ticket } = await apiRequest<{ ticket: string }>(
          `/businesses/${businessId}/events/ticket`,
          accessToken,
          { method: "POST" },
        );
        if (!alive) return;
        socket = new WebSocket(websocketUrl(`/businesses/${businessId}/events/ws`));
        socket.onopen = () => {
          if (alive) socket?.send(JSON.stringify({ ticket, after_id: eventCursors.current[businessId] || 0 }));
        };
        socket.onmessage = (message) => {
          if (!alive) return;
          const packet = JSON.parse(message.data) as { type: string; event?: EventRecord };
          if (packet.type === "ready") setEventStatus("Live");
          if (packet.type === "event" && packet.event) {
            const eventId = Number(packet.event.id);
            const currentCursor = eventCursors.current[businessId] || 0;
            if (!Number.isSafeInteger(eventId) || eventId <= currentCursor) return;
            eventCursors.current[businessId] = eventId;
            try {
              window.sessionStorage.setItem(cursorStorageKey, String(eventId));
            } catch {
              /* The in-memory cursor still protects this connection. */
            }
            setEvents((previous) =>
              previous.some((item) => item.id === eventId) ? previous : [packet.event!, ...previous].slice(0, 30),
            );
          }
        };
        socket.onerror = () => {
          if (alive) setEventStatus("Reconnecting");
        };
        socket.onclose = () => {
          if (alive) {
            setEventStatus("Reconnecting");
            retryTimer = window.setTimeout(() => void connect(), 2000);
          }
        };
      } catch {
        if (alive) {
          setEventStatus("Offline");
          retryTimer = window.setTimeout(() => void connect(), 5000);
        }
      }
    };
    void connect();
    return () => {
      alive = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [accessToken, businessId, eventStreaming]);

  // Unfinished Operations work this person can see, for the badge on the Operations Center menu item.
  useEffect(() => {
    if (!activeWorker && !platformAdmin) return;
    let alive = true;
    const load = () =>
      apiRequest<{ pending: number; overdue: number }>("/operations/pending-count", accessToken)
        .then((data) => alive && setPendingWork(data))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [activeWorker, platformAdmin, accessToken]);

  const navButton = (label: string, badge?: ReactNode) => (
    <button
      key={label}
      type="button"
      className={active === label ? "nav-item active" : "nav-item"}
      aria-current={active === label ? "page" : undefined}
      onClick={() => go(label)}
    >
      <NavIcon name={label} />
      <span className="nav-label">{label}</span>
      {badge}
    </button>
  );
  const waitingBadge =
    waitingHandoffs !== null && waitingHandoffs > 0 ? (
      <b className="queue-badge" aria-label={`${waitingHandoffs} waiting`}>
        {waitingHandoffs > 99 ? "99+" : waitingHandoffs}
      </b>
    ) : undefined;
  const showAlert = waitingHandoffs !== null && waitingHandoffs > (acknowledgedWaiting[businessId] || 0);
  const gated = !platformAdmin && activeWorker;
  return (
    <ShiftGate accessToken={accessToken} required={gated} pending={!platformAdmin && !workerChecked} onSignOut={onSignOut ? () => void onSignOut() : undefined}>
    <div className={drawerOpen && !isDesktop ? "staff-app shell sidebar-open" : "staff-app shell"}>
      <aside
        id="staff-sidebar"
        className="sidebar staff-sidebar"
        aria-label="Control Center navigation"
        ref={sidebarRef}
        aria-hidden={!isDesktop && !drawerOpen ? true : undefined}
      >
        <div className="staff-sidebar-head">
          <a className="brand" href="#overview" onClick={() => go("Overview")}>
            <BrandMark />
            <span>
              <strong>FayFort</strong>
              <small>CONTROL CENTER</small>
            </span>
          </a>
          {!isDesktop && (
            <button type="button" className="staff-icon-button" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
              <NavIcon name="close" />
            </button>
          )}
        </div>
        {businessLoading ? (
          <div className="business-placeholder">Checking client accounts…</div>
        ) : businesses.length > 0 ? (
          <label className="business-picker">
            <span>Client account</span>
            <select aria-label="Client account" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              {businesses.map((item) => (
                <option key={item.business_id} value={item.business_id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="business-placeholder">{businessError || "No client accounts are available."}</div>
        )}
        <nav aria-label="Main navigation">
          {groups.map((group) => (
            <section key={group} aria-label={group}>
              <h2>{group}</h2>
              {modules
                .filter(([, g]) => g === group)
                .map(([label]) => navButton(label, label === "Human Agents" ? waitingBadge : undefined))}
            </section>
          ))}
          {(activeWorker || platformAdmin) && (
            <section aria-label="Worker requests">
              <h2>{platformAdmin ? "Member work" : "Worker tools"}</h2>
              {platformAdmin && navButton("Member Requests")}
              <a className="nav-item" href="/operations">
                <NavIcon name="Operations Center" />
                <span className="nav-label">Operations Center</span>
                {pendingWork && pendingWork.pending > 0 && (
                  <b
                    className={pendingWork.overdue > 0 ? "queue-badge is-overdue" : "queue-badge is-pending"}
                    aria-label={`${pendingWork.pending} pending${pendingWork.overdue ? `, ${pendingWork.overdue} overdue` : ""}`}
                    title={`${pendingWork.pending} pending${pendingWork.overdue ? ` · ${pendingWork.overdue} overdue` : ""}`}
                  >
                    {pendingWork.pending > 99 ? "99+" : pendingWork.pending}
                  </b>
                )}
              </a>
            </section>
          )}
          {platformAdmin && (
            <section aria-label="Platform administration">
              <h2>Platform admin</h2>
              {["FayFort Workers", "Shop", "Ads", "Website", "Emails", "Theme Studio", "Infrastructure"].map((label) => navButton(label))}
            </section>
          )}
        </nav>
        <footer>
          <span className="staff-events">
            <i className={eventStatus === "Live" ? "event-dot live" : "event-dot"} /> Events {eventStatus}
          </span>
          {navButton("My account")}
          <a className="nav-item" href="/member/chat" title="Your own member account: orders, chats and points">
            <NavIcon name="My account" />
            <span className="nav-label">My member account</span>
          </a>
          <button type="button" className="nav-item" onClick={() => void onSignOut?.()}>
            <NavIcon name="Sign out" />
            <span className="nav-label">Sign out</span>
          </button>
        </footer>
      </aside>
      {!isDesktop && drawerOpen && <div className="staff-scrim" aria-hidden="true" />}
      <main className="staff-main">
        <header className="staff-topbar">
          {!isDesktop && (
            <button
              type="button"
              className="staff-icon-button"
              aria-label="Open menu"
              aria-controls="staff-sidebar"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <NavIcon name="menu" />
            </button>
          )}
          <span className="staff-crumbs">
            <span className="staff-crumb-business">{currentBusiness?.name || "FayFort workspace"}</span>
            <span className="staff-crumb-page">{active}</span>
          </span>
          <div className="header-status">
            {showAlert && (
              <>
                <button
                  type="button"
                  className="queue-alert"
                  onClick={() => go("Human Agents")}
                  aria-label={`${waitingHandoffs} handoffs waiting; open Human Agents queue`}
                >
                  <b>{waitingHandoffs}</b>
                  <span>{waitingHandoffs === 1 ? "handoff waiting" : "handoffs waiting"}</span>
                </button>
                <button type="button" className="staff-ghost-button" onClick={acknowledgeWaiting} aria-label="Mark waiting handoffs as seen">
                  Mark as seen
                </button>
              </>
            )}
            {gated && <ShiftControl accessToken={accessToken} />}
            <StaffThemeToggle theme={staffTheme} onChange={setStaffTheme} />
            {import.meta.env.DEV ? <small className="staff-dev-pill">Dev</small> : null}
          </div>
        </header>
        <div className="staff-page" aria-live="polite">
          <div className="heading">
            <div>
              <h1>{active}</h1>
              <p>{descriptions[active]}</p>
            </div>
          </div>
          <PageHelp key={active} id={active === "Channels" || active === "Connections" ? "Channels & Connections" : active} />
          <PageErrorBoundary page={active}>
          {active === "Theme Studio" && platformAdmin ? (
            <ThemeStudioPage accessToken={accessToken} /> 
          ) : active === "Infrastructure" && platformAdmin ? (
            <InfrastructurePage accessToken={accessToken} />
          ) : active === "FayFort Workers" && platformAdmin ? (
            <WorkforcePage accessToken={accessToken} />
          ) : active === "Emails" && platformAdmin ? (
            <EmailCenterPage accessToken={accessToken} />
          ) : active === "My account" ? (
            <StaffAccountPage accessToken={accessToken} email={signedInEmail || ""} isWorker={activeWorker && !platformAdmin} />
          ) : active === "Shop" && platformAdmin ? (
            <CommercePage
              accessToken={accessToken}
              initialTab={(["overview", "revenue", "products", "trends", "invoices", "sales", "giveaways", "orders", "billing"].includes(new URLSearchParams(window.location.search).get("tab") || "")
                ? new URLSearchParams(window.location.search).get("tab")
                : "overview") as "overview"}
            />
          ) : active === "Ads" && platformAdmin ? (
            <AdsPage accessToken={accessToken} />
          ) : active === "Website" && platformAdmin ? (
            <WebsitePage accessToken={accessToken} />

          ) : active === "Member Requests" && (platformAdmin || activeWorker) ? (
            platformAdmin ? (
              <PlatformRequestAssignmentPage accessToken={accessToken} />
            ) : (
              <div className="empty ops-moved">
                <h2>Member requests moved to the Operations Center</h2>
                <p>Requests, photo reviews and shop work are now one queue with step-by-step guidance.</p>
                <a className="primary-button" href="/operations">
                  Open the Operations Center
                </a>
              </div>
            )
          ) : businessLoading ? (
            <div className="empty" role="status">
              <b>…</b>
              <h2>Loading your workspace</h2>
              <p>Checking FayFort team access.</p>
            </div>
          ) : businessError ? (
            <div className="notice error" role="alert">
              {businessError}
              <div className="record-actions">
                <button onClick={() => void loadBusinesses()}>Retry</button>
                {invalidSession && <button onClick={() => void onSignOut?.()}>Sign out and sign in again</button>}
              </div>
            </div>
          ) : businesses.length === 0 ? (
            <div className="empty">
              <b>!</b>
              <h2>No client accounts are available</h2>
              <p>
                Signed in as {signedInEmail || "this account"}. The Control Center requires an active FayFort worker or
                platform-admin grant. Member accounts do not provide access to the Control Center.
              </p>
              <div className="record-actions">
                <button onClick={() => void loadBusinesses()}>Check again</button>
                <button onClick={() => void onSignOut?.()}>Sign out</button>
              </div>
            </div>
          ) : active === "Overview" ? (
            <Overview
              events={events}
              setActive={go}
              accessToken={accessToken}
              businessId={businessId}
              waitingHandoffs={waitingHandoffs}
              platformAdmin={platformAdmin}
            />
          ) : ["Channels & Connections", "Channels", "Connections"].includes(active) ? (
            <>
              <ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={Boolean(currentBusiness)} />
              <OperationalModulePage module="Channels" accessToken={accessToken} businessId={businessId} />
            </>
          ) : active === "Automations" ? (
            <AutomationsPage accessToken={accessToken} businessId={businessId} />
          ) : active === "Human Agents" ? (
            <>
              <AgentAvailabilityPanel accessToken={accessToken} businessId={businessId} />
              <HandoffsPage accessToken={accessToken} businessId={businessId} />
            </>
          ) : ["Conversations", "Customers", "Requests"].includes(active) ? (
            <WorkspaceDataPage
              module={active}
              accessToken={accessToken}
              businessId={businessId}
              canManage={Boolean(currentBusiness)}
              setActive={setActive}
              conversationTarget={conversationTarget}
              clearConversationTarget={() => setConversationTarget(null)}
              requestTargetId={requestTargetId}
              clearRequestTarget={() => setRequestTargetId(null)}
              openConversationFromCustomer={(conversation) => {
                setConversationTarget(conversation);
                setActive("Conversations");
              }}
              openRequestFromCustomer={(requestId) => {
                setRequestTargetId(requestId);
                setActive("Requests");
              }}
            />
          ) : active === "Directory & Tools" ? (
            <DirectoryToolsPage accessToken={accessToken} businessId={businessId} />
          ) : active === "Entitlements" ? (
            <EntitlementsPage accessToken={accessToken} businessId={businessId} />
          ) : active === "Verification" ? (
            <VerificationPage accessToken={accessToken} businessId={businessId} />
          ) : active === "Knowledge" ? (
            <KnowledgePage accessToken={accessToken} businessId={businessId} canManage={Boolean(currentBusiness)} />
          ) : active === "Settings" ? (
            <SettingsPage accessToken={accessToken} businessId={businessId} canManage={Boolean(currentBusiness)} />

          ) : active === "Analytics" ? (
            <AnalyticsPage accessToken={accessToken} businessId={businessId} />
          ) : (
            <div className="empty">
              <b>{active.slice(0, 1)}</b>
              <h2>{active} is being connected</h2>
              <p>This module will become active when its FastAPI workflow and data access are ready.</p>
              <button onClick={() => setActive("Overview")}>Back to overview</button>
            </div>
          )}
          </PageErrorBoundary>
        </div>
      </main>
    </div>
    </ShiftGate>
  );
}

type OverviewCounts = {
  openConversations: string;
  awaitingCustomer: string;
  activeRequests: string;
  failedRuns: string | null;
};

/** Live numbers for the selected client account, from the same endpoints the pages use. */
export function Overview({
  events,
  setActive,
  accessToken,
  businessId,
  waitingHandoffs,
  platformAdmin = false,
}: {
  events: EventRecord[];
  setActive: (page: string) => void;
  accessToken?: string;
  businessId?: string;
  waitingHandoffs?: number | null;
  platformAdmin?: boolean;
}) {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  useEffect(() => {
    if (!accessToken || !businessId) return;
    let alive = true;
    const countOf = async (path: string, key: string) => {
      try {
        const data = await apiRequest<Record<string, unknown>>(path, accessToken);
        const rows = Array.isArray(data?.[key]) ? (data[key] as unknown[]) : null;
        if (!rows) return "—";
        return `${rows.length}${data.has_more ? "+" : ""}`;
      } catch {
        return "—";
      }
    };
    void Promise.all([
      countOf(`/businesses/${businessId}/conversations?status=open&limit=50&offset=0`, "conversations"),
      countOf(`/businesses/${businessId}/requests?status=awaiting_customer`, "requests"),
      countOf(`/businesses/${businessId}/requests?status=active`, "requests"),
      apiRequest<{ summary?: { failed_runs?: number } }>("/operations/automation-health", accessToken)
        .then((data) => (typeof data?.summary?.failed_runs === "number" ? String(data.summary.failed_runs) : null))
        .catch(() => null),
    ]).then(([openConversations, awaitingCustomer, activeRequests, failedRuns]) => {
      if (alive) setCounts({ openConversations, awaitingCustomer, activeRequests, failedRuns });
    });
    return () => {
      alive = false;
    };
  }, [accessToken, businessId]);
  const tiles: { label: string; value: string; page: string; tone?: string }[] = [
    { label: "Open conversations", value: counts?.openConversations ?? "…", page: "Conversations" },
    {
      label: "Handoffs waiting",
      value: waitingHandoffs === null || waitingHandoffs === undefined ? "—" : String(waitingHandoffs),
      page: "Human Agents",
      tone: waitingHandoffs ? "is-bad" : undefined,
    },
    { label: "Requests awaiting the customer", value: counts?.awaitingCustomer ?? "…", page: "Requests" },
    { label: "Active requests", value: counts?.activeRequests ?? "…", page: "Requests" },
  ];
  if (counts?.failedRuns !== null && counts?.failedRuns !== undefined)
    tiles.push({
      label: "Failed automation runs (recent)",
      value: counts.failedRuns,
      page: "Automations",
      tone: Number(counts.failedRuns) > 0 ? "is-warn" : undefined,
    });
  return (
    <>
      <div className="overview-tiles" aria-label="Today at a glance">
        {tiles.map((tile) => (
          <button key={tile.label} type="button" className={`overview-tile ${tile.tone || ""}`.trim()} onClick={() => setActive(tile.page)}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </button>
        ))}
        {platformAdmin && accessToken && (
          <RevenueTile
            accessToken={accessToken}
            onOpen={() => {
              window.history.replaceState(null, "", "?page=shop&tab=revenue");
              setActive("Shop");
            }}
          />
        )}
      </div>
      <div className="overview-columns">
        <section className="overview-section" aria-label="Recent business activity">
          <h2 className="section-title">Recent activity</h2>
          <div className="event-list">
            {events.length ? (
              events.slice(0, 8).map((item) => (
                <div key={item.id}>
                  <strong>{readable(item.event_type.replaceAll(".", " "))}</strong>
                  <small>{new Date(item.created_at).toLocaleString()}</small>
                </div>
              ))
            ) : (
              <p className="quiet-note">No recent events yet. New activity for this client account appears here.</p>
            )}
          </div>
        </section>
        <section className="overview-section" aria-label="Shortcuts">
          <h2 className="section-title">Go to</h2>
          <div className="overview-links">
            {modules.slice(1).map(([label]) => (
              <button key={label} type="button" onClick={() => setActive(label)}>
                <NavIcon name={label} />
                <span>
                  <strong>{label}</strong>
                  <small>{descriptions[label]}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
