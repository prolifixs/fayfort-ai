import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import type { Department } from "./types";
import { DEPARTMENT_GUIDES } from "./playbooks";
import "./desks.css";

/** The Operations Center by desk (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R2): a left rail of My work, one desk per
 * department and the shared pages; each desk has the same header, pipeline strip and tool cards. */

export type DeskStage = { key: string; label: string; count: number };
export type DeskSummary = {
  department: Department;
  total: number;
  available: number;
  mine: number;
  waiting: number;
  overdue: number;
  stages: DeskStage[];
};
export type DesksState = { desks: DeskSummary[]; mine: number; mine_due_today: number; mine_overdue: number };

export const DESK_ORDER: Department[] = ["conversation_intake", "sourcing", "fulfillment", "member_support", "disputes", "store_team"];

export const DESK_LABEL: Record<Department, string> = {
  conversation_intake: "Conversations",
  sourcing: "Sourcing",
  fulfillment: "Fulfillment",
  member_support: "Member support",
  disputes: "Disputes",
  store_team: "Store team",
};

/** What each stage on the strip means, for "How this desk works". */
export const STAGE_HELP: Record<string, string> = {
  member_app: "Members writing in the FayFort app who asked for a person.",
  customer: "Instagram, Messenger and website customers the AI handed over.",
  review: "New requests: check the details, set the ETA, ask for a deposit if their plan needs one (Deposits due lists them).",
  sourcing: "Finding suppliers and options.",
  deposit: "A deposit invoice is out; buying waits until it's paid.",
  with_member: "Options sent or a question asked; the member's move.",
  chosen: "The member picked an option; send the invoice.",
  invoice: "The invoice is out; paying it moves the request to Fulfillment by itself.",
  paid: "The member has paid; it moves to Fulfillment.",
  group_buy: "Several members buying the same item together.",
  confirmed: "Paid and ready to buy from the supplier.",
  warehouse: "Bought and received at the warehouse; check and pack it.",
  on_the_way: "Shipped; keep the tracking up to date.",
  delivered: "Delivered; close it once the member is happy.",
  shop_order: "Orders from the online shop to pack and ship.",
  money: "Failed payments, invoices that didn't send, refunds.",
  bookings: "Consultations with the CEO and China tours.",
  campaigns: "Giveaway draws and prizes, and campaigns to prepare.",
  reviews: "Photos members sent with their reviews.",
  chats: "Member chats that need support.",
  listings: "New products to list, products to map or retire.",
  finds: "FayFort Finds: research, list and fill the weekly drop.",
  sections: "Store sections on Browse to refresh.",
  new: "Nobody has it yet.",
  working: "Someone is working on it.",
  waiting: "The next move is someone else's; it comes back by itself.",
  blocked: "Stuck: read the notes and help.",
};

/** Where each desk hands work (section 2.4 of the plan). */
export const DESK_HANDOFFS: Record<Department, string[]> = {
  conversation_intake: ["Sourcing: start a sourcing request from a chat", "Disputes: open a dispute", "Member support: bookings, refunds"],
  sourcing: ["Fulfillment: by itself once the invoice is paid", "Store team: suggest a listing or a find"],
  fulfillment: ["Disputes: damaged, missing or wrong items", "Member support: refunds"],
  member_support: ["Disputes: when a payment problem is really an order problem", "Sourcing: a member ready to buy"],
  disputes: ["Member support: refunds once agreed", "Fulfillment: replacements to send"],
  store_team: ["Sourcing: products members keep asking for"],
};

export function useDesks(token: string | null, reloadKey: unknown) {
  const [state, setState] = useState<DesksState | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiRequest<DesksState>("/operations/desks", token)
      .then((found) => {
        if (alive && Array.isArray(found?.desks)) setState(found);
      })
      .catch(() => {
        /* The rail still works without counts. */
      });
    return () => {
      alive = false;
    };
  }, [token, reloadKey]);
  return state;
}

export type RailEntry = {
  id: string;
  label: string;
  badge?: number;
  urgent?: boolean;
  sub?: boolean;
  group: "home" | "desks" | "shared" | "admin";
};

const GROUP_LABEL = { home: "", desks: "Your desks", shared: "Shared", admin: "Administrators" };

export function OpsRail({ entries, active, onOpen }: { entries: RailEntry[]; active: string; onOpen: (id: string) => void }) {
  const railRef = useRef<HTMLElement>(null);
  // On phones and tablets the rail is one scrolling row: keep the open desk in sight.
  useEffect(() => {
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!rail || !current || rail.scrollWidth <= rail.clientWidth) return;
    const offset = current.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
    rail.scrollTo?.({ left: offset - (rail.clientWidth - current.offsetWidth) / 2, behavior: "smooth" });
  }, [active]);
  const groups = (["home", "desks", "shared", "admin"] as const).filter((group) => entries.some((entry) => entry.group === group));
  return (
    <nav className="ops-rail" aria-label="Operations desks" ref={railRef}>
      {groups.map((group) => (
        <div key={group} className="ops-rail-group" role="group" aria-label={GROUP_LABEL[group] || "Home"}>
          {GROUP_LABEL[group] && <h2>{GROUP_LABEL[group]}</h2>}
          {entries
            .filter((entry) => entry.group === group)
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`ops-rail-item${entry.sub ? " is-sub" : ""}${active === entry.id ? " is-active" : ""}`}
                aria-current={active === entry.id ? "page" : undefined}
                onClick={() => onOpen(entry.id)}
              >
                <span>{entry.label}</span>
                {entry.badge ? (
                  <b className={entry.urgent ? "ops-rail-badge is-urgent" : "ops-rail-badge"} aria-label={`${entry.badge}${entry.urgent ? ", some overdue" : ""}`}>
                    {entry.badge > 99 ? "99+" : entry.badge}
                  </b>
                ) : null}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}

export function PipelineStrip({ stages, active, onPick }: { stages: DeskStage[]; active: string; onPick: (key: string) => void }) {
  if (stages.length === 0) return null;
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return (
    <div className="ops-pipeline" role="group" aria-label="Pipeline">
      <button type="button" className="ops-stage" aria-pressed={!active} onClick={() => onPick("")}>
        <span>All</span>
        <b>{total}</b>
      </button>
      {stages.map((stage, index) => (
        <button
          key={stage.key}
          type="button"
          className={`ops-stage${stage.count === 0 ? " is-empty" : ""}`}
          aria-pressed={active === stage.key}
          title={STAGE_HELP[stage.key]}
          onClick={() => onPick(active === stage.key ? "" : stage.key)}
        >
          {index > 0 && <i aria-hidden="true">›</i>}
          <span>{stage.label}</span>
          <b>{stage.count}</b>
        </button>
      ))}
    </div>
  );
}

/** A compact version of a tool that also has a page of its own. "Open full page" only for people allowed there. */
export function ToolCard({
  title,
  line,
  count,
  countLabel,
  onOpen,
  openLabel = "Open",
  fullHref,
  children,
}: {
  title: string;
  line: string;
  count?: number;
  countLabel?: string;
  onOpen?: () => void;
  openLabel?: string;
  fullHref?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ops-tool-card" aria-label={title}>
      <header>
        <h3>{title}</h3>
        {typeof count === "number" && (
          <span className="ops-tool-count">
            <b>{count}</b> {countLabel}
          </span>
        )}
      </header>
      <p>{line}</p>
      {children}
      {(onOpen || fullHref) && (
        <footer>
          {onOpen && (
            <button type="button" className="secondary-button" onClick={onOpen}>
              {openLabel}
            </button>
          )}
          {fullHref && (
            <a className="ops-tool-full" href={fullHref} target="_blank" rel="noreferrer">
              Open full page ↗
            </a>
          )}
        </footer>
      )}
    </section>
  );
}

export function DeskHeader({
  department,
  summary,
  stage,
  onStage,
  tools,
}: {
  department: Department;
  summary?: DeskSummary;
  stage: string;
  onStage: (key: string) => void;
  tools?: ReactNode;
}) {
  const stages = summary?.stages || [];
  return (
    <section className="ops-desk-head" aria-label={`${DESK_LABEL[department]} desk`}>
      <div className="ops-desk-title">
        <div>
          <h2>{DESK_LABEL[department]}</h2>
          <p>{DEPARTMENT_GUIDES[department]}</p>
        </div>
        {summary && (
          <dl className="ops-desk-counts">
            <div>
              <dt>Free to pick up</dt>
              <dd>{summary.available}</dd>
            </div>
            <div>
              <dt>Yours</dt>
              <dd>{summary.mine}</dd>
            </div>
            <div className={summary.overdue ? "is-urgent" : undefined}>
              <dt>Overdue</dt>
              <dd>{summary.overdue}</dd>
            </div>
          </dl>
        )}
      </div>
      <PipelineStrip stages={stages} active={stage} onPick={onStage} />
      <details className="ops-desk-how">
        <summary>How this desk works</summary>
        <div>
          {stages.length > 0 && (
            <>
              <h3>The pipeline</h3>
              <ol>
                {stages.map((item) => (
                  <li key={item.key}>
                    <strong>{item.label}.</strong> {STAGE_HELP[item.key] || ""}
                  </li>
                ))}
              </ol>
            </>
          )}
          <h3>Where its work goes next</h3>
          <ul>
            {DESK_HANDOFFS[department].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="operations-muted">Every item still has its step-by-step guide: open it and follow the steps bar.</p>
        </div>
      </details>
      {tools && <div className="ops-tool-row">{tools}</div>}
    </section>
  );
}

export function MyWorkHome({
  desks,
  onOpenDesk,
}: {
  desks: DesksState | null;
  onOpenDesk: (department: Department) => void;
}) {
  return (
    <section className="ops-desk-head ops-home" aria-label="My work">
      <div className="ops-desk-title">
        <div>
          <h2>My work</h2>
          <p>Everything you've claimed, across your desks. Pick up new work from a desk.</p>
        </div>
        {desks && (
          <dl className="ops-desk-counts">
            <div>
              <dt>Claimed</dt>
              <dd>{desks.mine}</dd>
            </div>
            <div>
              <dt>Due today</dt>
              <dd>{desks.mine_due_today}</dd>
            </div>
            <div className={desks.mine_overdue ? "is-urgent" : undefined}>
              <dt>Overdue</dt>
              <dd>{desks.mine_overdue}</dd>
            </div>
          </dl>
        )}
      </div>
      {desks && desks.desks.length > 0 && (
        <div className="ops-home-desks" role="group" aria-label="Your desks">
          {[...desks.desks]
            .sort((a, b) => DESK_ORDER.indexOf(a.department) - DESK_ORDER.indexOf(b.department))
            .map((desk) => (
              <button key={desk.department} type="button" className="ops-home-desk" onClick={() => onOpenDesk(desk.department)}>
                <strong>{DESK_LABEL[desk.department]}</strong>
                <span>
                  {desk.available} free to pick up
                  {desk.overdue ? <em> · {desk.overdue} overdue</em> : null}
                </span>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
