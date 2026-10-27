import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { DESK_HANDOFFS, DESK_LABEL, DESK_ORDER, STAGE_HELP } from "./Desks";
import { GuideArticle } from "./FlowPanels";
import { DEPARTMENT_GUIDES, GLOSSARY, GUIDES, TOOL_GUIDES } from "./playbooks";
import type { Department } from "./types";
import "./onboarding.css";

/** Welcome tour, first-week checklist and the Guide by desk (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R7). */

export type ChecklistItem = { key: string; title: string; how: string; done: boolean; desk?: Department };
export type OnboardingState = {
  show_tour: boolean;
  completed_at: string | null;
  job_title: string | null;
  departments: Department[];
  checklist: ChecklistItem[];
  done: number;
  total: number;
};

/** Each desk's pipeline, in order (mirrors app/accounts/desks.py). */
export const DESK_PIPELINE: Record<Department, [string, string][]> = {
  conversation_intake: [["member_app", "Member app chats"], ["customer", "Customer chats"]],
  sourcing: [["review", "Review"], ["deposit", "Deposit due"], ["sourcing", "Sourcing"], ["with_member", "Options sent"], ["chosen", "Chosen"], ["invoice", "Invoice sent"], ["paid", "Paid"], ["group_buy", "Group buys"]],
  fulfillment: [["confirmed", "Confirmed"], ["warehouse", "In the warehouse"], ["on_the_way", "On the way"], ["delivered", "Delivered"], ["shop_order", "Shop orders to pack"]],
  member_support: [["money", "Money"], ["bookings", "Bookings"], ["campaigns", "Giveaways"], ["reviews", "Photo reviews"], ["chats", "Chats"]],
  disputes: [["new", "New"], ["working", "Being worked on"], ["waiting", "Waiting"], ["blocked", "Stuck"]],
  store_team: [["listings", "Listings"], ["finds", "Finds"], ["sections", "Sections"], ["campaigns", "Campaigns"]],
};

/** The tool cards on each desk, one line each. */
export const DESK_TOOLS: Record<Department, [string, string][]> = {
  conversation_intake: [
    ["Member app chats", "Every chat in the FayFort app, also the ones the AI is handling; take one over when a member needs a person."],
    ["Customer chats", "Instagram, Messenger and website customers the AI handed to a person."],
    ["Customer card", "Beside every chat: who it is, what they asked for and what's still missing, their other chats."],
    ["Answers", "Search what the AI knows and drop the answer into your reply, so everyone says the same thing."],
    ["Send to another desk", "A product to source, a refund, a dispute: the other desk gets it with the chat attached."],
  ],
  sourcing: [
    ["Trends and group buys", "What members keep sharing, most wanted first; start a group buy when enough people want it."],
    ["Deposits due", "Requests whose member's plan needs a deposit that hasn't been asked for yet."],
    ["Sourcing batches", "Several members asking for the same item: research once, share with all of them."],
    ["Already in the catalog?", "Search the store and the sourcing catalog before hunting for a new supplier."],
  ],
  fulfillment: [
    ["Shop orders", "Paid shop orders still to pack, oldest first."],
    ["Sourced requests", "Paid member requests to buy, receive at the warehouse and ship."],
  ],
  member_support: [
    ["Bookings today", "Consultations with the CEO and China tours; the full calendar is under Bookings and tours."],
    ["Invoices", "Invoices that didn't send, and ones unpaid after 3 days."],
    ["Giveaways", "Ended giveaways to draw, and the ones still running."],
  ],
  disputes: [["Case file", "On every dispute: the member, the order, every payment, the chat and the Shopify or Stripe link."]],
  store_team: [
    ["Next Finds drop", "How full the next weekly drop is and what's still in research."],
    ["Listings", "Products on their way into the store: changes asked for, drafts, waiting for an administrator."],
    ["Coming up", "Sales, giveaways, sections and drops in the next two weeks."],
    ["Products", "The whole store, the sourcing catalog, listings in progress, Finds and sections."],
  ],
};

export function useOnboarding(token: string | null) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiRequest<OnboardingState>("/operations/me/onboarding", token)
      .then((found) => {
        if (alive && Array.isArray(found?.checklist)) setState(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, nonce]);
  const record = useCallback(
    async (key: string) => {
      if (!token) return;
      setState((current) =>
        current
          ? {
              ...current,
              show_tour: key === "tour" ? false : current.show_tour,
              checklist: current.checklist.map((item) => (item.key === key ? { ...item, done: true } : item)),
              done: current.checklist.filter((item) => item.done || item.key === key).length,
            }
          : current,
      );
      try {
        await apiRequest(`/operations/me/onboarding/${key}`, token, { method: "POST" });
      } catch {
        /* It shows again next time; nothing else depends on it. */
      }
    },
    [token],
  );
  return { state, record, reload: () => setNonce((value) => value + 1) };
}

// ---------------------------------------------------------------------------------------------
// The welcome tour
// ---------------------------------------------------------------------------------------------
type TourStep = { title: string; lead: string; points: string[] };

function tourSteps(desks: Department[], jobTitle: string | null): TourStep[] {
  const names = desks.map((desk) => DESK_LABEL[desk]);
  const deskList = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "your desk";
  const chats = desks.includes("conversation_intake");
  return [
    {
      title: "Welcome to the FayFort team",
      lead: `You're on ${deskList}${jobTitle ? ` as ${jobTitle}` : ""}. Here's how your day works, in two minutes.`,
      points: [
        "FayFort finds what members ask for in China, buys it, ships it, and runs the online shop. Every piece of that work lands here as a work item.",
        `Your desks: ${desks.map((desk) => `${DESK_LABEL[desk]} (${DEPARTMENT_GUIDES[desk].charAt(0).toLowerCase()}${DEPARTMENT_GUIDES[desk].slice(1, -1)})`).join("; ")}.`,
      ],
    },
    {
      title: "Start and end your shift",
      lead: "Your hours count from the moment you clock in.",
      points: [
        "Press Clock in at the top when you start. Take a break or Clock out from the same button.",
        "While you're clocked out the dashboards stay closed. If you close the page and forget, your shift ends by itself after 30 minutes.",
        ...(chats ? ["Next to the clock is your chat switch: Take chats for 8 hours lets customers who ask for a person be handed to you."] : []),
      ],
    },
    {
      title: "Your menu",
      lead: "On the left (along the top on phones):",
      points: [
        "My work: everything you're holding, with what's due today and what's overdue.",
        "Your desks: one per team you're on. The number is what's free to pick up; red means something is overdue.",
        "Schedule, Archive and Guide are shared by everyone.",
      ],
    },
    {
      title: "Every desk works the same way",
      lead: "Learn one desk and you know them all.",
      points: [
        "The strip of stages shows where the desk's work is. Tap a stage to see only that work; All brings everything back.",
        "How this desk works explains each stage and where the work goes next.",
        "Tool cards sit under the strip: the things the desk needs beside its list.",
        "The list has Everything and Free to pick up. Overdue first, then anything with a customer waiting, then the oldest.",
      ],
    },
    {
      title: "Working an item",
      lead: "Open an item and the steps bar tells you what to do now.",
      points: [
        "Claim it first, so nobody doubles up. It's yours for 15 minutes and renews while you work.",
        "Do now shows the next step; ? opens the full guide for that kind of work.",
        "The deadline turns amber when it's getting close and red when it's overdue.",
        ...(chats ? ["Chats come with a customer card, Answers to search what the AI knows, and Send to another desk."] : ["Notes and a checklist sit at the bottom; History shows everything that happened."]),
      ],
    },
    {
      title: "Your first week",
      lead: "A short checklist on My work walks you through your first days. Most of it ticks itself as you go.",
      points: [
        "First-week mode shows the full how-to on every step. Turn it off in the Guide once you're comfortable.",
        "The Guide has a page for each of your desks and for every kind of work.",
        "You can take this tour again from the Guide at any time.",
      ],
    },
  ];
}

export function WelcomeTour({ state, onFinish, onClose }: { state: OnboardingState; onFinish: () => void; onClose: () => void }) {
  const steps = tourSteps(state.departments, state.job_title);
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="ops-tour-scrim">
      <section className="ops-tour" role="dialog" aria-modal="true" aria-labelledby="ops-tour-title">
        <header>
          <small>
            Welcome tour · {index + 1} of {steps.length}
          </small>
          <button type="button" className="ops-link-button" onClick={onClose}>
            Skip the tour
          </button>
        </header>
        <h2 id="ops-tour-title">{step.title}</h2>
        <p className="ops-tour-lead">{step.lead}</p>
        <ul>
          {step.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="ops-tour-dots" aria-hidden="true">
          {steps.map((_, dot) => (
            <i key={dot} className={dot === index ? "is-on" : undefined} />
          ))}
        </div>
        <footer>
          <button type="button" className="secondary-button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Back
          </button>
          {last ? (
            <button type="button" className="primary-button" onClick={onFinish} autoFocus>
              Start working
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => setIndex(index + 1)} autoFocus>
              Next
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The first-week checklist
// ---------------------------------------------------------------------------------------------
export function FirstWeekCard({ state, onOpenGuide }: { state: OnboardingState | null; onOpenGuide: () => void }) {
  if (!state || state.total === 0 || state.done >= state.total) return null;
  const next = state.checklist.filter((item) => !item.done).slice(0, 3);
  return (
    <section className="ops-desk-head ops-first-week-card" aria-label="Your first week">
      <div className="ops-desk-title">
        <div>
          <h2>Your first week</h2>
          <p>
            {state.done} of {state.total} done. Most of these tick themselves as you work.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onOpenGuide}>
          See the checklist
        </button>
      </div>
      <span className="ops-trend-bar" role="progressbar" aria-label="First-week checklist" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.done}>
        <i style={{ width: `${Math.round((state.done / state.total) * 100)}%` }} />
      </span>
      <ol className="ops-checklist">
        {next.map((item) => (
          <li key={item.key}>
            <strong>{item.title}</strong>
            <small>{item.how}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChecklistArticle({ state, onTour }: { state: OnboardingState | null; onTour: () => void }) {
  return (
    <article className="ops-guide-article">
      <small>Start here</small>
      <h2>Your first week</h2>
      <p className="ops-guide-lead">A short list for your first days, made for your own desks. Most items tick themselves as you work.</p>
      {!state ? (
        <p className="operations-muted">Loading your checklist…</p>
      ) : (
        <ol className="ops-checklist is-full" aria-label="First-week checklist">
          {state.checklist.map((item) => (
            <li key={item.key} className={item.done ? "is-done" : undefined}>
              <span className="ops-check" aria-label={item.done ? "Done" : "Not done yet"}>
                {item.done ? "✓" : ""}
              </span>
              <div>
                <strong>{item.title}</strong>
                <small>{item.how}</small>
                {item.key === "tour" && !item.done && (
                  <button type="button" className="ops-link-button" onClick={onTour}>
                    Take the tour
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function TourArticle({ onTour }: { onTour: () => void }) {
  return (
    <article className="ops-guide-article">
      <small>Start here</small>
      <h2>Welcome tour</h2>
      <p className="ops-guide-lead">Six short screens: your shift, the menu, how every desk works, working an item and your first week.</p>
      <p>
        <button type="button" className="primary-button" onClick={onTour}>
          Take the tour
        </button>
      </p>
    </article>
  );
}

function DeskGuideArticle({ desk, onOpen }: { desk: Department; onOpen: (key: string) => void }) {
  const work = Object.entries(GUIDES).filter(([, guide]) => guide.department === desk);
  return (
    <article className="ops-guide-article">
      <small>Desk</small>
      <h2>{DESK_LABEL[desk]} desk</h2>
      <p className="ops-guide-lead">{DEPARTMENT_GUIDES[desk]}</p>
      <h3>The pipeline</h3>
      <ol className="ops-guide-steps">
        {DESK_PIPELINE[desk].map(([key, label]) => (
          <li key={key}>
            <strong>{label}</strong>
            <p>{STAGE_HELP[key]}</p>
          </li>
        ))}
      </ol>
      <h3>Tools on this desk</h3>
      <dl className="ops-guide-screen">
        {DESK_TOOLS[desk].map(([name, meaning]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
      <h3>Where its work goes next</h3>
      <ul>
        {DESK_HANDOFFS[desk].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {work.length > 0 && (
        <>
          <h3>Work you'll see here</h3>
          <div className="ops-guide-work">
            {work.map(([key, guide]) => (
              <button key={key} type="button" className="secondary-button" onClick={() => onOpen(key)}>
                {guide.title}
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

/** The Guide by desk: Start here (tour and checklist), your desks first, then the rest, tools and words. */
export function DeskGuideTab({
  firstWeek,
  setFirstWeek,
  myDesks,
  onboarding,
  onRecord,
  onTour,
}: {
  firstWeek: boolean;
  setFirstWeek: (value: boolean) => void;
  myDesks: Department[];
  onboarding: OnboardingState | null;
  onRecord: (key: string) => void;
  onTour: () => void;
}) {
  const [open, setOpen] = useState<string>(() => {
    const asked = new URLSearchParams(window.location.search).get("guide");
    return asked || (onboarding && onboarding.done < onboarding.total ? "first-week" : myDesks[0] ? `desk:${myDesks[0]}` : "first-week");
  });
  const others = DESK_ORDER.filter((desk) => !myDesks.includes(desk));
  // Reading one of your own desks' guides ticks it on the checklist, once.
  const recorded = useRef(new Set<string>());
  const mine = myDesks.join(",");
  useEffect(() => {
    const desk = open.startsWith("desk:") ? open.slice(5) : "";
    if (!desk || !mine.split(",").includes(desk) || recorded.current.has(desk)) return;
    if (onboarding?.checklist.some((item) => item.key === `guide_${desk}` && item.done)) return;
    recorded.current.add(desk);
    onRecord(`guide_${desk}`);
  }, [open, mine, onRecord, onboarding]);
  const guide = GUIDES[open] || TOOL_GUIDES[open];
  const deskButtons = (desks: Department[]) =>
    desks.map((desk) => (
      <div key={desk} className="ops-guide-desk">
        <button type="button" aria-pressed={open === `desk:${desk}`} onClick={() => setOpen(`desk:${desk}`)}>
          {DESK_LABEL[desk]} desk
        </button>
        {(open === `desk:${desk}` || GUIDES[open]?.department === desk) &&
          Object.entries(GUIDES)
            .filter(([, value]) => value.department === desk)
            .map(([key, value]) => (
              <button key={key} type="button" className="is-sub" aria-pressed={open === key} onClick={() => setOpen(key)}>
                {value.title}
              </button>
            ))}
      </div>
    ));
  return (
    <div className="ops-guide">
      <aside className="ops-guide-index" aria-label="Guides">
        <label className="ops-first-week">
          <input type="checkbox" checked={firstWeek} onChange={(event) => setFirstWeek(event.target.checked)} />
          <span>
            <strong>First-week mode</strong>
            <small>Show the full how-to on every step.</small>
          </span>
        </label>
        <section>
          <h3>Start here</h3>
          <button type="button" aria-pressed={open === "tour"} onClick={() => setOpen("tour")}>
            Welcome tour
          </button>
          <button type="button" aria-pressed={open === "first-week"} onClick={() => setOpen("first-week")}>
            Your first week
            {onboarding && onboarding.done < onboarding.total ? ` · ${onboarding.done}/${onboarding.total}` : ""}
          </button>
        </section>
        {myDesks.length > 0 && (
          <section>
            <h3>Your desks</h3>
            {deskButtons(myDesks)}
          </section>
        )}
        {others.length > 0 && (
          <section>
            <h3>{myDesks.length ? "Other desks" : "Desks"}</h3>
            {deskButtons(others)}
          </section>
        )}
        <section>
          <h3>Tools</h3>
          {Object.entries(TOOL_GUIDES).map(([key, value]) => (
            <button key={key} type="button" aria-pressed={open === key} onClick={() => setOpen(key)}>
              {value.title}
            </button>
          ))}
        </section>
        <section>
          <h3>Words we use</h3>
          <button type="button" aria-pressed={open === "glossary"} onClick={() => setOpen("glossary")}>
            Glossary
          </button>
        </section>
      </aside>
      <div className="ops-guide-body">
        {open === "tour" ? (
          <TourArticle onTour={onTour} />
        ) : open === "first-week" ? (
          <ChecklistArticle state={onboarding} onTour={onTour} />
        ) : open.startsWith("desk:") ? (
          <DeskGuideArticle desk={open.slice(5) as Department} onOpen={setOpen} />
        ) : open === "glossary" ? (
          <article className="ops-guide-article">
            <h2>Glossary</h2>
            <dl className="ops-guide-screen">
              {GLOSSARY.map((entry) => (
                <div key={entry.term}>
                  <dt>{entry.term}</dt>
                  <dd>{entry.meaning}</dd>
                </div>
              ))}
            </dl>
          </article>
        ) : (
          guide && <GuideArticle guide={guide} />
        )}
      </div>
    </div>
  );
}
