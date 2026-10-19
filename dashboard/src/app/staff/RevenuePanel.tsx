import { useCallback, useEffect, useState } from "react";
import { API_BASE, ApiRequestError, apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";
import { ChartFrame, HBars, StackedColumns, StatTile } from "../charts/Charts";

/** Control Center → Shop → Revenue: Shopify (shop orders, sourcing orders, deposits, consultations, contact credits)
 * and Stripe (memberships), with refunds taken off. Admins only. */

type RangeKey = "7d" | "30d" | "90d" | "12m" | "custom";
type StreamKey = "shop" | "sourcing" | "deposits" | "consultations" | "contact_credits" | "memberships" | "other";
export type RevenueReport = {
  range: { start: string; end: string; bucket: "day" | "week" | "month"; time_zone: string };
  currency: string;
  tiles: {
    gross: number;
    refunds: number;
    net: number;
    sales: number;
    average_sale: number | null;
    paying_customers: number;
    previous_net: number;
    change: number | null;
    mrr: { amount: number; members: { standard: number; pro: number } };
  };
  streams: { key: StreamKey; label: string }[];
  series: ({ bucket: string } & Record<StreamKey, number>)[];
  mix: { key: StreamKey; label: string; gross: number; refunds: number; net: number; count: number }[];
  sources: { shopify: number; stripe: number };
  top_products: { title: string; revenue: number; quantity: number }[];
  countries: { country: string; net: number }[];
  other_currencies: Record<string, number>;
  stripe_connected: boolean;
  data_since: string | null;
};

const RANGES: [RangeKey, string][] = [
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["90d", "90 days"],
  ["12m", "12 months"],
  ["custom", "Custom"],
];

export const usd = (value: number, cents = false) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 }).format(value);

function bucketLabel(key: string, bucket: string) {
  const date = new Date(`${key}T12:00:00Z`);
  if (bucket === "month") return date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function RevenuePanel({ accessToken }: { accessToken: string }) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState<RevenueReport | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const query = range === "custom" ? `range=custom&start=${start}&end=${end}` : `range=${range}`;
  const load = useCallback(async () => {
    if (range === "custom" && (!start || !end)) return;
    try {
      setData(await apiRequest<RevenueReport>(`/platform/revenue?${query}`, accessToken));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so Revenue isn't available yet."
          : reason instanceof Error
            ? reason.message
            : "Revenue could not be loaded.",
      );
    }
  }, [accessToken, query, range, start, end]);
  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setBusy("csv");
    try {
      const response = await fetch(`${API_BASE}/platform/revenue.csv?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error("The export could not be made.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `fayfort-revenue-${data?.range.start || "export"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The export could not be made.");
    } finally {
      setBusy("");
    }
  }

  async function importHistory() {
    setBusy("import");
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ shopify_imported: number; shopify_seen: number; notes: string[] }>(
        "/platform/revenue/backfill",
        accessToken,
        { method: "POST" },
        180_000,
      );
      setNotice(
        `Imported ${result.shopify_imported} past Shopify order${result.shopify_imported === 1 ? "" : "s"} (${result.shopify_seen} checked). ${result.notes.join(" ")}`.trim(),
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The history import failed.");
    } finally {
      setBusy("");
    }
  }

  const streams = (data?.streams || []).filter((s) => data?.mix.find((m) => m.key === s.key && (m.net !== 0 || m.count > 0)));
  const shown = streams.length ? streams : (data?.streams || []).slice(0, 1);
  const t = data?.tiles;
  return (
    <section className="control-panel revenue-panel" aria-label="Revenue">
      <div className="panel-heading revenue-heading">
        <div>
          <h2>Revenue</h2>
          <p>
            Everything paid through Shopify (shop, sourcing orders, deposits, consultations, contact credits) and Stripe (memberships), with
            refunds taken off. {data ? `Days are ${data.range.time_zone}.` : ""}
          </p>
        </div>
        <div className="revenue-actions">
          <button type="button" className="secondary-button" disabled={!!busy || !data} onClick={() => void exportCsv()}>
            {busy === "csv" ? "Exporting…" : "Export CSV"}
          </button>
          <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void importHistory()}>
            {busy === "import" ? "Importing…" : "Import past orders"}
          </button>
        </div>
      </div>
      <div className="revenue-filters" role="group" aria-label="Period">
        {RANGES.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={range === key} className={range === key ? "is-active" : ""} onClick={() => setRange(key)}>
            {label}
          </button>
        ))}
        {range === "custom" && (
          <span className="revenue-custom">
            <label>
              From <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label>
              To <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </span>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-delivery ok" role="status">
          {notice}
        </p>
      )}
      {data && !data.stripe_connected && (
        <p className="email-delivery off" role="note">
          Stripe isn't connected, so memberships show nothing yet. Connect it in Infrastructure → Connections.
        </p>
      )}
      {!data || !t ? (
        !error && <FayfortLoader label="Loading revenue…" />
      ) : (
        <>
          <div className="viz viz-stats">
            <StatTile label="Net revenue" value={usd(t.net)} delta={t.change} sub="vs the period before" />
            <StatTile label="Gross sales" value={usd(t.gross)} sub={`${t.sales} sale${t.sales === 1 ? "" : "s"}`} />
            <StatTile label="Refunds" value={usd(t.refunds)} sub={t.gross ? `${Math.round((t.refunds / t.gross) * 100)}% of gross` : "None"} tone={t.refunds ? "bad" : undefined} />
            <StatTile label="Average sale" value={t.average_sale === null ? "—" : usd(t.average_sale, true)} sub={`${t.paying_customers} paying customer${t.paying_customers === 1 ? "" : "s"}`} />
            <StatTile label="Memberships (monthly)" value={usd(t.mrr.amount)} sub={`${t.mrr.members.standard} Standard · ${t.mrr.members.pro} Pro`} />
          </div>
          {Object.keys(data.other_currencies).length > 0 && (
            <p className="muted revenue-other">
              Also received in other currencies (not converted):{" "}
              {Object.entries(data.other_currencies)
                .map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`)
                .join(" · ")}
            </p>
          )}
          <ChartFrame
            className="revenue-main"
            title="Net revenue by stream"
            subtitle={`${data.range.bucket === "day" ? "Daily" : data.range.bucket === "week" ? "Weekly" : "Monthly"} · ${bucketLabel(data.range.start, "day")} to ${bucketLabel(data.range.end, "day")}`}
            legend={shown}
            table={{
              columns: ["Period", ...shown.map((s) => s.label), "Total"],
              rows: data.series.map((row) => [
                bucketLabel(row.bucket, data.range.bucket),
                ...shown.map((s) => usd(row[s.key], true)),
                usd(shown.reduce((sum, s) => sum + row[s.key], 0), true),
              ]),
            }}
          >
            <StackedColumns
              label="Net revenue by stream over time"
              series={shown}
              format={(v) => usd(v)}
              data={data.series.map((row) => ({ label: bucketLabel(row.bucket, data.range.bucket), values: row as unknown as Record<string, number> }))}
            />
          </ChartFrame>
          <div className="revenue-grid">
            <ChartFrame
              title="Where it came from"
              subtitle={`Shopify ${usd(data.sources.shopify)} · Stripe ${usd(data.sources.stripe)}`}
              table={{ columns: ["Stream", "Sales", "Gross", "Refunds", "Net"], rows: data.mix.filter((m) => m.count).map((m) => [m.label, m.count, usd(m.gross, true), usd(m.refunds, true), usd(m.net, true)]) }}
            >
              <ul className="viz-hbars revenue-mix">
                {data.streams.map((s, index) => {
                  const m = data.mix.find((row) => row.key === s.key);
                  if (!m || !m.count) return null;
                  const max = Math.max(...data.mix.map((row) => row.net), 1);
                  return (
                    <li key={s.key}>
                      <span className="viz-hbar-label">
                        {s.label}
                        <small>
                          {m.count} sale{m.count === 1 ? "" : "s"}
                        </small>
                      </span>
                      <span className="viz-hbar-track">
                        <i className={`viz-hbar s${index + 1}`} style={{ width: `${Math.max(1.5, (m.net / max) * 100)}%` }} />
                        <b>{usd(m.net)}</b>
                      </span>
                    </li>
                  );
                })}
                {!data.mix.some((m) => m.count) && <li className="muted">No sales in this period.</li>}
              </ul>
            </ChartFrame>
            <ChartFrame
              title="Top shop products"
              subtitle="In-stock items, by revenue"
              table={{ columns: ["Product", "Sold", "Revenue"], rows: data.top_products.map((p) => [p.title, p.quantity, usd(p.revenue, true)]) }}
            >
              {data.top_products.length ? (
                <HBars label="Top shop products" format={(v) => usd(v)} data={data.top_products.map((p) => ({ label: p.title, value: p.revenue, note: `${p.quantity} sold` }))} />
              ) : (
                <p className="muted">No shop sales in this period.</p>
              )}
            </ChartFrame>
            <ChartFrame
              title="Countries"
              subtitle="Net revenue by shipping country"
              table={{ columns: ["Country", "Net"], rows: data.countries.map((c) => [c.country, usd(c.net, true)]) }}
            >
              {data.countries.length ? (
                <HBars label="Revenue by country" format={(v) => usd(v)} data={data.countries.map((c) => ({ label: c.country, value: c.net }))} />
              ) : (
                <p className="muted">No shipping countries recorded in this period.</p>
              )}
            </ChartFrame>
          </div>
          {data.data_since && (
            <p className="muted revenue-since">
              Sales recorded since {new Date(data.data_since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.
              Use Import past orders to bring in older Shopify orders.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Control Center Overview: this month's net revenue and the change on last month. Hidden when it can't load. */
export function RevenueTile({ accessToken, onOpen }: { accessToken: string; onOpen: () => void }) {
  const [data, setData] = useState<RevenueReport | null>(null);
  useEffect(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    apiRequest<RevenueReport>(`/platform/revenue?range=custom&start=${day(first)}&end=${day(now)}`, accessToken)
      .then(setData)
      .catch(() => setData(null));
  }, [accessToken]);
  if (!data) return null;
  return (
    <button type="button" className="overview-tile revenue-tile" onClick={onOpen}>
      <strong>{usd(data.tiles.net)}</strong>
      <span>Revenue this month</span>
      <small>
        {data.tiles.change === null ? `${data.tiles.sales} sales` : `${data.tiles.change >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(data.tiles.change * 100))}% vs the days before`}
      </small>
    </button>
  );
}
