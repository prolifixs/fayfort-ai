import { ApiRequestError, apiRequest } from "../../lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiUsageResult, AnalyticsCharts, AnalyticsEvent, AnalyticsResult } from "./types";
import { FayfortLoader } from "../brand/FayfortLogo";
import { ChartFrame, HBars, StackedColumns, StatTile, TrendLine, compact } from "../charts/Charts";
import { readable } from "../staff/StaffChrome";

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

const usdShort = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value < 1 ? 4 : 2 });

const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", messenger: "Messenger", facebook: "Facebook", website: "Website", whatsapp: "WhatsApp", manual: "Manual", other: "Other" };
const STATUS_LABEL: Record<string, string> = {
  requested: "Still waiting",
  assigned: "Assigned",
  active: "Person replying",
  returned: "Returned to the AI",
  resolved: "Resolved",
  cancelled: "Cancelled",
};
const OPERATION_LABEL: Record<string, string> = { intent: "Understanding the message", response: "Writing replies", summary: "Summarising chats" };

function bucketLabel(iso: string, bucket: "day" | "week") {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const text = date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return bucket === "week" ? `Wk of ${text}` : text;
}

export function AnalyticsPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [days, setDays] = useState(30);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [sampled, setSampled] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [usageError, setUsageError] = useState("");
  const [chartsError, setChartsError] = useState("");
  const [usage, setUsage] = useState<AiUsageResult>(emptyAiUsage(30));
  const [charts, setCharts] = useState<AnalyticsCharts | null>(null);
  const requestVersion = useRef(0);
  const refresh = useCallback(
    async (windowDays = days) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setPaging(false);
      setError("");
      setUsageError("");
      setChartsError("");
      setUsage(emptyAiUsage(windowDays));
      setCharts(null);
      setEvents([]);
      setSampled(0);
      setTruncated(false);
      setCursor(null);
      setHasMore(false);
      const [activityResult, usageResult, chartsResult] = await Promise.allSettled([
        apiRequest<AnalyticsResult>(`/businesses/${businessId}/analytics?days=${windowDays}&limit=50`, accessToken),
        apiRequest<AiUsageResult>(`/businesses/${businessId}/ai-usage?days=${windowDays}`, accessToken),
        apiRequest<AnalyticsCharts>(`/businesses/${businessId}/analytics/charts?days=${windowDays}`, accessToken),
      ]);
      if (version !== requestVersion.current) return;
      if (activityResult.status === "fulfilled") {
        const data = activityResult.value;
        setEvents(data.events);
        setSampled(data.sampled_events);
        setTruncated(data.summary_truncated);
        setCursor(data.next_before_id);
        setHasMore(data.has_more);
      } else
        setError(activityResult.reason instanceof Error ? activityResult.reason.message : "Analytics could not be loaded.");
      if (usageResult.status === "fulfilled") setUsage(usageResult.value);
      else setUsageError(usageResult.reason instanceof Error ? usageResult.reason.message : "AI usage could not be loaded.");
      if (chartsResult.status === "fulfilled" && chartsResult.value && Array.isArray(chartsResult.value.activity)) setCharts(chartsResult.value);
      else
        setChartsError(
          chartsResult.status === "rejected" && chartsResult.reason instanceof ApiRequestError && chartsResult.reason.status === 404
            ? "The charts need the latest API. Update the API on the server, then refresh."
            : chartsResult.status === "rejected" && chartsResult.reason instanceof Error
              ? chartsResult.reason.message
              : "The charts could not be loaded.",
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
      if (version === requestVersion.current) setError(e instanceof Error ? e.message : "Older activity could not be loaded.");
    } finally {
      if (version === requestVersion.current) setPaging(false);
    }
  }
  const budget = usage.budget;
  const used = budget.limit_usd > 0 ? Math.min(1, (budget.committed_usd + budget.pending_usd) / budget.limit_usd) : 0;
  const bucket = charts?.bucket || "day";
  const period = days === 7 ? "the 7 days before" : days === 30 ? "the 30 days before" : "the 90 days before";
  return (
    <section className="control-panel analytics-page" aria-label="Analytics activity">
      <div className="panel-heading">
        <div>
          <h2>Business activity analytics</h2>
          <p>How busy this account has been. Arrows compare with {period}. Every chart has a table view with the exact numbers.</p>
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
        <FayfortLoader label="Loading business activity…" />
      ) : (
        <>
          {charts && (
            <div className="viz viz-stats" aria-label="Headline numbers">
              <StatTile label="Conversations started" value={charts.totals.conversations.value.toLocaleString()} delta={charts.totals.conversations.change} sub="vs before" />
              <StatTile label="Messages received" value={charts.totals.messages.value.toLocaleString()} sub={`in the last ${days} days`} />
              <StatTile
                label="Handed to a person"
                value={charts.totals.handoffs.value.toLocaleString()}
                delta={charts.totals.handoffs.change}
                sub="vs before"
              />
              <StatTile label="AI model calls" value={charts.totals.ai_calls.value.toLocaleString()} delta={charts.totals.ai_calls.change} sub="vs before" />
              <StatTile label="AI cost" value={usdShort(charts.totals.ai_cost_usd.value)} sub={`in the last ${days} days`} />
            </div>
          )}
          <div className="analytics-budget" aria-label="AI monthly budget">
            <div className="analytics-budget-head">
              <strong>AI budget this month</strong>
              <span>
                {formatUsd(budget.committed_usd)} used of {formatUsd(budget.limit_usd)} · {formatUsd(budget.remaining_usd)} left
              </span>
            </div>
            <div
              className={`analytics-meter${used >= 0.9 ? " is-bad" : used >= 0.7 ? " is-warn" : ""}`}
              role="meter"
              aria-label="AI budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(used * 100)}
            >
              <i style={{ width: `${Math.max(used > 0 ? 1 : 0, used * 100)}%` }} />
            </div>
            <small>
              {used >= 0.9
                ? "Nearly used up: the AI stops answering when it runs out. Tell an administrator."
                : "Resets on the 1st (UTC). Held amounts are included until the provider confirms them."}
              {budget.pending_usd > 0 ? ` ${formatUsd(budget.pending_usd)} held.` : ""}
            </small>
          </div>
          {usageError && (
            <p className="quiet-note" role="alert">
              AI usage summary unavailable: {usageError}
            </p>
          )}
          {chartsError && (
            <p className="quiet-note" role="alert">
              {chartsError}
            </p>
          )}
          {charts && (
            <>
              <ChartFrame
                className="analytics-main"
                title="Activity"
                subtitle={`${bucket === "week" ? "Weekly" : "Daily"} · everything recorded, grouped`}
                legend={charts.groups}
                table={{
                  columns: ["Period", ...charts.groups.map((g) => g.label), "Total"],
                  rows: charts.activity.map((row) => [
                    bucketLabel(row.bucket, bucket),
                    ...charts.groups.map((g) => Number(row[g.key] || 0)),
                    charts.groups.reduce((sum, g) => sum + Number(row[g.key] || 0), 0),
                  ]),
                }}
              >
                <StackedColumns
                  label="Activity over time by group"
                  series={charts.groups}
                  format={(v) => compact(v)}
                  data={charts.activity.map((row) => ({ label: bucketLabel(row.bucket, bucket), values: row as unknown as Record<string, number> }))}
                />
              </ChartFrame>
              <div className="analytics-grid">
                <ChartFrame
                  title="New conversations"
                  subtitle="By channel"
                  legend={charts.channels.map((key) => ({ key, label: CHANNEL_LABEL[key] || readable(key) }))}
                  table={{
                    columns: ["Period", ...charts.channels.map((key) => CHANNEL_LABEL[key] || readable(key))],
                    rows: charts.conversations.map((row) => [bucketLabel(row.bucket, bucket), ...charts.channels.map((key) => Number(row[key] || 0))]),
                  }}
                >
                  {charts.channels.length ? (
                    <StackedColumns
                      label="New conversations by channel"
                      height={200}
                      series={charts.channels.map((key) => ({ key, label: CHANNEL_LABEL[key] || readable(key) }))}
                      format={(v) => compact(v)}
                      data={charts.conversations.map((row) => ({ label: bucketLabel(row.bucket, bucket), values: row as unknown as Record<string, number> }))}
                    />
                  ) : (
                    <p className="muted">No new conversations in this window.</p>
                  )}
                </ChartFrame>
                <ChartFrame
                  title="Handed to a person"
                  subtitle="Handoffs requested"
                  table={{ columns: ["Period", "Requested"], rows: charts.handoffs.series.map((row) => [bucketLabel(row.bucket, bucket), row.requested]) }}
                >
                  <TrendLine
                    label="Handoffs requested"
                    height={200}
                    format={(v) => compact(v)}
                    points={charts.handoffs.series.map((row) => ({ label: bucketLabel(row.bucket, bucket), value: row.requested }))}
                  />
                </ChartFrame>
                <ChartFrame
                  title="AI model calls"
                  subtitle={`${charts.ai.series.reduce((sum, row) => sum + row.tokens, 0).toLocaleString()} tokens reported`}
                  table={{
                    columns: ["Period", "Calls", "Tokens", "Cost"],
                    rows: charts.ai.series.map((row) => [bucketLabel(row.bucket, bucket), row.calls, row.tokens.toLocaleString(), usdShort(row.cost_usd)]),
                  }}
                >
                  <TrendLine
                    label="AI model calls"
                    height={200}
                    format={(v) => compact(v)}
                    points={charts.ai.series.map((row) => ({ label: bucketLabel(row.bucket, bucket), value: row.calls }))}
                  />
                </ChartFrame>
                <ChartFrame
                  title="What the AI was doing"
                  subtitle="Calls by job"
                  table={{
                    columns: ["Job", "Calls", "Tokens", "Cost"],
                    rows: charts.ai.by_operation.map((row) => [OPERATION_LABEL[row.operation] || readable(row.operation), row.calls, row.tokens.toLocaleString(), usdShort(row.cost_usd)]),
                  }}
                >
                  {charts.ai.by_operation.length ? (
                    <HBars
                      label="AI calls by job"
                      seriesIndex={6}
                      format={(v) => compact(v)}
                      data={charts.ai.by_operation.map((row) => ({
                        label: OPERATION_LABEL[row.operation] || readable(row.operation),
                        value: row.calls,
                        note: `${compact(row.tokens)} tokens`,
                      }))}
                    />
                  ) : (
                    <p className="muted">No AI calls in this window.</p>
                  )}
                </ChartFrame>
                <ChartFrame
                  title="Handoff outcomes"
                  subtitle="Where each handoff ended up"
                  table={{ columns: ["Outcome", "Handoffs"], rows: Object.entries(charts.handoffs.by_status).map(([key, value]) => [STATUS_LABEL[key] || readable(key), value]) }}
                >
                  {Object.keys(charts.handoffs.by_status).length ? (
                    <HBars
                      label="Handoff outcomes"
                      seriesIndex={1}
                      format={(v) => compact(v)}
                      data={Object.entries(charts.handoffs.by_status)
                        .sort(([, a], [, b]) => b - a)
                        .map(([key, value]) => ({ label: STATUS_LABEL[key] || readable(key), value }))}
                    />
                  ) : (
                    <p className="muted">No handoffs in this window.</p>
                  )}
                </ChartFrame>
                <ChartFrame
                  title="Most common events"
                  subtitle="Top eight"
                  table={{ columns: ["Event", "Count"], rows: charts.top_events.map((row) => [row.label, row.count]) }}
                >
                  {charts.top_events.length ? (
                    <HBars label="Most common events" seriesIndex={2} format={(v) => compact(v)} data={charts.top_events.map((row) => ({ label: row.label, value: row.count }))} />
                  ) : (
                    <p className="muted">Nothing recorded in this window.</p>
                  )}
                </ChartFrame>
              </div>
              {charts.truncated && (
                <p className="quiet-note" role="status">
                  Very busy window: charts count the latest 10,000 records of each kind. Pick a shorter window for exact totals.
                </p>
              )}
            </>
          )}
          <details className="analytics-details">
            <summary>AI details (models, providers, tokens)</summary>
            <p className="quiet-note">
              {usage.sampled_requests} model requests · {usage.source_messages} source {usage.source_messages === 1 ? "message" : "messages"} ·{" "}
              {usage.total_tokens.toLocaleString()} tokens reported ({usage.prompt_tokens.toLocaleString()} input,{" "}
              {usage.completion_tokens.toLocaleString()} output) · {usage.unknown_usage_requests} requests without provider token counts
              {usage.summary_truncated ? " · latest 5,000 requests shown" : ""}
            </p>
            <p className="quiet-note">
              Models: {Object.keys(usage.models).sort().join(", ") || "none recorded"} · Providers:{" "}
              {Object.keys(usage.providers).sort().join(", ") || "none recorded"}
            </p>
            {Object.keys(usage.message_call_distribution).length > 0 && (
              <p className="quiet-note">
                Model calls per source message:{" "}
                {Object.entries(usage.message_call_distribution)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([calls, messages]) => `${messages} message${Number(messages) === 1 ? "" : "s"} with ${calls} call${Number(calls) === 1 ? "" : "s"}`)
                  .join(" · ")}
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
            <p className="quiet-note">
              Budget reservations use the pinned provider's live published rates with a conservative maximum-token estimate; the provider invoice may differ.
            </p>
          </details>
          <details className="analytics-details" open={!charts}>
            <summary>
              Event log · {sampled}
              {truncated ? "+" : ""} events
            </summary>
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
          </details>
        </>
      )}
    </section>
  );
}
