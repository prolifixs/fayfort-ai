import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatMoney } from "./membershipApi";

/** Tour guide in China (owner request, 2026-10-20): a FayFort team member meets the member there. Every tour is
 * quoted by the team; the member pays the quote, then the guide is named in the tour chat. */
export type MemberTour = {
  id: string;
  summary: string;
  city_label: string;
  status: "requested" | "quoted" | "confirmed" | "completed" | "cancelled";
  quote_amount: number | null;
  currency: string;
  invoice_url: string | null;
  conversation_id: string | null;
  guide_name: string | null;
};

const STATUS: Record<MemberTour["status"], string> = {
  requested: "Request sent · we'll send a quote in the chat",
  quoted: "Quote ready · pay to confirm",
  confirmed: "Confirmed",
  completed: "Done",
  cancelled: "Cancelled",
};

const STATUS_SHORT: Record<MemberTour["status"], string> = {
  requested: "Waiting for quote",
  quoted: "Quote ready",
  confirmed: "Confirmed",
  completed: "Done",
  cancelled: "Cancelled",
};

const CITIES: [string, string][] = [
  ["guangzhou", "Guangzhou"],
  ["yiwu", "Yiwu"],
  ["shenzhen", "Shenzhen"],
  ["shanghai", "Shanghai"],
  ["other", "Another city"],
];
const NEEDS: [string, string][] = [
  ["canton_fair", "Canton Fair"],
  ["markets", "Wholesale markets"],
  ["factories", "Factory visits"],
  ["interpreting", "Interpreting"],
  ["airport_pickup", "Airport pickup"],
];

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function TourGuideCard({ accessToken, startOpen = false }: { accessToken: string; startOpen?: boolean }) {
  const [items, setItems] = useState<MemberTour[]>([]);
  const [open, setOpen] = useState(startOpen);
  const [city, setCity] = useState("guangzhou");
  const [cityOther, setCityOther] = useState("");
  const [arrival, setArrival] = useState("");
  const [days, setDays] = useState("3");
  const [people, setPeople] = useState("1");
  const [needs, setNeeds] = useState<string[]>([]);
  const [hotel, setHotel] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ tours: MemberTour[] }>("/members/tours", accessToken);
      setItems(result.tours || []);
    } catch {
      setItems([]);
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ tour: MemberTour }>("/members/tours", accessToken, {
        method: "POST",
        body: JSON.stringify({
          city,
          city_other: city === "other" ? cityOther : null,
          arrival_date: arrival,
          days: Number(days),
          people: Number(people),
          needs,
          hotel_area: hotel,
          whatsapp,
          notes,
        }),
      });
      setOpen(false);
      setNotice(`Request sent. We'll send your quote in the chat "Tour guide: ${result.tour.city_label}".`);
      setArrival("");
      setNotes("");
      setNeeds([]);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your tour request could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  const recent = items.filter((item) => item.status !== "cancelled").slice(0, 4);
  return (
    <section className="member-perk member-tourguide" aria-labelledby="member-perk-tour">
      <div className="member-perk-head">
        <div>
          <h3 id="member-perk-tour">Tour guide in China</h3>
          <p>A FayFort team member meets you in China: markets, factories, the Canton Fair, interpreting and getting around.</p>
        </div>
        <strong className="member-perk-price">Quoted for your trip</strong>
      </div>
      {recent.length > 0 && <h4 className="member-tourguide-title">Your trips</h4>}
      {recent.map((item) => (
        <div className="member-perk-row member-tourguide-trip" key={item.id}>
          <span>
            <strong>{item.summary}</strong>
            <small>
              <em className={`member-tourguide-status is-${item.status}`}>{STATUS_SHORT[item.status]}</em>
              {STATUS[item.status].split(" · ")[1] ? ` ${STATUS[item.status].split(" · ")[1]}` : ""}
              {item.guide_name && item.status === "confirmed" ? ` · Guide: ${item.guide_name}` : ""}
            </small>
          </span>
          {item.status === "quoted" && item.invoice_url ? (
            <a className="primary-button" href={item.invoice_url} target="_blank" rel="noopener noreferrer">
              Pay {formatMoney(Number(item.quote_amount), item.currency)}
            </a>
          ) : item.conversation_id ? (
            <a className="secondary-button" href={`/member/chat?conversation=${item.conversation_id}`}>
              Open chat
            </a>
          ) : null}
        </div>
      ))}
      {notice && <p className="member-perk-notice" role="status">{notice}</p>}
      {open ? (
        <form className="member-perk-form member-tour-form" onSubmit={(event) => void send(event)}>
          <div className="member-tour-grid">
            <label>
              Arriving in
              <select value={city} onChange={(event) => setCity(event.target.value)}>
                {CITIES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {city === "other" && (
              <label>
                Which city?
                <input value={cityOther} maxLength={80} required onChange={(event) => setCityOther(event.target.value)} />
              </label>
            )}
            <label>
              Arrival date
              <input type="date" min={today()} required value={arrival} onChange={(event) => setArrival(event.target.value)} />
            </label>
            <label>
              Days with a guide
              <input type="number" min={1} max={30} required value={days} onChange={(event) => setDays(event.target.value)} />
            </label>
            <label>
              People
              <input type="number" min={1} max={50} required value={people} onChange={(event) => setPeople(event.target.value)} />
            </label>
          </div>
          <fieldset className="member-tour-needs">
            <legend>What do you need?</legend>
            {NEEDS.map(([key, label]) => (
              <label key={key} className={needs.includes(key) ? "is-on" : undefined}>
                <input
                  type="checkbox"
                  checked={needs.includes(key)}
                  onChange={(event) => setNeeds((current) => (event.target.checked ? [...current, key] : current.filter((n) => n !== key)))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="member-tour-grid">
            <label>
              Hotel or area (optional)
              <input value={hotel} maxLength={200} placeholder="e.g. Pazhou, near the Canton Fair" onChange={(event) => setHotel(event.target.value)} />
            </label>
            <label>
              WhatsApp (optional)
              <input value={whatsapp} maxLength={40} inputMode="tel" placeholder="+234…" onChange={(event) => setWhatsapp(event.target.value)} />
            </label>
          </div>
          <label>
            Anything else? (optional)
            <textarea rows={3} maxLength={2000} value={notes} placeholder="What you're buying, budget, languages…" onChange={(event) => setNotes(event.target.value)} />
          </label>
          <p className="member-tour-pending">
            Picking a date from our calendar is coming soon. For now, our team confirms your dates in the chat before sending the quote.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="member-perk-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary-button" disabled={busy || !arrival}>
              {busy ? "Sending…" : "Request a guide"}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="primary-button" onClick={() => setOpen(true)}>
          Request a tour guide
        </button>
      )}
    </section>
  );
}
