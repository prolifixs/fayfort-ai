import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { AdSlot } from "./ads";
import { ApiRequestError, apiRequest } from "../../lib/api";
import {
  type Consultation,
  type ContactPack,
  type ContactStatus,
  type DirectoryRecord,
  type DirectoryType,
  type LandedStatus,
  type MemberPlanSummary,
  formatMoney,
} from "./membershipApi";
import { FayfortLoader } from "../brand/FayfortLogo";

const STATUS_LABEL: Record<Consultation["status"], string> = {
  awaiting_payment: "Waiting for payment",
  requested: "Booked · a specialist will reply in the chat",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Book a consultation: $100 Free, $50 Standard, Pro one included each month (then $50). */
export function ConsultationCard({
  accessToken,
  plan,
  onChange,
}: {
  accessToken: string;
  plan: MemberPlanSummary | null;
  onChange: () => void;
}) {
  const [items, setItems] = useState<Consultation[]>([]);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ consultations: Consultation[] }>("/members/consultations", accessToken);
      setItems(result.consultations || []);
    } catch {
      setItems([]);
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  const quote = plan?.consultation;
  const priceLabel = !quote ? "" : quote.included ? "Included in Pro this month" : formatMoney(quote.price, quote.currency);
  async function book(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest<{ consultation: Consultation }>("/members/consultations", accessToken, {
        method: "POST",
        body: JSON.stringify({ topic: topic.trim() }),
      });
      setTopic("");
      setOpen(false);
      await load();
      onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your consultation could not be booked.");
    } finally {
      setBusy(false);
    }
  }
  const recent = items.filter((item) => item.status !== "cancelled").slice(0, 3);
  return (
    <section className="member-perk" aria-labelledby="member-perk-consultation">
      <div className="member-perk-head">
        <div>
          <h3 id="member-perk-consultation">Consultation</h3>
          <p>One-to-one time with a FayFort sourcing specialist: suppliers, markets, trips and shipping.</p>
        </div>
        {quote && <strong className="member-perk-price">{priceLabel}</strong>}
      </div>
      {recent.map((item) => (
        <div className="member-perk-row" key={item.id}>
          <span>
            <strong>{item.topic}</strong>
            <small>{STATUS_LABEL[item.status]}</small>
          </span>
          {item.status === "awaiting_payment" && item.invoice_url ? (
            <a className="primary-button" href={item.invoice_url} target="_blank" rel="noopener noreferrer">
              Pay {formatMoney(Number(item.price), item.currency)}
            </a>
          ) : item.conversation_id ? (
            <a className="secondary-button" href={`/member/chat?conversation=${item.conversation_id}`}>
              Open chat
            </a>
          ) : null}
        </div>
      ))}
      {open ? (
        <form className="member-perk-form" onSubmit={(event) => void book(event)}>
          <label htmlFor="member-consultation-topic">What would you like to discuss?</label>
          <textarea
            id="member-consultation-topic"
            rows={3}
            maxLength={1000}
            required
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. Finding a reliable wig supplier in Guangzhou before the Canton Fair"
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="member-perk-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary-button" disabled={busy || topic.trim().length < 3}>
              {busy ? "Booking…" : quote && !quote.included ? `Book · ${priceLabel}` : "Book consultation"}
            </button>
          </div>
          {quote && !quote.included && (
            <small className="member-deposit-note">You'll get a payment link; the chat opens once it's paid.</small>
          )}
        </form>
      ) : (
        <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
          Book a consultation
        </button>
      )}
    </section>
  );
}

/** Contact credits: Pro's monthly allowance, purchased credits and the packs to buy more. */
export function ContactCreditsCard({
  accessToken,
  status,
  compact,
}: {
  accessToken: string;
  status: ContactStatus | null | undefined;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  async function buy(pack: ContactPack) {
    setBusy(pack.id);
    setError("");
    try {
      const result = await apiRequest<{ invoice: { invoice_url: string | null } }>("/members/contact-credits", accessToken, {
        method: "POST",
        body: JSON.stringify({ pack: pack.id }),
      });
      if (result.invoice.invoice_url) setLinks((current) => ({ ...current, [pack.id]: result.invoice.invoice_url! }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The payment link could not be created.");
    } finally {
      setBusy("");
    }
  }
  if (!status) return null;
  return (
    <section className={compact ? "member-perk compact" : "member-perk"} aria-labelledby="member-perk-contacts">
      <div className="member-perk-head">
        <div>
          <h3 id="member-perk-contacts">Supplier contacts</h3>
          <p>
            {status.pro_allowance
              ? `${status.pro_allowance_left} of ${status.pro_allowance} included unlocks left this month`
              : "Unlock a supplier's address, stall and contact person"}
            {status.credits ? ` · ${status.credits} credit${status.credits === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </div>
      <div className="member-perk-actions">
        {status.packs.map((pack) =>
          links[pack.id] ? (
            <a key={pack.id} className="primary-button" href={links[pack.id]} target="_blank" rel="noopener noreferrer">
              Pay {formatMoney(pack.price, pack.currency)}
            </a>
          ) : (
            <button key={pack.id} type="button" className="secondary-button" disabled={!!busy} onClick={() => void buy(pack)}>
              {busy === pack.id
                ? "Creating link…"
                : pack.credits === 1
                  ? `1 contact · ${formatMoney(pack.price, pack.currency)}`
                  : `${pack.credits} contacts · ${formatMoney(pack.price, pack.currency)}`}
            </button>
          ),
        )}
      </div>
      {Object.keys(links).length > 0 && (
        <small className="member-deposit-note">Credits are added as soon as the payment goes through.</small>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

const DIRECTORY_TABS: { id: DirectoryType; label: string; placeholder: string }[] = [
  { id: "market", label: "Suppliers & markets", placeholder: "Product or market, e.g. wigs, Liwan" },
  { id: "service_provider", label: "Services", placeholder: "Freight, inspection, agent… or a city" },
  { id: "hotel", label: "Hotels", placeholder: "Area or hotel name" },
  { id: "restaurant", label: "Restaurants", placeholder: "Area or food, e.g. halal" },
];
const FIELD_LABELS: Record<string, string> = {
  place_name: "Market",
  city: "City",
  district: "District",
  service: "Service",
  ships_to: "Ships to",
  area: "Area",
  name_cn: "Chinese name",
  address_or_nearest_metro: "Location",
  takes_foreigners: "Takes foreigners",
  tier: "Tier",
  where_it_is: "Where",
  food_type: "Food",
  halal: "Halal",
  opening_hours: "Hours",
  address_en: "Address",
  address_cn: "Address (Chinese)",
  buyer_notes: "Buyer notes",
  company: "Company",
  company_cn: "Company (Chinese)",
  contact_name: "Contact",
  phone_wechat: "Phone / WeChat",
  other_numbers: "Other numbers",
  email_qq: "Email / QQ",
  booth: "Booth",
  hours: "Hours",
  rough_price_per_night: "Price per night",
  phone: "Phone",
  floor_or_stall: "Floor / stall",
  best_time: "Best time",
};
const HIDDEN_PUBLIC = new Set(["place_name", "hotel_name", "restaurant", "categories"]);

function show(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
}

function Fields({ values, skip }: { values: Record<string, unknown>; skip?: Set<string> }) {
  const entries = Object.entries(values).filter(
    ([key, value]) => !skip?.has(key) && key !== "contacts" && value !== null && value !== undefined && value !== "",
  );
  if (!entries.length) return null;
  return (
    <dl className="member-directory-fields">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{FIELD_LABELS[key] || key.replaceAll("_", " ")}</dt>
          <dd>{show(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function verificationBadge(record: DirectoryRecord) {
  if (record.verified) return <small className="member-directory-badge">Verified</small>;
  if (record.verification === "conflicting") return <small className="member-directory-badge unconfirmed">Sources disagree</small>;
  return <small className="member-directory-badge unconfirmed">Not yet confirmed</small>;
}

/** LANDED buyers (app/membership/landed.py): owners see the LANDED snapshot's addresses free; others can claim. */
export function LandedAccessCard({ accessToken, onChange }: { accessToken: string; onChange?: (owner: boolean) => void }) {
  const [status, setStatus] = useState<LandedStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [orderName, setOrderName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    apiRequest<LandedStatus>("/members/landed", accessToken)
      .then((result) => live && setStatus(result))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [accessToken]);
  async function claim(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<LandedStatus>("/members/landed/claim", accessToken, {
        method: "POST",
        body: JSON.stringify({ order_name: orderName, email }),
      });
      setStatus(result);
      setOpen(false);
      onChange?.(result.owner);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your LANDED access could not be claimed.");
    } finally {
      setBusy(false);
    }
  }
  if (!status) return null;
  if (status.owner) {
    return (
      <div className="member-landed is-owner" role="status">
        <strong>LANDED owner{status.order_name ? ` · order ${status.order_name}` : ""}</strong>
        <span>
          The addresses from your LANDED directory are unlocked for you. Supplier contacts, and entries added after{" "}
          {status.snapshot_date}, use contact credits.
        </span>
      </div>
    );
  }
  return (
    <div className="member-landed">
      {open ? (
        <form className="member-landed-form" onSubmit={(event) => void claim(event)}>
          <strong>Claim your LANDED access</strong>
          <span>Enter the order number from your LANDED receipt and the email you bought it with.</span>
          <div className="member-landed-fields">
            <label>
              Order number
              <input value={orderName} required maxLength={40} placeholder="#1001" onChange={(event) => setOrderName(event.target.value)} />
            </label>
            <label>
              Purchase email
              <input type="email" value={email} required maxLength={320} onChange={(event) => setEmail(event.target.value)} />
            </label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="member-landed-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Checking…" : "Claim access"}
            </button>
          </div>
        </form>
      ) : (
        <p className="member-landed-ask">
          <span>Bought the LANDED book? Its directory addresses are free for you.</span>
          <button type="button" className="text-button" onClick={() => setOpen(true)}>
            Claim your access
          </button>
        </p>
      )}
    </div>
  );
}

/** Supplier directory panel in the member chat: search, unlock, and "My contacts". */
export function DirectoryPanel({ accessToken, onClose }: { accessToken: string; onClose?: () => void }) {
  const [type, setType] = useState<DirectoryType | "mine">("market");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryRecord[] | null>(null);
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [needCredits, setNeedCredits] = useState(false);
  const search = useCallback(
    async (nextType: DirectoryType | "mine", nextQuery: string) => {
      setError("");
      setResults(null);
      try {
        const result =
          nextType === "mine"
            ? await apiRequest<{ results: DirectoryRecord[]; contacts: ContactStatus }>("/members/directory/unlocked", accessToken)
            : await apiRequest<{ results: DirectoryRecord[]; contacts: ContactStatus }>(
                `/members/directory?${new URLSearchParams({ type: nextType, q: nextQuery.trim() })}`,
                accessToken,
              );
        setResults(result.results || []);
        setStatus(result.contacts);
      } catch (reason) {
        setResults([]);
        setError(reason instanceof Error ? reason.message : "The directory could not be loaded.");
      }
    },
    [accessToken],
  );
  useEffect(() => {
    void search("market", "");
  }, [search]);
  async function unlock(record: DirectoryRecord) {
    setBusy(record.id);
    setError("");
    setNeedCredits(false);
    try {
      const result = await apiRequest<{ record: DirectoryRecord }>("/members/directory/unlock", accessToken, {
        method: "POST",
        body: JSON.stringify({ record_type: record.record_type, record_id: record.id }),
      });
      setResults((current) => (current || []).map((item) => (item.id === record.id ? result.record : item)));
      if (result.record.contacts) setStatus(result.record.contacts);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 402) setNeedCredits(true);
      setError(reason instanceof Error ? reason.message : "That contact could not be unlocked.");
    } finally {
      setBusy("");
    }
  }
  const tab = DIRECTORY_TABS.find((item) => item.id === type);
  const unlockLabel = status?.pro_allowance_left ? "Unlock (included)" : status?.credits ? "Unlock (1 credit)" : "Unlock";
  return (
    <section className="member-workspace-panel member-directory" aria-label="Supplier directory">
      <div className="member-directory-header">
        <div>
          <h2>Supplier directory</h2>
          <p>Markets, suppliers and services in China. Entries we haven't confirmed yet are marked. Unlock a record to see its address and contacts.</p>
        </div>
        {onClose && (
          <button type="button" className="secondary-button" onClick={onClose}>
            Back to chat
          </button>
        )}
      </div>
      <div className="member-directory-tabs" role="tablist" aria-label="Directory sections">
        {[...DIRECTORY_TABS, { id: "mine" as const, label: "My contacts", placeholder: "" }].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={type === item.id}
            onClick={() => {
              setType(item.id);
              void search(item.id, item.id === "mine" ? "" : query);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {type !== "mine" && (
        <form
          className="member-directory-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void search(type, query);
          }}
        >
          <input
            aria-label="Search the directory"
            value={query}
            maxLength={100}
            placeholder={tab?.placeholder}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="primary-button">Search</button>
        </form>
      )}
      <LandedAccessCard accessToken={accessToken} onChange={() => void search(type, query)} />
      {(type === "market" || type === "service_provider" || type === "mine") && (
        <ContactCreditsCard accessToken={accessToken} status={status} compact />
      )}
      {error && (
        <p className={needCredits ? "member-directory-notice" : "form-error"} role="alert">
          {error}
        </p>
      )}
      {results === null ? (
        <FayfortLoader label="Loading…" />
      ) : !results.length ? (
        <p className="empty-copy">
          {type === "mine" ? "Contacts you unlock are kept here for good." : "Nothing matched. Try a product, market or city."}
        </p>
      ) : (
        <ul className="member-directory-list">
          {results.map((record, index) => (
            <Fragment key={`${record.record_type}-${record.id}`}>
            {index === 5 && <AdSlot placement="directory_feed" as="li" />}
            <li className={record.unlocked ? "unlocked" : undefined}>
              <div className="member-directory-title">
                <strong>{record.title}</strong>
                {verificationBadge(record)}
                {record.free && <small className="member-directory-badge free">Free</small>}
              </div>
              {!!record.public.categories?.length && (
                <p className="member-directory-tags">{record.public.categories.join(" · ")}</p>
              )}
              <Fields values={record.public} skip={HIDDEN_PUBLIC} />
              {record.unlocked && record.private ? (
                <div className="member-directory-private">
                  <Fields values={record.private} />
                  {(record.private.contacts || []).map((contact, index) => (
                    <Fields key={index} values={contact as Record<string, unknown>} skip={new Set(["verified"])} />
                  ))}
                </div>
              ) : !record.unlocked ? (
                <>
                {record.landed && record.private && (
                  <div className="member-directory-private is-landed">
                    <small className="member-directory-landed">Free with LANDED</small>
                    <Fields values={record.private} />
                  </div>
                )}
                <div className="member-directory-locked">
                  <span>{record.landed ? "Stall and contact details are locked." : "Address, stall and contact details are locked."}</span>
                  <button type="button" className="primary-button" disabled={busy === record.id} onClick={() => void unlock(record)}>
                    {busy === record.id ? "Unlocking…" : unlockLabel}
                  </button>
                </div>
                </>
              ) : null}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
    </section>
  );
}
