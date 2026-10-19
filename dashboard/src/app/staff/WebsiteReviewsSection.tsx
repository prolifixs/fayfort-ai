import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { NextHint } from "./PageHelp";
import { ApiRequestError, apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";

/** Control Center → Website → Customer reviews: screenshots of reviews customers sent (read automatically, checked
 * here), member reviews of shipped orders, and what shows on the www.fayfort.com home page. */

type Source = "member" | "instagram" | "whatsapp" | "facebook" | "tiktok" | "email" | "google" | "other";
type Status = "pending" | "published" | "hidden";
export type StaffReview = {
  id: string;
  source: Source;
  status: Status;
  featured: boolean;
  rating: number | null;
  body: string;
  display_name: string | null;
  country: string | null;
  product: string | null;
  reviewed_on: string | null;
  staff_note: string | null;
  ocr_text: string | null;
  screenshot_url: string | null;
  created_at: string;
};
type Listing = { reviews: StaffReview[]; counts: Record<Status, number> };
type Filter = "pending" | "published" | "hidden" | "all";

const SOURCE_LABEL: Record<Source, string> = {
  member: "Member review",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  tiktok: "TikTok",
  email: "Email",
  google: "Google",
  other: "Other",
};
const IMPORT_SOURCES: Exclude<Source, "member">[] = ["instagram", "whatsapp", "facebook", "tiktok", "email", "google", "other"];
const FILTERS: [Filter, string][] = [
  ["pending", "To check"],
  ["published", "Published"],
  ["hidden", "Hidden"],
  ["all", "All"],
];
const READ_TIMEOUT_MS = 90_000;

export function WebsiteReviewsSection({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<"" | Exclude<Source, "member">>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Listing>("/platform/site/reviews", accessToken));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so reviews aren't available yet."
          : reason instanceof Error
            ? reason.message
            : "Reviews could not be loaded.",
      );
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(files: FileList | null) {
    const list = Array.from(files || []).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
    if (!list.length) {
      setError("Choose PNG, JPEG or WebP screenshots.");
      return;
    }
    setError("");
    setNotice("");
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    for (const [index, file] of list.entries()) {
      try {
        await apiRequest(
          `/platform/site/reviews/screenshot${source ? `?source=${source}` : ""}`,
          accessToken,
          { method: "POST", body: file, headers: { "Content-Type": file.type } },
          READ_TIMEOUT_MS,
        );
      } catch (reason) {
        failed += 1;
        setError(`${file.name}: ${reason instanceof Error ? reason.message : "could not be read"}`);
      }
      setProgress({ done: index + 1, total: list.length });
    }
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
    const read = list.length - failed;
    if (read) setNotice(`${read} screenshot${read === 1 ? "" : "s"} read. Check ${read === 1 ? "it" : "them"} below, then publish.`);
    setFilter("pending");
    await load();
  }

  async function save(review: StaffReview, next: Partial<StaffReview>, message: string) {
    setError("");
    setNotice("");
    const merged = { ...review, ...next };
    const payload = {
      source: merged.source === "member" ? "other" : merged.source,
      status: merged.status,
      featured: merged.featured,
      body: merged.body,
      display_name: merged.display_name || null,
      country: merged.country || null,
      product: merged.product || null,
      rating: merged.rating,
      reviewed_on: merged.reviewed_on || null,
      staff_note: merged.staff_note || null,
    };
    try {
      await apiRequest(`/platform/site/reviews/${review.id}`, accessToken, { method: "PUT", body: JSON.stringify(payload) });
      setNotice(message);
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The review could not be saved.");
      return false;
    }
  }

  async function remove(review: StaffReview) {
    try {
      await apiRequest(`/platform/site/reviews/${review.id}`, accessToken, { method: "DELETE" });
      setNotice("Deleted.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The review could not be deleted.");
    }
  }

  const shown = (data?.reviews || []).filter((review) => filter === "all" || review.status === filter);
  const counts = data?.counts || { pending: 0, published: 0, hidden: 0 };
  return (
    <section className="control-panel reviews-admin" id="reviews" aria-label="Customer reviews">
      <div className="panel-heading">
        <h2>Customer reviews</h2>
        <p>
          Shown on the www.fayfort.com home page. Upload screenshots of reviews customers sent you and the text is read for you; check it, then
          publish. Members can also review an order once it ships, and those arrive here too. Publish every genuine review, good or bad; hide
          only spam, abuse or personal details.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-delivery ok" role="status">
          {notice}
        </p>
      )}
      <div className="reviews-intake">
        <div
          className="reviews-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void upload(event.dataTransfer.files);
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 16v3h16v-3M12 4v11M7 9l5-5 5 5" />
          </svg>
          <div>
            <strong>{progress ? `Reading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Add review screenshots"}</strong>
            <span>Drop them here or choose files. PNG, JPEG or WebP, up to 8 MB each.</span>
          </div>
          <label className="reviews-source">
            Screenshots from
            <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} disabled={!!progress}>
              <option value="">Work it out</option>
              {IMPORT_SOURCES.map((item) => (
                <option key={item} value={item}>
                  {SOURCE_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label className={`primary-button reviews-choose${progress ? " is-busy" : ""}`}>
            {progress ? "Reading…" : "Choose screenshots"}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={!!progress}
              onChange={(event) => void upload(event.target.files)}
            />
          </label>
        </div>
        <button type="button" className="text-link-button" onClick={() => setTyping((value) => !value)} aria-expanded={typing}>
          {typing ? "Close" : "Or type one in (from a call, an email or a text)"}
        </button>
        {typing && (
          <TypeInForm
            accessToken={accessToken}
            onSaved={async () => {
              setTyping(false);
              setNotice("Saved. Check it below, then publish.");
              setFilter("pending");
              await load();
            }}
            onError={setError}
          />
        )}
      </div>
      <div className="reviews-filters" role="tablist" aria-label="Show reviews">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>
            {label}
            {key !== "all" && <span>{counts[key]}</span>}
          </button>
        ))}
      </div>
      {!data ? (
        !error && <FayfortLoader label="Loading…" />
      ) : !shown.length ? (
        <p className="muted reviews-empty">
          {filter === "pending" ? "Nothing to check. New screenshots and member reviews show up here." : "No reviews here yet."}
        </p>
      ) : (
        <ul className="reviews-list">
          {shown.map((review) => (
            <ReviewCard key={review.id} review={review} onSave={save} onRemove={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Stars({ value, onChange, label }: { value: number | null; onChange?: (value: number | null) => void; label: string }) {
  return (
    <span className="review-stars" role={onChange ? "radiogroup" : "img"} aria-label={onChange ? label : `${value || 0} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className={value && n <= value ? "is-on" : ""}
            onClick={() => onChange(value === n ? null : n)}
          >
            ★
          </button>
        ) : (
          <i key={n} className={value && n <= value ? "is-on" : ""} aria-hidden="true">
            ★
          </i>
        ),
      )}
    </span>
  );
}

function ReviewCard({
  review,
  onSave,
  onRemove,
}: {
  review: StaffReview;
  onSave: (review: StaffReview, next: Partial<StaffReview>, message: string) => Promise<boolean>;
  onRemove: (review: StaffReview) => void;
}) {
  const [draft, setDraft] = useState(review);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setDraft(review), [review]);
  const member = review.source === "member";
  const changed = JSON.stringify(draft) !== JSON.stringify(review);
  const set = (next: Partial<StaffReview>) => setDraft((current) => ({ ...current, ...next }));
  async function act(next: Partial<StaffReview>, message: string) {
    setBusy(true);
    await onSave(draft, next, message);
    setBusy(false);
  }
  const statusPill = { pending: ["To check", "is-warn"], published: ["Published", "is-good"], hidden: ["Hidden", ""] }[review.status];
  return (
    <li className={`review-admin-card is-${review.status}`} aria-label={`Review from ${review.display_name || "a customer"}`}>
      <div className="review-admin-media">
        {review.screenshot_url ? (
          <button type="button" className="review-shot" onClick={() => setZoom(true)} aria-label="Open the screenshot">
            <img src={review.screenshot_url} alt="" loading="lazy" />
          </button>
        ) : (
          <div className={`review-shot-none${member ? " is-member" : ""}`}>
            <strong>{member ? "Verified order" : "Typed in"}</strong>
            <span>{member ? "Written by the member in their dashboard" : "No screenshot"}</span>
          </div>
        )}
        {zoom && review.screenshot_url && (
          <div className="review-zoom" role="dialog" aria-label="Screenshot" onClick={() => setZoom(false)}>
            <img src={review.screenshot_url} alt="Review screenshot" />
            <button type="button" className="secondary-button" onClick={() => setZoom(false)}>
              Close
            </button>
          </div>
        )}
      </div>
      <div className="review-admin-body">
        <div className="review-admin-head">
          <span className={`status-pill ${statusPill[1]}`.trim()}>{statusPill[0]}</span>
          <span className="review-source">{SOURCE_LABEL[review.source]}</span>
          {review.featured && <span className="status-pill is-good">On the home page first</span>}
        </div>
        {review.staff_note && review.status === "pending" && <p className="review-note">{review.staff_note}</p>}
        {review.status === "pending" && (
          <NextHint>
            {member
              ? "Read it, then Publish it to the website or Hide it. Members' words can't be changed."
              : "Compare the text with the screenshot, fix anything the reader got wrong, add the name, then Publish."}
          </NextHint>
        )}
        {member ? (
          <div className="review-member-words">
            <Stars value={review.rating} label="Rating" />
            <blockquote>{review.body}</blockquote>
            <small>The member's own words and stars can't be edited. Publish or hide them.</small>
          </div>
        ) : (
          <label className="review-field review-field-body">
            Customer's words
            <textarea rows={4} maxLength={1500} value={draft.body} onChange={(event) => set({ body: event.target.value })} />
          </label>
        )}
        <div className="review-field-grid">
          <label className="review-field">
            Name to show
            <input maxLength={60} value={draft.display_name || ""} placeholder="Amaka O. or @handle" onChange={(event) => set({ display_name: event.target.value })} />
          </label>
          <label className="review-field">
            Country
            <input maxLength={60} value={draft.country || ""} placeholder="Nigeria" onChange={(event) => set({ country: event.target.value })} />
          </label>
          {!member && (
            <>
              <label className="review-field">
                What they bought
                <input maxLength={120} value={draft.product || ""} placeholder="Optional" onChange={(event) => set({ product: event.target.value })} />
              </label>
              <label className="review-field">
                From
                <select value={draft.source} onChange={(event) => set({ source: event.target.value as Source })}>
                  {IMPORT_SOURCES.map((item) => (
                    <option key={item} value={item}>
                      {SOURCE_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="review-field">
                Date
                <input type="date" value={draft.reviewed_on || ""} onChange={(event) => set({ reviewed_on: event.target.value || null })} />
              </label>
              <div className="review-field">
                <span>Stars (only if the customer gave them)</span>
                <Stars value={draft.rating} onChange={(rating) => set({ rating })} label="Stars the customer gave" />
              </div>
            </>
          )}
        </div>
        {!member && review.ocr_text && (
          <details className="review-ocr">
            <summary>Text read from the screenshot</summary>
            <pre>{review.ocr_text}</pre>
          </details>
        )}
        <div className="review-admin-actions">
          {review.status !== "published" ? (
            <button type="button" className="primary-button" disabled={busy} onClick={() => void act({ status: "published" }, "Published. It shows on the website within about 5 minutes.")}>
              Publish
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              aria-pressed={review.featured}
              onClick={() => void act({ featured: !review.featured }, review.featured ? "No longer shown first." : "Shown first on the home page.")}
            >
              {review.featured ? "★ Shown first" : "☆ Show first"}
            </button>
          )}
          {changed && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({}, "Saved.")}>
              Save changes
            </button>
          )}
          {review.status !== "hidden" && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ status: "hidden", featured: false }, "Hidden from the website.")}>
              Hide
            </button>
          )}
          {confirming ? (
            <>
              <button type="button" className="secondary-button danger" disabled={busy} onClick={() => onRemove(review)}>
                Yes, delete
              </button>
              <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="text-link-button review-delete" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function TypeInForm({ accessToken, onSaved, onError }: { accessToken: string; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const [form, setForm] = useState({ source: "whatsapp", body: "", display_name: "", country: "", product: "" });
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest("/platform/site/reviews", accessToken, {
        method: "POST",
        body: JSON.stringify({ ...form, display_name: form.display_name || null, country: form.country || null, product: form.product || null }),
      });
      await onSaved();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "The review could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="reviews-typein" onSubmit={submit} aria-label="Type in a review">
      <label className="review-field review-field-body">
        Customer's words
        <textarea required rows={3} maxLength={1500} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
      </label>
      <div className="review-field-grid">
        <label className="review-field">
          Name to show
          <input maxLength={60} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
        </label>
        <label className="review-field">
          Country
          <input maxLength={60} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} />
        </label>
        <label className="review-field">
          What they bought
          <input maxLength={120} value={form.product} onChange={(event) => setForm({ ...form, product: event.target.value })} />
        </label>
        <label className="review-field">
          From
          <select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
            {IMPORT_SOURCES.map((item) => (
              <option key={item} value={item}>
                {SOURCE_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="primary-button" disabled={busy}>
        {busy ? "Saving…" : "Save for checking"}
      </button>
    </form>
  );
}
