/**
 * Products → Finds (docs/FINDS_PLAN.md): the Store team's desk for FayFort Finds. Scout what's moving, check it in
 * China, price it for resellers, then the listing goes to review and an administrator publishes it into a weekly drop.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import "./store-team.css";

type Lane = "trending" | "rare";
type Status = "scouted" | "checked" | "not_obtainable" | "in_review" | "scheduled" | "released" | "retired";
type Break = { min_qty: number; price: number };
type Drop = { id: string; title: string; early_at: string; release_at: string; catalog_at: string; target_count: number; state: string; count?: number };
export type Find = {
  id: string;
  lane: Lane;
  status: Status;
  stage: string | null;
  competition: string | null;
  signal_platforms: string[];
  signal_regions: string[];
  why: string | null;
  scout_note: string | null;
  china_check: "in_person" | "supplier" | "online" | null;
  china_place: string | null;
  unit_cost_min: number | null;
  unit_cost_max: number | null;
  cost_currency: string;
  supplier_moq: number | null;
  sample_available: boolean | null;
  china_note: string | null;
  sell_price_min: number | null;
  sell_price_max: number | null;
  price_breaks: Break[];
  unit_weight_kg: number | null;
  scouted_at: string;
  checked_at: string | null;
  missing: string[];
  listing_id: string | null;
  listing?: { id: string; title: string; status: string; cover: { url: string; media_type?: string } | null };
  product?: { id: string; name: string; media_url: string | null; active: boolean };
  drop?: Drop;
};
type Rate = { zone: string; label: string; air_per_kg: number | null; handling_per_unit: number };

const STATUS_LABEL: Record<Status, string> = {
  scouted: "Scouted",
  checked: "Checked in China",
  not_obtainable: "Not obtainable",
  in_review: "In review",
  scheduled: "In a drop",
  released: "Released",
  retired: "Retired",
};
const PLATFORMS: [string, string][] = [
  ["tiktok_shop", "TikTok Shop"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["amazon", "Amazon"],
  ["google_trends", "Google searches"],
  ["markets", "Wholesale markets"],
  ["members", "FayFort members"],
  ["other", "Other shops"],
];
const FILTERS: [string, string][] = [
  ["open", "Being prepared"],
  ["live", "In drops"],
  ["not_obtainable", "Not obtainable"],
  ["all", "All"],
];
const dateText = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const errorText = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);
const numOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="st-field">
      <span className="st-label">{label}</span>
      {children}
      {hint && <small className="operations-muted">{hint}</small>}
    </label>
  );
}

export function FindsDesk({ token, canManage, onOpenListing }: { token: string; canManage: boolean; onOpenListing: (listingId: string) => void }) {
  const [filter, setFilter] = useState("open");
  const [items, setItems] = useState<Find[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ finds: Find[]; drops: Drop[] }>(`/operations/finds?status=${filter}`, token);
      setItems(data.finds || []);
      setDrops(data.drops || []);
    } catch (reason) {
      setError(errorText(reason, "Finds could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [filter, token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function scout(lane: Lane) {
    setError("");
    try {
      const data = await apiRequest<{ find: Find }>("/operations/finds", token, { method: "POST", body: JSON.stringify({ lane }) });
      setFilter("open");
      await load();
      setOpenId(data.find.id);
    } catch (reason) {
      setError(errorText(reason, "The find could not be started."));
    }
  }

  const upcoming = drops.filter((d) => d.state !== "catalog");
  return (
    <div className="fd">
      <section className="fd-intro" aria-label="How Finds work">
        <div>
          <h3>FayFort Finds</h3>
          <p className="operations-muted">
            Trending products and rare finds for paid members. Scout it, check it in China, price it for resellers, then fill in the
            listing and send it for review. An administrator publishes it into the next Monday drop (Pro sees it 48 hours early).
          </p>
        </div>
        <div className="fd-scout">
          <button type="button" className="primary-button" onClick={() => void scout("trending")}>
            Scout a trending find
          </button>
          <button type="button" className="secondary-button" onClick={() => void scout("rare")}>
            Scout a rare find
          </button>
        </div>
      </section>
      {upcoming.length > 0 && (
        <ul className="fd-drops" aria-label="Upcoming drops">
          {upcoming.slice(0, 4).map((drop) => (
            <li key={drop.id} className={`is-${drop.state}`}>
              <strong>{drop.title}</strong>
              <span>
                {drop.count ?? 0} of {drop.target_count} finds
              </span>
              <small>
                {drop.state === "planned" ? `Pro ${dateText(drop.early_at)} · everyone ${dateText(drop.release_at)}` : drop.state === "early" ? "Open for Pro" : "Released"}
              </small>
              <meter min={0} max={drop.target_count} value={drop.count ?? 0} aria-label={`${drop.title} filled`} />
            </li>
          ))}
        </ul>
      )}
      <div className="st-tabs" role="tablist" aria-label="Which finds">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => { setFilter(key); setOpenId(null); }}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className={openId ? "st-split has-editor" : "st-split"}>
        <div className="st-list-pane">
          {loading && <p className="operations-muted">Loading…</p>}
          {!loading && items.length === 0 && <p className="operations-empty-copy">No finds here yet. Start with Scout a trending find or Scout a rare find.</p>}
          <ul className="st-list" aria-label="Finds">
            {items.map((find) => {
              const cover = find.product?.media_url || find.listing?.cover?.url;
              return (
                <li key={find.id}>
                  <button type="button" className={openId === find.id ? "st-row-button is-open" : "st-row-button"} onClick={() => setOpenId(find.id)}>
                    {cover ? <img className="st-thumb" src={cover} alt="" loading="lazy" /> : <span className="st-thumb is-empty" aria-hidden="true">No photo</span>}
                    <span className="st-row-text">
                      <strong>{find.product?.name || find.listing?.title || "Untitled find"}</strong>
                      <small>
                        {find.lane === "rare" ? "Rare find" : "Trending"}
                        {find.missing.length ? ` · ${find.missing.length} to do` : ""}
                        {find.drop ? ` · ${find.drop.title}` : ""}
                      </small>
                    </span>
                    <span className={`st-pill fd-pill is-${find.status}`}>{STATUS_LABEL[find.status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {canManage && <ShippingRates token={token} />}
        </div>
        {openId && (
          <div className="st-editor-pane">
            <button type="button" className="operations-back-to-queue" onClick={() => setOpenId(null)}>
              ← Back to the list
            </button>
            <FindEditor key={openId} token={token} findId={openId} canManage={canManage} drops={upcoming} onChanged={() => void load()} onOpenListing={onOpenListing} />
          </div>
        )}
      </div>
    </div>
  );
}

type Draft = Record<string, string | boolean | string[] | null>;
const toDraft = (f: Find): Draft => ({
  lane: f.lane,
  stage: f.stage || "",
  competition: f.competition || "",
  signal_platforms: f.signal_platforms,
  signal_regions: f.signal_regions.join(", "),
  why: f.why || "",
  scout_note: f.scout_note || "",
  china_check: f.china_check || "",
  china_place: f.china_place || "",
  unit_cost_min: f.unit_cost_min?.toString() ?? "",
  unit_cost_max: f.unit_cost_max?.toString() ?? "",
  cost_currency: f.cost_currency || "CNY",
  supplier_moq: f.supplier_moq?.toString() ?? "",
  sample_available: f.sample_available === null ? "" : f.sample_available ? "yes" : "no",
  china_note: f.china_note || "",
  sell_price_min: f.sell_price_min?.toString() ?? "",
  sell_price_max: f.sell_price_max?.toString() ?? "",
  unit_weight_kg: f.unit_weight_kg?.toString() ?? "",
});

export function FindEditor({
  token,
  findId,
  canManage,
  drops,
  onChanged,
  onOpenListing,
}: {
  token: string;
  findId: string;
  canManage: boolean;
  drops: Drop[];
  onChanged: () => void;
  onOpenListing: (listingId: string) => void;
}) {
  const [find, setFind] = useState<Find | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [breaks, setBreaks] = useState<{ min_qty: string; price: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");

  const take = useCallback((next: Find) => {
    setFind(next);
    setDraft(toDraft(next));
    setBreaks(next.price_breaks.length ? next.price_breaks.map((b) => ({ min_qty: String(b.min_qty), price: String(b.price) })) : [{ min_qty: "1", price: "" }]);
  }, []);
  useEffect(() => {
    apiRequest<{ find: Find }>(`/operations/finds/${findId}`, token)
      .then((data) => take(data.find))
      .catch((reason) => setError(errorText(reason, "The find could not be loaded.")));
  }, [findId, take, token]);

  if (!find) return error ? <p className="form-error" role="alert">{error}</p> : <p className="operations-muted">Loading…</p>;
  const closed = ["not_obtainable", "retired"].includes(find.status);
  const set = (key: string, value: Draft[string]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved("");
  };
  const text = (key: string) => String(draft[key] ?? "");

  function body() {
    return {
      lane: draft.lane,
      stage: draft.lane === "trending" ? text("stage") || null : null,
      competition: draft.lane === "rare" ? text("competition") || null : null,
      signal_platforms: draft.signal_platforms,
      signal_regions: text("signal_regions").split(",").map((r) => r.trim()).filter(Boolean),
      why: text("why"),
      scout_note: text("scout_note"),
      china_check: text("china_check") || null,
      china_place: text("china_place"),
      unit_cost_min: numOrNull(text("unit_cost_min")),
      unit_cost_max: numOrNull(text("unit_cost_max")),
      cost_currency: text("cost_currency") || "CNY",
      supplier_moq: numOrNull(text("supplier_moq")),
      sample_available: draft.sample_available === "" ? null : draft.sample_available === "yes",
      china_note: text("china_note"),
      sell_price_min: numOrNull(text("sell_price_min")),
      sell_price_max: numOrNull(text("sell_price_max")),
      unit_weight_kg: numOrNull(text("unit_weight_kg")),
      price_breaks: breaks.filter((b) => b.min_qty.trim() && b.price.trim()).map((b) => ({ min_qty: Number(b.min_qty), price: Number(b.price) })),
    };
  }
  async function act(path: string, payload?: unknown, message = "Saved.") {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const data = await apiRequest<{ find: Find }>(`/operations/finds/${findId}${path}`, token, {
        method: path ? "POST" : "PATCH",
        body: JSON.stringify(payload ?? body()),
      });
      take(data.find);
      setSaved(message);
      onChanged();
    } catch (reason) {
      setError(errorText(reason, "The find could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  async function saveThenCheck() {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/operations/finds/${findId}`, token, { method: "PATCH", body: JSON.stringify(body()) });
      const data = await apiRequest<{ find: Find }>(`/operations/finds/${findId}/checked`, token, { method: "POST", body: "{}" });
      take(data.find);
      setSaved("Checked in China. Now finish the listing and send it for review.");
      onChanged();
    } catch (reason) {
      setError(errorText(reason, "The China check could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="fd-editor" aria-label="Find research">
      <header className="fd-editor-head">
        <div>
          <small>{find.lane === "rare" ? "Rare find" : "Trending find"} · scouted {dateText(find.scouted_at)}</small>
          <h3>{find.product?.name || find.listing?.title || "Untitled find"}</h3>
        </div>
        <span className={`st-pill fd-pill is-${find.status}`}>{STATUS_LABEL[find.status]}</span>
      </header>
      {find.missing.length > 0 && !closed && (
        <p className="fd-missing" role="status">
          Still to do: {find.missing.join(", ")}.
        </p>
      )}
      <fieldset className="fd-section" disabled={closed || busy}>
        <legend>1. What you saw</legend>
        <div className="fd-grid">
          <Field label="Lane">
            <select value={text("lane")} onChange={(e) => set("lane", e.target.value)}>
              <option value="trending">Trending</option>
              <option value="rare">Rare find</option>
            </select>
          </Field>
          {draft.lane === "trending" ? (
            <Field label="Trend stage">
              <select value={text("stage")} onChange={(e) => set("stage", e.target.value)}>
                <option value="">Choose…</option>
                <option value="rising">Rising</option>
                <option value="peaking">Peaking</option>
                <option value="steady">Steady seller</option>
              </select>
            </Field>
          ) : (
            <Field label="Competition">
              <select value={text("competition")} onChange={(e) => set("competition", e.target.value)}>
                <option value="">Choose…</option>
                <option value="low">Low: few sellers</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          )}
        </div>
        <div className="fd-chips" role="group" aria-label="Where it's moving">
          {PLATFORMS.map(([key, label]) => {
            const on = (draft.signal_platforms as string[] | undefined)?.includes(key);
            return (
              <label key={key} className={on ? "is-on" : undefined}>
                <input
                  type="checkbox"
                  checked={!!on}
                  onChange={(e) => {
                    const current = (draft.signal_platforms as string[]) || [];
                    set("signal_platforms", e.target.checked ? [...current, key] : current.filter((p) => p !== key));
                  }}
                />
                {label}
              </label>
            );
          })}
        </div>
        <Field label="Countries or regions" hint="Comma separated, for example US, UK, Nigeria.">
          <input value={text("signal_regions")} onChange={(e) => set("signal_regions", e.target.value)} />
        </Field>
        <Field label="Why it's a find (members see this)" hint="In your own words: what's happening and why a reseller should care. Don't paste other tools' figures.">
          <textarea rows={3} maxLength={600} value={text("why")} onChange={(e) => set("why", e.target.value)} />
        </Field>
        <Field label="Scout notes (only the team sees this)" hint="Figures from Kalodata or other tools, links, competitors.">
          <textarea rows={3} maxLength={2000} value={text("scout_note")} onChange={(e) => set("scout_note", e.target.value)} />
        </Field>
      </fieldset>

      <fieldset className="fd-section" disabled={closed || busy}>
        <legend>2. China check</legend>
        <div className="fd-grid">
          <Field label="How it was checked">
            <select value={text("china_check")} onChange={(e) => set("china_check", e.target.value)}>
              <option value="">Not yet</option>
              <option value="in_person">In person (market or factory)</option>
              <option value="supplier">With a supplier</option>
              <option value="online">Online (1688, Alibaba)</option>
            </select>
          </Field>
          <Field label="Where (members see this)" hint="For example Baiyun market, Guangzhou.">
            <input maxLength={120} value={text("china_place")} onChange={(e) => set("china_place", e.target.value)} />
          </Field>
          <Field label="Unit cost from">
            <input inputMode="decimal" value={text("unit_cost_min")} onChange={(e) => set("unit_cost_min", e.target.value)} />
          </Field>
          <Field label="Unit cost to">
            <input inputMode="decimal" value={text("unit_cost_max")} onChange={(e) => set("unit_cost_max", e.target.value)} />
          </Field>
          <Field label="Cost currency">
            <select value={text("cost_currency")} onChange={(e) => set("cost_currency", e.target.value)}>
              <option value="CNY">CNY</option>
              <option value="USD">USD</option>
            </select>
          </Field>
          <Field label="Supplier's minimum order">
            <input inputMode="numeric" value={text("supplier_moq")} onChange={(e) => set("supplier_moq", e.target.value)} />
          </Field>
          <Field label="Sample possible?">
            <select value={text("sample_available")} onChange={(e) => set("sample_available", e.target.value)}>
              <option value="">Not asked</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
        <Field label="China notes (only the team sees this)" hint="Supplier, contact, stall, quality notes.">
          <textarea rows={2} maxLength={2000} value={text("china_note")} onChange={(e) => set("china_note", e.target.value)} />
        </Field>
        {["scouted", "checked"].includes(find.status) && (
          <div className="fd-actions">
            <button type="button" className="secondary-button" onClick={() => void saveThenCheck()}>
              {find.status === "checked" ? "Save the check again" : "Mark as checked in China"}
            </button>
            {closing ? (
              <span className="fd-close">
                <input aria-label="Why it can't be got" placeholder="Why it can't be got" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="secondary-button danger" onClick={() => void act("/not-obtainable", { reason }, "Closed as not obtainable.")}>
                  Close it
                </button>
              </span>
            ) : (
              <button type="button" className="text-button" onClick={() => setClosing(true)}>
                Not obtainable
              </button>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="fd-section" disabled={closed || busy}>
        <legend>3. Price for resellers</legend>
        <p className="operations-muted">Our price per unit (USD, commission included) at each quantity. Members on Standard and Pro see these.</p>
        <table className="fd-breaks">
          <thead>
            <tr>
              <th scope="col">From quantity</th>
              <th scope="col">Price per unit (USD)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {breaks.map((b, index) => (
              <tr key={index}>
                <td>
                  <input aria-label={`Break ${index + 1} quantity`} inputMode="numeric" value={b.min_qty} onChange={(e) => setBreaks((all) => all.map((x, i) => (i === index ? { ...x, min_qty: e.target.value } : x)))} />
                </td>
                <td>
                  <input aria-label={`Break ${index + 1} price`} inputMode="decimal" value={b.price} onChange={(e) => setBreaks((all) => all.map((x, i) => (i === index ? { ...x, price: e.target.value } : x)))} />
                </td>
                <td>
                  <button type="button" className="text-button" onClick={() => setBreaks((all) => all.filter((_, i) => i !== index))} aria-label={`Remove break ${index + 1}`}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {breaks.length < 6 && (
          <button type="button" className="text-button" onClick={() => setBreaks((all) => [...all, { min_qty: "", price: "" }])}>
            + Add a price break
          </button>
        )}
        <div className="fd-grid">
          <Field label="Usual selling price from (USD)" hint="What resellers charge, for Pro's margin.">
            <input inputMode="decimal" value={text("sell_price_min")} onChange={(e) => set("sell_price_min", e.target.value)} />
          </Field>
          <Field label="Usual selling price to (USD)">
            <input inputMode="decimal" value={text("sell_price_max")} onChange={(e) => set("sell_price_max", e.target.value)} />
          </Field>
          <Field label="Weight of one unit (kg)" hint="Packed weight, for the landed estimate.">
            <input inputMode="decimal" value={text("unit_weight_kg")} onChange={(e) => set("unit_weight_kg", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="fd-saved" role="status">{saved}</p>}
      {!closed && (
        <div className="fd-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={() => void act("")}>
            {busy ? "Saving…" : "Save research"}
          </button>
        </div>
      )}

      <section className="fd-section" aria-label="Listing and drop">
        <h4>4. Listing and drop</h4>
        {find.listing_id ? (
          <p>
            Photos, title, category and the rough price are on the listing{find.listing ? ` (${find.listing.status.replace("_", " ")})` : ""}.{" "}
            <button type="button" className="ops-link-button" onClick={() => onOpenListing(find.listing_id!)}>
              Open the listing
            </button>
          </p>
        ) : null}
        {find.drop ? (
          <p>
            In <strong>{find.drop.title}</strong>: Pro {dateText(find.drop.early_at)}, everyone {dateText(find.drop.release_at)}, regular catalog from {dateText(find.drop.catalog_at)}.
          </p>
        ) : (
          <p className="operations-muted">When an administrator publishes the listing, the find goes into the next drop with room.</p>
        )}
        {canManage && find.status === "scheduled" && drops.length > 1 && (
          <Field label="Move to another drop">
            <select
              value={find.drop?.id || ""}
              onChange={(e) => void act("/drop", { drop_id: e.target.value }, "Moved.")}
            >
              {drops
                .filter((d) => d.state === "planned")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({d.count ?? 0} of {d.target_count})
                  </option>
                ))}
            </select>
          </Field>
        )}
      </section>
    </article>
  );
}

function ShippingRates({ token }: { token: string }) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { air: string; handling: string }>>({});
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || rates) return;
    apiRequest<{ rates: Rate[] }>("/operations/finds/shipping-rates", token)
      .then((data) => {
        setRates(data.rates);
        setDraft(Object.fromEntries(data.rates.map((r) => [r.zone, { air: r.air_per_kg?.toString() ?? "", handling: r.handling_per_unit ? String(r.handling_per_unit) : "" }])));
      })
      .catch((reason) => setMessage(errorText(reason, "Rates could not be loaded.")));
  }, [open, rates, token]);
  async function save() {
    setMessage("");
    try {
      const data = await apiRequest<{ rates: Rate[] }>("/operations/finds/shipping-rates", token, {
        method: "PUT",
        body: JSON.stringify({ rates: (rates || []).map((r) => ({ zone: r.zone, air_per_kg: numOrNull(draft[r.zone]?.air || ""), handling_per_unit: numOrNull(draft[r.zone]?.handling || "") ?? 0 })) }),
      });
      setRates(data.rates);
      setMessage("Shipping rates saved. Pro members see landed estimates for zones with a rate.");
    } catch (reason) {
      setMessage(errorText(reason, "Rates could not be saved."));
    }
  }
  return (
    <details className="fd-rates" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Shipping rates for landed estimates</summary>
      <p className="operations-muted">Air freight per kilo to each region, plus any handling per unit. A region with no rate shows no estimate.</p>
      {rates && (
        <table className="fd-breaks">
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col">USD per kg</th>
              <th scope="col">Handling per unit</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.zone}>
                <th scope="row">{r.label}</th>
                <td>
                  <input aria-label={`${r.label} per kg`} inputMode="decimal" value={draft[r.zone]?.air ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.zone]: { ...d[r.zone], air: e.target.value } }))} />
                </td>
                <td>
                  <input aria-label={`${r.label} handling`} inputMode="decimal" value={draft[r.zone]?.handling ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.zone]: { ...d[r.zone], handling: e.target.value } }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rates && (
        <button type="button" className="secondary-button" onClick={() => void save()}>
          Save rates
        </button>
      )}
      {message && <p className="operations-muted" role="status">{message}</p>}
    </details>
  );
}
