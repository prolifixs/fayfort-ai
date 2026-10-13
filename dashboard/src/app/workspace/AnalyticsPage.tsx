import { apiRequest } from "../../lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiUsageResult, AnalyticsEvent, AnalyticsResult } from "./types";

export const emptyAiUsage = (days: number): AiUsageResult => ({
  days,
  sampled_requests: 0,
  summary_truncated: false,
  reported_usage_requests: 0,
  unknown_usage_requests: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  source_messages: 0,
  message_call_distribution: {},
  operations: {},
  models: {},
  providers: {},
  budget: { limit_usd: 0, committed_usd: 0, pending_usd: 0, remaining_usd: 0, month_start: "" },
});

export const formatUsd = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

export function AnalyticsPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [days, setDays] = useState(30);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sampled, setSampled] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [usageError, setUsageError] = useState("");
  const [usage, setUsage] = useState<AiUsageResult>(emptyAiUsage(30));
  const requestVersion = useRef(0);
  const refresh = useCallback(
    async (windowDays = days) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setPaging(false);
      setError("");
      setUsageError("");
      setUsage(emptyAiUsage(windowDays));
      setEvents([]);
      setCounts({});
      setSampled(0);
      setTruncated(false);
      setCursor(null);
      setHasMore(false);
      const [activityResult, usageResult] = await Promise.allSettled([
        apiRequest<AnalyticsResult>(`/businesses/${businessId}/analytics?days=${windowDays}&limit=50`, accessToken),
        apiRequest<AiUsageResult>(`/businesses/${businessId}/ai-usage?days=${windowDays}`, accessToken),
      ]);
      if (version !== requestVersion.current) return;
      if (activityResult.status === "fulfilled") {
        const data = activityResult.value;
        setEvents(data.events);
        setCounts(data.event_counts);
        setSampled(data.sampled_events);
        setTruncated(data.summary_truncated);
        setCursor(data.next_before_id);
        setHasMore(data.has_more);
      } else
        setError(
          activityResult.reason instanceof Error ? activityResult.reason.message : "Analytics could not be loaded.",
        );
      if (usageResult.status === "fulfilled") setUsage(usageResult.value);
      else
        setUsageError(
          usageResult.reason instanceof Error ? usageResult.reason.message : "AI usage could not be loaded.",
        );
      setLoading(false);
    },
    [accessToken, businessId, days],
  );
  useEffect(() => {
    void refresh();
    return () => {
      requestVersion.current += 1;
    };
  }, [refresh]);
  async function loadOlder() {
    if (cursor === null) return;
    const version = requestVersion.current;
    const windowDays = days;
    setPaging(true);
    setError("");
    try {
      const data = await apiRequest<AnalyticsResult>(
        `/businesses/${businessId}/analytics?days=${windowDays}&limit=50&before_id=${cursor}`,
        accessToken,
      );
      if (version !== requestVersion.current) return;
      setEvents((current) => [...current, ...data.events]);
      setCursor(data.next_before_id);
      setHasMore(data.has_more);
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : "Older activity could not be loaded.");
    } finally {
      if (version === requestVersion.current) setPaging(false);
    }
  }
  return (
    <section className="control-panel" aria-label="Analytics activity">
      <div className="panel-heading">
        <div>
          <h2>Business activity analytics</h2>
          <p>
            Event counts summarize the latest 500 saved business events in the selected window. Activity is ordered by
            event ID, newest first; this view does not infer revenue, conversation totals, or other source-table totals.
          </p>
        </div>
        <div className="record-actions">
          <label>
            Time window{" "}
            <select aria-label="Analytics time window" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading business activity…</p>
      ) : (
        <>
          <div className="record">
            <div>
              <strong>AI usage and monthly budget</strong>
              <small>
                {formatUsd(usage.budget.limit_usd)} monthly ceiling · {formatUsd(usage.budget.committed_usd)} committed
                · {formatUsd(usage.budget.remaining_usd)} remaining (UTC calendar month)
              </small>
              <small>{formatUsd(usage.budget.pending_usd)} held for provider outcomes without confirmed usage</small>
              <small>
                {usage.sampled_requests} model requests · {usage.source_messages} source{" "}
                {usage.source_messages === 1 ? "message" : "messages"}
              </small>
              <small>
                {usage.total_tokens.toLocaleString()} tokens reported ({usage.prompt_tokens.toLocaleString()} input,{" "}
                {usage.completion_tokens.toLocaleString()} output)
              </small>
              <small>
                {usage.unknown_usage_requests} requests without provider token counts
                {usage.summary_truncated ? " · latest 5,000 requests shown" : ""}
              </small>
              <small>
                Models: {Object.keys(usage.models).sort().join(", ") || "none recorded"} · Providers:{" "}
                {Object.keys(usage.providers).sort().join(", ") || "none recorded"}
              </small>
              <small>
                Budget reservations use the pinned provider's live published rates with a conservative maximum-token
                estimate; the provider invoice may differ.
              </small>
            </div>
          </div>
          {Object.keys(usage.message_call_distribution).length > 0 && (
            <p className="quiet-note">
              Model calls per source message:{" "}
              {Object.entries(usage.message_call_distribution)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(
                  ([calls, messages]) =>
                    `${messages} message${Number(messages) === 1 ? "" : "s"} with ${calls} call${Number(calls) === 1 ? "" : "s"}`,
                )
                .join(" · ")}
            </p>
          )}
          {usageError && (
            <p className="quiet-note" role="alert">
              AI usage summary unavailable: {usageError}
            </p>
          )}
          {Object.keys(usage.operations).length > 0 && (
            <div className="metrics" aria-label="AI usage by operation">
              {Object.entries(usage.operations)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, value]) => (
                  <div key={name}>
                    <strong>{value.calls}</strong>
                    <small>
                      {name} calls · {value.total_tokens.toLocaleString()} reported tokens
                    </small>
                  </div>
                ))}
            </div>
          )}
          <div className="metrics">
            <div>
              <strong>
                {sampled}
                {truncated ? "+" : ""}
              </strong>
              <small>Events counted in window{truncated ? " (500 event cap)" : ""}</small>
            </div>
            {Object.entries(counts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <div key={key}>
                  <strong>{value}</strong>
                  <small>{key}</small>
                </div>
              ))}
          </div>
          {truncated && (
            <p className="quiet-note" role="status">
              Counts are capped at 500 events. Narrow the time window for a complete count of the returned sample.
            </p>
          )}
          {events.length === 0 ? (
            <p className="empty-copy">No business events were recorded in the last {days} days.</p>
          ) : (
            <div className="record-list" aria-label="Recent business events">
              {events.map((item) => (
                <div className="record" key={item.id}>
                  <div>
                    <strong>{item.event_type}</strong>
                    <small>
                      {item.entity_type} · {item.entity_id} · {new Date(item.created_at).toLocaleString()}
                    </small>
                    <small>Event #{item.id}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasMore && (
            <div className="record-actions">
              <button onClick={() => void loadOlder()} disabled={paging}>
                {paging ? "Loading…" : "Load older activity"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
