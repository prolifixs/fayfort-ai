import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";

/** Arrival day for a tour guide, on a month calendar (GET /members/tours/calendar). Days too soon for a guide to get
 * ready, or when every guide is already out, can't be picked. The chosen stay is shaded. Bookings batch 3. */
type DayState = "open" | "full" | "too_soon";
type Calendar = { days: { date: string; state: DayState }[]; earliest: string; notice_days: number };

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
function monthKey(iso: string) {
  return iso.slice(0, 7);
}
function monthTitle(key: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-15T12:00:00Z`));
}
export function longDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

export function TourDatePicker({
  accessToken,
  value,
  stayDays,
  onChange,
}: {
  accessToken: string;
  value: string;
  stayDays: number;
  onChange: (date: string) => void;
}) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [failed, setFailed] = useState(false);
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiRequest<Calendar>("/members/tours/calendar?days=120", accessToken)
      .then((found) => {
        if (alive) setCalendar(found);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [accessToken]);

  const states = useMemo(() => new Map((calendar?.days || []).map((d) => [d.date, d.state])), [calendar]);
  const months = useMemo(() => [...new Set((calendar?.days || []).map((d) => monthKey(d.date)))], [calendar]);
  const shown = month && months.includes(month) ? month : value && months.includes(monthKey(value)) ? monthKey(value) : months[0];
  const stay = useMemo(() => {
    const set = new Set<string>();
    if (value) for (let i = 0; i < Math.max(1, stayDays || 1); i += 1) set.add(addDays(value, i));
    return set;
  }, [value, stayDays]);

  if (failed) {
    // The calendar couldn't load: a plain date field still works (the server checks the date).
    return <input type="date" required aria-label="Arrival date" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
  if (!calendar || !shown) return <p className="operations-muted">Loading the calendar…</p>;

  const first = `${shown}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = first; monthKey(day) === shown; day = addDays(day, 1)) cells.push(day);
  const index = months.indexOf(shown);
  const fullInStay = [...stay].some((day) => states.get(day) === "full");

  return (
    <div className="tour-calendar" role="group" aria-label="Arrival date">
      <div className="tour-calendar-head">
        <button type="button" className="icon-button" aria-label="Previous month" disabled={index <= 0} onClick={() => setMonth(months[index - 1])}>
          ‹
        </button>
        <strong aria-live="polite">{monthTitle(shown)}</strong>
        <button type="button" className="icon-button" aria-label="Next month" disabled={index >= months.length - 1} onClick={() => setMonth(months[index + 1])}>
          ›
        </button>
      </div>
      <div className="tour-calendar-grid">
        {WEEK.map((name) => (
          <span key={name} className="tour-calendar-weekday" aria-hidden="true">
            {name}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} />;
          const state = states.get(day) || "too_soon";
          const classes = ["tour-day", `is-${state}`, stay.has(day) ? "in-stay" : "", day === value ? "is-arrival" : ""].filter(Boolean).join(" ");
          return (
            <button
              key={day}
              type="button"
              className={classes}
              disabled={state !== "open"}
              aria-pressed={day === value}
              aria-label={`${longDate(day)}${state === "full" ? ", guides fully booked" : state === "too_soon" ? ", too soon" : ""}`}
              onClick={() => onChange(day)}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="tour-calendar-key">
        <span className="tour-key is-open" /> Free <span className="tour-key is-full" /> Guides booked <span className="tour-key in-stay" /> Your stay
      </p>
      <p className="member-deposit-note">
        {value
          ? `Arriving ${longDate(value)}${stayDays > 1 ? `, guide until ${longDate(addDays(value, stayDays - 1))}` : ""}.`
          : `Pick your arrival day. Guides need ${calendar.notice_days} days' notice.`}
        {fullInStay ? " Some of those days are already booked; we'll confirm a guide for them in the chat." : ""}
      </p>
    </div>
  );
}
