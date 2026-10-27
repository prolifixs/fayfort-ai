import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { ToolCard } from "./Desks";
import { statusLabel } from "./types";

/** Tool cards for the Sourcing and Fulfillment desks (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R4). */

export type Trend = {
  id: string;
  title: string;
  url: string;
  platform: string;
  image_url?: string | null;
  status: string;
  want_count: number;
  share_count: number;
  pool: { target: number; price: number | null; currency: string | null; deadline: string | null; progress: number | null } | null;
  ready: boolean;
  in_store: boolean;
};
export type DepositDue = {
  request_id: string;
  work_item_id: string;
  title: string;
  stage: string;
  tier: string | null;
  rate: number | null;
  expected_total: number | null;
  currency: string | null;
  suggested_deposit: number | null;
  claimed: boolean;
};
type Overview = { trends: Trend[]; deposits_due: DepositDue[] };
type Product = {
  id: string;
  name: string;
  where: string;
  price_min?: number | null;
  price_max?: number | null;
  currency?: string | null;
  min_order?: number | null;
  lead_time_min_days?: number | null;
  lead_time_max_days?: number | null;
  in_stock?: boolean | null;
  online_store_url?: string | null;
};
type Orders = {
  to_pack: { id: string; order_name: string | null; total: string | number | null; currency: string | null; placed_at: string | null; units: number; work_item_id: string | null; claimed: boolean }[];
  to_pack_count: number;
  shipped_this_week: number;
};

const money = (amount: number | string | null | undefined, currency?: string | null) =>
  amount === null || amount === undefined || amount === "" ? "—" : `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
function age(iso: string | null) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function useSourcingOverview(token: string | null, enabled: boolean, reloadKey: unknown) {
  const [data, setData] = useState<Overview | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!token || !enabled) return;
    let alive = true;
    apiRequest<Overview>("/operations/sourcing/overview", token)
      .then((found) => {
        if (alive && Array.isArray(found?.trends)) setData(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, enabled, reloadKey, nonce]);
  return { data, reload: () => setNonce((value) => value + 1) };
}

export function TrendsCard({ token, trends, onChanged }: { token: string; trends: Trend[]; onChanged: () => void }) {
  const [poolFor, setPoolFor] = useState<string | null>(null);
  const shown = trends.slice(0, 5);
  return (
    <ToolCard title="Trends and group buys" line="Links members keep sharing, most wanted first. Enough people wanting the same thing makes a group buy." count={trends.length} countLabel="trending">
      {shown.length === 0 ? (
        <p className="operations-muted">Nothing shared yet.</p>
      ) : (
        <ul className="ops-trends">
          {shown.map((trend) => (
            <li key={trend.id}>
              <div className="ops-trend-top">
                <a href={trend.url} target="_blank" rel="noreferrer">
                  {trend.title}
                </a>
                <b>{trend.want_count} want this</b>
              </div>
              <div className="ops-trend-meta">
                <span className="ops-chip">{trend.ready ? "Ready to invoice" : trend.status === "pooling" ? "Group buy" : statusLabel(trend.status)}</span>
                {trend.in_store && <span className="ops-chip is-paid">In the store</span>}
                {trend.pool && (
                  <span>
                    {trend.want_count}/{trend.pool.target} at {money(trend.pool.price, trend.pool.currency)}
                  </span>
                )}
              </div>
              {trend.pool?.progress != null && (
                <span className="ops-trend-bar" role="progressbar" aria-label={`${trend.title}: group buy progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(trend.pool.progress * 100)}>
                  <i style={{ width: `${Math.round(trend.pool.progress * 100)}%` }} />
                </span>
              )}
              {trend.status === "open" &&
                (poolFor === trend.id ? (
                  <PoolForm token={token} trend={trend} onDone={() => (setPoolFor(null), onChanged())} onCancel={() => setPoolFor(null)} />
                ) : (
                  <button type="button" className="ops-link-button" onClick={() => setPoolFor(trend.id)}>
                    Start a group buy
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

function PoolForm({ token, trend, onDone, onCancel }: { token: string; trend: Trend; onDone: () => void; onCancel: () => void }) {
  const [target, setTarget] = useState(String(Math.max(10, trend.want_count)));
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [deadline, setDeadline] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/operations/sourcing/trends/${trend.id}/pool`, token, {
        method: "POST",
        body: JSON.stringify({
          target: Number(target),
          price: Number(price),
          currency,
          deadline: deadline ? new Date(`${deadline}T23:59:00`).toISOString() : null,
          note: note.trim() || null,
        }),
      });
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The group buy couldn't be started.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ops-pool-form" onSubmit={save} aria-label={`Start a group buy for ${trend.title}`}>
      <label>
        Buyers needed
        <input type="number" min={2} max={10000} required value={target} onChange={(event) => setTarget(event.target.value)} />
      </label>
      <label>
        Group price each
        <input type="number" min={0.01} step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <label>
        Currency
        <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
          {["USD", "NGN", "GBP", "EUR", "CNY", "GHS", "KES", "ZAR"].map((code) => (
            <option key={code}>{code}</option>
          ))}
        </select>
      </label>
      <label>
        Closes on (optional)
        <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
      </label>
      <label className="ops-pool-note">
        Note for members (optional)
        <input maxLength={500} value={note} placeholder="Ships about 3 weeks after it fills" onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="ops-pool-actions">
        <button className="primary-button" disabled={busy || !price}>
          {busy ? "Starting…" : "Start the group buy"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <small className="operations-muted">Members who want it see the price and join. When it fills, a Group buy item lands on this desk to confirm and invoice everyone.</small>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

export function DepositsCard({ deposits, onOpen }: { deposits: DepositDue[]; onOpen: (workItemId: string) => void }) {
  return (
    <ToolCard title="Deposits due" line="Requests whose member's plan needs a deposit before we buy, and none has been asked for yet." count={deposits.length} countLabel="to ask">
      {deposits.length === 0 ? (
        <p className="operations-muted">None. Every request that needs a deposit has one.</p>
      ) : (
        <ul className="ops-tool-list">
          {deposits.slice(0, 5).map((deposit) => (
            <li key={deposit.request_id}>
              <div>
                <strong>{deposit.title}</strong>
                <small>
                  {deposit.tier ? statusLabel(deposit.tier) : "Plan unknown"}
                  {deposit.rate != null ? ` · ${Math.round(deposit.rate * 100)}%` : ""}
                  {deposit.suggested_deposit != null ? ` · about ${money(deposit.suggested_deposit, deposit.currency)}` : " · set the expected total first"}
                </small>
              </div>
              <button type="button" className="secondary-button" onClick={() => onOpen(deposit.work_item_id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

export function CatalogCard({ token }: { token: string }) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      setProducts((await apiRequest<{ products: Product[] }>(`/operations/catalog?q=${encodeURIComponent(query.trim())}`, token)).products);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The catalog couldn't be searched.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolCard title="Already in the catalog?" line="Search the store and the sourcing catalog before looking for a new supplier.">
      <form className="ops-answers-form" role="search" aria-label="Search the catalog" onSubmit={search}>
        <input type="search" aria-label="Search the catalog" placeholder="lace wig, ankara, satin bonnet…" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" className="secondary-button" disabled={busy || query.trim().length < 2}>
          {busy ? "…" : "Search"}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {products && products.length === 0 && <p className="operations-muted">Not in the catalog yet.</p>}
      {products && products.length > 0 && (
        <ul className="ops-tool-list">
          {products.map((product) => (
            <li key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <small>
                  {product.where}
                  {product.price_min != null ? ` · ${money(product.price_min, product.currency)}${product.price_max && product.price_max !== product.price_min ? `–${Number(product.price_max).toFixed(2)}` : ""}` : ""}
                  {product.min_order ? ` · min ${product.min_order}` : ""}
                  {product.lead_time_min_days ? ` · ${product.lead_time_min_days}–${product.lead_time_max_days || product.lead_time_min_days} days` : ""}
                  {product.where === "Store" && product.in_stock === false ? " · sold out" : ""}
                </small>
              </div>
              {product.online_store_url && (
                <a className="ops-tool-full" href={product.online_store_url} target="_blank" rel="noreferrer">
                  View ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}

export function OrdersCard({ token, enabled, reloadKey, canManage, onOpen }: { token: string; enabled: boolean; reloadKey: unknown; canManage: boolean; onOpen: (workItemId: string) => void }) {
  const [orders, setOrders] = useState<Orders | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiRequest<Orders>("/operations/fulfillment/orders", token)
      .then((found) => {
        if (alive && Array.isArray(found?.to_pack)) setOrders(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, enabled, reloadKey]);
  return (
    <ToolCard
      title="Shop orders"
      line={orders ? `Paid shop orders still to pack, oldest first. ${orders.shipped_this_week} shipped this week.` : "Paid shop orders still to pack, oldest first."}
      count={orders?.to_pack_count}
      countLabel="to pack"
      fullHref={canManage ? "/?page=shop" : undefined}
    >
      {orders && orders.to_pack.length === 0 && <p className="operations-muted">Everything paid is packed.</p>}
      {orders && orders.to_pack.length > 0 && (
        <ul className="ops-tool-list">
          {orders.to_pack.slice(0, 5).map((order) => (
            <li key={order.id}>
              <div>
                <strong>
                  {order.order_name || "Order"} · {order.units} item{order.units === 1 ? "" : "s"}
                </strong>
                <small>
                  {money(order.total, order.currency)} · paid {age(order.placed_at)}
                  {order.claimed ? " · someone has it" : ""}
                </small>
              </div>
              {order.work_item_id && (
                <button type="button" className="secondary-button" onClick={() => onOpen(order.work_item_id!)}>
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}
