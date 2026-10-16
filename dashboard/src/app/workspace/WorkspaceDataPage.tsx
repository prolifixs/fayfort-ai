import { apiRequest } from "../../lib/api";
import { useCallback, useEffect, useState } from "react";
import { StaffChatThread, fromBusinessMessage } from "../staff/StaffChatThread";
import { ShortId, readable } from "../staff/StaffChrome";
import type {
  ConversationDetail,
  ConversationRow,
  CustomerConversationRow,
  CustomerDetail,
  CustomerRow,
  Handoff,
  MessageRow,
  RequestRow,
} from "./types";

export function WorkspaceDataPage({
  module,
  accessToken,
  businessId,
  canManage = false,
  setActive,
  conversationTarget,
  clearConversationTarget,
  requestTargetId,
  clearRequestTarget,
  openConversationFromCustomer,
  openRequestFromCustomer,
}: {
  module: string;
  accessToken: string;
  businessId: string;
  canManage?: boolean;
  setActive: (page: string) => void;
  conversationTarget: CustomerConversationRow | null;
  clearConversationTarget: () => void;
  requestTargetId: string | null;
  clearRequestTarget: () => void;
  openConversationFromCustomer: (conversation: CustomerConversationRow) => void;
  openRequestFromCustomer: (requestId: string) => void;
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [conversationStatus, setConversationStatus] = useState("");
  const [conversationChannel, setConversationChannel] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationOffset, setConversationOffset] = useState(0);
  const [conversationHasMore, setConversationHasMore] = useState(false);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [requestStatus, setRequestStatus] = useState("");
  const [focusedRequestId, setFocusedRequestId] = useState<string | null>(null);
  const [loadedModule, setLoadedModule] = useState("");
  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [relatedCustomer, setRelatedCustomer] = useState<CustomerRow | null>(null);
  const [relatedRequests, setRelatedRequests] = useState<ConversationDetail["requests"]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [clockNow, setClockNow] = useState(Date.now());
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [requestBusy, setRequestBusy] = useState("");
  const [retryBusy, setRetryBusy] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadedModule("");
    setError("");
    try {
      if (module === "Conversations") {
        // Only chats that need a person; every chat's full history is on its customer's page.
        const params = new URLSearchParams({ limit: "50", offset: String(conversationOffset), needs_person: "true" });
        if (conversationStatus) params.set("status", conversationStatus);
        if (conversationChannel.trim()) params.set("channel", conversationChannel.trim());
        const data = await apiRequest<{ conversations: ConversationRow[]; has_more: boolean }>(
          `/businesses/${businessId}/conversations?${params.toString()}`,
          accessToken,
        );
        setConversations(data.conversations);
        setConversationHasMore(data.has_more);
      } else if (module === "Customers") {
        const data = await apiRequest<{ customers: CustomerRow[] }>(`/businesses/${businessId}/customers`, accessToken);
        setCustomers(data.customers);
      } else {
        const params = new URLSearchParams();
        if (requestStatus) params.set("status", requestStatus);
        const data = await apiRequest<{ requests: RequestRow[] }>(
          `/businesses/${businessId}/requests?${params.toString()}`,
          accessToken,
        );
        setRequests(data.requests);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${module} could not be loaded.`);
    } finally {
      setLoading(false);
      setLoadedModule(module);
    }
  }, [accessToken, businessId, module, conversationOffset, conversationStatus, conversationChannel, requestStatus]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!handoff || !["requested", "assigned"].includes(handoff.status)) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [handoff]);
  async function updateRequestStatus(item: RequestRow, status: string) {
    setRequestBusy(item.id);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/requests/${item.id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request status could not be changed.");
    } finally {
      setRequestBusy("");
    }
  }
  async function updateRequestFields(item: RequestRow, updates: Record<string, unknown>) {
    setRequestBusy(item.id);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/requests/${item.id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request update failed.");
    } finally {
      setRequestBusy("");
    }
  }
  const visibleConversations = conversations.filter(
    (item) =>
      !conversationSearch.trim() ||
      [item.customer_name, item.customer_username, item.customer_external_id, item.summary].some((value) =>
        String(value || "")
          .toLocaleLowerCase()
          .includes(conversationSearch.trim().toLocaleLowerCase()),
      ),
  );
  async function openConversation(item: ConversationRow) {
    if (item.id !== selected?.id) setReply("");
    setSelected(item);
    setDetailLoading(true);
    setDetailError("");
    try {
      const [data, hd] = await Promise.all([
        apiRequest<{ messages: MessageRow[] } & ConversationDetail>(
          `/businesses/${businessId}/conversations/${item.id}/messages`,
          accessToken,
        ),
        apiRequest<{ handoffs: Handoff[] }>(`/businesses/${businessId}/handoffs`, accessToken),
      ]);
      const missing = [] as string[];
      if (!data || !Array.isArray(data.messages)) missing.push("messages");
      if (!data || !Array.isArray(data.requests)) missing.push("related requests");
      if (!data || !("customer" in data)) missing.push("customer profile");
      if (!hd || !Array.isArray(hd.handoffs)) missing.push("handoffs");
      if (missing.length)
        throw new Error(
          `Conversation details are missing ${missing.join(", ")}. Confirm the dashboard API is running the current code and retry.`,
        );
      const messages = data.messages.map((message) => ({
        ...message,
        content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
        delivery: message.delivery
          ? {
              ...message.delivery,
              status: typeof message.delivery.status === "string" ? message.delivery.status : "unknown",
            }
          : null,
      }));
      setMessages(messages);
      setRelatedCustomer(data.customer);
      setRelatedRequests(data.requests);
      setHandoffs(hd.handoffs);
      setHandoff(
        hd.handoffs.find(
          (h) => h.conversation_id === item.id && ["requested", "assigned", "active"].includes(h.status),
        ) || null,
      );
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Conversation details could not be loaded.");
      setMessages([]);
      setRelatedCustomer(null);
      setRelatedRequests([]);
      setHandoff(null);
    } finally {
      setDetailLoading(false);
    }
  }
  useEffect(() => {
    if (module === "Conversations" && conversationTarget) {
      void openConversation(conversationTarget);
      clearConversationTarget();
    }
  }, [module, conversationTarget]);
  useEffect(() => {
    if (module !== "Requests" || !requestTargetId || loading || loadedModule !== "Requests") return;
    if (requests.some((item) => item.id === requestTargetId)) setFocusedRequestId(requestTargetId);
    else setError("That customer request is not in the loaded request list.");
    clearRequestTarget();
  }, [module, requestTargetId, loading, loadedModule, requests]);
  async function retryDelivery(message: MessageRow) {
    if (!selected || !message.delivery) return;
    setRetryBusy(message.id);
    setDetailError("");
    try {
      await apiRequest(
        "/businesses/" + businessId + "/channel-deliveries/" + message.delivery.id + "/retry",
        accessToken,
        { method: "POST" },
      );
      await openConversation(selected);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Delivery retry could not be completed.");
    } finally {
      setRetryBusy("");
    }
  }
  /** Staff replies go through the active handoff, the same route the Human Agents queue uses. */
  async function sendReply() {
    if (!selected || !handoff || handoff.status !== "active" || !reply.trim()) return;
    setReplyBusy(true);
    setDetailError("");
    try {
      await apiRequest(`/businesses/${businessId}/handoffs/${handoff.id}/messages`, accessToken, {
        method: "POST",
        body: JSON.stringify({ content: reply.trim() }),
      });
      setReply("");
      await openConversation(selected);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Your reply could not be sent.");
    } finally {
      setReplyBusy(false);
    }
  }
  async function requestHumanHandoff() {
    if (!selected) return;
    setHandoffBusy(true);
    setDetailError("");
    try {
      const d = await apiRequest<{ handoff: Handoff }>(
        `/businesses/${businessId}/handoffs?conversation_id=${encodeURIComponent(selected.id)}`,
        accessToken,
        { method: "POST", body: JSON.stringify({ reason: "customer_requested" }) },
      );
      setHandoff(d.handoff);
      setHandoffs((p) => [d.handoff, ...p]);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Human handoff could not be requested.");
    } finally {
      setHandoffBusy(false);
    }
  }
  const queue = [...handoffs]
    .filter((h) => h.status === "requested")
    .sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));
  const position = handoff?.status === "requested" ? queue.findIndex((h) => h.id === handoff.id) + 1 : 0;
  const timerEnd = handoff?.status === "active" && handoff.updated_at ? Date.parse(handoff.updated_at) : clockNow;
  const seconds = handoff ? Math.max(0, Math.floor((timerEnd - Date.parse(handoff.requested_at)) / 1000)) : 0;
  const timer = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <section
      className={
        module === "Conversations" && selected ? "control-panel conversation-workspace has-selection" : "control-panel conversation-workspace"
      }
      aria-label={`${module} workspace`}
    >
      <div className="panel-heading">
        <div>
          <h2 className="sr-only">{module}</h2>
          <p>
            {module === "Conversations"
              ? "Only chats that need a person are listed here."
              : module === "Customers"
                ? "Customer profiles and channels seen by this business."
                : "Structured customer requests, missing information, and current status."}
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {module === "Conversations" && (
        <div className="record-actions conversation-filters">
          <label>
            Status
            <select
              aria-label="Filter conversations by status"
              value={conversationStatus}
              onChange={(e) => {
                setConversationOffset(0);
                setConversationStatus(e.target.value);
              }}
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label>
            Channel
            <input
              aria-label="Filter conversations by channel"
              maxLength={50}
              value={conversationChannel}
              onChange={(e) => {
                setConversationOffset(0);
                setConversationChannel(e.target.value);
              }}
              placeholder="All channels (e.g. instagram)"
            />
          </label>
          <label>
            Search this page
            <input
              aria-label="Search loaded conversations"
              maxLength={100}
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder="Customer, username, ID or summary"
            />
          </label>
        </div>
      )}
      {module === "Requests" && (
        <div className="record-actions conversation-filters">
          <label>
            Status
            <select
              aria-label="Filter requests by status"
              value={requestStatus}
              onChange={(e) => setRequestStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {["active", "awaiting_customer", "completed", "cancelled", "superseded"].map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {loading ? (
        <p role="status">Loading {module.toLowerCase()}…</p>
      ) : module === "Conversations" ? (
        conversations.length === 0 ? (
          <p className="empty-copy">
            {conversationOffset > 0 || conversationStatus || conversationChannel.trim()
              ? "No chats needing a person match these filters."
              : "No chats need a person right now. The AI is handling them; open Customers to read any chat's history."}
          </p>
        ) : (
          <div className={selected ? "workspace-split inbox has-selection" : "workspace-split inbox"}>
            <div className="record-list inbox-list" aria-label="Conversation list">
              {visibleConversations.length === 0 ? (
                <p className="empty-copy">No conversations on this page match that search.</p>
              ) : (
                visibleConversations.map((item) => (
                  <button
                    className={selected?.id === item.id ? "record selected-record" : "record"}
                    key={item.id}
                    onClick={() => void openConversation(item)}
                  >
                    <span className="inbox-row">
                      <span className="inbox-row-top">
                        <strong>{item.customer_name || item.customer_external_id || "Customer"}</strong>
                        <time dateTime={item.last_message_at || item.created_at}>
                          {shortWhen(item.last_message_at || item.created_at)}
                        </time>
                      </span>
                      <small className="inbox-row-meta">
                        {readable(item.channel || item.platform || "Unknown channel")}
                        {item.customer_username ? ` · ${item.customer_username}` : ""}
                        {item.handoff_status ? (
                          <span className={item.handoff_status === "requested" ? "status-pill is-warn" : "status-pill is-good"}>
                            {item.handoff_status === "requested" ? "Waiting for a person" : item.handoff_status === "assigned" ? "Assigned" : "Person replying"}
                          </span>
                        ) : (
                          <span className={item.status === "open" ? "status-pill is-good" : "status-pill"}>{readable(item.status)}</span>
                        )}
                      </small>
                      {item.summary && <small className="inbox-row-preview">{item.summary}</small>}
                    </span>
                  </button>
                ))
              )}
              <div className="record-actions inbox-pager">
                <button
                  disabled={conversationOffset === 0 || loading}
                  onClick={() => setConversationOffset(Math.max(0, conversationOffset - 50))}
                >
                  Previous page
                </button>
                <small>
                  {conversationOffset + 1}–{conversationOffset + conversations.length}
                  {conversationHasMore ? "+" : ""}
                </small>
                <button
                  disabled={!conversationHasMore || loading}
                  onClick={() => setConversationOffset(conversationOffset + 50)}
                >
                  Next page
                </button>
              </div>
            </div>
            <div className="message-panel conversation-detail">
              {!selected ? (
                <p className="empty-copy">Select a conversation to view its messages.</p>
              ) : (
                <>
                  <button type="button" className="inbox-back" onClick={() => setSelected(null)}>
                    ← All conversations
                  </button>
                  <div className="conversation-detail-head">
                    <div>
                      <h3>{selected.customer_name || selected.customer_external_id || "Customer"}</h3>
                      <p>
                        {readable(selected.channel || selected.platform || "Unknown channel")}
                        {selected.customer_username ? ` · ${selected.customer_username}` : ""}
                      </p>
                    </div>
                    <span className={selected.status === "open" ? "status-pill is-good" : "status-pill"}>
                      {readable(selected.status)}
                    </span>
                  </div>
                  <div className="conversation-body">
                  <aside className="conversation-side" aria-label="Conversation context">
                  <div className="conversation-context">
                    {relatedCustomer ? (
                      <button type="button" onClick={() => setActive("Customers")}>
                        Customer profile ·{" "}
                        {String(
                          relatedCustomer.profile?.name ||
                            relatedCustomer.profile?.full_name ||
                            relatedCustomer.external_customer_id,
                        )}
                      </button>
                    ) : (
                      <span className="quiet-note">No customer profile is linked to this conversation.</span>
                    )}
                    {relatedRequests.length > 0 ? (
                      <button type="button" onClick={() => setActive("Requests")}>
                        Open {relatedRequests.length} related request{relatedRequests.length === 1 ? "" : "s"}
                      </button>
                    ) : (
                      <span className="quiet-note">No related requests.</span>
                    )}
                    {handoff && (
                      <button type="button" onClick={() => setActive("Human Agents")}>
                        Open Human Agents queue
                      </button>
                    )}
                  </div>
                  {relatedRequests.length > 0 && (
                    <div className="related-requests" aria-label="Related requests">
                      {relatedRequests.map((request) => (
                        <div className="related-request" key={request.id}>
                          <strong>{readable(request.request_type)}</strong>
                          <span className="status-pill is-warn">{readable(request.status)}</span>
                          <small>
                            Missing:{" "}
                            {request.missing_information?.length
                              ? request.missing_information.map(readable).join(", ")
                              : "nothing"}
                          </small>
                          <ShortId id={request.id} label="Request" />
                        </div>
                      ))}
                    </div>
                  )}
                  {detailError && (
                    <p className="form-error" role="alert">
                      {detailError}
                    </p>
                  )}
                  {!detailLoading && module === "Conversations" && (
                    <div className={handoff ? "handoff-status" : "handoff-start"}>
                      {handoff ? (
                        <>
                          <strong>
                            Human handoff <span className="status-pill is-info">{readable(handoff.status)}</span>
                          </strong>
                          <span>
                            {handoff.status === "active" ? "Waited " : "Waiting "}
                            {timer}
                            {position ? ` · queue position ${position}` : ""}
                            {handoff.assigned_to ? ` · assigned to ${handoff.assigned_to}` : ""}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>No human takeover requested.</span>
                          <button disabled={handoffBusy} onClick={() => void requestHumanHandoff()}>
                            {handoffBusy ? "Requesting…" : "Request human takeover"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  </aside>
                  {detailLoading ? (
                    <p role="status">Loading messages…</p>
                  ) : (
                    <StaffChatThread
                      label="Conversation messages"
                      emptyText="No messages recorded in this conversation."
                      messages={messages.map((message) =>
                        fromBusinessMessage(message, {
                          meta: message.delivery ? (
                            <span className={message.delivery.status === "rejected" ? "is-bad" : undefined}>
                              {readable(message.delivery.status)}
                              {message.delivery.safe_error_code ? ` · ${readable(message.delivery.safe_error_code)}` : ""}
                            </span>
                          ) : undefined,
                          action:
                            canManage &&
                            message.delivery?.status === "rejected" &&
                            message.delivery.safe_error_code !== "response_window_expired" ? (
                              <button
                                type="button"
                                disabled={retryBusy === message.id}
                                onClick={() => void retryDelivery(message)}
                              >
                                {retryBusy === message.id ? "Retrying…" : "Retry rejected delivery"}
                              </button>
                            ) : undefined,
                        }),
                      )}
                      composer={
                        handoff?.status === "active"
                          ? {
                              id: "conversation-reply",
                              label: "Reply to customer",
                              value: reply,
                              onChange: setReply,
                              onSubmit: (event) => {
                                event.preventDefault();
                                void sendReply();
                              },
                              busy: replyBusy,
                              placeholder: `Reply to ${selected.customer_name || "the customer"}…`,
                              note: "Sent through the connected channel. Delivery status shows under your message.",
                            }
                          : null
                      }
                      footer={
                        handoff?.status === "active" ? null : (
                          <p className="staff-thread-footer">
                            {handoff
                              ? "You can reply here once this handoff is taken over."
                              : "The AI is handling this conversation. Request a human takeover to reply yourself."}
                          </p>
                        )
                      }
                    />
                  )}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      ) : module === "Customers" ? (
        <CustomerWorkspace
          customers={customers}
          accessToken={accessToken}
          businessId={businessId}
          setActive={setActive}
          openConversation={openConversationFromCustomer}
          openRequest={openRequestFromCustomer}
        />
      ) : (
        <RequestWorkspace
          requests={requests}
          accessToken={accessToken}
          businessId={businessId}
          busyId={requestBusy}
          focusedId={focusedRequestId}
          onUpdateStatus={(item, status) => void updateRequestStatus(item, status)}
          onUpdateFields={(item, updates) => void updateRequestFields(item, updates)}
        />
      )}
    </section>
  );
}

function statusTone(status: string) {
  if (["completed", "open", "active"].includes(status)) return "status-pill is-good";
  if (["awaiting_customer", "requested", "pending"].includes(status)) return "status-pill is-warn";
  if (["cancelled", "failed", "rejected"].includes(status)) return "status-pill is-bad";
  return "status-pill";
}

/** "4:12 PM" today, "Tue" this week, otherwise "Oct 3". */
function shortWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - date.getTime() < 6 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RequestWorkspace({
  requests,
  accessToken,
  businessId,
  busyId,
  focusedId,
  onUpdateStatus,
  onUpdateFields,
}: {
  requests: RequestRow[];
  accessToken: string;
  businessId: string;
  busyId: string;
  focusedId: string | null;
  onUpdateStatus: (item: RequestRow, status: string) => void;
  onUpdateFields: (item: RequestRow, updates: Record<string, unknown>) => void;
}) {
  return (
    <div className="record-list" aria-label="Structured customer requests">
      {requests.length === 0 ? (
        <p className="empty-copy">No structured requests match this status.</p>
      ) : (
        requests.map((item) => (
          <RequestManagementCard
            key={item.id}
            item={item}
            requests={requests}
            accessToken={accessToken}
            businessId={businessId}
            busy={busyId === item.id}
            focused={focusedId === item.id}
            onUpdateStatus={(status) => onUpdateStatus(item, status)}
            onUpdateFields={(updates) => onUpdateFields(item, updates)}
          />
        ))
      )}
    </div>
  );
}

export function RequestManagementCard({
  item,
  requests,
  accessToken,
  businessId,
  busy,
  focused,
  onUpdateStatus,
  onUpdateFields,
}: {
  item: RequestRow;
  requests: RequestRow[];
  accessToken: string;
  businessId: string;
  busy: boolean;
  focused: boolean;
  onUpdateStatus: (status: string) => void;
  onUpdateFields: (updates: Record<string, unknown>) => void;
}) {
  const [required, setRequired] = useState(item.required_information.join(", "));
  const [missing, setMissing] = useState(item.missing_information.join(", "));
  const [details, setDetails] = useState(JSON.stringify(item.details || {}, null, 2));
  const [events, setEvents] = useState<Array<{
    id: number;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }> | null>(null);
  const [error, setError] = useState("");
  async function showHistory() {
    setError("");
    try {
      const data = await apiRequest<{
        events: Array<{ id: number; event_type: string; payload: Record<string, unknown>; created_at: string }>;
      }>(`/businesses/${businessId}/requests/${item.id}/events`, accessToken);
      setEvents(data.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request history could not be loaded.");
    }
  }
  function saveCorrections() {
    try {
      const parsed = JSON.parse(details);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error("Request details must be a JSON object.");
      onUpdateFields({
        required_information: required
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        missing_information: missing
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        details: parsed,
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request details must be valid JSON.");
    }
  }
  return (
    <article className={focused ? "record request-card selected-record" : "record request-card"}>
      <div>
        <span className="request-card-title">
          <strong>{readable(item.request_type)}</strong>
          <span className={statusTone(item.status)}>{readable(item.status)}</span>
        </span>
        <dl className="request-fields">
          {Object.entries(item.details || {}).map(([key, value]) => (
            <div key={key}>
              <dt>{readable(key)}</dt>
              <dd>{typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}</dd>
            </div>
          ))}
          <div>
            <dt>Still missing</dt>
            <dd>{item.missing_information.length ? item.missing_information.map(readable).join(", ") : "Nothing"}</dd>
          </div>
        </dl>
        <span className="request-card-refs">
          <ShortId id={item.id} label="Request" />
          <ShortId id={item.conversation_id} label="Chat" />
          {item.related_request_id && <ShortId id={item.related_request_id} label="Related" />}
        </span>
        <div className="record-actions">
          <select
            aria-label={`Next status for request ${item.id}`}
            value=""
            onChange={(e) => {
              if (e.target.value) onUpdateStatus(e.target.value);
            }}
            disabled={busy || ["completed", "cancelled", "superseded"].includes(item.status)}
          >
            <option value="">Update status…</option>
            {(item.status === "active"
              ? ["awaiting_customer", "completed", "cancelled"]
              : item.status === "awaiting_customer"
                ? ["active", "completed", "cancelled"]
                : []
            ).map((status) => (
              <option key={status} value={status}>
                {readable(status)}
              </option>
            ))}
          </select>
          <select
            aria-label={`Related request for ${item.id}`}
            value={item.related_request_id || ""}
            disabled={busy}
            onChange={(e) => onUpdateFields({ related_request_id: e.target.value || null })}
          >
            <option value="">No related request</option>
            {requests
              .filter((other) => other.customer_id === item.customer_id && other.id !== item.id)
              .map((other) => (
                <option key={other.id} value={other.id}>
                  {readable(other.request_type)} · {readable(other.status)} · {other.id.slice(0, 8)}
                </option>
              ))}
          </select>
          {busy && <small>Saving…</small>}
        </div>
        <details>
          <summary>Correct request information</summary>
          <label>
            Required information (comma separated)
            <input value={required} onChange={(e) => setRequired(e.target.value)} />
          </label>
          <label>
            Missing information (comma separated)
            <input value={missing} onChange={(e) => setMissing(e.target.value)} />
          </label>
          <label>
            Request details (JSON)
            <textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <button type="button" disabled={busy} onClick={saveCorrections}>
            Save correction
          </button>
        </details>
        <details
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open && events === null) void showHistory();
          }}
        >
          <summary>Request audit history</summary>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {events === null ? (
            <p>Loading request history…</p>
          ) : events.length === 0 ? (
            <p className="empty-copy">No dashboard changes have been recorded for this request.</p>
          ) : (
            events.map((event) => (
              <small key={event.id}>
                {event.event_type.replaceAll(".", " ")} · {new Date(event.created_at).toLocaleString()} ·{" "}
                {String(event.payload.updated_fields || event.payload.status || "")}
              </small>
            ))
          )}
        </details>
      </div>
    </article>
  );
}

export function CustomerWorkspace({
  customers,
  accessToken,
  businessId,
  setActive,
  openConversation,
  openRequest,
}: {
  customers: CustomerRow[];
  accessToken: string;
  businessId: string;
  setActive: (page: string) => void;
  openConversation: (conversation: CustomerConversationRow) => void;
  openRequest: (requestId: string) => void;
}) {
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function selectCustomer(item: CustomerRow) {
    setSelected(item);
    setDetail(null);
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<CustomerDetail>(`/businesses/${businessId}/customers/${item.id}`, accessToken);
      if (!data?.customer || !Array.isArray(data.conversations) || !Array.isArray(data.requests))
        throw new Error("Customer details returned an incomplete response.");
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Customer details could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  const profile =
    detail?.customer.profile && typeof detail.customer.profile === "object"
      ? Object.entries(detail.customer.profile)
      : [];
  return (
    <div className="workspace-split customer-workspace">
      <div className="record-list" aria-label="Customer profiles">
        {customers.length === 0 ? (
          <p className="empty-copy">No customer profiles have been recorded for this business.</p>
        ) : (
          customers.map((item) => (
            <button
              className={selected?.id === item.id ? "record selected-record" : "record"}
              key={item.id}
              onClick={() => void selectCustomer(item)}
            >
              <span className="inbox-row">
                <span className="inbox-row-top">
                  <strong>{String(item.profile?.name || item.profile?.full_name || item.external_customer_id)}</strong>
                  <time dateTime={item.updated_at}>{shortWhen(item.updated_at)}</time>
                </span>
                <small className="inbox-row-meta">
                  {readable(item.channel)} · ID {item.external_customer_id}
                </small>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="message-panel" aria-label="Customer profile and history">
        {!selected ? (
          <p className="empty-copy">Select a customer to view their profile and history.</p>
        ) : (
          <>
            <div className="conversation-detail-head">
              <div>
                <h3>{String(selected.profile?.name || selected.profile?.full_name || "Customer profile")}</h3>
                <p>
                  {readable(selected.channel)} · Customer ID {selected.external_customer_id}
                </p>
              </div>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {loading ? (
              <p role="status">Loading customer history…</p>
            ) : (
              detail && (
                <>
                  {profile.length ? (
                    <dl className="customer-profile">
                      {profile.map(([key, value]) => (
                        <div key={key}>
                          <dt>{readable(key)}</dt>
                          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="empty-copy">No additional profile details.</p>
                  )}
                  <div className="customer-history-section">
                    <div className="panel-heading">
                      <h3>Conversation history</h3>
                      <button
                        type="button"
                        disabled={!detail.conversations.length}
                        onClick={() => setActive("Conversations")}
                      >
                        Open Conversations
                      </button>
                    </div>
                    {detail.conversations.length === 0 ? (
                      <p className="empty-copy">No conversations are linked to this customer.</p>
                    ) : (
                      <div className="related-requests">
                        {detail.conversations.map((conversation) => (
                          <article className="message-item" key={conversation.id}>
                            <strong>
                              {readable(conversation.channel || conversation.platform || "Unknown channel")}{" "}
                              <span className={statusTone(conversation.status)}>{readable(conversation.status)}</span>
                            </strong>
                            <small>
                              {new Date(conversation.last_message_at || conversation.created_at).toLocaleString()}
                            </small>
                            {conversation.summary && <p>{conversation.summary}</p>}
                            <button type="button" onClick={() => openConversation(conversation)}>
                              Open conversation
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="customer-history-section">
                    <div className="panel-heading">
                      <h3>Requests</h3>
                      <button type="button" disabled={!detail.requests.length} onClick={() => setActive("Requests")}>
                        Open Requests
                      </button>
                    </div>
                    {detail.requests.length === 0 ? (
                      <p className="empty-copy">No requests are linked to this customer.</p>
                    ) : (
                      <div className="related-requests">
                        {detail.requests.map((request) => (
                          <article className="message-item" key={request.id}>
                            <strong>
                              {readable(request.request_type)}{" "}
                              <span className={statusTone(request.status)}>{readable(request.status)}</span>
                            </strong>
                            <small>
                              Still missing:{" "}
                              {request.missing_information?.length
                                ? request.missing_information.map(readable).join(", ")
                                : "nothing"}
                            </small>
                            <button type="button" onClick={() => openRequest(request.id)}>
                              Open request
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
