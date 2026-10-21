import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import "./tours.css";

/** Operations → Tour bookings: tour guide requests from members. Quote → paid → name the guide → done. */
export type TourBooking = {
  id: string;
  member_name?: string;
  city_label: string;
  summary: string;
  arrival_date: string;
  days: number;
  people: number;
  needs: string[];
  hotel_area: string | null;
  whatsapp: string | null;
  notes: string | null;
  status: "requested" | "quoted" | "confirmed" | "completed" | "cancelled";
  quote_amount: number | null;
  currency: string;
  guide_name: string | null;
  work_item_id: string | null;
  cancel_reason?: string | null;
};

export const TOUR_STATUS: Record<TourBooking["status"], string> = {
  requested: "Needs a quote",
  quoted: "Quoted, waiting for payment",
  confirmed: "Paid, confirmed",
  completed: "Done",
  cancelled: "Cancelled",
};

type Filter = "open" | "completed" | "cancelled";

function TourCard({
  tour,
  needs,
  token,
  onChanged,
  onOpenWorkItem,
}: {
  tour: TourBooking;
  needs: Record<string, string>;
  token: string;
  onChanged: () => void;
  onOpenWorkItem?: (id: string) => void;
}) {
  const [amount, setAmount] = useState(tour.quote_amount ? String(tour.quote_amount) : "");
  const [currency, setCurrency] = useState(tour.currency || "USD");
  const [note, setNote] = useState("");
  const [guide, setGuide] = useState(tour.guide_name || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/operations/tours/${tour.id}/${path}`, token, { method: "POST", body: JSON.stringify(body) });
      setNotice(done);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const finished = tour.status === "completed" || tour.status === "cancelled";
  return (
    <article className="tour-card" aria-label={`Tour: ${tour.summary}`}>
      <header>
        <div>
          <strong>{tour.member_name || "Member"}</strong>
          <span>{tour.summary}</span>
        </div>
        <span className={`tour-pill is-${tour.status}`}>{TOUR_STATUS[tour.status]}</span>
      </header>
      <dl className="tour-facts">
        {tour.needs.length > 0 && (
          <div>
            <dt>Needs</dt>
            <dd>{tour.needs.map((n) => needs[n] || n).join(", ")}</dd>
          </div>
        )}
        {tour.hotel_area && (
          <div>
            <dt>Staying around</dt>
            <dd>{tour.hotel_area}</dd>
          </div>
        )}
        {tour.whatsapp && (
          <div>
            <dt>WhatsApp</dt>
            <dd>{tour.whatsapp}</dd>
          </div>
        )}
        {tour.quote_amount ? (
          <div>
            <dt>Quote</dt>
            <dd>
              {tour.quote_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {tour.currency}
            </dd>
          </div>
        ) : null}
        {tour.guide_name && (
          <div>
            <dt>Guide</dt>
            <dd>{tour.guide_name}</dd>
          </div>
        )}
        {tour.notes && (
          <div className="tour-notes">
            <dt>Notes</dt>
            <dd>{tour.notes}</dd>
          </div>
        )}
        {tour.cancel_reason && (
          <div>
            <dt>Reason</dt>
            <dd>{tour.cancel_reason}</dd>
          </div>
        )}
      </dl>
      {!finished && (
        <div className="tour-actions">
          {(tour.status === "requested" || tour.status === "quoted") && (
            <form
              className="tour-row"
              onSubmit={(event) => {
                event.preventDefault();
                void act("quote", { amount: Number(amount), currency, note }, "Quote sent. The member got the invoice and a message in the chat.");
              }}
            >
              <label>
                Quote
                <input type="number" min="1" step="0.01" inputMode="decimal" value={amount} required onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label>
                Currency
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option>USD</option>
                  <option>NGN</option>
                  <option>CNY</option>
                  <option>GBP</option>
                  <option>EUR</option>
                </select>
              </label>
              <label className="tour-wide">
                Message with the quote (optional)
                <input value={note} maxLength={1000} placeholder="What's included: transport, interpreter, hours…" onChange={(e) => setNote(e.target.value)} />
              </label>
              <button className="primary-button" disabled={busy || !amount}>
                {tour.status === "quoted" ? "Send a new quote" : "Send quote"}
              </button>
            </form>
          )}
          {tour.status === "confirmed" && (
            <form
              className="tour-row"
              onSubmit={(event) => {
                event.preventDefault();
                void act("guide", { guide_name: guide, note }, "Guide saved and the member told in the chat.");
              }}
            >
              <label className="tour-wide">
                Guide's name
                <input value={guide} maxLength={80} required onChange={(e) => setGuide(e.target.value)} />
              </label>
              <button className="primary-button" disabled={busy || !guide.trim()}>
                {tour.guide_name ? "Change guide" : "Name the guide"}
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void act("status", { status: "completed" }, "Marked done.")}>
                Mark done
              </button>
            </form>
          )}
          <div className="tour-row">
            <label className="tour-wide">
              Cancel reason
              <input value={reason} maxLength={500} placeholder="Shown to the member" onChange={(e) => setReason(e.target.value)} />
            </label>
            <button type="button" className="secondary-button danger" disabled={busy} onClick={() => void act("status", { status: "cancelled", reason }, "Cancelled.")}>
              Cancel tour
            </button>
          </div>
        </div>
      )}
      {(error || notice) && (
        <p className={error ? "form-error" : "operations-notice"} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}
      {tour.work_item_id && onOpenWorkItem && (
        <button type="button" className="ops-link-button" onClick={() => onOpenWorkItem(tour.work_item_id as string)}>
          Open the chat with the member
        </button>
      )}
    </article>
  );
}

export function ToursPanel({ token, onOpenWorkItem }: { token: string; onOpenWorkItem?: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [tours, setTours] = useState<TourBooking[]>([]);
  const [needs, setNeeds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ tours: TourBooking[]; needs: Record<string, string> }>(`/operations/tours?status=${filter}`, token);
      setTours(data.tours || []);
      setNeeds(data.needs || {});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tour bookings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filter, token]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="tours-panel" aria-label="Tour bookings">
      <header className="tours-head">
        <div>
          <h2>Tour bookings</h2>
          <p>Members asking for a FayFort guide in China. Quote each one, then name the guide once it's paid.</p>
        </div>
        <div className="tours-filter" role="group" aria-label="Show">
          {(["open", "completed", "cancelled"] as Filter[]).map((key) => (
            <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "is-on" : undefined} onClick={() => setFilter(key)}>
              {key === "open" ? "Open" : key === "completed" ? "Done" : "Cancelled"}
            </button>
          ))}
        </div>
      </header>
      <p className="tours-pending" role="note">
        Pending completion: picking dates from a calendar and team availability. For now, agree the dates with the member in the chat
        before you quote.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="operations-muted">Loading tour bookings…</p>
      ) : tours.length === 0 ? (
        <p className="operations-empty-copy">{filter === "open" ? "No open tour requests." : "Nothing here yet."}</p>
      ) : (
        <div className="tours-list">
          {tours.map((tour) => (
            <TourCard key={tour.id} tour={tour} needs={needs} token={token} onChanged={() => void load()} onOpenWorkItem={onOpenWorkItem} />
          ))}
        </div>
      )}
    </section>
  );
}
