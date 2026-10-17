import { FormEvent, useEffect, useLayoutEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { MemberDialog } from "./MemberAccountDialogs";
import { memberCountryOptions } from "./memberShared";
import { FayfortLoader } from "../brand/FayfortLogo";

/** A saved delivery address. Members keep up to two; one is the default. */
export type MemberAddress = {
  id: string;
  label: string;
  recipient_name: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
  is_default: boolean;
};

export type ProfileCompletion = {
  percent: number;
  done: number;
  total: number;
  address_ready: boolean;
  items: { key: string; label: string; done: boolean; required?: boolean; why?: string }[];
};

export const MAX_ADDRESSES = 2;

export function addressLine(address: Partial<MemberAddress> | null | undefined): string {
  if (!address) return "";
  return [address.line1, address.line2, address.city, address.region, address.postal_code, address.country]
    .filter(Boolean)
    .join(", ");
}

type AddressDraft = Omit<MemberAddress, "id" | "is_default"> & { make_default: boolean };
const emptyDraft: AddressDraft = {
  label: "Home",
  recipient_name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postal_code: "",
  country: "",
  make_default: false,
};

/** Add or edit one address. */
export function AddressForm({
  initial,
  onSave,
  onCancel,
  busy,
  submitLabel = "Save address",
}: {
  initial?: MemberAddress | null;
  onSave: (draft: AddressDraft) => void;
  onCancel?: () => void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState<AddressDraft>(
    initial ? { ...emptyDraft, ...initial, make_default: initial.is_default } : emptyDraft,
  );
  const set = (field: keyof AddressDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  return (
    <form
      className="member-address-form"
      aria-label={initial ? `Edit ${initial.label} address` : "New address"}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="member-shipping-grid">
        <label>
          Name for this address
          <input required maxLength={40} value={draft.label} onChange={(event) => set("label", event.target.value)} placeholder="Home, Office…" />
        </label>
        <label>
          Recipient <span className="quiet-note">(optional)</span>
          <input autoComplete="name" maxLength={120} value={draft.recipient_name || ""} onChange={(event) => set("recipient_name", event.target.value)} />
        </label>
      </div>
      <label>
        Street address
        <input required autoComplete="address-line1" maxLength={160} value={draft.line1} onChange={(event) => set("line1", event.target.value)} />
      </label>
      <label>
        Apartment, suite, unit <span className="quiet-note">(optional)</span>
        <input autoComplete="address-line2" maxLength={160} value={draft.line2 || ""} onChange={(event) => set("line2", event.target.value)} />
      </label>
      <div className="member-shipping-grid">
        <label>
          City or town
          <input required autoComplete="address-level2" maxLength={100} value={draft.city} onChange={(event) => set("city", event.target.value)} />
        </label>
        <label>
          State or region <span className="quiet-note">(optional)</span>
          <input autoComplete="address-level1" maxLength={100} value={draft.region || ""} onChange={(event) => set("region", event.target.value)} />
        </label>
      </div>
      <div className="member-shipping-grid">
        <label>
          Postal code <span className="quiet-note">(optional)</span>
          <input autoComplete="postal-code" maxLength={32} value={draft.postal_code || ""} onChange={(event) => set("postal_code", event.target.value)} />
        </label>
        <label>
          Country
          <select required autoComplete="country-name" value={draft.country} onChange={(event) => set("country", event.target.value)}>
            <option value="">Select country</option>
            {draft.country && !memberCountryOptions.some((country) => country.name === draft.country) && (
              <option value={draft.country}>{draft.country}</option>
            )}
            {memberCountryOptions.map((country) => (
              <option key={country.code} value={country.name}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Phone for delivery <span className="quiet-note">(couriers may call)</span>
        <input type="tel" autoComplete="tel" maxLength={40} value={draft.phone || ""} onChange={(event) => set("phone", event.target.value)} placeholder="+234 803 000 0000" />
      </label>
      <label className="member-checkbox-row">
        <input type="checkbox" checked={draft.make_default} onChange={(event) => set("make_default", event.target.checked)} />
        <span>Use this as my default address</span>
      </label>
      <div className="member-shipping-actions">
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function payloadFor(draft: AddressDraft) {
  const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
  return {
    label: draft.label.trim() || "Home",
    recipient_name: clean(draft.recipient_name),
    phone: clean(draft.phone),
    line1: draft.line1.trim(),
    line2: clean(draft.line2),
    city: draft.city.trim(),
    region: clean(draft.region),
    postal_code: clean(draft.postal_code),
    country: draft.country,
    make_default: draft.make_default,
  };
}

/** Load and change the member's saved addresses. */
export function useAddresses(accessToken: string | null, reloadKey = 0) {
  const [addresses, setAddresses] = useState<MemberAddress[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!accessToken) return;
    let alive = true;
    apiRequest<{ addresses: MemberAddress[] }>("/members/addresses", accessToken)
      .then((result) => alive && setAddresses(result.addresses || []))
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Your addresses could not be loaded."))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [accessToken, reloadKey]);
  async function run(path: string, method: string, body?: unknown) {
    if (!accessToken) return false;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ addresses: MemberAddress[] }>(path, accessToken, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setAddresses(result.addresses || []);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your address could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    addresses,
    loaded,
    busy,
    error,
    add: (draft: AddressDraft) => run("/members/addresses", "POST", payloadFor(draft)),
    update: (id: string, draft: AddressDraft) => run(`/members/addresses/${id}`, "PUT", payloadFor(draft)),
    remove: (id: string) => run(`/members/addresses/${id}`, "DELETE"),
    makeDefault: (id: string) => run(`/members/addresses/${id}/default`, "POST"),
  };
}

/** Settings: the address book (up to two addresses). */
export function AddressBook({ accessToken, onChange }: { accessToken: string; onChange?: () => void }) {
  const book = useAddresses(accessToken);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const done = (ok: boolean) => {
    if (ok) {
      setEditing(null);
      onChange?.();
    }
  };
  return (
    <section className="member-settings-section" aria-labelledby="member-settings-addresses">
      <h2 id="member-settings-addresses">Shipping addresses</h2>
      <p>
        Save up to two addresses. You'll choose one before paying for an order, so we know where to deliver.
      </p>
      {!book.loaded ? (
        <FayfortLoader label="Loading your addresses…" />
      ) : (
        <div className="member-address-list">
          {book.addresses.map((address) =>
            editing === address.id ? (
              <AddressForm
                key={address.id}
                initial={address}
                busy={book.busy}
                onCancel={() => setEditing(null)}
                onSave={(draft) => void book.update(address.id, draft).then(done)}
              />
            ) : (
              <article key={address.id} className={address.is_default ? "member-address-card is-default" : "member-address-card"}>
                <div>
                  <strong>
                    {address.label}
                    {address.is_default && <span className="member-address-badge">Default</span>}
                  </strong>
                  {address.recipient_name && <span>{address.recipient_name}</span>}
                  <span>{addressLine(address)}</span>
                  {address.phone ? <small>{address.phone}</small> : <small className="member-address-missing">No phone for delivery</small>}
                </div>
                <div className="member-address-actions">
                  <button type="button" className="secondary-button" onClick={() => setEditing(address.id)}>
                    Edit
                  </button>
                  {!address.is_default && (
                    <button type="button" className="secondary-button" disabled={book.busy} onClick={() => void book.makeDefault(address.id).then(done)}>
                      Make default
                    </button>
                  )}
                  <button type="button" className="link-danger" disabled={book.busy} onClick={() => void book.remove(address.id).then(done)}>
                    Remove
                  </button>
                </div>
              </article>
            ),
          )}
          {editing === "new" ? (
            <AddressForm busy={book.busy} onCancel={() => setEditing(null)} onSave={(draft) => void book.add(draft).then(done)} />
          ) : book.addresses.length < MAX_ADDRESSES ? (
            <button type="button" className="secondary-button member-address-add" onClick={() => setEditing("new")}>
              + Add {book.addresses.length ? "a second" : "an"} address
            </button>
          ) : (
            <p className="quiet-note">You have two addresses saved. Edit or remove one to add another.</p>
          )}
        </div>
      )}
      {book.error && (
        <p className="form-error" role="alert">
          {book.error}
        </p>
      )}
    </section>
  );
}

/** How complete the member's profile is; the address is the item that blocks paying for an order. */
export function ProfileCompletionCard({
  completion,
  onAction,
}: {
  completion: ProfileCompletion | null | undefined;
  onAction?: (key: string) => void;
}) {
  if (!completion) return null;
  return (
    <section className="member-settings-section member-completion" aria-labelledby="member-completion-heading">
      <div className="member-completion-head">
        <h2 id="member-completion-heading">Profile {completion.percent}% complete</h2>
        <span>
          {completion.done} of {completion.total}
        </span>
      </div>
      <ProfileMeter percent={completion.percent} />
      <ul className="member-completion-list">
        {completion.items.map((item) => (
          <li key={item.key} className={item.done ? "is-done" : item.required ? "is-required" : ""}>
            <span aria-hidden="true">{item.done ? "✓" : item.required ? "!" : "○"}</span>
            <div>
              <strong>{item.label}</strong>
              {!item.done && item.why && <small>{item.why}</small>}
            </div>
            {!item.done && onAction && ["address", "phone", "photo"].includes(item.key) && (
              <button type="button" className="link-button" onClick={() => onAction(item.key)}>
                Add
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProfileMeter({ percent, label }: { percent: number; label?: string }) {
  const tone = percent >= 100 ? "is-complete" : percent >= 60 ? "is-mid" : "is-low";
  return (
    <span
      className={`member-meter ${tone}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label || `Profile ${percent}% complete`}
    >
      <span style={{ width: `${Math.max(4, Math.min(100, percent))}%` }} />
    </span>
  );
}

/** Before paying an order invoice: choose (or add) the delivery address. */
export function AddressPickerDialog({
  accessToken,
  invoice,
  onClose,
}: {
  accessToken: string;
  invoice: { id: string; title: string };
  onClose: () => void;
}) {
  const book = useAddresses(accessToken);
  const [choice, setChoice] = useState("");
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!choice && book.addresses.length) setChoice((book.addresses.find((a) => a.is_default) || book.addresses[0]).id);
    if (book.loaded && !book.addresses.length) setAdding(true);
  }, [book.addresses, book.loaded, choice]);
  async function pay() {
    if (!choice) return;
    setPaying(true);
    setError("");
    // Open the tab now (browsers block tabs opened after a wait), then point it at the invoice.
    const tab = window.open("", "_blank");
    try {
      const result = await apiRequest<{ invoice_url: string }>(`/members/invoices/${invoice.id}/pay`, accessToken, {
        method: "POST",
        body: JSON.stringify({ address_id: choice }),
      });
      if (tab) tab.location.href = result.invoice_url;
      else window.location.assign(result.invoice_url);
      onClose();
    } catch (reason) {
      tab?.close();
      setError(reason instanceof Error ? reason.message : "Your invoice could not be opened.");
    } finally {
      setPaying(false);
    }
  }
  return (
    <MemberDialog eyebrow="Delivery address" title="Where should we deliver?" onClose={onClose}>
      <p>
        Choose the address for <strong>{invoice.title}</strong>. It's added to your invoice before you pay.
      </p>
      {!book.loaded ? (
        <FayfortLoader label="Loading your addresses…" />
      ) : adding ? (
        <AddressForm
          busy={book.busy}
          submitLabel="Save and use this address"
          onCancel={book.addresses.length ? () => setAdding(false) : undefined}
          onSave={(draft) =>
            void book.add({ ...draft, make_default: draft.make_default || !book.addresses.length }).then((ok) => {
              if (ok) {
                setAdding(false);
                setChoice("");
              }
            })
          }
        />
      ) : (
        <fieldset className="member-address-choice">
          <legend className="sr-only">Delivery address</legend>
          {book.addresses.map((address) => (
            <label key={address.id} className={choice === address.id ? "is-chosen" : ""}>
              <input type="radio" name="ship-to" value={address.id} checked={choice === address.id} onChange={() => setChoice(address.id)} />
              <span>
                <strong>
                  {address.label}
                  {address.is_default && <span className="member-address-badge">Default</span>}
                </strong>
                <small>{addressLine(address)}</small>
              </span>
            </label>
          ))}
          {book.addresses.length < MAX_ADDRESSES && (
            <button type="button" className="link-button" onClick={() => setAdding(true)}>
              + Use a different address
            </button>
          )}
        </fieldset>
      )}
      {(error || book.error) && (
        <p className="form-error" role="alert">
          {error || book.error}
        </p>
      )}
      {!adding && (
        <button type="button" className="primary-button member-pay-button" disabled={!choice || paying} onClick={() => void pay()}>
          {paying ? "Opening your invoice…" : "Deliver here and pay"}
        </button>
      )}
    </MemberDialog>
  );
}

/** Heart-style save toggle for shop products (the Saved products list). */
export function SaveProductButton({
  accessToken,
  productId,
  initial,
  compact = false,
  onChange,
}: {
  accessToken: string;
  productId: string;
  initial: boolean | null | undefined;
  compact?: boolean;
  onChange?: (saved: boolean) => void;
}) {
  const [saved, setSaved] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  useEffect(() => setSaved(Boolean(initial)), [initial, productId]);
  async function toggle() {
    const next = !saved;
    setBusy(true);
    setSaved(next);
    try {
      await apiRequest(`/members/products/${productId}/saved`, accessToken, { method: next ? "POST" : "DELETE" });
      onChange?.(next);
    } catch {
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className={`${compact ? "shop-save is-compact" : "shop-save"}${saved ? " is-saved" : ""}`}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved products" : "Save product"}
      title={saved ? "Saved" : "Save for later"}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        void toggle();
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      </svg>
      {!compact && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}

/** First-visit tour: points at each part of the member dashboard in turn. */
export type TourStep = { target: string; title: string; body: string };

export const MEMBER_TOUR: TourStep[] = [
  { target: "new-chat", title: "Start a chat", body: "Ask our AI about any product, paste a TikTok or shop link, or ask for a person." },
  { target: "browse", title: "Browse", body: "Shop FayFort products, trending items and group buys. Tap the heart to save one." },
  { target: "saved", title: "Saved products", body: "Everything you've saved, in one place." },
  { target: "requests", title: "Orders & requests", body: "Invoices to pay, your orders and every sourcing request with its delivery estimate." },
  { target: "directory", title: "Supplier directory", body: "Verified suppliers you can contact." },
  { target: "chats", title: "Your chats", body: "Past chats live here. Chats linked to a request are kept with it." },
  { target: "notifications", title: "Notifications", body: "Replies from our team, invoice reminders and request updates." },
  { target: "cart", title: "Cart", body: "Items you're buying from the shop." },
  {
    target: "account",
    title: "Your account",
    body: "Points, rank, plan and Settings. Add a shipping address there: you'll need it before paying for an order.",
  },
];

export function MemberTour({
  steps,
  onFinish,
  beforeStep,
}: {
  steps: TourStep[];
  onFinish: () => void;
  beforeStep?: (step: TourStep) => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const step = steps[index];
  useLayoutEffect(() => {
    beforeStep?.(step);
    const measure = () => {
      const element = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
      if (element && element.offsetParent !== null) {
        element.scrollIntoView?.({ block: "nearest" });
        setBox(element.getBoundingClientRect());
      } else setBox(null);
    };
    const timer = window.setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFinish]);
  const last = index === steps.length - 1;
  const pad = 6;
  const cardStyle: React.CSSProperties = {};
  if (box) {
    const width = Math.min(320, window.innerWidth - 32);
    const right = box.right + 16 + width < window.innerWidth;
    cardStyle.width = width;
    if (right) {
      cardStyle.left = box.right + 16;
      cardStyle.top = Math.max(16, Math.min(box.top, window.innerHeight - 240));
    } else {
      cardStyle.left = Math.max(16, Math.min(box.left, window.innerWidth - width - 16));
      cardStyle.top = box.bottom + 12 + 220 < window.innerHeight ? box.bottom + 12 : Math.max(16, box.top - 232);
    }
  }
  return (
    <div className="member-tour" role="dialog" aria-modal="true" aria-label="Dashboard tour">
      {box ? (
        <div
          className="member-tour-spot"
          style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
        />
      ) : (
        <div className="member-tour-dim" />
      )}
      <section className={box ? "member-tour-card" : "member-tour-card is-centered"} style={cardStyle} aria-live="polite">
        <small>
          Step {index + 1} of {steps.length}
        </small>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="member-tour-dots" aria-hidden="true">
          {steps.map((item, position) => (
            <span key={item.target} className={position === index ? "is-active" : ""} />
          ))}
        </div>
        <div className="member-tour-actions">
          <button type="button" className="link-button" onClick={onFinish}>
            Skip tour
          </button>
          <span>
            {index > 0 && (
              <button type="button" className="secondary-button" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button type="button" className="primary-button" onClick={() => (last ? onFinish() : setIndex(index + 1))}>
              {last ? "Finish" : "Next"}
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
