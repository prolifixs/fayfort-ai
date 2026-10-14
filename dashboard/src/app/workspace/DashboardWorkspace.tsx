import { ThemeStudioPage } from "../ThemeStudioPage";
import { KnowledgePage } from "../KnowledgePage";
import { ApiRequestError, apiRequest, websocketUrl } from "../../lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Business, ConversationRow, EventRecord, WorkspaceProps } from "./types";
import { PlatformRequestAssignmentPage, WorkerRequestsPage } from "../staff/WorkerPages";
import { WorkforcePage } from "../staff/WorkforcePage";
import { StaffAccountPage } from "../staff/StaffAccountPage";
import { EmailCenterPage } from "../staff/EmailCenterPage";
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

export const modules = [
  ["Overview", "Workspace"],
  ["Conversations", "Workspace"],
  ["Customers", "Workspace"],
  ["Requests", "Workspace"],
  ["Directory & Tools", "Operations"],
  ["Channels", "Operations"],
  ["Connections", "Operations"],
  ["Automations", "Operations"],
  ["Entitlements", "Operations"],
  ["Verification", "Operations"],
  ["Human Agents", "Operations"],
  ["Knowledge", "Manage"],
  ["Analytics", "Manage"],
  ["Settings", "Manage"],
] as const;

export const descriptions: Record<string, string> = {
  Overview: "A clear view of conversations, requests, channels, handoffs, and automation health.",
  Conversations: "Review customer conversations with operational context alongside the chat.",
  Customers: "Customer profiles and history from Layer 5.",
  Requests: "Structured requests, missing information, and lifecycle status.",
  "Directory & Tools": "Curated directory data and Layer 6 access controls.",
  Channels: "Channel behavior and receiving, auto-reply, and handoff controls.",
  Connections: "External accounts, connection health, and provider lifecycle.",
  Automations: "Rules, schedules, execution history, retries, and failures.",
  Entitlements: "Business access grants consumed by Layer 6.",
  Verification: "Review unverified directory fields and record approval history.",
  "Human Agents": "Human availability, assignment, takeover, and return to automation.",
  Knowledge: "Business-approved FAQ answers with exact question matching and version history.",
  Analytics: "Saved business-event history with bounded counts and time-window filters.",
  Settings: "Safe business configuration managed through the FayFort control plane.",
  Giveaways: "A staff workspace for future giveaway management.",
  "Member Requests": "Assigned member sourcing and purchasing requests with verified milestone updates.",
  "Theme Studio": "Create, preview, publish, and archive member themes using safe design tokens.",
  Infrastructure: "Cloudflare tunnels, public hostnames and webhook endpoints for the FayFort platform.",
  "FayFort Workers": "Invite workers, see who is online, and manage each worker's account.",
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
  const [active, setActive] = useState("Overview");
  const [conversationTarget, setConversationTarget] = useState<ConversationRow | null>(null);
  const [requestTargetId, setRequestTargetId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [businessError, setBusinessError] = useState("");
  const [invalidSession, setInvalidSession] = useState(false);
  const [businessLoading, setBusinessLoading] = useState(true);
  const [activeWorker, setActiveWorker] = useState(false);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventStatus, setEventStatus] = useState("Connecting");
  const [waitingHandoffs, setWaitingHandoffs] = useState<number | null>(null);
  const [acknowledgedWaiting, setAcknowledgedWaiting] = useState<Record<string, number>>({});
  const eventCursors = useRef<Record<string, number>>({});
  const currentBusiness = businesses.find((item) => item.business_id === businessId);
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActive("Overview")}>
          <b className="brand-mark">F</b>
          <span>
            <strong>FayFort</strong>
            <small>CONTROL CENTER</small>
          </span>
        </a>
        {businessLoading ? (
          <div className="business-placeholder">Checking client accounts…</div>
        ) : businesses.length > 0 ? (
          <label className="business-picker">
            <span>CLIENT ACCOUNT</span>
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
                .map(([label]) => (
                  <button
                    key={label}
                    className={active === label ? "nav-item active" : "nav-item"}
                    aria-current={active === label ? "page" : undefined}
                    onClick={() => setActive(label)}
                  >
                    <span>{label.slice(0, 1)}</span>
                    {label}
                    {label === "Human Agents" && waitingHandoffs !== null && waitingHandoffs > 0 && (
                      <b className="queue-badge" aria-label={`${waitingHandoffs} waiting`}>
                        {waitingHandoffs > 99 ? "99+" : waitingHandoffs}
                      </b>
                    )}
                  </button>
                ))}
            </section>
          ))}
          {(activeWorker || platformAdmin) && (
            <section aria-label="Worker requests">
              <h2>{platformAdmin ? "Member work" : "Worker tools"}</h2>
              <button
                className={active === "Member Requests" ? "nav-item active" : "nav-item"}
                aria-current={active === "Member Requests" ? "page" : undefined}
                onClick={() => setActive("Member Requests")}
              >
                <span>R</span>Member Requests
              </button>
              <a className="nav-item" href="/operations">
                <span>O</span>Operations Center
              </a>
            </section>
          )}
          {(platformAdmin || activeWorker) && (
            <section aria-label="Platform administration">
              <h2>{platformAdmin ? "Platform admin" : "Platform"}</h2>
              {platformAdmin && (
                <>
                  <button
                    className={active === "FayFort Workers" ? "nav-item active" : "nav-item"}
                    aria-current={active === "FayFort Workers" ? "page" : undefined}
                    onClick={() => setActive("FayFort Workers")}
                  >
                    <span>W</span>FayFort Workers
                  </button>
                  <button
                    className={active === "Emails" ? "nav-item active" : "nav-item"}
                    aria-current={active === "Emails" ? "page" : undefined}
                    onClick={() => setActive("Emails")}
                  >
                    <span>E</span>Emails
                  </button>
                  <button
                    className={active === "Theme Studio" ? "nav-item active" : "nav-item"}
                    aria-current={active === "Theme Studio" ? "page" : undefined}
                    onClick={() => setActive("Theme Studio")}
                  >
                    <span>T</span>Theme Studio
                  </button>
                  <button
                    className={active === "Infrastructure" ? "nav-item active" : "nav-item"}
                    aria-current={active === "Infrastructure" ? "page" : undefined}
                    onClick={() => setActive("Infrastructure")}
                  >
                    <span>I</span>Infrastructure
                  </button>
                </>
              )}
              <button
                className={active === "Giveaways" ? "nav-item active" : "nav-item"}
                aria-current={active === "Giveaways" ? "page" : undefined}
                onClick={() => setActive("Giveaways")}
              >
                <span>G</span>Giveaways
              </button>
            </section>
          )}
        </nav>
        <footer>
          <i className={eventStatus === "Live" ? "event-dot live" : "event-dot"} /> Events {eventStatus}
          <button
            className="signout-button"
            aria-current={active === "My account" ? "page" : undefined}
            onClick={() => setActive("My account")}
          >
            My account
          </button>
          <button className="signout-button" onClick={() => void onSignOut?.()}>
            Sign out
          </button>
        </footer>
      </aside>
      <main>
        <header>
          <span>
            {currentBusiness?.name || "FayFort workspace"} <em>/</em> {active}
          </span>
          <div className="header-status">
            {waitingHandoffs !== null && waitingHandoffs > (acknowledgedWaiting[businessId] || 0) && (
              <>
                <button
                  className="queue-alert"
                  onClick={() => setActive("Human Agents")}
                  aria-label={`${waitingHandoffs} handoffs waiting; open Human Agents queue`}
                >
                  {waitingHandoffs} {waitingHandoffs === 1 ? "handoff" : "handoffs"} waiting · Open queue
                </button>
                <button type="button" onClick={acknowledgeWaiting} aria-label="Mark waiting handoffs as seen">
                  Mark as seen
                </button>
              </>
            )}
            {import.meta.env.DEV ? <small>DEVELOPMENT</small> : null}
          </div>
        </header>
        <article aria-live="polite">
          <div className="heading">
            <div>
              <label>FAYFORT WORKSPACE</label>
              <h1>{active}</h1>
              <p>{descriptions[active]}</p>
            </div>
            <mark>Layer 7 build</mark>
          </div>
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
          ) : active === "Giveaways" && (platformAdmin || activeWorker) ? (
            <section className="empty" aria-label="Giveaways workspace">
              <b>G</b>
              <h2>No giveaways yet</h2>
              <p>
                This staff section is ready for future giveaway records. Uploads, campaigns, entries, winner selection,
                and messaging have not been added.
              </p>
            </section>
          ) : active === "Member Requests" && (platformAdmin || activeWorker) ? (
            platformAdmin ? (
              <PlatformRequestAssignmentPage accessToken={accessToken} />
            ) : (
              <WorkerRequestsPage accessToken={accessToken} />
            )
          ) : businessLoading ? (
            <div className="empty" role="status">
              <b>�</b>
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
            <Overview events={events} setActive={setActive} />
          ) : active === "Connections" ? (
            <ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={Boolean(currentBusiness)} />
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
          ) : active === "Channels" ? (
            <>
              <ConnectionsPage accessToken={accessToken} businessId={businessId} canManage={Boolean(currentBusiness)} />
              <OperationalModulePage module="Channels" accessToken={accessToken} businessId={businessId} />
            </>
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
        </article>
      </main>
    </div>
  );
}

export function Overview({ events, setActive }: { events: EventRecord[]; setActive: (page: string) => void }) {
  return (
    <>
      <div className="welcome">
        <label>CONTROL PLANE</label>
        <h2>Your operations, in one place</h2>
        <p>The Control Center uses your FayFort team sign-in to access managed client accounts.</p>
      </div>
      <h2 className="section-title">
        Workspace modules <small>Connected as they are built</small>
      </h2>
      <div className="cards">
        {modules.slice(1).map(([label]) => (
          <button key={label} onClick={() => setActive(label)}>
            <b>{label.slice(0, 1)}</b>
            <span>
              <strong>{label}</strong>
              <small>{descriptions[label]}</small>
            </span>
            <i>↗</i>
          </button>
        ))}
      </div>
      <h2 className="section-title">
        Recent activity <small>Live event stream</small>
      </h2>
      <div className="event-list" aria-label="Recent business activity">
        {events.length ? (
          events.slice(0, 8).map((item) => (
            <div key={item.id}>
              <strong>{item.event_type}</strong>
              <small>{new Date(item.created_at).toLocaleString()}</small>
            </div>
          ))
        ) : (
          <p>Waiting for business events.</p>
        )}
      </div>
    </>
  );
}
