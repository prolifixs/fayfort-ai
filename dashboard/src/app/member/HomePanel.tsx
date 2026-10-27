import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import {
  memberFacingText,
  memberStageText,
  requestIsDone,
  requestProgressIndex,
  requestProgressStages,
  type MemberRequestRow,
} from "../requests/requestShared";
import { PANEL_PATHS, type MemberPanel } from "./memberRoutes";
import { timeLeft, type Giveaway, type ShopCard, type ShopHome, type TrendCard } from "./commerceApi";

/**
 * Member Home (/member/home), UI facelift phase 3 and 4 (docs/UI_FACELIFT_PLAN.md). Ask FayFort first; Needs you and
 * On its way as one line each until opened; then the shop, new Finds and the giveaway get the space. Read-only: paying, answering and choosing happen
 * in Orders & requests, where the address check and the payment flow already live.
 */

type HomeInvoice = { id: string; title: string; amount: number; currency: string; status: "sent" | "paid"; kind?: string };
type HomeOrder = {
  id: string;
  order_name: string | null;
  fulfillment_status: string | null;
  financial_status: string | null;
  cancelled_at: string | null;
  line_items: { title: string; quantity: number }[];
  placed_at: string | null;
};
type HomeFind = { id: string; name: string; media_url: string | null; media_type: string | null; locked: boolean };
type HomeFinds = {
  drop: { title: string; release_at: string } | null;
  finds: HomeFind[];
  next_drop: { title: string; opens_for_you: string } | null;
};

export type HomeData = {
  invoices: HomeInvoice[];
  orders: HomeOrder[];
  requests: MemberRequestRow[];
  finds: HomeFinds | null;
};

type Need = { key: string; title: string; line: string; action: string; href: string; amount?: string };
type Progress = { key: string; title: string; status: string; line: string; step: number; steps: number; href: string };

const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
const stageOf = (request: MemberRequestRow) => request.events.at(-1)?.stage || "submitted";

/** What needs the member, newest first: invoices to pay, then questions and choices on their requests. */
export function homeNeeds(data: HomeData): Need[] {
  const needs: Need[] = data.invoices
    .filter((invoice) => invoice.status === "sent")
    .map((invoice) => ({
      key: `invoice-${invoice.id}`,
      title: invoice.title,
      line: invoice.kind === "deposit" ? "Sourcing deposit to pay" : "Invoice to pay",
      action: "Review and pay",
      href: PANEL_PATHS.requests,
      amount: money(invoice.amount, invoice.currency),
    }));
  for (const request of data.requests) {
    const stage = stageOf(request);
    const title = memberFacingText(request.request_title);
    const href = `${PANEL_PATHS.requests}#request-${request.id}`;
    if (stage === "needs_member_input")
      needs.push({ key: `answer-${request.id}`, title, line: "We need a detail from you", action: "Answer", href });
    else if (
      stage === "options_sent" &&
      request.sourcing_options?.length &&
      !request.sourcing_options.some((option) => option.status === "selected")
    )
      needs.push({ key: `choose-${request.id}`, title, line: "Options are ready to choose from", action: "Choose", href });
  }
  return needs;
}

/** Requests and store orders still on their way, at most four. */
export function homeProgress(data: HomeData): Progress[] {
  const steps = requestProgressStages.length;
  const requests: Progress[] = data.requests
    .filter((request) => !requestIsDone(stageOf(request)))
    .map((request) => {
      const stage = stageOf(request);
      const text = memberStageText[stage] || memberStageText.submitted;
      const eta = request.eta_at ? new Date(request.eta_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
      return {
        key: `request-${request.id}`,
        title: memberFacingText(request.request_title),
        status: text.status,
        line: eta ? `Expected around ${eta}` : text.next,
        step: requestProgressIndex(stage) + 1,
        steps,
        href: `${PANEL_PATHS.requests}#request-${request.id}`,
      };
    });
  const orders: Progress[] = data.orders
    .filter((order) => !order.cancelled_at && order.fulfillment_status !== "fulfilled")
    .map((order) => ({
      key: `order-${order.id}`,
      title: order.line_items[0]?.title || order.order_name || "Store order",
      status: order.financial_status === "paid" ? "Paid, being prepared" : "Order placed",
      line: order.order_name ? `Order ${order.order_name}` : "From the FayFort store",
      step: order.financial_status === "paid" ? 2 : 1,
      steps: 4,
      href: PANEL_PATHS.requests,
    }));
  return [...requests, ...orders].slice(0, 4);
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Where the member is right now: the city of their device's time zone, so the place always matches the time shown
 * (a delivery address can be somewhere else). The country is added from the address when it is the same city.
 */
export function memberPlace(timeZone: string, address?: { city?: string | null; country?: string | null } | null): string {
  const city = (timeZone.split("/").pop() || "").replaceAll("_", " ");
  if (address?.country && address.city && address.city.toLowerCase() === city.toLowerCase()) return `${city}, ${address.country}`;
  return city;
}

/** Hours China is ahead of (or behind) the member right now, rounded to the half hour. */
export function chinaOffsetHours(now: Date, timeZone?: string): number {
  const minutes = (zone?: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", day: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .reduce<Record<string, number>>((all, part) => ({ ...all, [part.type]: Number(part.value) }), {});
    return parts.day * 1440 + parts.hour * 60 + parts.minute;
  };
  let diff = minutes(CHINA_ZONE) - minutes(timeZone);
  // Across a month boundary the day numbers jump; bring the difference back within a day.
  if (diff > 1440) diff -= 1440 * Math.round(diff / 1440);
  if (diff < -1440) diff += 1440 * Math.round(-diff / 1440);
  return Math.round(diff / 30) / 2;
}

const CHINA_ZONE = "Asia/Shanghai";
const clock = (now: Date, timeZone?: string) =>
  now.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });

/** The member's place and time next to Guangzhou's, ticking every half minute. */
function PlaceClocks({ place }: { place: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ahead = chinaOffsetHours(now, zone);
  const gap =
    ahead === 0 ? "same time" : `${Math.abs(ahead)} ${Math.abs(ahead) === 1 ? "hour" : "hours"} ${ahead > 0 ? "ahead" : "behind"}`;
  return (
    <p className="member-home-clocks">
      <span>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <b>{place || "You"}</b> {clock(now, zone)}
      </span>
      <span>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <b>Guangzhou, China</b> {clock(now, CHINA_ZONE)} <small>({gap})</small>
      </span>
    </p>
  );
}

type Shelf = { key: string; label: string; items: ShelfItem[] };
type ShelfItem = { key: string; name: string; image: string | null; line: string; open: () => void; tag?: string };

const shelfMoney = (value?: number | null, currency = "USD") =>
  value === null || value === undefined ? "" : money(value, currency);

export function HomePanel({
  accessToken,
  memberName,
  shop,
  onGo,
  onAsk,
  onOpenProduct,
  onEnter,
  busyId,
}: {
  accessToken: string;
  memberName: string;
  /** The shop front the shell already loads (rails and giveaways). */
  shop: ShopHome | null;
  onGo: (panel: MemberPanel, href?: string) => void;
  onAsk: (text: string) => void;
  onOpenProduct: (card: ShopCard) => void;
  onEnter: (giveaway: Giveaway) => void;
  busyId?: string;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [question, setQuestion] = useState("");
  const [place, setPlace] = useState("");
  const [open, setOpen] = useState<"needs" | "progress" | null>(null);
  const [shelfKey, setShelfKey] = useState("");
  useEffect(() => {
    let alive = true;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Each part is optional: a failure in one still shows the others.
    Promise.all([
      apiRequest<{ orders?: HomeOrder[]; invoices?: HomeInvoice[] }>("/members/orders", accessToken).catch(() => null),
      apiRequest<{ requests?: MemberRequestRow[] }>("/members/requests", accessToken).catch(() => null),
      apiRequest<HomeFinds>("/members/finds", accessToken).catch(() => null),
      apiRequest<{ addresses?: { city?: string | null; country?: string | null; is_default?: boolean }[] }>("/members/addresses", accessToken).catch(() => null),
    ]).then(([orders, requests, finds, addresses]) => {
      if (!alive) return;
      if (!orders && !requests && !finds) setFailed(true);
      const list = Array.isArray(addresses?.addresses) ? addresses.addresses : [];
      setPlace(memberPlace(zone, list.find((address) => address.is_default) || list[0] || null));
      setData({
        invoices: Array.isArray(orders?.invoices) ? orders.invoices : [],
        orders: Array.isArray(orders?.orders) ? orders.orders : [],
        requests: Array.isArray(requests?.requests) ? requests.requests : [],
        finds: finds && Array.isArray(finds.finds) ? finds : null,
      });
    });
    return () => {
      alive = false;
    };
  }, [accessToken]);

  const needs = data ? homeNeeds(data) : [];
  const progress = data ? homeProgress(data) : [];
  const finds = data?.finds;
  const firstName = memberName === "Member" ? "" : memberName.split(/\s+/)[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

  // The carousel: the shop's product rails, new Finds and group buys, each behind a chip.
  const shelves: Shelf[] = [];
  for (const rail of shop?.rails || []) {
    if (rail.kind === "trend") continue;
    const items = (rail.items as ShopCard[]).filter((card) => card && card.id).slice(0, 12);
    if (items.length)
      shelves.push({
        key: `rail-${rail.key}`,
        label: rail.title,
        items: items.map((card) => ({
          key: card.id,
          name: card.name,
          image: card.media_type === "video" ? null : card.media_url || null,
          line: card.sale?.sale_price ? shelfMoney(card.sale.sale_price, card.currency) : shelfMoney(card.price, card.currency),
          tag: card.badges?.[0]?.label,
          open: () => onOpenProduct(card),
        })),
      });
  }
  if (finds?.finds.length)
    shelves.splice(1, 0, {
      key: "finds",
      label: "New in Finds",
      items: finds.finds.slice(0, 12).map((find) => ({
        key: find.id,
        name: find.locked ? "Opens soon" : find.name,
        image: find.locked || find.media_type === "video" ? null : find.media_url,
        line: find.locked ? "Upgrade to see it first" : "FayFort Finds",
        open: () => onGo("finds", `${PANEL_PATHS.finds}?find=${encodeURIComponent(find.id)}`),
      })),
    });
  const pools = (shop?.rails || []).find((rail) => rail.key === "almost_sourced");
  if (pools?.items.length)
    shelves.push({
      key: "group",
      label: "Group buys",
      items: (pools.items as TrendCard[]).slice(0, 12).map((trend) => ({
        key: trend.id,
        name: trend.title,
        image: trend.image_url || null,
        line: trend.pool ? `${trend.want_count} of ${trend.pool.target} joined` : `${trend.want_count} want this`,
        open: () => onGo("catalog", PANEL_PATHS.catalog),
      })),
    });
  const shelf = shelves.find((item) => item.key === shelfKey) || shelves[0];
  const giveaway = (shop?.giveaways || []).find((item) => item.status === "open");

  function go(event: React.MouseEvent<HTMLAnchorElement>, panel: MemberPanel, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onGo(panel, href);
  }
  function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    onAsk(question.trim());
  }

  return (
    <section className="member-workspace-panel member-home" aria-labelledby="member-home-title">
      <header className="member-home-head">
        <small>{today}</small>
        <h2 id="member-home-title">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h2>
        <PlaceClocks place={place} />
      </header>

      <section className="member-home-card member-home-ask" aria-labelledby="home-ask-title">
        <div>
          <h3 id="home-ask-title">Need something from China?</h3>
          <p>Paste a TikTok, Instagram or shop link, or describe it. We find it, check it in Guangzhou and quote you.</p>
        </div>
        <form onSubmit={ask}>
          <label className="sr-only" htmlFor="home-ask-input">
            Ask FayFort
          </label>
          <input
            id="home-ask-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Describe it or paste a link…"
            maxLength={2000}
          />
          <button type="submit" aria-label="Send to FayFort" disabled={!question.trim()}>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </section>

      {/* Needs you and On its way: one line each until opened. */}
      <div className="member-home-status">
        <section className={open === "needs" ? "member-home-fold is-open" : "member-home-fold"} aria-labelledby="home-needs-title">
          <button type="button" aria-expanded={open === "needs"} aria-controls="home-needs-list" onClick={() => setOpen(open === "needs" ? null : "needs")}>
            <span className={needs.length ? "member-home-fold-icon is-alert" : "member-home-fold-icon"} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 8v5M12 16.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
            <span className="member-home-fold-text">
              <strong id="home-needs-title">Needs you</strong>
              <small>{!data ? "Checking…" : needs.length ? needs[0].title + (needs.length > 1 ? ` and ${needs.length - 1} more` : "") : "Nothing waiting"}</small>
            </span>
            {needs.length > 0 && <span className="member-home-count">{needs.length}</span>}
            <svg className="member-home-chevron" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 10l5 5 5-5" />
            </svg>
          </button>
          {open === "needs" && (
            <div id="home-needs-list" className="member-home-fold-body">
              {needs.length === 0 ? (
                <p className="member-home-empty">Nothing waiting for you. Anything you need to pay, answer or choose shows up here.</p>
              ) : (
                <ul className="member-home-list">
                  {needs.slice(0, 5).map((need) => (
                    <li key={need.key} className="member-home-need">
                      <span>
                        <strong>{need.title}</strong>
                        <small>{need.line}</small>
                      </span>
                      {need.amount && <b className="member-home-amount">{need.amount}</b>}
                      <a className="primary-button" href={need.href} onClick={(event) => go(event, "requests", need.href)}>
                        {need.action}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className={open === "progress" ? "member-home-fold is-open" : "member-home-fold"} aria-labelledby="home-progress-title">
          <button
            type="button"
            aria-expanded={open === "progress"}
            aria-controls="home-progress-list"
            onClick={() => setOpen(open === "progress" ? null : "progress")}
          >
            <span className="member-home-fold-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M3 8h12v10H3zM15 11h4l3 3v4h-7M7 18h.01M18 18h.01" />
              </svg>
            </span>
            <span className="member-home-fold-text">
              <strong id="home-progress-title">On its way</strong>
              <small>{!data ? "Checking…" : progress.length ? `${progress[0].title} · ${progress[0].status}` : "Nothing in progress"}</small>
            </span>
            {progress.length > 0 && <span className="member-home-count is-calm">{progress.length}</span>}
            <svg className="member-home-chevron" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 10l5 5 5-5" />
            </svg>
          </button>
          {open === "progress" && (
            <div id="home-progress-list" className="member-home-fold-body">
              {progress.length === 0 ? (
                <p className="member-home-empty">
                  Nothing on its way yet.{" "}
                  <a href={PANEL_PATHS.catalog} onClick={(event) => go(event, "catalog", PANEL_PATHS.catalog)}>
                    Shop
                  </a>{" "}
                  or ask us to source something.
                </p>
              ) : (
                <ul className="member-home-list">
                  {progress.map((item) => (
                    <li key={item.key}>
                      <a className="member-home-track" href={item.href} onClick={(event) => go(event, "requests", item.href)}>
                        <span className="member-home-track-top">
                          <strong>{item.title}</strong>
                          <em>{item.status}</em>
                        </span>
                        <span
                          className="member-home-steps"
                          role="img"
                          aria-label={`Step ${Math.min(item.step, item.steps)} of ${item.steps}`}
                          style={{ "--steps": item.steps } as React.CSSProperties}
                        >
                          {Array.from({ length: item.steps }, (_, index) => (
                            <i key={index} className={index < item.step ? "is-done" : ""} />
                          ))}
                        </span>
                        <small>{item.line}</small>
                      </a>
                    </li>
                  ))}
                  <li>
                    <a className="member-home-more" href={PANEL_PATHS.requests} onClick={(event) => go(event, "requests", PANEL_PATHS.requests)}>
                      All orders and requests
                    </a>
                  </li>
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      {/* For you: products, new Finds and group buys in one compact carousel. */}
      <section className="member-home-card member-home-shelf" aria-labelledby="home-shelf-title">
        <div className="member-home-card-head">
          <h3 id="home-shelf-title">For you</h3>
          <a href={PANEL_PATHS.catalog} onClick={(event) => go(event, "catalog", PANEL_PATHS.catalog)}>
            Open the shop
          </a>
        </div>
        {!shop && !data ? (
          <HomeSkeleton rows={1} tiles />
        ) : shelves.length === 0 ? (
          <p className="member-home-empty">New products show up here as soon as they're in the shop.</p>
        ) : (
          <>
            <div className="member-home-chips" role="group" aria-label="Show">
              {shelves.map((item) => (
                <button key={item.key} type="button" aria-pressed={shelf?.key === item.key} onClick={() => setShelfKey(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
            <ul className="member-home-carousel" aria-label={shelf?.label}>
              {shelf?.items.map((item) => (
                <li key={item.key}>
                  <button type="button" onClick={item.open}>
                    <span className="member-home-carousel-media">
                      {item.image ? <img src={item.image} alt="" loading="lazy" /> : <span aria-hidden="true" />}
                      {item.tag && <em>{item.tag}</em>}
                    </span>
                    <strong>{item.name}</strong>
                    {item.line && <small>{item.line}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="member-home-feature">
        <section className="member-home-card member-home-finds" aria-labelledby="home-finds-title">
          <div className="member-home-card-head">
            <h3 id="home-finds-title">FayFort Finds</h3>
            {finds?.next_drop && (
              <span className="member-home-tag">
                Next drop {new Date(finds.next_drop.opens_for_you).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </span>
            )}
          </div>
          <p>Trending products and rare finds, checked in China and priced for resellers. A new drop every Monday.</p>
          {!data ? (
            <HomeSkeleton rows={1} tiles />
          ) : finds && finds.finds.length > 0 ? (
            <ul className="member-home-tiles">
              {finds.finds.slice(0, 3).map((find) => (
                <li key={find.id}>
                  {find.media_url && find.media_type !== "video" && !find.locked ? (
                    <img src={find.media_url} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true" className="member-home-tile-blank" />
                  )}
                  <small>{find.locked ? "Opens soon" : find.name}</small>
                </li>
              ))}
            </ul>
          ) : null}
          <a className="primary-button" href={PANEL_PATHS.finds} onClick={(event) => go(event, "finds", PANEL_PATHS.finds)}>
            {finds?.drop ? `See ${finds.drop.title}` : "Open Finds"}
          </a>
        </section>

        <section className="member-home-card member-home-giveaway" aria-labelledby="home-giveaway-title">
          <div className="member-home-card-head">
            <h3 id="home-giveaway-title">Giveaway</h3>
            {giveaway && <span className="member-home-tag">Ends in {timeLeft(giveaway.ends_at)}</span>}
          </div>
          {giveaway ? (
            <>
              <p className="member-home-prize">
                <strong>{giveaway.prize_text ? `Win ${giveaway.prize_text}` : giveaway.title}</strong>
                <span>{giveaway.title}</span>
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={giveaway.entered || busyId === giveaway.id}
                onClick={() => onEnter(giveaway)}
              >
                {giveaway.entered ? "You're in" : busyId === giveaway.id ? "Entering…" : "Enter free"}
              </button>
            </>
          ) : (
            <p className="member-home-empty">No giveaway running right now. The next one shows up here and in the shop.</p>
          )}
        </section>
      </div>

      {failed && (
        <p className="member-home-empty" role="status">
          Some of your updates couldn't load just now. Your orders and chats are still in the menu.
        </p>
      )}
    </section>
  );
}

/** Grey placeholders while Home loads, in the shape of what is coming. */
function HomeSkeleton({ rows, tiles = false }: { rows: number; tiles?: boolean }) {
  return (
    <div className="member-home-skeleton" aria-hidden="true">
      {tiles ? (
        <div className="member-home-skeleton-tiles">
          <i />
          <i />
          <i />
        </div>
      ) : (
        Array.from({ length: rows }, (_, index) => <i key={index} />)
      )}
    </div>
  );
}
