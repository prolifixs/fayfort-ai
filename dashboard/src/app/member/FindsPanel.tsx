import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";

/** FayFort Finds (docs/FINDS_PLAN.md): trending products and rare finds, checked in China and released every Monday.
 * What a member sees follows their plan; the page also shows how the team finds them (owner request: show the effort). */
type Access = { level: "free" | "standard" | "pro"; early: boolean; research: boolean; breaks: boolean; maths: boolean; watch_limit: number | null; alerts: boolean; niche_requests: number };
type Break = { min_qty: number; price: number };
type Landed = { min_qty: number; unit_price: number; freight_per_unit: number; landed_per_unit: number; margin_per_unit?: number };
type FindCard = {
  id: string;
  product_id: string;
  lane: "trending" | "rare";
  name: string;
  media_url: string | null;
  media_type: string | null;
  stage: string | null;
  competition: string | null;
  watching: boolean;
  locked: boolean;
  currency?: string;
  price_from?: number | null;
  min_order?: number | null;
  lead_time?: [number | null, number | null];
  check?: string;
  trail?: { scouted_at: string | null; checked_at: string | null; approved_at: string | null; released_at: string | null };
  research?: { why: string | null; platforms: string[]; regions: string[]; china_check: string; china_place: string | null; sample_available: boolean | null };
  price_breaks?: Break[];
  typical_price?: [number | null, number | null];
  landed?: Landed[];
  landed_note?: string | null;
  zone?: string | null;
  description?: string;
  media?: { media_type: string; url: string; alt?: string | null }[];
};
type Step = { title: string; body: string };
type FindsResponse = {
  access: Access;
  process: Step[];
  drop: { id: string; title: string; release_at: string } | null;
  stats: { scouted: number; checked: number; made_it: number } | null;
  finds: FindCard[];
  drops: { id: string; title: string; release_at: string }[];
  next_drop: { title: string; release_at: string; early_at: string; opens_for_you: string } | null;
  watching_count: number;
  countries: string[];
};

const COUNTRY_KEY = "ff_finds_country";
const money = (value: number | null | undefined, currency = "USD") =>
  value === null || value === undefined ? "" : new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const COMPETITION: Record<string, string> = { low: "Low competition", medium: "Some competition", high: "Busy market" };
const PLAN: Record<Access["level"], string> = { free: "Free", standard: "Standard", pro: "Pro" };

function readCountry(): string {
  try {
    return window.localStorage.getItem(COUNTRY_KEY) || "";
  } catch {
    return "";
  }
}
function countryNames(codes: string[]) {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(undefined, { type: "region" });
  } catch {
    names = null;
  }
  return codes.map((code) => ({ code, name: names?.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));
}

export function FindsPanel({ accessToken, onOpenProduct, onUpgrade }: { accessToken: string; onOpenProduct: (productId: string) => void; onUpgrade: () => void }) {
  const [data, setData] = useState<FindsResponse | null>(null);
  const [lane, setLane] = useState<"all" | "trending" | "rare" | "watching">("all");
  const [dropId, setDropId] = useState<string>("");
  const [watching, setWatching] = useState<FindCard[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("find"));
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (dropId) params.set("drop", dropId);
      if (lane === "trending" || lane === "rare") params.set("lane", lane);
      const found = await apiRequest<FindsResponse>(`/members/finds${params.toString() ? `?${params}` : ""}`, accessToken);
      setData(found);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Finds could not be loaded.");
    }
  }, [accessToken, dropId, lane]);
  useEffect(() => {
    if (lane !== "watching") void load();
  }, [lane, load]);
  useEffect(() => {
    if (lane !== "watching") return;
    apiRequest<{ finds: FindCard[] }>("/members/finds/watching", accessToken)
      .then((found) => setWatching(found.finds))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Your watched finds could not be loaded."));
  }, [accessToken, lane]);

  async function toggleWatch(card: FindCard) {
    setError("");
    try {
      await apiRequest(`/members/finds/${card.id}/watch`, accessToken, { method: card.watching ? "DELETE" : "POST" });
      const flip = (list: FindCard[]) => list.map((c) => (c.id === card.id ? { ...c, watching: !c.watching } : c));
      setData((current) => (current ? { ...current, finds: flip(current.finds), watching_count: current.watching_count + (card.watching ? -1 : 1) } : current));
      setWatching((current) => (current ? (card.watching ? current.filter((c) => c.id !== card.id) : current) : current));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This find could not be watched.");
      return false;
    }
  }

  if (!data) {
    return (
      <section className="member-workspace-panel member-finds" aria-label="FayFort Finds">
        {error ? <p className="form-error" role="alert">{error}</p> : <FayfortLoader label="Loading this week's finds…" />}
      </section>
    );
  }
  const access = data.access;
  const cards = lane === "watching" ? watching || [] : data.finds;
  return (
    <section className="member-workspace-panel member-finds" aria-labelledby="member-finds-title">
      <header>
        <small>FAYFORT FINDS</small>
        <h2 id="member-finds-title">{data.drop?.title || "FayFort Finds"}</h2>
        <p>Trending products and rare finds, each checked in China and priced for buying in quantity. New every Monday.</p>
      </header>

      {data.stats && data.stats.made_it > 0 && (
        <p className="member-finds-effort">
          For this drop we looked at <strong>{data.stats.scouted}</strong> products, checked <strong>{data.stats.checked}</strong> in China, and{" "}
          <strong>{data.stats.made_it}</strong> made it.
        </p>
      )}

      <div className={`member-finds-plan is-${access.level}`}>
        <span>
          <strong>Your plan: {PLAN[access.level]}.</strong>{" "}
          {access.level === "free"
            ? "You see each drop a week after it opens, with three finds featured. Standard opens new finds on Monday with the research and prices; Pro two days early."
            : access.level === "standard"
              ? "You see each drop on Monday with the research and price breaks. Pro sees it two days early, with landed costs and margins."
              : "You see each drop two days early, with landed costs and margins for your country."}
          {data.next_drop ? ` Next drop opens for you ${when(data.next_drop.opens_for_you)}.` : ""}
        </span>
        {access.level !== "pro" && (
          <button type="button" className="secondary-button" onClick={onUpgrade}>
            See plans
          </button>
        )}
      </div>

      <div className="member-finds-bar">
        <div className="member-finds-tabs" role="tablist" aria-label="Show">
          {([
            ["all", "All"],
            ["trending", "Trending"],
            ["rare", "Rare finds"],
            ["watching", `Watching${data.watching_count ? ` (${data.watching_count})` : ""}`],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={lane === key} className={lane === key ? "is-on" : undefined} onClick={() => setLane(key)}>
              {label}
            </button>
          ))}
        </div>
        {data.drops.length > 1 && lane !== "watching" && (
          <label className="member-finds-archive">
            Drop
            <select value={dropId || data.drop?.id || ""} onChange={(event) => setDropId(event.target.value)}>
              {data.drops.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {cards.length === 0 ? (
        <div className="member-finds-empty">
          {lane === "watching" ? (
            <p>Nothing watched yet. Tap Watch on a find to hear when its price drops or it's ready to order again.</p>
          ) : data.next_drop ? (
            <p>
              The first drop opens for you {when(data.next_drop.opens_for_you)}. Our team is scouting and checking products in China for it now.
            </p>
          ) : (
            <p>No finds here yet.</p>
          )}
        </div>
      ) : (
        <ul className="member-finds-grid" aria-label="Finds">
          {cards.map((card) => (
            <li key={card.id}>
              <FindTile card={card} onOpen={() => setOpenId(card.id)} onUpgrade={onUpgrade} />
            </li>
          ))}
        </ul>
      )}

      <section className="member-finds-process" aria-labelledby="member-finds-how">
        <h3 id="member-finds-how">How we find them</h3>
        <ol>
          {data.process.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.body}</span>
            </li>
          ))}
        </ol>
      </section>

      {access.niche_requests > 0 && <NicheRequest accessToken={accessToken} />}

      {openId && (
        <FindSheet
          accessToken={accessToken}
          findId={openId}
          countries={data.countries}
          onClose={() => setOpenId(null)}
          onToggleWatch={toggleWatch}
          onOpenProduct={onOpenProduct}
          onUpgrade={onUpgrade}
        />
      )}
    </section>
  );
}

function FindTile({ card, onOpen, onUpgrade }: { card: FindCard; onOpen: () => void; onUpgrade: () => void }) {
  if (card.locked) {
    return (
      <div className="member-find-tile is-locked">
        <span className="member-find-media">{card.media_url && <img src={card.media_url} alt="" loading="lazy" />}</span>
        <span className="member-find-body">
          <span className={`member-find-lane is-${card.lane}`}>{card.lane === "rare" ? "Rare find" : "Trending"}</span>
          <strong>Unlock with Standard</strong>
          <button type="button" className="text-button" onClick={onUpgrade}>
            See plans
          </button>
        </span>
      </div>
    );
  }
  return (
    <button type="button" className="member-find-tile" onClick={onOpen}>
      <span className="member-find-media">
        {card.media_url ? card.media_type === "video" ? <video src={card.media_url} muted playsInline preload="metadata" /> : <img src={card.media_url} alt="" loading="lazy" /> : null}
        {card.watching && <span className="member-find-watching">Watching</span>}
      </span>
      <span className="member-find-body">
        <span className={`member-find-lane is-${card.lane}`}>
          {card.lane === "rare" ? "Rare find" : "Trending"}
          {card.stage ? ` · ${card.stage}` : card.competition ? ` · ${COMPETITION[card.competition] || ""}` : ""}
        </span>
        <strong>{card.name}</strong>
        {card.check && <small>✓ {card.check}</small>}
        <small>
          {card.price_breaks?.length
            ? `From ${money(Math.min(...card.price_breaks.map((b) => b.price)), card.currency)} a unit in quantity`
            : card.price_from
              ? `From ${money(card.price_from, card.currency)}`
              : "Ask us for a price"}
        </small>
      </span>
    </button>
  );
}

function FindSheet({
  accessToken,
  findId,
  countries,
  onClose,
  onToggleWatch,
  onOpenProduct,
  onUpgrade,
}: {
  accessToken: string;
  findId: string;
  countries: string[];
  onClose: () => void;
  onToggleWatch: (card: FindCard) => Promise<boolean>;
  onOpenProduct: (productId: string) => void;
  onUpgrade: () => void;
}) {
  const [card, setCard] = useState<FindCard | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [country, setCountry] = useState(readCountry);
  const [error, setError] = useState("");
  const names = useMemo(() => countryNames(countries), [countries]);

  useEffect(() => {
    let alive = true;
    const query = country ? `?country=${encodeURIComponent(country)}` : "";
    apiRequest<{ find: FindCard; access: Access }>(`/members/finds/${findId}${query}`, accessToken)
      .then((found) => {
        if (!alive) return;
        setCard(found.find);
        setAccess(found.access);
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "This find could not be loaded."));
    return () => {
      alive = false;
    };
  }, [accessToken, country, findId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function chooseCountry(code: string) {
    setCountry(code);
    try {
      window.localStorage.setItem(COUNTRY_KEY, code);
    } catch {
      /* the choice just isn't remembered */
    }
  }
  const cover = card?.media?.[0];
  const trail = card?.trail;
  return (
    <div className="member-find-sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <article className="member-find-sheet" role="dialog" aria-modal="true" aria-label={card?.name || "Find"}>
        <button type="button" className="icon-button member-find-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {!card ? (
          error ? <p className="form-error" role="alert">{error}</p> : <FayfortLoader label="Loading the find…" />
        ) : (
          <>
            {cover && (
              <div className="member-find-sheet-media">
                {cover.media_type === "video" ? <video src={cover.url} controls playsInline /> : <img src={cover.url} alt={cover.alt || card.name} />}
              </div>
            )}
            <span className={`member-find-lane is-${card.lane}`}>
              {card.lane === "rare" ? "Rare find" : "Trending"}
              {card.stage ? ` · ${card.stage}` : card.competition ? ` · ${COMPETITION[card.competition] || ""}` : ""}
            </span>
            <h3>{card.name}</h3>
            {trail && (
              <ol className="member-find-trail" aria-label="How this find was made">
                {trail.scouted_at && <li>Spotted {day(trail.scouted_at)}</li>}
                {trail.checked_at && <li>{card.check || "Checked in China"} {day(trail.checked_at)}</li>}
                {trail.approved_at && <li>Priced {day(trail.approved_at)}</li>}
                {trail.released_at && <li>Released {day(trail.released_at)}</li>}
              </ol>
            )}
            {card.research ? (
              <section className="member-find-block" aria-label="Why it's a find">
                <h4>Why it's a find</h4>
                {card.research.why && <p>{card.research.why}</p>}
                <dl>
                  {card.research.platforms.length > 0 && (
                    <div>
                      <dt>Moving on</dt>
                      <dd>{card.research.platforms.join(", ")}</dd>
                    </div>
                  )}
                  {card.research.regions.length > 0 && (
                    <div>
                      <dt>Where</dt>
                      <dd>{card.research.regions.join(", ")}</dd>
                    </div>
                  )}
                  <div>
                    <dt>China check</dt>
                    <dd>
                      {card.research.china_check}
                      {card.research.china_place ? `, ${card.research.china_place}` : ""}
                      {card.research.sample_available ? " · sample possible" : ""}
                    </dd>
                  </div>
                  {card.min_order ? (
                    <div>
                      <dt>Minimum order</dt>
                      <dd>{card.min_order}</dd>
                    </div>
                  ) : null}
                  {card.lead_time?.[0] !== null && card.lead_time?.[0] !== undefined ? (
                    <div>
                      <dt>Lead time</dt>
                      <dd>
                        {card.lead_time[0]}
                        {card.lead_time[1] && card.lead_time[1] !== card.lead_time[0] ? `–${card.lead_time[1]}` : ""} days
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : (
              <p className="member-perk-notice">The research, China check and quantity prices are on Standard and Pro.</p>
            )}
            {card.price_breaks && card.price_breaks.length > 0 && (
              <section className="member-find-block" aria-label="Price per unit">
                <h4>Our price per unit</h4>
                <table className="member-find-table">
                  <thead>
                    <tr>
                      <th scope="col">Quantity</th>
                      <th scope="col">Per unit</th>
                      {card.landed && card.landed.length > 0 && <th scope="col">Landed{card.zone ? ` (${card.zone})` : ""}</th>}
                      {card.landed?.some((l) => l.margin_per_unit !== undefined) && <th scope="col">Margin</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {card.price_breaks.map((b, index) => {
                      const next = card.price_breaks![index + 1];
                      const landed = card.landed?.find((l) => l.min_qty === b.min_qty);
                      return (
                        <tr key={b.min_qty}>
                          <td>{next ? `${b.min_qty}–${next.min_qty - 1}` : `${b.min_qty}+`}</td>
                          <td>{money(b.price, card.currency)}</td>
                          {card.landed && card.landed.length > 0 && <td>{landed ? money(landed.landed_per_unit, card.currency) : ""}</td>}
                          {card.landed?.some((l) => l.margin_per_unit !== undefined) && (
                            <td className={landed?.margin_per_unit !== undefined && landed.margin_per_unit < 0 ? "is-negative" : undefined}>
                              {landed?.margin_per_unit !== undefined ? money(landed.margin_per_unit, card.currency) : ""}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {access?.maths ? (
                  <div className="member-find-landed">
                    <label>
                      Ship to
                      <select value={country} onChange={(event) => chooseCountry(event.target.value)}>
                        <option value="">Choose your country</option>
                        {names.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small>
                      {card.landed && card.landed.length
                        ? `Landed = our price + air freight and handling per unit, an estimate.${card.typical_price?.[0] ? ` Margin at the usual selling price of ${money(card.typical_price[0], card.currency)}${card.typical_price[1] && card.typical_price[1] !== card.typical_price[0] ? `–${money(card.typical_price[1], card.currency)}` : ""}.` : ""} Duties and local delivery aren't included.`
                        : card.landed_note || (country ? "No landed estimate for this find yet; ask us in the chat." : "Choose your country to see the landed cost and margin.")}
                    </small>
                  </div>
                ) : (
                  <p className="member-find-upsell">
                    Landed cost to your country and the margin are on Pro.{" "}
                    <button type="button" className="text-button" onClick={onUpgrade}>
                      See plans
                    </button>
                  </p>
                )}
              </section>
            )}
            {card.description && <p className="member-find-description">{card.description}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="member-find-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  if (await onToggleWatch(card)) setCard({ ...card, watching: !card.watching });
                }}
              >
                {card.watching ? "Watching ✓" : "Watch"}
              </button>
              <button type="button" className="primary-button" onClick={() => onOpenProduct(card.product_id)}>
                Order or request a batch
              </button>
            </div>
            <small className="member-deposit-note">
              {access?.alerts
                ? "Watching tells you when the price drops or it's ready to order again."
                : "On Free you can watch 5 finds; alerts come with Standard and Pro."}
            </small>
          </>
        )}
      </article>
    </div>
  );
}

function NicheRequest({ accessToken }: { accessToken: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<{ left: number }>("/members/finds/niche-requests", accessToken, { method: "POST", body: JSON.stringify({ text: text.trim() }) });
      setText("");
      setMessage(`Sent. Our team scouts it and replies in your chat. ${result.left} request${result.left === 1 ? "" : "s"} left this month.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your request could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="member-perk member-finds-niche" onSubmit={(event) => void send(event)}>
      <div className="member-perk-head">
        <div>
          <h3>Research a niche for me</h3>
          <p>Pro: twice a month, tell us what you sell and we scout that niche for you.</p>
        </div>
      </div>
      <label htmlFor="member-finds-niche">What should we look for?</label>
      <textarea id="member-finds-niche" rows={3} maxLength={1000} value={text} placeholder="e.g. Satin bonnets and edge brushes I can sell in Lagos, under $3 a unit" onChange={(event) => setText(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="member-perk-notice" role="status">{message}</p>}
      <div className="member-perk-actions">
        <button className="primary-button" disabled={busy || text.trim().length < 10}>
          {busy ? "Sending…" : "Send to the team"}
        </button>
      </div>
    </form>
  );
}
