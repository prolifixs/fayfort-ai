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
  drop_alerts?: boolean;
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

/** The clock the Home widgets share, ticking every half minute. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export type GuangzhouPhase = "dawn" | "day" | "dusk" | "night";
export type GuangzhouStatus = { phase: GuangzhouPhase; open: boolean; line: string; workday: number };

/**
 * What Guangzhou is doing right now, for a member deciding when to ask a supplier something. Offices there work
 * roughly 9 AM to 6 PM with a lunch break, Monday to Saturday; most suppliers rest on Sunday.
 */
export function guangzhouStatus(now: Date): GuangzhouStatus {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CHINA_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const hour = minutes / 60;
  const phase: GuangzhouPhase = hour >= 5 && hour < 9 ? "dawn" : hour >= 9 && hour < 17 ? "day" : hour >= 17 && hour < 20 ? "dusk" : "night";
  const workday = Math.min(1, Math.max(0, (minutes - 9 * 60) / (9 * 60)));
  const sunday = parts.weekday === "Sun";
  const saturdayNight = parts.weekday === "Sat" && hour >= 18;
  if (sunday || saturdayNight) return { phase, open: false, line: "Most suppliers rest on Sunday. Replies pick up on Monday.", workday: sunday ? 0 : workday };
  if (hour >= 9 && hour < 12) return { phase, open: true, line: "Guangzhou is open. A good time to ask for quotes.", workday };
  if (hour >= 12 && hour < 13.5) return { phase, open: true, line: "Lunch break in Guangzhou. Replies resume at 1:30 PM there.", workday };
  if (hour >= 13.5 && hour < 18) return { phase, open: true, line: "Guangzhou is open. Suppliers are replying.", workday };
  if (hour >= 5 && hour < 9) return { phase, open: false, line: "Guangzhou is waking up. Suppliers reply from 9 AM there.", workday };
  return { phase, open: false, line: "Guangzhou is closed. Replies come in from 9 AM there.", workday };
}

/** Time until something, short enough for a big countdown: "8d 14h", "5h 20m", "12m". */
export function countdown(target: string, now = Date.now()): string {
  const ms = Date.parse(target) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

function DayIcon({ hour }: { hour: number }) {
  return hour >= 6 && hour < 18 ? (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

const hourIn = (now: Date, timeZone?: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now)) % 24;

/** Today: the greeting with a one-line summary, and the member's clock next to Guangzhou's with what it is doing. */
function TodayWidget({ title, summary, place }: { title: string; summary: string; place: string }) {
  const now = useNow();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ahead = chinaOffsetHours(now, zone);
  const gap =
    ahead === 0 ? "Same time as you" : `${Math.abs(ahead)} ${Math.abs(ahead) === 1 ? "hour" : "hours"} ${ahead > 0 ? "ahead" : "behind"}`;
  const status = guangzhouStatus(now);
  const today = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  return (
    <header className="member-home-today" data-phase={status.phase}>
      <div className="member-home-today-main">
        <small>{today}</small>
        <h2 id="member-home-title">{title}</h2>
        {summary && <p>{summary}</p>}
      </div>
      <div className="member-home-today-side">
        <div className="member-home-clocks">
          <div className="member-home-clock">
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {place || "You"}
            </span>
            <strong>{clock(now, zone)}</strong>
            <small>
              <DayIcon hour={hourIn(now, zone)} />
              Your time
            </small>
          </div>
          <div className="member-home-clock is-china">
            <span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              Guangzhou, China
            </span>
            <strong>{clock(now, CHINA_ZONE)}</strong>
            <small>
              <DayIcon hour={hourIn(now, CHINA_ZONE)} />
              {gap}
            </small>
          </div>
        </div>
        <p className={status.open ? "member-home-gz is-open" : "member-home-gz"}>
          <i aria-hidden="true" />
          {status.line}
        </p>
        <div
          className="member-home-gz-bar"
          role="img"
          aria-label={`Guangzhou workday ${Math.round(status.workday * 100)}% through`}
        >
          <i style={{ width: `${Math.round(status.workday * 100)}%` }} />
        </div>
      </div>
    </header>
  );
}

/** Shown in the Finds fan before the first drop, so the card keeps its shape. */
const FAN_PLACEHOLDERS: HomeFind[] = [1, 2, 3].map((n) => ({ id: `soon-${n}`, name: "", media_url: null, media_type: null, locked: true }));

const GIFT_ICON = (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13M19 12v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
  </svg>
);

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
  const [alerts, setAlerts] = useState<boolean | null>(null);
  const [alertsBusy, setAlertsBusy] = useState(false);
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
  const now = useNow();
  const summary = !data
    ? ""
    : needs.length
      ? `${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you${progress.length ? `, ${progress.length} on the way` : ""}.`
      : progress.length
        ? `Nothing needs you. ${progress.length} on the way.`
        : "Nothing needs you today.";

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
  const alertsOn = alerts ?? Boolean(finds?.drop_alerts);
  async function toggleAlerts() {
    const next = !alertsOn;
    setAlerts(next);
    setAlertsBusy(true);
    try {
      const saved = await apiRequest<{ drop_alerts: boolean }>("/members/finds/alerts", accessToken, {
        method: "PUT",
        body: JSON.stringify({ on: next }),
      });
      setAlerts(saved.drop_alerts);
    } catch {
      setAlerts(!next);
    } finally {
      setAlertsBusy(false);
    }
  }
  const findsCountdown = finds?.next_drop ? countdown(finds.next_drop.opens_for_you, now.getTime()) : "";

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
      <TodayWidget title={`${greeting()}${firstName ? `, ${firstName}` : ""}`} summary={summary} place={place} />

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

      <div className={giveaway ? "member-home-feature" : "member-home-feature is-solo"}>
        <section className="member-home-card member-home-finds" aria-labelledby="home-finds-title">
          <div className="member-home-finds-body">
            <h3 id="home-finds-title" className="member-home-eyebrow">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
              </svg>
              FayFort Finds
            </h3>
            {findsCountdown ? (
              <p className="member-home-big">
                <strong>{findsCountdown}</strong>
                <span>until {finds?.next_drop?.title || "the next drop"} opens for you</span>
              </p>
            ) : finds?.drop ? (
              <p className="member-home-big">
                <strong>Live now</strong>
                <span>{finds.drop.title}</span>
              </p>
            ) : (
              <p className="member-home-big">
                <strong>Mondays</strong>
                <span>A new drop every week</span>
              </p>
            )}
            <p>Trending products and rare finds, checked in China and priced for resellers.</p>
            <div className="member-home-finds-actions">
              <a className="primary-button" href={PANEL_PATHS.finds} onClick={(event) => go(event, "finds", PANEL_PATHS.finds)}>
                {finds?.drop ? `See ${finds.drop.title}` : "Open Finds"}
              </a>
              {data && (
                <button
                  type="button"
                  className={alertsOn ? "member-home-bell is-on" : "member-home-bell"}
                  aria-pressed={alertsOn}
                  disabled={alertsBusy}
                  onClick={() => void toggleAlerts()}
                  title={alertsOn ? "We'll email you when a drop opens for you" : "Get an email when a drop opens for you"}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                    {!alertsOn && <path d="M3 3l18 18" />}
                  </svg>
                  {alertsOn ? "We'll email you" : "Notify me"}
                </button>
              )}
            </div>
          </div>
          {!data ? (
            <HomeSkeleton rows={1} tiles />
          ) : (
            <ul className="member-home-fan" aria-label={finds?.finds.length ? "From the latest drop" : undefined} aria-hidden={finds?.finds.length ? undefined : true}>
              {(finds?.finds.length ? finds.finds.slice(0, 3) : FAN_PLACEHOLDERS).map((find) => (
                <li key={find.id} title={find.locked ? "Opens for you soon" : find.name}>
                  {find.media_url && find.media_type !== "video" && !find.locked ? (
                    <img src={find.media_url} alt={find.name} loading="lazy" />
                  ) : (
                    <span className="member-home-fan-locked">
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                      </svg>
                      <small>{find.locked ? "Soon" : find.name}</small>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {giveaway && (
          <section className="member-home-card member-home-giveaway" aria-labelledby="home-giveaway-title">
            <div className="member-home-ticket-top">
              <h3 id="home-giveaway-title" className="member-home-eyebrow">
                {GIFT_ICON}
                Giveaway
              </h3>
              <p className="member-home-prize">
                <strong>{giveaway.prize_text ? `Win ${giveaway.prize_text}` : giveaway.title}</strong>
                {giveaway.prize_text && <span>{giveaway.title}</span>}
              </p>
            </div>
            <div className="member-home-ticket-stub">
              <span>
                <small>Time left</small>
                <b>{timeLeft(giveaway.ends_at, now.getTime()).replace(" left", "")}</b>
              </span>
              <button
                type="button"
                className="primary-button"
                disabled={giveaway.entered || busyId === giveaway.id}
                onClick={() => onEnter(giveaway)}
              >
                {giveaway.entered ? "You're in" : busyId === giveaway.id ? "Entering…" : "Enter free"}
              </button>
            </div>
          </section>
        )}
      </div>

      {!giveaway && (
        <section className="member-home-strip" aria-label="Giveaway">
          <span className="member-home-strip-icon">{GIFT_ICON}</span>
          <p>
            <strong>No giveaway right now.</strong> The next one shows up here and in the shop.
          </p>
          <a href={PANEL_PATHS.catalog} onClick={(event) => go(event, "catalog", PANEL_PATHS.catalog)}>
            Visit the shop
          </a>
        </section>
      )}

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
