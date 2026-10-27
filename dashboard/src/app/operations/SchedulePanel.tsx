/**
 * The Schedule tab (docs/CATALOG_MERCHANDISING_PLAN.md §5): giveaways, flash sales, store sections, product
 * launches, deadlines and recurring orders in one calendar. It is a view: every entry opens what owns it.
 * Administrators can plan from a day (a giveaway or a store section).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest } from "../../lib/api";
import { SectionEditor, useCategories } from "./StoreTeam";
import type { ScheduleEntry } from "./storeTypes";
import { departmentLabel, departments, type Department } from "./types";
import "./store-team.css";

type View = "week" | "month" | "agenda";
const TYPE_LABEL: Record<ScheduleEntry["type"], string> = {
  giveaway: "Giveaways",
  sale: "Flash sales",
  section: "Sections",
  launch: "Launches",
  deadline: "Deadlines",
  recurring: "Recurring orders",
  booking: "Bookings",
  drop: "Finds drops",
};
const ALL_TYPES = Object.keys(TYPE_LABEL) as ScheduleEntry["type"][];

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function startOfWeek(date: Date) {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7; // Monday first
  return addDays(day, -offset);
}
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function localInput(date: Date) {
  return `${dayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function rangeFor(view: View, anchor: Date): { start: Date; end: Date; days: Date[] } {
  if (view === "week") {
    const start = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return { start, end: addDays(start, 7), days };
  }
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return { start, end: addDays(start, 42), days };
  }
  const start = startOfDay(anchor);
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, 14), days };
}

export function SchedulePanel({
  token,
  canManage,
  myDepartments,
  onOpenWorkItem,
  onOpenProducts,
}: {
  token: string;
  canManage: boolean;
  myDepartments: Department[];
  onOpenWorkItem: (id: string) => void;
  onOpenProducts: (href: string) => void;
}) {
  const categories = useCategories(token);
  const narrow = typeof window !== "undefined" && window.innerWidth < 720;
  const [view, setView] = useState<View>(narrow ? "agenda" : "week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [types, setTypes] = useState<Set<ScheduleEntry["type"]>>(new Set(ALL_TYPES));
  const [department, setDepartment] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [workers, setWorkers] = useState<{ user_id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [planDay, setPlanDay] = useState<Date | null>(null);
  const [planning, setPlanning] = useState<"giveaway" | "section" | null>(null);
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ start: range.start.toISOString(), end: range.end.toISOString() });
      if (types.size < ALL_TYPES.length) params.set("types", [...types].join(","));
      if (department) params.set("department", department);
      if (workerId) params.set("worker_id", workerId);
      const data = await apiRequest<{ entries: ScheduleEntry[]; workers?: { user_id: string; label: string }[] }>(
        `/operations/schedule?${params}`,
        token,
      );
      setEntries(data.entries || []);
      if (data.workers?.length) setWorkers(data.workers);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The schedule could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [range, types, department, workerId, token]);
  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const grouped: Record<string, ScheduleEntry[]> = {};
    for (const entry of entries) {
      const key = dayKey(new Date(entry.at));
      (grouped[key] ||= []).push(entry);
    }
    return grouped;
  }, [entries]);

  function open(entry: ScheduleEntry) {
    if (entry.work_item_id) return onOpenWorkItem(entry.work_item_id);
    if (entry.href.startsWith("/operations")) return onOpenProducts(entry.href);
    window.location.assign(entry.href);
  }
  function shift(direction: number) {
    if (view === "month") setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    else setAnchor(addDays(anchor, direction * (view === "week" ? 7 : 14)));
  }
  const today = dayKey(new Date());
  const title =
    view === "month"
      ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : `${range.days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${range.days[range.days.length - 1].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  const visibleDepartments = canManage ? departments : myDepartments;

  const chip = (entry: ScheduleEntry, compact = false) => (
    <li key={entry.id}>
      <button type="button" className={`sc-chip type-${entry.type} is-${entry.status}`} onClick={() => open(entry)} title={entry.detail || entry.title}>
        {!compact && <time>{timeOf(entry.at)}</time>}
        <span>{entry.title}</span>
        {entry.status === "overdue" && <b className="sc-flag">Overdue</b>}
      </button>
    </li>
  );
  const planButton = (day: Date) =>
    canManage && (
      <button type="button" className="sc-plan" aria-label={`Plan something on ${day.toDateString()}`} onClick={() => { setPlanDay(day); setPlanning(null); }}>
        +
      </button>
    );

  return (
    <section className="sc-schedule" aria-label="Schedule">
      <header className="sc-head">
        <div className="sc-nav">
          <button type="button" className="secondary-button" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" className="sc-arrow" aria-label="Earlier" onClick={() => shift(-1)}>
            ‹
          </button>
          <button type="button" className="sc-arrow" aria-label="Later" onClick={() => shift(1)}>
            ›
          </button>
          <h2>{title}</h2>
        </div>
        <div className="sc-views" role="group" aria-label="Calendar view">
          {(["week", "month", "agenda"] as View[]).map((value) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>
              {value === "agenda" ? "List" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </header>
      <div className="sc-filters">
        <fieldset>
          <legend className="sr-only">Show</legend>
          {ALL_TYPES.map((type) => (
            <label key={type} className={`sc-filter type-${type}`}>
              <input
                type="checkbox"
                checked={types.has(type)}
                onChange={(event) =>
                  setTypes((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(type);
                    else next.delete(type);
                    return next.size ? next : current;
                  })
                }
              />
              {TYPE_LABEL[type]}
            </label>
          ))}
        </fieldset>
        <label>
          Department
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">All {canManage ? "" : "of mine"}</option>
            {visibleDepartments.map((value) => (
              <option key={value} value={value}>
                {departmentLabel[value]}
              </option>
            ))}
          </select>
        </label>
        {canManage && (
          <label>
            Person
            <select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              <option value="">Everyone</option>
              {workers.map((worker) => (
                <option key={worker.user_id} value={worker.user_id}>
                  {worker.label}
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
      {loading && !entries.length && <p className="operations-muted">Loading the schedule…</p>}

      {view === "agenda" ? (
        <ol className="sc-agenda">
          {range.days.map((day) => {
            const list = byDay[dayKey(day)] || [];
            if (!list.length && dayKey(day) !== today) return null;
            return (
              <li key={dayKey(day)} className={dayKey(day) === today ? "is-today" : ""}>
                <h3>
                  {day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
                  {planButton(day)}
                </h3>
                {list.length ? <ul>{list.map((entry) => chip(entry))}</ul> : <p className="operations-muted">Nothing scheduled.</p>}
              </li>
            );
          })}
          {!entries.length && !loading && <li className="operations-muted">Nothing in the next two weeks.</li>}
        </ol>
      ) : (
        <div className={`sc-grid is-${view}`} role="grid" aria-label={view === "week" ? "Week" : "Month"}>
          {range.days.slice(0, 7).map((day) => (
            <div key={`h-${dayKey(day)}`} className="sc-weekday" role="columnheader">
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
          ))}
          {range.days.map((day) => {
            const key = dayKey(day);
            const list = byDay[key] || [];
            const outside = view === "month" && day.getMonth() !== anchor.getMonth();
            const shown = view === "month" ? list.slice(0, 3) : list;
            return (
              <div key={key} role="gridcell" className={`sc-day${key === today ? " is-today" : ""}${outside ? " is-outside" : ""}`}>
                <div className="sc-day-head">
                  <span>{day.getDate()}</span>
                  {planButton(day)}
                </div>
                <ul>{shown.map((entry) => chip(entry, view === "month"))}</ul>
                {view === "month" && list.length > 3 && (
                  <button type="button" className="ops-link-button sc-more" onClick={() => { setAnchor(day); setView("agenda"); }}>
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="sc-legend">
        <span className="type-giveaway">Giveaway</span>
        <span className="type-sale">Sale</span>
        <span className="type-section">Section</span>
        <span className="type-launch">Launch</span>
        <span className="type-deadline">Deadline</span>
        <span className="type-recurring">Recurring</span>
        <span className="is-overdue">Overdue</span>
      </p>

      {planDay && (
        <div className="ops-sheet-scrim" onClick={() => setPlanDay(null)}>
          <aside className="ops-sheet" role="dialog" aria-modal="true" aria-label="Plan" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="ops-sheet-close" aria-label="Close" onClick={() => setPlanDay(null)}>
              ×
            </button>
            <h2>Plan for {planDay.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h2>
            {!planning ? (
              <div className="sc-plan-choices">
                <button type="button" className="primary-button" onClick={() => setPlanning("giveaway")}>
                  Schedule a giveaway
                </button>
                <button type="button" className="secondary-button" onClick={() => setPlanning("section")}>
                  New store section
                </button>
                <a className="secondary-button" href="/?page=shop&tab=sales">
                  Flash sale or code (Shop)
                </a>
                <p className="operations-muted">Each giveaway and sale opens a “Prepare a campaign” task for the Store team, due a day before it starts.</p>
              </div>
            ) : planning === "giveaway" ? (
              <GiveawayPlanForm
                token={token}
                day={planDay}
                onDone={() => {
                  setPlanDay(null);
                  void load();
                }}
              />
            ) : (
              <SectionEditor
                token={token}
                categories={categories}
                defaultStart={localInput(new Date(planDay.getFullYear(), planDay.getMonth(), planDay.getDate(), 9))}
                onSaved={() => {
                  setPlanDay(null);
                  void load();
                }}
                onCancel={() => setPlanning(null)}
              />
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function GiveawayPlanForm({ token, day, onDone }: { token: string; day: Date; onDone: () => void }) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10);
  const [title, setTitle] = useState("");
  const [prize, setPrize] = useState("");
  const [description, setDescription] = useState("");
  const [winners, setWinners] = useState("1");
  const [startsAt, setStartsAt] = useState(localInput(start));
  const [endsAt, setEndsAt] = useState(localInput(addDays(start, 7)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/platform/commerce/giveaways", token, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          prize_text: prize.trim(),
          description: description.trim(),
          winner_count: Number(winners) || 1,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
        }),
      });
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The giveaway could not be scheduled.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="st-section-editor" onSubmit={submit} aria-label="Schedule a giveaway">
      <label className="st-field">
        <span className="st-label">Title</span>
        <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Wig week giveaway" />
      </label>
      <label className="st-field">
        <span className="st-label">Prize</span>
        <input required maxLength={300} value={prize} onChange={(event) => setPrize(event.target.value)} placeholder="One 18-inch body wave wig" />
      </label>
      <label className="st-field">
        <span className="st-label">Description (optional)</span>
        <textarea rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="st-row">
        <label className="st-field">
          <span className="st-label">Starts</span>
          <input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </label>
        <label className="st-field">
          <span className="st-label">Ends</span>
          <input type="datetime-local" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </label>
        <label className="st-field">
          <span className="st-label">Winners</span>
          <input type="number" min="1" max="50" value={winners} onChange={(event) => setWinners(event.target.value)} />
        </label>
      </div>
      <p className="operations-muted">It opens and closes by itself on these dates. A store-product prize can be set in Shop → Giveaways.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary-button" disabled={busy || !title.trim() || !prize.trim()}>
        Schedule giveaway
      </button>
    </form>
  );
}
