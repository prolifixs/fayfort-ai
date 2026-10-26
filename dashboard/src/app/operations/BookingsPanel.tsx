import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { ToursPanel } from "./ToursPanel";
import "./bookings.css";

/**
 * Operations → Bookings (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md §6): every booking in one place.
 * The assistant and administrators see everything and manage the CEO's calendar; everyone else sees what they host
 * and keeps their own hours. Tours keep their own tab here until they move onto the calendar.
 */
export type BookingKind = "consultation" | "session" | "tour";
export type BookingStatus = "held" | "confirmed" | "completed" | "no_show" | "cancelled";
export type Booking = {
  id: string;
  kind: BookingKind;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  hold_expires_at: string | null;
  topic: string | null;
  brief: string | null;
  host_note: string | null;
  call_link: string | null;
  member_time_zone: string | null;
  reschedule_count: number;
  cancel_reason: string | null;
  cancelled_by: string | null;
  refund: "due" | "done" | "none" | null;
  work_item_id: string | null;
  host_id: string;
  member_id: string | null;
  host: { user_id: string; name: string; photo_url: string | null; staff_role: string };
  member_name: string;
  conversation_id: string | null;
  payment: { status: string | null; amount: number | null; currency: string | null } | null;
  when_china: string;
  needs: string[];
};
type Host = { user_id: string; name: string; photo_url: string | null; staff_role: string; job_title: string | null; is_self: boolean };
type Me = { user_id: string; staff_role: string; sees_all: boolean; admin: boolean; ceo_id: string | null; hosts: Host[] };
type Tab = "list" | "calendar" | "hours" | "tours";
type ListView = "needs_action" | "today" | "upcoming" | "past";

export const KIND_LABEL: Record<BookingKind, string> = { consultation: "Consultation", session: "Session", tour: "Tour" };
export const STATUS_LABEL: Record<BookingStatus, string> = {
  held: "Waiting for payment",
  confirmed: "Confirmed",
  completed: "Done",
  no_show: "No-show",
  cancelled: "Cancelled",
};
const NEED_LABEL: Record<string, string> = {
  refund: "Refund due",
  hold_expiring: "Hold ends soon",
  call_link: "Add the call link",
  brief: "Write the brief",
  mark_done: "Mark done or no-show",
};
const VIEW_LABEL: Record<ListView, string> = { needs_action: "Needs action", today: "Today", upcoming: "Upcoming", past: "Past" };
const CHINA = "Asia/Shanghai";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function formatIn(iso: string, zone: string, options: Intl.DateTimeFormatOptions = {}) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...options }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}
const timeIn = (iso: string, zone: string) => formatIn(iso, zone, { hour: "2-digit", minute: "2-digit", hour12: false });
const dayIn = (iso: string, zone: string) => formatIn(iso, zone, { weekday: "short", day: "numeric", month: "short" });
const dayKeyIn = (iso: string, zone: string) => formatIn(iso, zone, { year: "numeric", month: "2-digit", day: "2-digit" });

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list && list.length) return list;
  } catch {
    /* older browsers */
  }
  return ["Asia/Shanghai", "Asia/Hong_Kong", "Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Europe/London", "America/New_York", "UTC"];
}

function startOfChinaWeek(date: Date) {
  // Monday 00:00 China time, as a UTC instant.
  const china = new Date(date.getTime() + 8 * 3600_000);
  const offset = (china.getUTCDay() + 6) % 7;
  const monday = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() - offset);
  return new Date(monday - 8 * 3600_000);
}

// ---------------------------------------------------------------------------------------------
// Booking detail
// ---------------------------------------------------------------------------------------------
function MovePicker({ token, booking, onMoved }: { token: string; booking: Booking; onMoved: (next: Booking) => void }) {
  const [day, setDay] = useState(() => dayKeyIn(booking.starts_at, CHINA).split("/").reverse().join("-"));
  const [slots, setSlots] = useState<{ starts_at: string }[] | null>(null);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!day) return;
    const from = new Date(`${day}T00:00:00+08:00`);
    const to = new Date(from.getTime() + 24 * 3600_000);
    setSlots(null);
    apiRequest<{ slots: { starts_at: string }[] }>(
      `/operations/bookings/slots?host_id=${booking.host_id}&kind=${booking.kind}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&ignore=${booking.id}`,
      token,
    )
      .then((data) => setSlots(data.slots || []))
      .catch((reason) => setError(errorText(reason, "Free times could not be loaded.")));
  }, [day, booking.host_id, booking.kind, booking.id, token]);
  async function move(startsAt: string) {
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest<{ booking: Booking }>(`/operations/bookings/${booking.id}/move`, token, {
        method: "POST",
        body: JSON.stringify({ starts_at: startsAt, reason }),
      });
      onMoved(data.booking);
    } catch (reason) {
      setError(errorText(reason, "The booking could not be moved."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="booking-move">
      <div className="booking-row">
        <label>
          Day (China)
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <label className="booking-wide">
          Reason (in the email to the member)
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      {slots === null ? (
        <p className="operations-muted">Loading free times…</p>
      ) : slots.length === 0 ? (
        <p className="operations-muted">No free times in the weekly hours that day.</p>
      ) : (
        <div className="booking-slots" role="group" aria-label="Free times">
          {slots.map((slot) => (
            <button key={slot.starts_at} type="button" className="secondary-button" disabled={busy} onClick={() => void move(slot.starts_at)}>
              {timeIn(slot.starts_at, CHINA)}
            </button>
          ))}
        </div>
      )}
      <form
        className="booking-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (custom) void move(new Date(`${custom}:00+08:00`).toISOString());
        }}
      >
        <label>
          Or another time (China), outside the weekly hours
          <input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} />
        </label>
        <button className="secondary-button" disabled={busy || !custom}>
          Move to this time
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function BookingDetail({
  token,
  me,
  booking,
  onChanged,
  onClose,
  onOpenWorkItem,
}: {
  token: string;
  me: Me;
  booking: Booking;
  onChanged: (next: Booking) => void;
  onClose: () => void;
  onOpenWorkItem?: (id: string) => void;
}) {
  const [link, setLink] = useState(booking.call_link || "");
  const [brief, setBrief] = useState(booking.brief || "");
  const [note, setNote] = useState(booking.host_note || "");
  const [mode, setMode] = useState<"" | "move" | "cancel">("");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState<"" | "yes" | "no">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    setLink(booking.call_link || "");
    setBrief(booking.brief || "");
    setNote(booking.host_note || "");
  }, [booking]);
  const manages = me.sees_all || booking.host_id === me.user_id || (me.staff_role === "assistant" && booking.host_id === me.ceo_id);
  const isHost = booking.host_id === me.user_id;
  const live = booking.status === "held" || booking.status === "confirmed";
  const started = new Date(booking.starts_at).getTime() <= Date.now();

  async function call(path: string, body: unknown, done: string, method = "POST") {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const data = await apiRequest<{ booking: Booking }>(`/operations/bookings/${booking.id}/${path}`, token, {
        method,
        body: JSON.stringify(body),
      });
      onChanged(data.booking);
      setSaved(done);
      setMode("");
    } catch (reason) {
      setError(errorText(reason, "The booking could not be updated."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="booking-detail" aria-label="Booking">
      <header>
        <div>
          <span className={`booking-kind kind-${booking.kind}`}>{KIND_LABEL[booking.kind]}</span>
          <h3>{booking.when_china}</h3>
          <p>
            {booking.member_name}
            {booking.member_time_zone && booking.member_time_zone !== CHINA
              ? ` · their time ${dayIn(booking.starts_at, booking.member_time_zone)}, ${timeIn(booking.starts_at, booking.member_time_zone)}`
              : ""}
          </p>
        </div>
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      </header>
      <dl className="booking-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`booking-status is-${booking.status}`}>{STATUS_LABEL[booking.status]}</span>
            {booking.status === "held" && booking.hold_expires_at && ` · held until ${dayIn(booking.hold_expires_at, CHINA)} ${timeIn(booking.hold_expires_at, CHINA)}`}
          </dd>
        </div>
        <div>
          <dt>With</dt>
          <dd>{booking.host.name}</dd>
        </div>
        {booking.payment && (
          <div>
            <dt>Payment</dt>
            <dd>
              {booking.payment.amount != null ? `${booking.payment.amount} ${booking.payment.currency || ""}` : ""}{" "}
              {booking.payment.status === "paid" ? "· paid" : booking.payment.status ? `· ${booking.payment.status}` : ""}
            </dd>
          </div>
        )}
        {booking.reschedule_count > 0 && (
          <div>
            <dt>Moved by the member</dt>
            <dd>{booking.reschedule_count}×</dd>
          </div>
        )}
        {booking.refund && booking.refund !== "none" && (
          <div>
            <dt>Refund</dt>
            <dd>{booking.refund === "due" ? "Due: refund it in Shopify, then mark it refunded" : "Refunded"}</dd>
          </div>
        )}
        {booking.cancel_reason && (
          <div className="booking-full">
            <dt>{booking.status === "cancelled" ? "Why it was cancelled" : "Note"}</dt>
            <dd>{booking.cancel_reason}</dd>
          </div>
        )}
        {booking.topic && (
          <div className="booking-full">
            <dt>What they want to discuss</dt>
            <dd>{booking.topic}</dd>
          </div>
        )}
      </dl>

      {booking.needs.length > 0 && (
        <ul className="booking-needs" aria-label="To do">
          {booking.needs.map((need) => (
            <li key={need}>{NEED_LABEL[need] || need}</li>
          ))}
        </ul>
      )}

      {manages && live && (
        <form
          className="booking-row"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void call("details", { call_link: link }, "Call link saved. The member gets it by email.", "PUT");
          }}
        >
          <label className="booking-wide">
            Call link
            <input type="url" placeholder="https://meet.google.com/…" value={link} onChange={(event) => setLink(event.target.value)} />
          </label>
          <button className="secondary-button" disabled={busy || link === (booking.call_link || "")}>
            Save link
          </button>
        </form>
      )}
      {!manages && booking.call_link && (
        <p>
          <a className="primary-button" href={booking.call_link} target="_blank" rel="noreferrer">
            Join the call
          </a>
        </p>
      )}

      {manages && booking.kind === "consultation" && (
        <form
          className="booking-stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void call("details", { brief }, "Brief saved.", "PUT");
          }}
        >
          <label>
            Brief for the CEO (only the team sees it)
            <textarea rows={3} maxLength={2000} value={brief} onChange={(event) => setBrief(event.target.value)} />
          </label>
          <button className="secondary-button" disabled={busy || brief === (booking.brief || "")}>
            Save brief
          </button>
        </form>
      )}
      {!manages && booking.brief && (
        <div className="booking-brief">
          <strong>Brief</strong>
          <p>{booking.brief}</p>
        </div>
      )}
      {(isHost || me.sees_all) && (booking.status === "confirmed" || booking.status === "completed") && started && (
        <form
          className="booking-stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void call("details", { host_note: note }, "Note saved.", "PUT");
          }}
        >
          <label>
            Note after the call (only the team sees it)
            <textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button className="secondary-button" disabled={busy || note === (booking.host_note || "")}>
            Save note
          </button>
        </form>
      )}

      <div className="booking-actions">
        {booking.work_item_id && onOpenWorkItem && (
          <button type="button" className="secondary-button" onClick={() => onOpenWorkItem(booking.work_item_id!)}>
            Open the chat with the member
          </button>
        )}
        {manages && live && (
          <>
            <button type="button" className="secondary-button" onClick={() => setMode(mode === "move" ? "" : "move")}>
              Move
            </button>
            <button type="button" className="secondary-button danger" onClick={() => setMode(mode === "cancel" ? "" : "cancel")}>
              Cancel booking
            </button>
          </>
        )}
        {manages && booking.status === "confirmed" && started && (
          <>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void call("finish", { status: "completed" }, "Marked done.")}>
              Mark done
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void call("finish", { status: "no_show" }, "Marked as no-show.")}>
              No-show
            </button>
          </>
        )}
        {me.sees_all && booking.refund === "due" && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => void call("refunded", {}, "Refund recorded.")}>
            Mark refunded
          </button>
        )}
      </div>

      {mode === "move" && <MovePicker token={token} booking={booking} onMoved={(next) => { onChanged(next); setMode(""); setSaved("Moved. The member was emailed the new time."); }} />}
      {mode === "cancel" && (
        <form
          className="booking-stack booking-cancel"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void call("cancel", { reason, refund: booking.status === "confirmed" ? refund === "yes" : null }, "Cancelled. The member was emailed.");
          }}
        >
          <label>
            Reason (the member sees it)
            <input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {booking.status === "confirmed" && (
            <fieldset>
              <legend>This booking is paid. Refund it?</legend>
              <label>
                <input type="radio" name="refund" checked={refund === "yes"} onChange={() => setRefund("yes")} /> Yes, refund
              </label>
              <label>
                <input type="radio" name="refund" checked={refund === "no"} onChange={() => setRefund("no")} /> No refund
              </label>
            </fieldset>
          )}
          <button className="primary-button danger" disabled={busy || !reason.trim() || (booking.status === "confirmed" && !refund)}>
            {busy ? "Cancelling…" : "Cancel booking"}
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// List and calendar
// ---------------------------------------------------------------------------------------------
function BookingRow({ booking, showHost, onOpen, selected }: { booking: Booking; showHost: boolean; onOpen: () => void; selected: boolean }) {
  return (
    <li>
      <button type="button" className={`booking-item${selected ? " is-selected" : ""}`} onClick={onOpen} aria-label={`${KIND_LABEL[booking.kind]} with ${booking.member_name}, ${booking.when_china}`}>
        <span className="booking-when">
          <strong>{timeIn(booking.starts_at, CHINA)}</strong>
          <small>{dayIn(booking.starts_at, CHINA)}</small>
        </span>
        <span className="booking-main">
          <strong>
            {booking.member_name} <span className={`booking-kind kind-${booking.kind}`}>{KIND_LABEL[booking.kind]}</span>
          </strong>
          <small>
            {showHost ? `With ${booking.host.name} · ` : ""}
            {booking.topic || "No topic"}
          </small>
        </span>
        <span className="booking-side">
          <span className={`booking-status is-${booking.status}`}>{STATUS_LABEL[booking.status]}</span>
          {booking.needs.map((need) => (
            <small key={need} className="booking-need">
              {NEED_LABEL[need] || need}
            </small>
          ))}
        </span>
      </button>
    </li>
  );
}

function CalendarWeek({ bookings, start, onOpen, showHost }: { bookings: Booking[]; start: Date; onOpen: (b: Booking) => void; showHost: boolean }) {
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 24 * 3600_000));
  return (
    <div className="booking-week" role="grid" aria-label="Week">
      {days.map((day) => {
        const key = dayKeyIn(day.toISOString(), CHINA);
        const items = bookings.filter((b) => dayKeyIn(b.starts_at, CHINA) === key && b.status !== "cancelled");
        const today = key === dayKeyIn(new Date().toISOString(), CHINA);
        return (
          <section key={key} className={`booking-day${today ? " is-today" : ""}`} role="row" aria-label={dayIn(day.toISOString(), CHINA)}>
            <h4>{dayIn(day.toISOString(), CHINA)}</h4>
            {items.length === 0 ? (
              <p className="operations-muted">—</p>
            ) : (
              items.map((b) => (
                <button key={b.id} type="button" role="gridcell" className={`booking-chip kind-${b.kind} is-${b.status}`} onClick={() => onOpen(b)}>
                  <strong>{timeIn(b.starts_at, CHINA)}</strong> {b.member_name}
                  {showHost && <small>{b.host.name}</small>}
                </button>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Weekly hours and blocked time
// ---------------------------------------------------------------------------------------------
type Block = { weekday: number; start_time: string; end_time: string; kinds: BookingKind[] };
type TimeOff = { id: string; starts_at: string; ends_at: string; reason: string | null };

export function HoursEditor({ token, me }: { token: string; me: Me }) {
  const [hostId, setHostId] = useState(me.hosts[0]?.user_id || me.user_id);
  const [zone, setZone] = useState(CHINA);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [offFrom, setOffFrom] = useState("");
  const [offTo, setOffTo] = useState("");
  const [offReason, setOffReason] = useState("");
  const zones = useMemo(() => timeZones(), []);
  const host = me.hosts.find((h) => h.user_id === hostId);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ time_zone: string; weekly: Block[]; time_off: TimeOff[]; can_edit: boolean }>(`/operations/availability/${hostId}`, token);
      setZone(data.time_zone || CHINA);
      setBlocks((data.weekly || []).map((b) => ({ weekday: b.weekday, start_time: b.start_time, end_time: b.end_time, kinds: b.kinds })));
      setTimeOff(data.time_off || []);
      setCanEdit(data.can_edit);
    } catch (reason) {
      setError(errorText(reason, "The calendar could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [hostId, token]);
  useEffect(() => {
    void load();
  }, [load]);

  function change(index: number, patch: Partial<Block>) {
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));
    setSaved("");
  }
  async function save() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await apiRequest(`/operations/availability/${hostId}`, token, { method: "PUT", body: JSON.stringify({ time_zone: zone, weekly: blocks }) });
      setSaved("Weekly hours saved. Members see the new free times straight away.");
    } catch (reason) {
      setError(errorText(reason, "The weekly hours could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  async function addOff(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest<{ time_off: { clashing_bookings?: number } }>(`/operations/availability/${hostId}/time-off`, token, {
        method: "POST",
        body: JSON.stringify({ starts_at: new Date(offFrom).toISOString(), ends_at: new Date(offTo).toISOString(), reason: offReason }),
      });
      setOffFrom("");
      setOffTo("");
      setOffReason("");
      const clashes = data.time_off?.clashing_bookings || 0;
      setSaved(clashes ? `Blocked. ${clashes} booking${clashes === 1 ? " is" : "s are"} already in that time: move ${clashes === 1 ? "it" : "them"} from the list.` : "Blocked. No bookings can be made in that time.");
      await load();
    } catch (reason) {
      setError(errorText(reason, "The blocked time could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  async function removeOff(id: string) {
    setBusy(true);
    try {
      await apiRequest(`/operations/availability/${hostId}/time-off/${id}`, token, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(errorText(reason, "The blocked time could not be removed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="booking-hours" aria-label="Weekly hours and blocked time">
      <div className="booking-row">
        {me.hosts.length > 1 && (
          <label>
            Calendar
            <select value={hostId} onChange={(event) => setHostId(event.target.value)}>
              {me.hosts.map((h) => (
                <option key={h.user_id} value={h.user_id}>
                  {h.is_self ? `${h.name} (you)` : h.staff_role === "ceo" ? `${h.name} (CEO)` : h.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Time zone
          <select value={zone} disabled={!canEdit} onChange={(event) => { setZone(event.target.value); setSaved(""); }}>
            {!zones.includes(zone) && <option value={zone}>{zone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="operations-muted">
        {host?.staff_role === "ceo"
          ? "When the CEO takes consultations. Members only see free times inside these hours, at least a day ahead."
          : "When you can take bookings. Members only see free times inside these hours."}
      </p>
      {loading ? (
        <p className="operations-muted">Loading…</p>
      ) : (
        <div className="booking-weekdays">
          {WEEKDAYS.map((name, weekday) => {
            const indexes = blocks.map((b, i) => [b, i] as const).filter(([b]) => b.weekday === weekday);
            return (
              <div key={name} className="booking-weekday">
                <h4>{name}</h4>
                {indexes.length === 0 && <p className="operations-muted">Not available</p>}
                {indexes.map(([block, index]) => (
                  <div key={index} className="booking-block">
                    <label>
                      From
                      <input type="time" step={1800} disabled={!canEdit} value={block.start_time} onChange={(event) => change(index, { start_time: event.target.value })} aria-label={`${name} from`} />
                    </label>
                    <label>
                      To
                      <input type="time" step={1800} disabled={!canEdit} value={block.end_time} onChange={(event) => change(index, { end_time: event.target.value })} aria-label={`${name} to`} />
                    </label>
                    <span className="booking-kinds">
                      {(["consultation", "session"] as BookingKind[]).map((kind) => (
                        <label key={kind}>
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={block.kinds.includes(kind)}
                            onChange={(event) =>
                              change(index, { kinds: event.target.checked ? [...block.kinds, kind] : block.kinds.filter((k) => k !== kind) })
                            }
                          />{" "}
                          {kind === "consultation" ? "Consultations" : "Sessions"}
                        </label>
                      ))}
                    </span>
                    {canEdit && (
                      <button type="button" className="text-button" onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${name} ${block.start_time}`}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setBlocks((current) => [...current, { weekday, start_time: "14:00", end_time: "18:00", kinds: host?.staff_role === "ceo" ? ["consultation"] : ["consultation", "session"] }])
                    }
                  >
                    + Add hours on {name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canEdit && (
        <button type="button" className="primary-button" disabled={busy || loading} onClick={() => void save()}>
          {busy ? "Saving…" : "Save weekly hours"}
        </button>
      )}

      <h3>Blocked time</h3>
      {timeOff.length === 0 ? (
        <p className="operations-muted">Nothing blocked.</p>
      ) : (
        <ul className="booking-off">
          {timeOff.map((off) => (
            <li key={off.id}>
              <span>
                {dayIn(off.starts_at, zone)} {timeIn(off.starts_at, zone)} → {dayIn(off.ends_at, zone)} {timeIn(off.ends_at, zone)}
                {off.reason ? ` · ${off.reason}` : ""}
              </span>
              {canEdit && (
                <button type="button" className="text-button" disabled={busy} onClick={() => void removeOff(off.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="booking-row" onSubmit={(event) => void addOff(event)}>
          <label>
            From (your time)
            <input type="datetime-local" required value={offFrom} onChange={(event) => setOffFrom(event.target.value)} />
          </label>
          <label>
            To (your time)
            <input type="datetime-local" required value={offTo} onChange={(event) => setOffTo(event.target.value)} />
          </label>
          <label className="booking-wide">
            Reason (only the team sees it)
            <input maxLength={200} value={offReason} onChange={(event) => setOffReason(event.target.value)} />
          </label>
          <button className="secondary-button" disabled={busy}>
            Block this time
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------------------------
export function BookingsPanel({
  token,
  tourTeam,
  initialTab,
  initialBooking,
  onOpenWorkItem,
}: {
  token: string;
  tourTeam: boolean;
  initialTab?: Tab;
  initialBooking?: string | null;
  onOpenWorkItem?: (id: string) => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab || "list");
  const [view, setView] = useState<ListView>("needs_action");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [week, setWeek] = useState(() => startOfChinaWeek(new Date()));
  const [hostFilter, setHostFilter] = useState("");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<Me>("/operations/bookings/me", token)
      .then(setMe)
      .catch((reason) => setError(errorText(reason, "Bookings could not be loaded.")));
  }, [token]);
  useEffect(() => {
    if (!initialBooking) return;
    apiRequest<{ booking: Booking }>(`/operations/bookings/${initialBooking}`, token)
      .then((data) => setSelected(data.booking))
      .catch(() => undefined);
  }, [initialBooking, token]);

  const load = useCallback(async () => {
    if (tab !== "list" && tab !== "calendar") return;
    setLoading(true);
    setError("");
    try {
      const host = hostFilter ? `&host_id=${hostFilter}` : "";
      const path =
        tab === "calendar"
          ? `/operations/bookings?view=range&from=${encodeURIComponent(week.toISOString())}&to=${encodeURIComponent(new Date(week.getTime() + 7 * 24 * 3600_000).toISOString())}${host}`
          : `/operations/bookings?view=${view}${host}`;
      const data = await apiRequest<{ bookings: Booking[] }>(path, token);
      setBookings(data.bookings || []);
    } catch (reason) {
      setError(errorText(reason, "Bookings could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [tab, view, week, hostFilter, token]);
  useEffect(() => {
    void load();
  }, [load]);

  function changed(next: Booking) {
    setSelected(next);
    setBookings((current) => current.map((b) => (b.id === next.id ? next : b)));
  }

  const tabs: [Tab, string][] = [
    ["list", "Bookings"],
    ["calendar", "Calendar"],
    ["hours", me?.staff_role === "assistant" ? "CEO's hours" : "Hours & time off"],
    ...(tourTeam ? ([["tours", "Tours"]] as [Tab, string][]) : []),
  ];
  const showHost = Boolean(me?.sees_all);

  return (
    <section className="bookings-panel" aria-label="Bookings">
      <header className="bookings-head">
        <div>
          <h2>Bookings</h2>
          <p>
            {me?.sees_all
              ? "Every consultation and session. Times are China time unless it says otherwise."
              : "The bookings you host, and the hours members can book you. Times are China time."}
          </p>
        </div>
        <div className="tours-filter" role="tablist" aria-label="Bookings views">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-on" : undefined} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === "tours" && <ToursPanel token={token} onOpenWorkItem={onOpenWorkItem} />}
      {tab === "hours" && me && <HoursEditor token={token} me={me} />}
      {(tab === "list" || tab === "calendar") && (
        <>
          <div className="booking-row bookings-filters">
            {tab === "list" ? (
              <div className="tours-filter" role="group" aria-label="Show">
                {(Object.keys(VIEW_LABEL) as ListView[]).map((key) => (
                  <button key={key} type="button" aria-pressed={view === key} className={view === key ? "is-on" : undefined} onClick={() => setView(key)}>
                    {VIEW_LABEL[key]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="booking-weeknav">
                <button type="button" className="secondary-button" aria-label="Previous week" onClick={() => setWeek(new Date(week.getTime() - 7 * 24 * 3600_000))}>
                  ←
                </button>
                <strong>Week of {dayIn(week.toISOString(), CHINA)}</strong>
                <button type="button" className="secondary-button" aria-label="Next week" onClick={() => setWeek(new Date(week.getTime() + 7 * 24 * 3600_000))}>
                  →
                </button>
                <button type="button" className="text-button" onClick={() => setWeek(startOfChinaWeek(new Date()))}>
                  This week
                </button>
              </div>
            )}
            {showHost && me && me.hosts.length > 1 && (
              <label>
                Host
                <select value={hostFilter} onChange={(event) => setHostFilter(event.target.value)}>
                  <option value="">Everyone</option>
                  {me.hosts.map((h) => (
                    <option key={h.user_id} value={h.user_id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className={`bookings-body${selected ? " has-detail" : ""}`}>
            <div>
              {loading ? (
                <p className="operations-muted">Loading bookings…</p>
              ) : tab === "calendar" ? (
                <CalendarWeek bookings={bookings} start={week} onOpen={setSelected} showHost={showHost} />
              ) : bookings.length === 0 ? (
                <p className="operations-empty-copy">
                  {view === "needs_action" ? "Nothing needs doing right now." : view === "today" ? "No bookings today." : "Nothing here yet."}
                </p>
              ) : (
                <ul className="booking-list">
                  {bookings.map((booking) => (
                    <BookingRow key={booking.id} booking={booking} showHost={showHost} selected={selected?.id === booking.id} onOpen={() => setSelected(booking)} />
                  ))}
                </ul>
              )}
            </div>
            {selected && me && (
              <BookingDetail token={token} me={me} booking={selected} onChanged={changed} onClose={() => setSelected(null)} onOpenWorkItem={onOpenWorkItem} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
