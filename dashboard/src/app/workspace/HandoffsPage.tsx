import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ConversationRow, Handoff, HandoffAgent, HandoffEvent } from "./types";

export function AgentAvailabilityPanel({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [availability, setAvailability] = useState<"available" | "away" | "offline">("offline");
  const [until, setUntil] = useState("");
  const [capacity, setCapacity] = useState(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    void apiRequest<{
      availability: "available" | "away" | "offline";
      available_until: string | null;
      max_active_handoffs: number;
    }>(`/businesses/${businessId}/handoffs/availability`, accessToken)
      .then((data) => {
        if (!alive) return;
        setAvailability(data.availability);
        setCapacity(data.max_active_handoffs);
        if (data.available_until) {
          const date = new Date(data.available_until);
          setUntil(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
        } else setUntil("");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Availability could not be loaded.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [accessToken, businessId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await apiRequest(`/businesses/${businessId}/handoffs/availability`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          availability,
          available_until: availability === "available" && until ? new Date(until).toISOString() : null,
          max_active_handoffs: capacity,
        }),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Availability could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel availability-panel" aria-label="Your human-agent availability">
      <div className="panel-heading">
        <div>
          <h2>Your availability</h2>
          <p>
            Set your FayFort-wide on-duty window and maximum concurrent handoffs across all client accounts.
            Availability expires automatically; wait estimates stay unavailable until enough recent human first-response
            timings exist.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form className="inline-form" onSubmit={save}>
        <label>
          Availability
          <select
            aria-label="Your agent availability"
            value={availability}
            disabled={loading}
            onChange={(e) => setAvailability(e.target.value as "available" | "away" | "offline")}
          >
            <option value="available">Available</option>
            <option value="away">Away</option>
            <option value="offline">Offline</option>
          </select>
        </label>
        {availability === "available" && (
          <label>
            On duty until
            <input
              aria-label="Available until"
              type="datetime-local"
              required
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        )}
        <label>
          Maximum active handoffs
          <input
            aria-label="Maximum active handoffs"
            type="number"
            min={1}
            max={20}
            step={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </label>
        <button className="primary-button" disabled={busy || loading}>
          {busy ? "Saving…" : "Save availability"}
        </button>
        {saved && <small role="status">Availability saved.</small>}
      </form>
    </section>
  );
}

export function HandoffsPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [items, setItems] = useState<Handoff[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [agents, setAgents] = useState<HandoffAgent[]>([]);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [reason, setReason] = useState("customer_requested");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [sourceFilter, setSourceFilter] = useState("all");
  const [history, setHistory] = useState<Record<string, HandoffEvent[]>>({});
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [historyBusy, setHistoryBusy] = useState<Record<string, boolean>>({});
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState("waiting");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = statusFilter === "all" ? "" : `&status=${statusFilter}`;
      const estimates = statusFilter === "waiting" ? "&with_estimates=true" : "";
      const [d, c, a] = await Promise.all([
        apiRequest<{ handoffs: Handoff[]; total: number; has_more: boolean }>(
          `/businesses/${businessId}/handoffs?limit=50&offset=${offset}${status}${estimates}`,
          accessToken,
        ),
        apiRequest<{ conversations: ConversationRow[] }>(`/businesses/${businessId}/conversations`, accessToken),
        apiRequest<{ agents: HandoffAgent[] }>(`/businesses/${businessId}/handoffs/agents`, accessToken),
      ]);
      setItems(d.handoffs);
      setTotal(d.total);
      setHasMore(d.has_more);
      setConversations(c.conversations);
      setAgents(a.agents);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Handoffs could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId, offset, statusFilter]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function request(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(
        `/businesses/${businessId}/handoffs?conversation_id=${encodeURIComponent(conversationId)}`,
        accessToken,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      setConversationId("");
      if (offset !== 0) setOffset(0);
      else await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Handoff could not be requested.");
    } finally {
      setBusy(false);
    }
  }
  async function action(item: Handoff, path: string, body?: unknown) {
    setBusy(true);
    try {
      await apiRequest(`/businesses/${businessId}/handoffs/${item.id}/${path}`, accessToken, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Handoff action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function assign(item: Handoff) {
    const agentId = assignTo[item.id] || item.assigned_to;
    if (!agentId) return;
    await action(item, "assign", { agent_id: agentId });
  }
  async function toggleHistory(item: Handoff) {
    const open = !historyOpen[item.id];
    setHistoryOpen((previous) => ({ ...previous, [item.id]: open }));
    if (!open || history[item.id]) return;
    setHistoryBusy((previous) => ({ ...previous, [item.id]: true }));
    try {
      const data = await apiRequest<{ events: HandoffEvent[] }>(
        `/businesses/${businessId}/handoffs/${item.id}/events`,
        accessToken,
      );
      setHistory((previous) => ({ ...previous, [item.id]: data.events }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Handoff history could not be loaded.");
      setHistoryOpen((previous) => ({ ...previous, [item.id]: false }));
    } finally {
      setHistoryBusy((previous) => ({ ...previous, [item.id]: false }));
    }
  }
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const source = (h: Handoff) =>
    byId.get(h.conversation_id)?.channel || byId.get(h.conversation_id)?.platform || "unknown";
  const sources = Array.from(new Set(items.map(source))).sort();
  const visible = items.filter((h) => sourceFilter === "all" || source(h) === sourceFilter);
  return (
    <section className="control-panel" aria-label="Human handoff management">
      <div className="panel-heading">
        <div>
          <h2>Human agent queue</h2>
          <p>
            FIFO queue · {total} handoff{total === 1 ? "" : "s"} in this client account. Assigned human replies use the
            connected provider when outbound delivery is enabled; delivery status appears in the conversation.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form className="inline-form" onSubmit={request}>
        <label>
          Conversation
          <select required value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
            <option value="">Choose a conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.customer_name || c.customer_external_id || "Customer"} �{" "}
                {c.channel || c.platform || "Unknown source"} �{" "}
                {new Date(c.last_message_at || c.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reason
          <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="primary-button" disabled={busy || !conversationId}>
          Request human handoff
        </button>
      </form>
      <label className="queue-filter">
        Queue status
        <select
          aria-label="Queue status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="waiting">Waiting</option>
          <option value="active">Active</option>
          <option value="returned">Returned</option>
          <option value="all">All handoffs</option>
        </select>
      </label>
      <label className="queue-filter">
        Filter queue by source
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          {sources.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p>Loading handoffs�</p>
      ) : visible.length === 0 ? (
        <p className="empty-copy">{items.length ? "No handoffs match this source filter." : "No handoffs recorded."}</p>
      ) : (
        <div className="record-list">
          {visible.map((item) => (
            <div className="record handoff-record" key={item.id}>
              <div>
                <strong>
                  {item.status} � {item.reason}
                </strong>
                <small>
                  {byId.get(item.conversation_id)?.customer_name ||
                    byId.get(item.conversation_id)?.customer_external_id ||
                    "Customer"}{" "}
                  � {source(item)} � Requested {new Date(item.requested_at).toLocaleString()}
                </small>
                {item.queue_position && (
                  <small>
                    FIFO position {item.queue_position} ·{" "}
                    {item.wait_estimate?.status === "estimated"
                      ? `Estimated first response: ${item.wait_estimate.lower_minutes}–${item.wait_estimate.upper_minutes} min (${item.wait_estimate.sample_size} samples)`
                      : item.wait_estimate?.reason || "Wait estimate unavailable."}
                  </small>
                )}
                <div className="record-actions">
                  {["requested", "assigned"].includes(item.status) && (
                    <>
                      <label>
                        Assign to
                        <select
                          aria-label={`Assign handoff ${item.id} to agent`}
                          value={assignTo[item.id] || item.assigned_to || ""}
                          onChange={(e) => setAssignTo((previous) => ({ ...previous, [item.id]: e.target.value }))}
                        >
                          <option value="">Choose an active agent</option>
                          {agents.map((agent) => (
                            <option key={agent.user_id} value={agent.user_id}>
                              {agent.user_id} · FayFort worker
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        disabled={busy || !(assignTo[item.id] || item.assigned_to)}
                        onClick={() => void assign(item)}
                      >
                        Assign
                      </button>
                      <button disabled={busy} onClick={() => void action(item, "take-over")}>
                        Take over
                      </button>
                    </>
                  )}
                  {item.status === "active" && (
                    <>
                      <button disabled={busy} onClick={() => void action(item, "return-to-automation")}>
                        Return to automation
                      </button>
                      <input
                        aria-label={`Reply for ${item.id}`}
                        value={reply[item.id] || ""}
                        onChange={(e) => setReply((p) => ({ ...p, [item.id]: e.target.value }))}
                        placeholder="Human reply"
                      />
                      <button
                        disabled={busy || !reply[item.id]?.trim()}
                        onClick={() => void action(item, "messages", { content: reply[item.id] })}
                      >
                        Send reply
                      </button>
                    </>
                  )}
                </div>
                <button type="button" className="handoff-history-toggle" onClick={() => void toggleHistory(item)}>
                  {historyOpen[item.id] ? "Hide history" : "View history"}
                </button>
                {historyOpen[item.id] && (
                  <div className="handoff-history" aria-label="Handoff history">
                    {historyBusy[item.id] ? (
                      <p role="status">Loading handoff history…</p>
                    ) : (history[item.id] || []).length === 0 ? (
                      <p className="quiet-note">No state changes recorded for this handoff.</p>
                    ) : (
                      <ul>
                        {history[item.id].map((event) => (
                          <li key={event.id}>
                            <strong>{event.event_type.replaceAll("_", " ")}</strong>
                            <small>
                              {event.actor_id || "Actor not recorded"} · {new Date(event.created_at).toLocaleString()}
                            </small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && (
        <div className="record-actions queue-pagination">
          <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous queue page
          </button>
          <small>
            {total === 0
              ? "No handoffs"
              : `Showing ${offset + 1}–${Math.min(offset + items.length, total)} of ${total}`}
          </small>
          <button disabled={!hasMore || loading} onClick={() => setOffset(offset + 50)}>
            Next queue page
          </button>
        </div>
      )}
    </section>
  );
}
