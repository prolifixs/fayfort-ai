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

/**
 * Member Home (/member/home), UI facelift phase 3 (docs/UI_FACELIFT_PLAN.md). One look at what needs the member,
 * what is on its way and what's new, with the chat one tap away. Read-only: paying, answering and choosing happen
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

export function HomePanel({
  accessToken,
  memberName,
  onGo,
  onAsk,
}: {
  accessToken: string;
  memberName: string;
  onGo: (panel: MemberPanel, href?: string) => void;
  onAsk: (text: string) => void;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [question, setQuestion] = useState("");
  useEffect(() => {
    let alive = true;
    // Each part is optional: a failure in one still shows the others.
    Promise.all([
      apiRequest<{ orders?: HomeOrder[]; invoices?: HomeInvoice[] }>("/members/orders", accessToken).catch(() => null),
      apiRequest<{ requests?: MemberRequestRow[] }>("/members/requests", accessToken).catch(() => null),
      apiRequest<HomeFinds>("/members/finds", accessToken).catch(() => null),
    ]).then(([orders, requests, finds]) => {
      if (!alive) return;
      if (!orders && !requests && !finds) setFailed(true);
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
      </header>

      <div className="member-home-grid">
        <section className="member-home-card member-home-needs" aria-labelledby="home-needs-title">
          <div className="member-home-card-head">
            <h3 id="home-needs-title">Needs you</h3>
            {needs.length > 0 && <span className="member-home-count">{needs.length}</span>}
          </div>
          {!data ? (
            <HomeSkeleton rows={2} />
          ) : needs.length === 0 ? (
            <p className="member-home-empty">Nothing waiting for you. We'll put anything you need to pay, answer or choose right here.</p>
          ) : (
            <ul className="member-home-list">
              {needs.slice(0, 4).map((need) => (
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
        </section>

        <section className="member-home-card member-home-ask" aria-labelledby="home-ask-title">
          <h3 id="home-ask-title">Need something from China?</h3>
          <p>Paste a TikTok, Instagram or shop link, or describe it. We find it, check it in Guangzhou and quote you.</p>
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

        <section className="member-home-card member-home-progress" aria-labelledby="home-progress-title">
          <div className="member-home-card-head">
            <h3 id="home-progress-title">On its way</h3>
            <a href={PANEL_PATHS.requests} onClick={(event) => go(event, "requests", PANEL_PATHS.requests)}>
              All orders
            </a>
          </div>
          {!data ? (
            <HomeSkeleton rows={2} />
          ) : progress.length === 0 ? (
            <p className="member-home-empty">
              Nothing in progress yet.{" "}
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
            </ul>
          )}
        </section>

        <section className="member-home-card member-home-finds" aria-labelledby="home-finds-title">
          <div className="member-home-card-head">
            <h3 id="home-finds-title">FayFort Finds</h3>
            {finds?.next_drop && (
              <span className="member-home-tag">
                Next drop {new Date(finds.next_drop.opens_for_you).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </span>
            )}
          </div>
          {!data ? (
            <HomeSkeleton rows={1} tiles />
          ) : finds && finds.finds.length > 0 ? (
            <>
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
              <a className="secondary-button" href={PANEL_PATHS.finds} onClick={(event) => go(event, "finds", PANEL_PATHS.finds)}>
                See {finds.drop?.title || "this week's Finds"}
              </a>
            </>
          ) : (
            <p className="member-home-empty">
              Trending products and rare finds, checked in China. A new drop every Monday.{" "}
              <a href={PANEL_PATHS.finds} onClick={(event) => go(event, "finds", PANEL_PATHS.finds)}>
                Open Finds
              </a>
            </p>
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
