import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "../../lib/api";
import { relativeTime } from "./WorkforcePage";

type Tab = "overview" | "products" | "trends" | "invoices" | "sales" | "giveaways" | "orders" | "billing";

const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["trends", "Trend queue & pools"],
  ["invoices", "Invoices"],
  ["sales", "Flash sales & codes"],
  ["giveaways", "Giveaways"],
  ["products", "Category mapping"],
  ["orders", "Orders"],
  ["billing", "Member plans"],
];

function money(value: number | string | null | undefined, currency = "USD") {
  if (value === null || value === undefined || value === "") return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

function useLoad<T>(path: string, accessToken: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await apiRequest<T>(path, accessToken));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so the Shop isn't available yet. Update the API on the VPS, then refresh this page."
          : reason instanceof Error
            ? reason.message
            : "This section could not be loaded.",
      );
    }
  }, [path, accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, load, setError };
}

/** Control Center → Shop: Shopify connection, the grouped trend queue, invoices, sales, giveaways and orders. */
export function CommercePage({ accessToken, initialTab = "overview" }: { accessToken: string; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="email-center commerce-center">
      <div className="email-tabs" role="tablist" aria-label="Shop sections">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewPanel accessToken={accessToken} />}
      {tab === "trends" && <TrendsPanel accessToken={accessToken} />}
      {tab === "invoices" && <InvoicesPanel accessToken={accessToken} />}
      {tab === "sales" && <SalesPanel accessToken={accessToken} />}
      {tab === "giveaways" && <GiveawaysPanel accessToken={accessToken} />}
      {tab === "products" && <MappingPanel accessToken={accessToken} />}
      {tab === "orders" && <OrdersPanel accessToken={accessToken} />}
      {tab === "billing" && <BillingPanel accessToken={accessToken} />}
    </div>
  );
}

interface Overview {
  connection: {
    store_domain: string | null;
    admin_configured: boolean;
    storefront_configured: boolean;
    webhook_secret_configured: boolean;
    sync_enabled: boolean;
    webhook_url: string | null;
    api_version: string;
  };
  catalog: { shopify_products: number; shopify_active: number; in_stock: number; needs_category: number; fayfort_listings: number };
  sync_runs: { id: string; kind: string; status: string; products_seen: number; products_upserted: number; products_removed: number; error: string | null; started_at: string }[];
  recent_webhooks: { topic: string; status: string; received_at: string; error: string | null }[];
  trends: { open: number; pooling: number; pools_ready: number };
  invoices: { sent: number; paid: number; failed: number };
  orders_7_days: { count: number; total: number; checkouts_started?: number };
}

function OverviewPanel({ accessToken }: { accessToken: string }) {
  const { data, error, load, setError } = useLoad<Overview>("/platform/commerce/overview", accessToken);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  async function run(path: string, label: string) {
    setBusy(label);
    setNotice("");
    setError("");
    try {
      const result = await apiRequest<Record<string, unknown>>(path, accessToken, { method: "POST" });
      setNotice(
        label === "setup"
          ? `Shopify is set up: category field ${String(result.category_definition)}; webhooks ${Object.values(
              (result.webhooks as Record<string, string>) || {},
            ).join(", ")}.`
          : "Sync started. Refresh in a minute to see the result.",
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }
  const c = data?.connection;
  return (
    <section className="control-panel" aria-label="Shop overview">
      <div className="panel-heading">
        <h2>Shopify connection and catalog</h2>
        <p>Shopify holds products, prices, stock, checkout and orders. FayFort copies the catalog and adds Find It, pools, sales and giveaways.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="email-delivery ok" role="status">{notice}</p>}
      {c && (
        <>
          <p className={c.admin_configured ? "email-delivery ok" : "email-delivery off"} role="status">
            {c.admin_configured
              ? `Connected to ${c.store_domain} (API ${c.api_version}).`
              : "Shopify isn't connected yet. Add the Shopify settings to the API server's api.env."}
            {c.admin_configured && !c.storefront_configured ? " Checkout uses cart links until the Storefront token is added." : ""}
            {c.admin_configured && !c.webhook_secret_configured ? " Webhook secret missing." : ""}
            {c.admin_configured && !c.sync_enabled ? " Scheduled sync is off (COMMERCE_SYNC_ENABLED)." : ""}
          </p>
          <div className="newsletter-actions">
            <button type="button" className="secondary-button" disabled={!!busy || !c.admin_configured} onClick={() => void run("/platform/commerce/setup", "setup")}>
              {busy === "setup" ? "Setting up…" : "Set up Shopify (category field + webhooks)"}
            </button>
            <button type="button" className="primary-button" disabled={!!busy || !c.admin_configured} onClick={() => void run("/platform/commerce/sync", "sync")}>
              {busy === "sync" ? "Starting…" : "Sync now"}
            </button>
          </div>
          {c.webhook_url && <p className="muted">Webhook address: {c.webhook_url}</p>}
        </>
      )}
      {data?.catalog && data.trends && data.invoices && data.orders_7_days && (
        <dl className="commerce-stats">
          <div><dt>Store products</dt><dd>{data.catalog.shopify_active}</dd></div>
          <div><dt>In stock</dt><dd>{data.catalog.in_stock}</dd></div>
          <div><dt>Need a category</dt><dd>{data.catalog.needs_category}</dd></div>
          <div><dt>Sourcing listings</dt><dd>{data.catalog.fayfort_listings}</dd></div>
          <div><dt>Open trend items</dt><dd>{data.trends.open}</dd></div>
          <div><dt>Pools ready</dt><dd>{data.trends.pools_ready}</dd></div>
          <div><dt>Invoices paid / sent</dt><dd>{data.invoices.paid} / {data.invoices.sent + data.invoices.paid}</dd></div>
          <div><dt>Orders, 7 days</dt><dd>{data.orders_7_days.count} · {money(data.orders_7_days.total)}</dd></div>
          <div><dt>Checkouts started, 7 days</dt><dd>{data.orders_7_days.checkouts_started ?? 0}</dd></div>
        </dl>
      )}
      {(data?.sync_runs || []).length ? (
        <table className="workforce-table" aria-label="Recent syncs">
          <thead><tr><th>Sync</th><th>Result</th><th>When</th></tr></thead>
          <tbody>
            {(data?.sync_runs || []).map((run) => (
              <tr key={run.id}>
                <td>{run.kind}</td>
                <td>{run.status === "failed" ? `Failed: ${run.error}` : `${run.status} · ${run.products_upserted} updated, ${run.products_removed} retired`}</td>
                <td>{relativeTime(run.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

interface Trend {
  id: string;
  url: string;
  platform: string;
  title: string;
  image_url?: string | null;
  status: string;
  share_count: number;
  want_count: number;
  pool?: { target: number; price: number | null; currency: string | null; progress: number | null } | null;
  linked_product?: { id: string; name: string } | null;
  ready: boolean;
}

function TrendsPanel({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState("open");
  const { data, error, load, setError } = useLoad<{ trends: Trend[] }>(
    `/platform/commerce/trends${status ? `?status=${status}` : ""}`,
    accessToken,
  );
  const [editing, setEditing] = useState<Trend | null>(null);
  const [form, setForm] = useState({ target: "10", price: "", currency: "USD", product: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  async function update(trend: Trend, body: Record<string, unknown>, message: string) {
    setBusy(trend.id);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/platform/commerce/trends/${trend.id}`, accessToken, { method: "PUT", body: JSON.stringify(body) });
      setNotice(message);
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The item could not be updated.");
    } finally {
      setBusy("");
    }
  }
  async function invoicePool(trend: Trend) {
    if (!window.confirm(`Send Shopify invoices to the ${trend.want_count} members in this pool?`)) return;
    setBusy(trend.id);
    setError("");
    try {
      const result = await apiRequest<{ sent: number; failed: unknown[]; skipped: number }>(
        `/platform/commerce/trends/${trend.id}/invoices`,
        accessToken,
        { method: "POST" },
      );
      setNotice(`Invoices sent: ${result.sent}. Already invoiced: ${result.skipped}. Failed: ${result.failed.length}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invoices could not be sent.");
    } finally {
      setBusy("");
    }
  }
  async function publish(trend: Trend) {
    setBusy(trend.id);
    setError("");
    try {
      const result = await apiRequest<{ shopify_admin_url: string }>("/platform/commerce/publish-sourced", accessToken, {
        method: "POST",
        body: JSON.stringify({ trend_item_id: trend.id }),
      });
      setNotice("Draft product created in Shopify. Add photos and stock there, then set it Active.");
      window.open(result.shopify_admin_url, "_blank", "noopener");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The product could not be created.");
    } finally {
      setBusy("");
    }
  }
  function savePool(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const body: Record<string, unknown> = {};
    if (form.product.trim()) body.linked_product_id = form.product.trim();
    if (form.price.trim()) {
      body.status = "pooling";
      body.pool_target = Number(form.target);
      body.pool_price = form.price.trim();
      body.pool_currency = form.currency.trim().toUpperCase();
    }
    void update(editing, body, form.product.trim() ? "Linked. Everyone who wanted it was emailed." : "Pool is open.");
  }
  return (
    <section className="control-panel" aria-label="Trend queue">
      <div className="panel-heading">
        <h2>Trend queue</h2>
        <p>
          Every shared link, grouped by item, so "12 want this" is handled once. Link it to a store product, open a pool with a
          group price, then invoice the pool when it's full.
        </p>
      </div>
      <div className="workforce-filters">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">Open</option>
            <option value="pooling">Pooling</option>
            <option value="sourcing">Sourcing</option>
            <option value="closed">Closed</option>
            <option value="dismissed">Dismissed</option>
            <option value="">All</option>
          </select>
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="email-delivery ok" role="status">{notice}</p>}
      {!data ? (
        <p role="status">Loading…</p>
      ) : !(data?.trends || []).length ? (
        <p className="empty-copy">Nothing here yet. Links members paste or share appear here.</p>
      ) : (
        <ul className="commerce-trends">
          {(data?.trends || []).map((trend) => (
            <li key={trend.id} className={trend.ready ? "ready" : ""}>
              {trend.image_url ? <img src={trend.image_url} alt="" /> : <span className="commerce-thumb" />}
              <div>
                <strong>{trend.title}</strong>
                <small>
                  {trend.platform} · {trend.want_count} want · shared {trend.share_count}×
                  {trend.pool ? ` · pool ${trend.want_count}/${trend.pool.target} at ${money(trend.pool.price, trend.pool.currency || "USD")}` : ""}
                  {trend.linked_product ? ` · linked to ${trend.linked_product.name}` : ""}
                  {trend.ready ? " · READY TO INVOICE" : ""}
                </small>
                <a href={trend.url} target="_blank" rel="noreferrer noopener">
                  Open link
                </a>
              </div>
              <div className="record-actions">
                <button type="button" disabled={busy === trend.id} onClick={() => { setEditing(trend); setForm({ target: String(trend.pool?.target || 10), price: trend.pool?.price ? String(trend.pool.price) : "", currency: trend.pool?.currency || "USD", product: trend.linked_product?.id || "" }); }}>
                  Link or pool
                </button>
                {(trend.status === "pooling" || trend.status === "sourcing") && (
                  <button type="button" disabled={busy === trend.id} onClick={() => void invoicePool(trend)}>
                    Invoice pool
                  </button>
                )}
                <button type="button" disabled={busy === trend.id} onClick={() => void publish(trend)}>
                  Publish to Shopify
                </button>
                {trend.status !== "dismissed" && (
                  <button type="button" disabled={busy === trend.id} onClick={() => void update(trend, { status: "dismissed" }, "Dismissed.")}>
                    Dismiss
                  </button>
                )}
              </div>
              {editing?.id === trend.id && (
                <form className="inline-form" onSubmit={savePool} aria-label="Link or pool">
                  <label>
                    Store product id (to link)
                    <input value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} placeholder="FayFort product id" />
                  </label>
                  <label>
                    Pool target
                    <input type="number" min={2} value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} />
                  </label>
                  <label>
                    Group price
                    <input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="45.00" />
                  </label>
                  <label>
                    Currency
                    <input value={form.currency} maxLength={3} onChange={(event) => setForm({ ...form, currency: event.target.value })} />
                  </label>
                  <button className="primary-button" disabled={busy === trend.id}>Save</button>
                  <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface InvoiceRow {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  error: string | null;
  created_at: string;
  invoice_url: string | null;
  request_id: string | null;
  trend_item_id: string | null;
  kind?: "order" | "deposit" | "consultation" | "contact_credits";
  deposit_credit?: number;
}
interface ReadyRow {
  request_id: string;
  request_title: string;
  product_name: string;
  price_amount: number | null;
  currency: string | null;
  can_invoice: boolean;
  deposit?: { amount: number; currency: string; status: string } | null;
}
interface DepositRow {
  id: string;
  request_title: string;
  stage: string;
  tier: "free" | "standard" | "pro";
  rate: number;
  reason: string;
  expected_total: number | null;
  expected_currency: string | null;
  suggested_deposit: number | null;
  created_at: string;
}
const INVOICE_KIND: Record<string, string> = {
  order: "Order",
  deposit: "Sourcing deposit",
  consultation: "Consultation",
  contact_credits: "Contact credits",
};

function DepositsDue({ rows, accessToken, onSent, onError }: {
  rows: DepositRow[];
  accessToken: string;
  onSent: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  async function send(row: DepositRow) {
    const total = Number(totals[row.id] ?? row.expected_total ?? "");
    if (!Number.isFinite(total) || total <= 0) {
      onError("Enter the expected total for this request first.");
      return;
    }
    setBusy(row.id);
    try {
      await apiRequest("/platform/commerce/invoices/deposit", accessToken, {
        method: "POST",
        body: JSON.stringify({ request_id: row.id, expected_total: total, currency: row.expected_currency || "USD" }),
      });
      onSent("Deposit invoice sent. It counts toward the member's order when they buy.");
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "The deposit invoice could not be sent.");
    } finally {
      setBusy("");
    }
  }
  if (!rows.length) return <p className="empty-copy">No open requests waiting for a deposit.</p>;
  return (
    <div className="record-list">
      {rows.map((row) => {
        const value = totals[row.id] ?? (row.expected_total != null ? String(row.expected_total) : "");
        const total = Number(value);
        const deposit = Number.isFinite(total) && total > 0 ? total * row.rate : null;
        return (
          <div className="record" key={row.id}>
            <div>
              <strong>{row.request_title}</strong>
              <small>
                {row.tier.charAt(0).toUpperCase() + row.tier.slice(1)} plan · {row.stage.replaceAll("_", " ")} ·{" "}
                {row.rate === 0 ? "no deposit (Pro in good standing)" : `${Math.round(row.rate * 100)}% deposit`}
                {row.reason === "pro_below_good_standing" ? " · Pro below good standing" : ""}
              </small>
            </div>
            {row.rate > 0 && (
              <div className="record-actions">
                <label className="deposit-total">
                  <span>Expected total ({row.expected_currency || "USD"})</span>
                  <input
                    inputMode="decimal"
                    value={value}
                    placeholder="0.00"
                    onChange={(event) => setTotals((current) => ({ ...current, [row.id]: event.target.value }))}
                  />
                </label>
                <button type="button" disabled={busy === row.id || deposit === null} onClick={() => void send(row)}>
                  {deposit === null ? "Send deposit invoice" : `Send ${money(deposit, row.expected_currency || "USD")} deposit`}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InvoicesPanel({ accessToken }: { accessToken: string }) {
  const { data, error, load, setError } = useLoad<{
    invoices: InvoiceRow[];
    ready_to_invoice: ReadyRow[];
    deposits_due?: DepositRow[];
  }>(
    "/platform/commerce/invoices",
    accessToken,
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  async function send(row: ReadyRow) {
    setBusy(row.request_id);
    setError("");
    try {
      await apiRequest("/platform/commerce/invoices", accessToken, { method: "POST", body: JSON.stringify({ request_id: row.request_id }) });
      setNotice("Invoice sent. Shopify emailed the member, and it shows in their Orders & requests.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invoice could not be sent.");
    } finally {
      setBusy("");
    }
  }
  async function publish(row: ReadyRow) {
    setBusy(row.request_id);
    setError("");
    try {
      const result = await apiRequest<{ shopify_admin_url: string }>("/platform/commerce/publish-sourced", accessToken, {
        method: "POST",
        body: JSON.stringify({ request_id: row.request_id }),
      });
      setNotice("Draft product created in Shopify.");
      window.open(result.shopify_admin_url, "_blank", "noopener");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The product could not be created.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="Invoices">
      <div className="panel-heading">
        <h2>Sourcing invoices</h2>
        <p>
          Take the sourcing deposit when a request comes in (Free 50%, Standard 25%, Pro none while buying regularly),
          then invoice the chosen option. A paid deposit is taken off the order invoice. Payment moves the request to
          "Purchase confirmed" automatically.
        </p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="email-delivery ok" role="status">{notice}</p>}
      <h3 className="newsletter-history-title">Deposits due</h3>
      {!data ? (
        <p role="status">Loading…</p>
      ) : (
        <DepositsDue
          rows={data.deposits_due || []}
          accessToken={accessToken}
          onError={(message) => setError(message)}
          onSent={(message) => {
            setError("");
            setNotice(message);
            void load();
          }}
        />
      )}
      <h3 className="newsletter-history-title">Ready to invoice</h3>
      {!data ? (
        <p role="status">Loading…</p>
      ) : !(data?.ready_to_invoice || []).length ? (
        <p className="empty-copy">No chosen options waiting for an invoice.</p>
      ) : (
        <div className="record-list">
          {(data?.ready_to_invoice || []).map((row) => (
            <div className="record" key={row.request_id}>
              <div>
                <strong>{row.request_title}</strong>
                <small>
                  {row.product_name} · {row.can_invoice ? money(row.price_amount, row.currency || "USD") : "needs a price and currency"}
                  {row.deposit
                    ? row.deposit.status === "paid"
                      ? ` · deposit ${money(row.deposit.amount, row.deposit.currency)} paid, taken off the invoice`
                      : ` · deposit ${money(row.deposit.amount, row.deposit.currency)} not paid yet`
                    : ""}
                </small>
              </div>
              <div className="record-actions">
                <button type="button" disabled={!row.can_invoice || busy === row.request_id} onClick={() => void send(row)}>
                  Send invoice
                </button>
                <button type="button" disabled={busy === row.request_id} onClick={() => void publish(row)}>
                  Publish to Shopify
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className="newsletter-history-title">Sent</h3>
      {(data?.invoices || []).length ? (
        <table className="workforce-table" aria-label="Sent invoices">
          <thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {(data?.invoices || []).map((row) => (
              <tr key={row.id}>
                <td>
                  {row.title}
                  <small>{row.trend_item_id ? "Pool" : INVOICE_KIND[row.kind || "order"] || "Request"}</small>
                </td>
                <td>
                  {money(row.amount, row.currency)}
                  {row.deposit_credit ? <small>less {money(row.deposit_credit, row.currency)} deposit</small> : null}
                </td>
                <td>{row.status}{row.error ? <small>{row.error}</small> : null}</td>
                <td>{relativeTime(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-copy">No invoices yet.</p>
      )}
    </section>
  );
}

interface Sale {
  id: string;
  title: string;
  discount_type: "percentage" | "fixed_amount";
  value: number;
  product_ids: string[];
  code: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  error: string | null;
}

function toIso(local: string) {
  return local ? new Date(local).toISOString() : "";
}

function SalesPanel({ accessToken }: { accessToken: string }) {
  const { data, error, load, setError } = useLoad<{ sales: Sale[] }>("/platform/commerce/sales", accessToken);
  const [form, setForm] = useState({ title: "", type: "percentage", value: "20", products: "", starts: "", ends: "", code: "", limit: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/platform/commerce/sales", accessToken, {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          discount_type: form.type,
          value: form.value,
          product_ids: form.products.split(/[\s,]+/).filter(Boolean),
          starts_at: toIso(form.starts),
          ends_at: toIso(form.ends),
          code: form.code.trim() ? form.code.trim().toUpperCase() : null,
          usage_limit: form.limit ? Number(form.limit) : null,
        }),
      });
      setNotice(form.code.trim() ? "Code created in Shopify." : "Flash sale scheduled. Cards show the countdown while it runs.");
      setForm({ ...form, title: "", code: "", limit: "" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sale could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel(sale: Sale) {
    if (!window.confirm(`Cancel "${sale.title}"? Shopify stops applying it immediately.`)) return;
    try {
      await apiRequest(`/platform/commerce/sales/${sale.id}/cancel`, accessToken, { method: "POST" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sale could not be cancelled.");
    }
  }
  return (
    <section className="control-panel" aria-label="Flash sales">
      <div className="panel-heading">
        <h2>Flash sales and codes</h2>
        <p>Without a code, the sale applies automatically between the start and end and members see a countdown. With a code (for an influencer), only shoppers who enter it get the discount.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="email-delivery ok" role="status">{notice}</p>}
      <form className="inline-form" onSubmit={create} aria-label="New sale">
        <label>Title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>
          Type
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            <option value="percentage">Percent off</option>
            <option value="fixed_amount">Amount off each item</option>
          </select>
        </label>
        <label>Value<input required inputMode="decimal" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></label>
        <label>Product ids<input required value={form.products} onChange={(event) => setForm({ ...form, products: event.target.value })} placeholder="FayFort product ids, comma separated" /></label>
        <label>Starts<input required type="datetime-local" value={form.starts} onChange={(event) => setForm({ ...form, starts: event.target.value })} /></label>
        <label>Ends<input required type="datetime-local" value={form.ends} onChange={(event) => setForm({ ...form, ends: event.target.value })} /></label>
        <label>Code (optional)<input value={form.code} maxLength={40} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="AMAKA20" /></label>
        <label>Uses (optional)<input type="number" min={1} value={form.limit} onChange={(event) => setForm({ ...form, limit: event.target.value })} /></label>
        <button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
      </form>
      {(data?.sales || []).length ? (
        <table className="workforce-table" aria-label="Sales">
          <thead><tr><th>Sale</th><th>Discount</th><th>Window</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data?.sales || []).map((sale) => (
              <tr key={sale.id}>
                <td>{sale.title}<small>{sale.code ? `Code ${sale.code}` : "Automatic"} · {sale.product_ids.length} products</small></td>
                <td>{sale.discount_type === "percentage" ? `${sale.value}%` : money(sale.value)}</td>
                <td>{new Date(sale.starts_at).toLocaleString()}<small>to {new Date(sale.ends_at).toLocaleString()}</small></td>
                <td>{sale.status}{sale.error ? <small>{sale.error}</small> : null}</td>
                <td>{sale.status === "scheduled" && <button type="button" className="text-button" onClick={() => void cancel(sale)}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-copy">No sales yet.</p>
      )}
    </section>
  );
}

interface GiveawayRow {
  id: string;
  title: string;
  prize_text: string;
  starts_at: string;
  ends_at: string;
  winner_count: number;
  status: "draft" | "open" | "drawn" | "cancelled";
  entries: number;
  draw_seed: string | null;
  winners: { member_id: string; rank: number; prize_code: string | null; prize_error: string | null }[];
}

function GiveawaysPanel({ accessToken }: { accessToken: string }) {
  const { data, error, load, setError } = useLoad<{ giveaways: GiveawayRow[] }>("/platform/commerce/giveaways", accessToken);
  const [form, setForm] = useState({ title: "", prize: "", product: "", starts: "", ends: "", winners: "1", description: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  async function act(path: string, init: RequestInit, message: string, key: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await apiRequest(path, accessToken, init);
      setNotice(message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void act(
      "/platform/commerce/giveaways",
      {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          prize_text: form.prize,
          prize_product_id: form.product.trim() || null,
          starts_at: toIso(form.starts),
          ends_at: toIso(form.ends),
          winner_count: Number(form.winners) || 1,
        }),
      },
      "Giveaway saved as a draft. Open it when you're ready.",
      "new",
    );
  }
  return (
    <section className="control-panel" aria-label="Giveaways workspace">
      <div className="panel-heading">
        <h2>Giveaways</h2>
        <p>Members enter from the chat's front page (one entry each). After the end time, draw winners: the draw uses a recorded seed so anyone can repeat it. Winners are emailed; store prizes get a one-time 100% code.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="email-delivery ok" role="status">{notice}</p>}
      <form className="inline-form" onSubmit={create} aria-label="New giveaway">
        <label>Title<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label>Prize<input required maxLength={300} value={form.prize} onChange={(event) => setForm({ ...form, prize: event.target.value })} placeholder="A 24-inch body wave wig" /></label>
        <label>Prize product id (optional)<input value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} /></label>
        <label>Starts<input required type="datetime-local" value={form.starts} onChange={(event) => setForm({ ...form, starts: event.target.value })} /></label>
        <label>Ends<input required type="datetime-local" value={form.ends} onChange={(event) => setForm({ ...form, ends: event.target.value })} /></label>
        <label>Winners<input type="number" min={1} max={50} value={form.winners} onChange={(event) => setForm({ ...form, winners: event.target.value })} /></label>
        <button className="primary-button" disabled={busy === "new"}>Create giveaway</button>
      </form>
      {!data ? (
        <p role="status">Loading…</p>
      ) : !(data?.giveaways || []).length ? (
        <p className="empty-copy">No giveaways yet.</p>
      ) : (
        <div className="record-list">
          {(data?.giveaways || []).map((giveaway) => (
            <div className="record" key={giveaway.id}>
              <div>
                <strong>{giveaway.title} · {giveaway.status}</strong>
                <small>
                  {giveaway.prize_text} · {giveaway.entries} entries · {giveaway.winner_count} winner(s) · ends {new Date(giveaway.ends_at).toLocaleString()}
                </small>
                {giveaway.winners.map((winner) => (
                  <small key={winner.member_id}>
                    #{winner.rank} {winner.member_id.slice(0, 8)}… {winner.prize_code ? `code ${winner.prize_code}` : winner.prize_error ? `prize code failed: ${winner.prize_error}` : "prize handled by the team"}
                  </small>
                ))}
                {giveaway.draw_seed && <small>Draw seed: {giveaway.draw_seed}</small>}
              </div>
              <div className="record-actions">
                {giveaway.status === "draft" && (
                  <button type="button" disabled={!!busy} onClick={() => void act(`/platform/commerce/giveaways/${giveaway.id}/status`, { method: "PUT", body: JSON.stringify({ status: "open" }) }, "Giveaway is open.", giveaway.id)}>
                    Open
                  </button>
                )}
                {giveaway.status === "open" && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      window.confirm(`Draw ${giveaway.winner_count} winner(s) from ${giveaway.entries} entries? This can't be undone.`) &&
                      void act(`/platform/commerce/giveaways/${giveaway.id}/draw`, { method: "POST" }, "Winners drawn and emailed.", giveaway.id)
                    }
                  >
                    Draw winners
                  </button>
                )}
                {(giveaway.status === "draft" || giveaway.status === "open") && (
                  <button type="button" disabled={!!busy} onClick={() => void act(`/platform/commerce/giveaways/${giveaway.id}/status`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }, "Giveaway cancelled.", giveaway.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface CategoryOption { source_ref: string; category: string; group_name?: string | null; product_type: string }
interface MappingProduct { id: string; name: string; product_type: string | null; price_min: number | null; currency: string | null; shopify_admin_url: string | null }

function MappingPanel({ accessToken }: { accessToken: string }) {
  const { data, error, load, setError } = useLoad<{ products: MappingProduct[]; categories: CategoryOption[] }>(
    "/platform/commerce/products?needs_category=true",
    accessToken,
  );
  const categories = data?.categories || [];
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  async function save(product: MappingProduct) {
    if (!choice[product.id]) return;
    setBusy(product.id);
    setError("");
    try {
      await apiRequest(`/platform/commerce/products/${product.id}/category`, accessToken, {
        method: "PUT",
        body: JSON.stringify({ category_ref: choice[product.id] }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The category could not be saved.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="Category mapping">
      <div className="panel-heading">
        <h2>Products that need a FayFort category</h2>
        <p>Shopify products are matched to the 968 FayFort categories by their FayFort category field, product type or tags. The ones below didn't match; pick a category and it's saved to Shopify too. Products that don't belong in the FayFort shop (a service, an ebook) can be tagged fayfort-hide in Shopify instead.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!data ? (
        <p role="status">Loading…</p>
      ) : !(data?.products || []).length ? (
        <p className="empty-copy">Every store product has a category.</p>
      ) : (
        <div className="record-list">
          {(data?.products || []).map((product) => (
            <div className="record" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <small>
                  {product.product_type || "No product type"} · {money(product.price_min, product.currency || "USD")}
                  {product.shopify_admin_url ? (
                    <>
                      {" · "}
                      <a href={product.shopify_admin_url} target="_blank" rel="noreferrer noopener">Open in Shopify</a>
                    </>
                  ) : null}
                </small>
              </div>
              <div className="record-actions">
                <select aria-label={`Category for ${product.name}`} value={choice[product.id] || ""} onChange={(event) => setChoice({ ...choice, [product.id]: event.target.value })}>
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.source_ref} value={category.source_ref}>
                      {category.group_name ? `${category.group_name} › ` : ""}{category.category} · {category.product_type}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={!choice[product.id] || busy === product.id} onClick={() => void save(product)}>
                  Save
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface OrderRow {
  id: string;
  order_name: string | null;
  source: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  total: number | null;
  currency: string | null;
  placed_at: string | null;
  line_items: { title: string; quantity: number }[];
}

function OrdersPanel({ accessToken }: { accessToken: string }) {
  const { data, error } = useLoad<{ orders: OrderRow[] }>("/platform/commerce/orders", accessToken);
  return (
    <section className="control-panel" aria-label="Orders">
      <div className="panel-heading">
        <h2>Orders</h2>
        <p>Orders from FayFort checkouts and paid invoices. Fulfil and refund them in Shopify; members see the status in Orders & requests.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!data ? (
        <p role="status">Loading…</p>
      ) : !(data?.orders || []).length ? (
        <p className="empty-copy">No orders yet.</p>
      ) : (
        <table className="workforce-table" aria-label="Order list">
          <thead><tr><th>Order</th><th>From</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
          <tbody>
            {(data?.orders || []).map((order) => (
              <tr key={order.id}>
                <td>{order.order_name}<small>{order.line_items.map((item) => `${item.quantity}× ${item.title}`).join(", ")}</small></td>
                <td>{order.source}</td>
                <td>{money(order.total, order.currency || "USD")}</td>
                <td>{order.financial_status}<small>{order.fulfillment_status || "unfulfilled"}</small></td>
                <td>{order.placed_at ? relativeTime(order.placed_at) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface BillingStatus {
  configured: boolean;
  mode: "test" | "live" | "not_configured";
  ready: boolean;
  prices: Record<"standard" | "pro", { id: string | null; monthly: number; currency: string }>;
  webhook: { url: string | null; ready: boolean; managed_by: "env" | "fayfort" };
  problem: string | null;
  checked_at: string | null;
  subscribers: Record<"standard" | "pro", number>;
}

/** Member plan billing through Stripe: everything is created automatically once STRIPE_SECRET_KEY is set. */
function BillingPanel({ accessToken }: { accessToken: string }) {
  const { data, error, load, setError } = useLoad<BillingStatus>("/platform/billing/status", accessToken);
  const [busy, setBusy] = useState(false);
  async function setup() {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/platform/billing/setup", accessToken, { method: "POST" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stripe setup failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel" aria-label="Member plans billing">
      <div className="panel-heading">
        <h2>Member plans (Stripe)</h2>
        <p>
          Standard and Pro are monthly Stripe subscriptions. With the Stripe secret key on the API server, FayFort creates
          the products, prices, customer portal and webhook by itself and keeps every member's plan in sync.
        </p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!data ? (
        <p role="status">Loading…</p>
      ) : !data.configured ? (
        <div className="empty-copy">
          Stripe isn't connected. Add <code>STRIPE_SECRET_KEY</code> to the API server's settings and restart it; setup
          then runs automatically.
        </div>
      ) : (
        <>
          <dl className="billing-status">
            <div><dt>Status</dt><dd>{data.ready ? "Ready" : "Needs attention"} · {data.mode === "live" ? "Live mode" : "Test mode"}</dd></div>
            <div><dt>Standard</dt><dd>{money(data.prices.standard.monthly, data.prices.standard.currency.toUpperCase())}/month · {data.subscribers.standard} active</dd></div>
            <div><dt>Pro</dt><dd>{money(data.prices.pro.monthly, data.prices.pro.currency.toUpperCase())}/month · {data.subscribers.pro} active</dd></div>
            <div><dt>Webhook</dt><dd>{data.webhook.ready ? "Connected" : "Not connected"}{data.webhook.url ? ` · ${data.webhook.url}` : ""}</dd></div>
            {data.checked_at && <div><dt>Last checked</dt><dd>{relativeTime(data.checked_at)}</dd></div>}
          </dl>
          {data.problem && <p className="form-error" role="alert">{data.problem}</p>}
          <div className="record-actions">
            <button type="button" disabled={busy} onClick={() => void setup()}>
              {busy ? "Checking Stripe…" : "Run setup and sync now"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
