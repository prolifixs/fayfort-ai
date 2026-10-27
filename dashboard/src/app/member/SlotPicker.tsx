import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";

/** Pick a consultation time from the live calendar (GET /members/bookings/slots), shown in the member's own time
 * zone with China time alongside. docs/BOOKINGS_AND_EXECUTIVE_PLAN.md batch 3. */
export type Slot = { starts_at: string; ends_at: string };
type SlotsResponse = {
  available: boolean;
  slots: Slot[];
  host: { name: string; job_title: string | null } | null;
  rules: { minutes: number; cancel_cutoff_hours: number; hold_hours: number };
  message: string | null;
};

const CHINA = "Asia/Shanghai";
/** The same moment, however it's written (a time from fayfort.com may say Z instead of +00:00). */
const same = (a: string | null, b: string) => !!a && Date.parse(a) === Date.parse(b);

export function memberZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function dayKey(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}

export function timeLabel(iso: string, zone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function whenLabel(iso: string, zone: string = memberZone()): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(key: string): { weekday: string; date: string } {
  const at = new Date(`${key}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(at),
    date: new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(at),
  };
}

export function SlotPicker({
  accessToken,
  value,
  onChange,
  onUnavailable,
}: {
  accessToken: string;
  value: string | null;
  onChange: (startsAt: string | null) => void;
  /** Called when booking times aren't open, so the form can fall back to agreeing a time in the chat. */
  onUnavailable?: (message: string) => void;
}) {
  const zone = useMemo(memberZone, []);
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const found = await apiRequest<SlotsResponse>("/members/bookings/slots?kind=consultation&days=21", accessToken);
      setData(found);
      if (!found.available) onUnavailable?.(found.message || "Booking times open soon.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Free times could not be loaded.");
      setData({ available: false, slots: [], host: null, rules: { minutes: 60, cancel_cutoff_hours: 24, hold_hours: 24 }, message: null });
    }
    // onUnavailable is a callback from the form; loading once per token is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    for (const slot of data?.slots || []) {
      const key = dayKey(slot.starts_at, zone);
      groups.set(key, [...(groups.get(key) || []), slot]);
    }
    return groups;
  }, [data, zone]);
  const days = [...byDay.keys()];
  const chosenDay = value ? dayKey(value, zone) : null;
  const shownDay = day && byDay.has(day) ? day : chosenDay && byDay.has(chosenDay) ? chosenDay : days[0] || null;
  const showChina = zone !== CHINA;
  const valueListed = !value || (data?.slots || []).some((slot) => same(value, slot.starts_at));

  if (!data) return <FayfortLoader label="Loading free times…" />;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!data.available) return null;
  if (!days.length) return <p className="member-perk-notice">{data.message || "No free times in the next three weeks. Message us in the chat."}</p>;

  return (
    <div className="member-slots" role="group" aria-label="Choose a time">
      <p className="member-slots-intro">
        {data.rules.minutes} minutes{data.host ? ` with ${data.host.name}${data.host.job_title ? `, ${data.host.job_title}` : ""}` : ""}. Times in your time zone ({zone.replace(/_/g, " ")})
        {showChina ? ", China time below" : ""}.
      </p>
      <div className="member-slot-days" role="tablist" aria-label="Day">
        {days.map((key) => {
          const label = dayLabel(key);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === shownDay}
              className={key === shownDay ? "is-on" : undefined}
              onClick={() => setDay(key)}
            >
              <small>{label.weekday}</small>
              <strong>{label.date}</strong>
              {chosenDay === key && <span className="member-slot-dot" aria-label="your time" />}
            </button>
          );
        })}
      </div>
      <div className="member-slot-times" aria-label="Time">
        {(shownDay ? byDay.get(shownDay) || [] : []).map((slot) => (
          <button
            key={slot.starts_at}
            type="button"
            aria-pressed={same(value, slot.starts_at)}
            className={same(value, slot.starts_at) ? "is-on" : undefined}
            onClick={() => onChange(same(value, slot.starts_at) ? null : slot.starts_at)}
          >
            <strong>{timeLabel(slot.starts_at, zone)}</strong>
            {showChina && <small>{timeLabel(slot.starts_at, CHINA)} China</small>}
          </button>
        ))}
      </div>
      {!valueListed && (
        <p className="form-error" role="alert">
          That time was just taken or isn't free any more. Pick another one.
        </p>
      )}
    </div>
  );
}
