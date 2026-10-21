/**
 * Store team screens (docs/CATALOG_MERCHANDISING_PLAN.md): the Products workspace, the listing editor, store
 * sections, and the panels inside Store team work items (categories, retiring, refreshing, campaigns).
 * Workers prepare; only an administrator publishes or archives.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import {
  AVAILABILITY_LABEL,
  LISTING_STATUS_LABEL,
  SECTION_STATE_LABEL,
  STATE_LABEL,
  leadTime,
  money,
  type CatalogProduct,
  type Category,
  type ListingMedia,
  type StoreListing,
  type StoreSection,
} from "./storeTypes";
import type { WorkItem } from "./types";
import "./store-team.css";

// ---------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------
let categoryCache: Category[] | null = null;

export function useCategories(token: string | null) {
  const [categories, setCategories] = useState<Category[]>(categoryCache || []);
  useEffect(() => {
    if (!token || categoryCache) return;
    let alive = true;
    apiRequest<{ categories: Category[] }>("/operations/store/categories", token)
      .then((data) => {
        categoryCache = data.categories || [];
        if (alive) setCategories(categoryCache);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token]);
  return categories;
}

export function categoryLabel(categories: Category[], ref: string | null | undefined) {
  if (!ref) return "No category";
  const found = categories.find((item) => item.source_ref === ref);
  return found ? `${found.category}${found.product_type ? ` · ${found.product_type}` : ""}` : ref;
}

/** Search the 968 FayFort categories by a word. */
export function CategoryPicker({
  categories,
  value,
  onChange,
  disabled,
  label = "Category",
}: {
  categories: Category[];
  value: string | null;
  onChange: (ref: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return categories
      .filter((item) => `${item.category} ${item.product_type || ""} ${item.group_name || ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [categories, query]);
  return (
    <div className="st-category">
      <span className="st-label">{label}</span>
      <div className="st-category-current">
        <strong>{categoryLabel(categories, value)}</strong>
        {value && <small>{categories.find((c) => c.source_ref === value)?.group_name || ""}</small>}
      </div>
      {!disabled && (
        <>
          <input
            type="search"
            aria-label="Search categories"
            placeholder="Search categories: wig, lace, ankara…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {matches.length > 0 && (
            <ul className="st-category-matches" role="listbox" aria-label="Matching categories">
              {matches.map((item) => (
                <li key={item.source_ref}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.source_ref === value}
                    onClick={() => {
                      onChange(item.source_ref);
                      setQuery("");
                    }}
                  >
                    <span>{item.category}</span>
                    <small>
                      {item.product_type} · {item.group_name}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && !matches.length && <small className="operations-muted">No category matches “{query}”.</small>}
        </>
      )}
    </div>
  );
}

function Thumb({ url, type, alt }: { url?: string | null; type?: string | null; alt?: string }) {
  if (!url) return <span className="st-thumb is-empty" aria-hidden="true">No photo</span>;
  if (url.includes("instagram.com")) return <span className="st-thumb is-instagram">Instagram</span>;
  return type === "video" ? (
    <video className="st-thumb" src={url} muted playsInline preload="metadata" aria-label={alt || "Video"} />
  ) : (
    <img className="st-thumb" src={url} alt={alt || ""} loading="lazy" />
  );
}

/** How a listing will look to members, using the same rules as the member shop. */
export function ListingPreview({ listing, categories }: { listing: StoreListing; categories: Category[] }) {
  const store = listing.kind === "store_product";
  const first = listing.media[0];
  const percent =
    store && listing.price && listing.compare_at_price && listing.compare_at_price > listing.price
      ? Math.round((1 - listing.price / listing.compare_at_price) * 100)
      : 0;
  const group = categories.find((c) => c.source_ref === listing.category_ref)?.group_name;
  return (
    <figure className="st-preview" aria-label="Member preview">
      <div className="st-preview-media">
        <Thumb url={first?.url} type={first?.media_type} alt={listing.title} />
        <div className="st-preview-badges">
          {percent >= 5 && <b className="is-discount">-{percent}%</b>}
          <b>{store ? "Ships now" : "Sourced on request"}</b>
        </div>
      </div>
      <figcaption>
        <small>{group || (store ? "FayFort store" : "Sourcing")}</small>
        <strong>{listing.title || "Title goes here"}</strong>
        {store ? (
          <span className="st-preview-price">
            <strong>{listing.price ? money(listing.price, listing.currency) : "Price"}</strong>
            {listing.compare_at_price ? <s>{money(listing.compare_at_price, listing.currency)}</s> : null}
          </span>
        ) : (
          <span className="st-preview-price">
            <strong>{listing.price_guide_min ? `From ${money(listing.price_guide_min, listing.currency)}` : "Price guide"}</strong>
            {listing.min_order ? <small> · min {listing.min_order}</small> : null}
          </span>
        )}
        <span className="st-preview-cta">{store ? "Add to cart" : "Request this item"}</span>
      </figcaption>
    </figure>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="st-field">
      <span className="st-label">{label}</span>
      {children}
      {hint && <small className="operations-muted">{hint}</small>}
    </label>
  );
}

const num = (value: string) => (value.trim() === "" ? null : Number(value));
const str = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

// ---------------------------------------------------------------------------------------------
// Listing editor
// ---------------------------------------------------------------------------------------------
type Draft = {
  title: string;
  description: string;
  category_ref: string | null;
  option_name: string;
  option_values: string;
  price: string;
  compare_at_price: string;
  cost: string;
  price_guide_min: string;
  price_guide_max: string;
  min_order: string;
  lead_time_min_days: string;
  lead_time_max_days: string;
  availability_status: StoreListing["availability_status"];
  planned_live_at: string;
};

function toDraft(listing: StoreListing): Draft {
  return {
    title: listing.title || "",
    description: listing.description || "",
    category_ref: listing.category_ref,
    option_name: listing.option_name || "",
    option_values: (listing.option_values || []).join(", "),
    price: str(listing.price),
    compare_at_price: str(listing.compare_at_price),
    cost: str(listing.cost),
    price_guide_min: str(listing.price_guide_min),
    price_guide_max: str(listing.price_guide_max),
    min_order: str(listing.min_order),
    lead_time_min_days: str(listing.lead_time_min_days),
    lead_time_max_days: str(listing.lead_time_max_days),
    availability_status: listing.availability_status || "sourcing",
    planned_live_at: listing.planned_live_at ? listing.planned_live_at.slice(0, 16) : "",
  };
}

function draftChanges(listing: StoreListing, draft: Draft) {
  const body: Record<string, unknown> = { title: draft.title, description: draft.description, clear: [] as string[] };
  const clear = body.clear as string[];
  if (draft.category_ref) body.category_ref = draft.category_ref;
  const setOrClear = (key: string, value: number | null) => {
    if (value === null || Number.isNaN(value)) clear.push(key);
    else body[key] = value;
  };
  if (listing.kind === "store_product") {
    if (draft.option_name.trim()) {
      body.option_name = draft.option_name.trim();
      body.option_values = draft.option_values.split(",").map((v) => v.trim()).filter(Boolean);
    } else {
      clear.push("option_name");
      body.option_values = [];
    }
    const price = num(draft.price);
    if (price !== null && !Number.isNaN(price)) body.price = price;
    setOrClear("compare_at_price", num(draft.compare_at_price));
    setOrClear("cost", num(draft.cost));
  } else {
    setOrClear("price_guide_min", num(draft.price_guide_min));
    setOrClear("price_guide_max", num(draft.price_guide_max));
    setOrClear("min_order", num(draft.min_order));
    setOrClear("lead_time_min_days", num(draft.lead_time_min_days));
    setOrClear("lead_time_max_days", num(draft.lead_time_max_days));
    body.availability_status = draft.availability_status;
  }
  if (draft.planned_live_at) body.planned_live_at = new Date(draft.planned_live_at).toISOString();
  else clear.push("planned_live_at");
  return body;
}

export function ListingEditor({
  token,
  listingId,
  categories,
  onChanged,
  onClaim,
}: {
  token: string;
  listingId: string;
  categories: Category[];
  onChanged?: (listing: StoreListing) => void;
  /** Shown when the worker must claim the work item before editing. */
  onClaim?: () => void;
}) {
  const [listing, setListing] = useState<StoreListing | null>(null);
  const [workItem, setWorkItem] = useState<WorkItem | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [shopLink, setShopLink] = useState("");
  const [linkReport, setLinkReport] = useState<{ read: boolean; filled: string[]; notes: string[] } | null>(null);
  const [backNote, setBackNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (next: StoreListing, announce = true) => {
      setListing(next);
      setDraft(toDraft(next));
      setDirty(false);
      if (announce) onChanged?.(next);
    },
    [onChanged],
  );
  const load = useCallback(async () => {
    const data = await apiRequest<{ listing: StoreListing; work_item: WorkItem | null; can_edit: boolean; can_publish: boolean }>(
      `/operations/store/listings/${listingId}`,
      token,
    );
    accept(data.listing, false);
    setWorkItem(data.work_item);
    setCanEdit(data.can_edit);
    setCanPublish(data.can_publish);
  }, [listingId, token, accept]);
  useEffect(() => {
    setError("");
    setNotice("");
    load().catch((reason) => setError(reason instanceof Error ? reason.message : "The listing could not be loaded."));
  }, [load]);

  async function act(work: () => Promise<void>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (done) setNotice(done);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };
  async function save() {
    if (!listing || !draft) return;
    const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify(draftChanges(listing, draft)),
    });
    accept(data.listing);
  }
  async function upload(files: FileList | null) {
    if (!listing || !files?.length) return;
    await act(async () => {
      let latest = listing;
      for (const file of Array.from(files).slice(0, 10 - listing.media.length)) {
        if (file.size > (file.type.startsWith("video/") ? 100 : 15) * 1024 * 1024)
          throw new Error(`${file.name} is too big. Photos up to 15 MB, videos up to 100 MB.`);
        const data = await apiRequest<{ listing: StoreListing }>(
          `/operations/store/listings/${latest.id}/media?filename=${encodeURIComponent(file.name)}`,
          token,
          { method: "POST", body: file, headers: { "Content-Type": file.type } },
        );
        latest = data.listing;
      }
      accept(latest);
      if (fileRef.current) fileRef.current.value = "";
    }, "Uploaded.");
  }
  async function fillFromLink() {
    if (!listing || !shopLink.trim()) return;
    if (dirty && draft) await save();
    await act(async () => {
      const data = await apiRequest<{ listing: StoreListing; read: boolean; filled: string[]; notes: string[] }>(
        `/operations/store/listings/${listing.id}/from-link`,
        token,
        { method: "POST", body: JSON.stringify({ url: shopLink.trim() }) },
      );
      accept(data.listing);
      setLinkReport({ read: data.read, filled: data.filled, notes: data.notes });
      setShopLink("");
    });
  }
  async function moveMedia(index: number, delta: number) {
    if (!listing) return;
    const order = listing.media.map((_, i) => i);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await act(async () => {
      const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ media_order: order }),
      });
      accept(data.listing);
    });
  }

  if (!listing || !draft) {
    return error ? <p className="form-error" role="alert">{error}</p> : <p className="operations-muted">Loading the listing…</p>;
  }
  const store = listing.kind === "store_product";
  const editable = canEdit;
  const finished = ["published", "cancelled"].includes(listing.status);
  const margin =
    store && draft.price && draft.cost && Number(draft.price) > 0 ? Math.round((1 - Number(draft.cost) / Number(draft.price)) * 100) : null;
  return (
    <div className="st-editor" aria-label={`Listing: ${listing.title || "untitled"}`}>
      <header className="st-editor-head">
        <div>
          <small>
            {listing.action === "update" ? "Edit to a" : "New"} {store ? "store product" : "sourcing item"}
          </small>
          <h3>{listing.title || "Untitled listing"}</h3>
        </div>
        <span className={`st-pill is-${listing.status}`}>{LISTING_STATUS_LABEL[listing.status]}</span>
      </header>
      {listing.status === "changes_requested" && listing.review_note && (
        <p className="st-callout is-warning" role="status">
          <strong>Changes asked:</strong> {listing.review_note}
        </p>
      )}
      {listing.status === "in_review" && !canPublish && (
        <p className="st-callout" role="status">
          With an administrator for review. You'll get a notice when it's published or sent back.
        </p>
      )}
      {!editable && !finished && listing.status !== "in_review" && onClaim && (
        <p className="st-callout" role="status">
          Claim this work to edit the listing.{" "}
          <button type="button" className="primary-button" onClick={onClaim}>
            Claim it
          </button>
        </p>
      )}
      {(error || notice) && (
        <p className={error ? "form-error" : "operations-notice"} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}
      <div className="st-editor-grid">
        <div className="st-editor-form">
          {!store && (
            <section className="st-block st-from-link" aria-label="Add from a product link">
              <h4>
                Add from a product link <small>optional · fills what's empty</small>
              </h4>
              {editable && (
                <div className="st-from-link-row">
                  <input
                    type="url"
                    inputMode="url"
                    aria-label="Product link"
                    placeholder="https://… a product page from any shop"
                    value={shopLink}
                    maxLength={2000}
                    onChange={(event) => setShopLink(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void fillFromLink();
                      }
                    }}
                  />
                  <button type="button" className="secondary-button" disabled={busy || !shopLink.trim()} onClick={() => void fillFromLink()}>
                    {busy ? "Reading…" : "Fill from link"}
                  </button>
                </div>
              )}
              {linkReport && (
                <div className={linkReport.read ? "st-callout" : "st-callout is-warning"} role="status">
                  {linkReport.filled.length ? <p>Filled in: {linkReport.filled.join(", ")}. Check them before review.</p> : null}
                  {linkReport.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              )}
              {listing.source_url ? (
                <p className="st-from-link-source">
                  Source:{" "}
                  <a href={listing.source_url} target="_blank" rel="noreferrer noopener">
                    {(() => {
                      try {
                        return new URL(listing.source_url).hostname.replace(/^www\./, "");
                      } catch {
                        return listing.source_url;
                      }
                    })()}
                  </a>{" "}
                  <small>· staff only, members don't see this link</small>
                </p>
              ) : (
                !editable && <p className="operations-muted">Added by hand.</p>
              )}
            </section>
          )}
          <section id="ops-listing-details" className="st-block" aria-label="Details">
            <h4>Details</h4>
            <Field label="Title">
              <input value={draft.title} maxLength={160} disabled={!editable} onChange={(event) => update({ title: event.target.value })} />
            </Field>
            <Field label="Description" hint={store ? "Shown on the product page and in Shopify." : "The AI uses this to answer members."}>
              <textarea
                rows={4}
                value={draft.description}
                maxLength={5000}
                disabled={!editable}
                onChange={(event) => update({ description: event.target.value })}
              />
            </Field>
            <CategoryPicker categories={categories} value={draft.category_ref} disabled={!editable} onChange={(ref) => update({ category_ref: ref })} />
            {store && (
              <div className="st-row">
                <Field label="Option (optional)" hint="One option, like Size or Colour">
                  <input value={draft.option_name} maxLength={60} disabled={!editable} placeholder="Size" onChange={(event) => update({ option_name: event.target.value })} />
                </Field>
                <Field label="Option values" hint="Separate with commas">
                  <input
                    value={draft.option_values}
                    disabled={!editable || !draft.option_name.trim() || listing.action === "update"}
                    placeholder="S, M, L"
                    onChange={(event) => update({ option_values: event.target.value })}
                  />
                </Field>
              </div>
            )}
          </section>

          <section id="ops-listing-media" className="st-block" aria-label="Photos and video">
            <h4>
              Photos and video <small>{listing.media.length} of 10 · the first is the card</small>
            </h4>
            {listing.media.length > 0 ? (
              <ol className="st-media">
                {listing.media.map((item: ListingMedia, index) => (
                  <li key={`${item.url}-${index}`}>
                    <Thumb url={item.url} type={item.media_type} alt={item.alt || listing.title} />
                    {index === 0 && <b className="st-media-first">Card</b>}
                    {editable && (
                      <div className="st-media-actions">
                        <button type="button" aria-label="Move earlier" disabled={busy || index === 0} onClick={() => void moveMedia(index, -1)}>
                          ←
                        </button>
                        <button
                          type="button"
                          aria-label="Move later"
                          disabled={busy || index === listing.media.length - 1}
                          onClick={() => void moveMedia(index, 1)}
                        >
                          →
                        </button>
                        <button
                          type="button"
                          aria-label="Remove"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const data = await apiRequest<{ listing: StoreListing }>(
                                `/operations/store/listings/${listing.id}/media/${index}`,
                                token,
                                { method: "DELETE" },
                              );
                              accept(data.listing);
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="operations-muted">No photos yet.</p>
            )}
            {editable && listing.media.length < 10 && (
              <div className="st-media-add">
                <label className="secondary-button st-upload">
                  Upload photos or video
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    multiple
                    onChange={(event) => void upload(event.target.files)}
                  />
                </label>
                <form
                  className="st-link-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!linkUrl.trim()) return;
                    void act(async () => {
                      const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}/media-url`, token, {
                        method: "POST",
                        body: JSON.stringify({ url: linkUrl.trim(), media_type: /\.(mp4|webm)(\?|$)/i.test(linkUrl) ? "video" : "image" }),
                      });
                      accept(data.listing);
                      setLinkUrl("");
                    });
                  }}
                >
                  <input
                    type="url"
                    aria-label="Photo link"
                    placeholder={store ? "or paste a photo link (https://…)" : "or paste a photo or Instagram link"}
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                  />
                  <button type="submit" className="secondary-button" disabled={busy || !linkUrl.trim()}>
                    Add
                  </button>
                </form>
              </div>
            )}
          </section>

          <section id="ops-listing-price" className="st-block" aria-label={store ? "Price" : "Price guide"}>
            <h4>
              {store ? "Price" : "Rough price"}
              {!store && <small> optional · leave empty and members see "Contact our team for a price"</small>}
            </h4>
            {store ? (
              <div className="st-row">
                <Field label="Price">
                  <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.price} disabled={!editable} onChange={(event) => update({ price: event.target.value })} />
                </Field>
                <Field label="Crossed-out price" hint="Only if it really sold for more">
                  <input type="number" min="0.01" step="0.01" value={draft.compare_at_price} disabled={!editable} onChange={(event) => update({ compare_at_price: event.target.value })} />
                </Field>
                <Field label="Cost (staff only)" hint={margin !== null ? `Margin ${margin}%` : "What it costs FayFort"}>
                  <input type="number" min="0" step="0.01" value={draft.cost} disabled={!editable} onChange={(event) => update({ cost: event.target.value })} />
                </Field>
              </div>
            ) : (
              <>
                <div className="st-row">
                  <Field label="From (rough estimate)">
                    <input type="number" min="0.01" step="0.01" value={draft.price_guide_min} disabled={!editable} onChange={(event) => update({ price_guide_min: event.target.value })} />
                  </Field>
                  <Field label="To (optional)">
                    <input type="number" min="0.01" step="0.01" value={draft.price_guide_max} disabled={!editable} onChange={(event) => update({ price_guide_max: event.target.value })} />
                  </Field>
                  <Field label="Minimum order">
                    <input type="number" min="1" step="1" value={draft.min_order} disabled={!editable} onChange={(event) => update({ min_order: event.target.value })} />
                  </Field>
                </div>
                <div className="st-row">
                  <Field label="Lead time from (days)">
                    <input type="number" min="0" max="365" value={draft.lead_time_min_days} disabled={!editable} onChange={(event) => update({ lead_time_min_days: event.target.value })} />
                  </Field>
                  <Field label="to (days)">
                    <input type="number" min="0" max="365" value={draft.lead_time_max_days} disabled={!editable} onChange={(event) => update({ lead_time_max_days: event.target.value })} />
                  </Field>
                  <Field label="Availability">
                    <select
                      value={draft.availability_status}
                      disabled={!editable}
                      onChange={(event) => update({ availability_status: event.target.value as Draft["availability_status"] })}
                    >
                      {Object.entries(AVAILABILITY_LABEL).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
            <Field label="Planned launch (optional)" hint="Shows on the Schedule">
              <input type="datetime-local" value={draft.planned_live_at} disabled={!editable} onChange={(event) => update({ planned_live_at: event.target.value })} />
            </Field>
          </section>
        </div>
        <aside className="st-editor-side">
          <ListingPreview listing={{ ...listing, ...previewFromDraft(listing, draft) }} categories={categories} />
          {listing.missing && listing.missing.length > 0 && editable && (
            <p className="st-missing">
              <strong>Before review, add:</strong> {listing.missing.join(", ")}.
            </p>
          )}
          {listing.shopify_admin_url && canPublish && (
            <a className="secondary-button" href={listing.shopify_admin_url} target="_blank" rel="noreferrer">
              Open in Shopify ↗
            </a>
          )}
        </aside>
      </div>
      <footer id="ops-listing-actions" className="st-editor-actions">
        {editable && (
          <>
            <button type="button" className="secondary-button" disabled={busy || !dirty} onClick={() => void act(save, "Saved.")}>
              Save changes
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (dirty) await save();
                  const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}/submit`, token, { method: "POST" });
                  accept(data.listing);
                  setCanEdit(false);
                }, store && listing.action === "create" ? "Sent for review. The Shopify draft is ready for an administrator." : "Sent for review.")
              }
            >
              Send for review
            </button>
          </>
        )}
        {canPublish && listing.status === "in_review" && (
          <>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}/publish`, token, { method: "POST" });
                  accept(data.listing);
                  if (store && listing.action === "create" && !data.listing.channels_published)
                    setNotice("Published. Enter its stock in Shopify and tick its sales channels (Headless, TikTok, Instagram) so it shows in the shop.");
                  else setNotice(store ? "Published. Enter its stock in Shopify if you haven't." : "Published. Members can see it now.");
                })
              }
            >
              Publish
            </button>
            <form
              className="st-back-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (backNote.trim().length < 3) return;
                void act(async () => {
                  const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}/send-back`, token, {
                    method: "POST",
                    body: JSON.stringify({ note: backNote.trim() }),
                  });
                  accept(data.listing);
                  setBackNote("");
                }, "Sent back to the worker with your note.");
              }}
            >
              <input aria-label="What should change" placeholder="What should change?" value={backNote} maxLength={1000} onChange={(event) => setBackNote(event.target.value)} />
              <button type="submit" className="secondary-button" disabled={busy || backNote.trim().length < 3}>
                Send back
              </button>
            </form>
          </>
        )}
        {!finished && (editable || canPublish) && (
          <details className="st-cancel">
            <summary>Cancel this listing</summary>
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void act(async () => {
                  const data = await apiRequest<{ listing: StoreListing }>(`/operations/store/listings/${listing.id}/cancel`, token, {
                    method: "POST",
                    body: JSON.stringify({ reason: cancelReason.trim() }),
                  });
                  accept(data.listing);
                }, "Cancelled.");
              }}
            >
              <input aria-label="Why cancel" placeholder="Why? (optional)" value={cancelReason} maxLength={500} onChange={(event) => setCancelReason(event.target.value)} />
              <button type="submit" className="secondary-button" disabled={busy}>
                Cancel listing
              </button>
            </form>
          </details>
        )}
        {workItem && <small className="operations-muted">Work item · {workItem.summary}</small>}
      </footer>
    </div>
  );
}

function previewFromDraft(listing: StoreListing, draft: Draft): Partial<StoreListing> {
  return {
    title: draft.title,
    category_ref: draft.category_ref,
    price: num(draft.price),
    compare_at_price: num(draft.compare_at_price),
    price_guide_min: num(draft.price_guide_min),
    min_order: num(draft.min_order),
    currency: listing.currency,
  };
}

// ---------------------------------------------------------------------------------------------
// Products workspace
// ---------------------------------------------------------------------------------------------
type Tab = "store" | "sourcing" | "listings" | "sections";

export function ProductsWorkspace({
  token,
  canManage,
  initialTab = "store",
  initialListing,
  onOpenWorkItem,
}: {
  token: string;
  canManage: boolean;
  initialTab?: Tab;
  initialListing?: string | null;
  onOpenWorkItem?: (id: string) => void;
}) {
  const categories = useCategories(token);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [openListing, setOpenListing] = useState<string | null>(initialListing || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shopifyConnected, setShopifyConnected] = useState(true);

  const load = useCallback(async () => {
    if (tab === "sections") return;
    setLoading(true);
    setError("");
    try {
      if (tab === "listings") {
        const data = await apiRequest<{ listings: StoreListing[] }>("/operations/store/products?tab=listings", token);
        setListings(data.listings || []);
      } else {
        const params = new URLSearchParams({ tab });
        if (query.trim()) params.set("q", query.trim());
        const data = await apiRequest<{ products: CatalogProduct[]; shopify_connected?: boolean }>(`/operations/store/products?${params}`, token);
        setProducts(data.products || []);
        setShopifyConnected(data.shopify_connected !== false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [tab, query, token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function start(kind: StoreListing["kind"], productId?: string) {
    setError("");
    try {
      const data = await apiRequest<{ listing: StoreListing }>("/operations/store/listings", token, {
        method: "POST",
        body: JSON.stringify(productId ? { kind, product_id: productId } : { kind }),
      });
      setOpenListing(data.listing.id);
      if (tab !== "listings") setTab("listings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The listing could not be started.");
    }
  }

  const tabs: [Tab, string][] = [
    ["store", "Store"],
    ["sourcing", "Sourcing"],
    ["listings", "In progress"],
    ["sections", "Sections"],
  ];
  return (
    <section className="st-workspace" aria-label="Products workspace">
      <header className="st-workspace-head">
        <div>
          <h2>Products</h2>
          <p>Everything in the shop. Prepare listings here; an administrator publishes them.</p>
        </div>
        <div className="st-new">
          <button type="button" className="primary-button" disabled={!shopifyConnected} onClick={() => void start("store_product")}>
            New store product
          </button>
          <button type="button" className="secondary-button" onClick={() => void start("sourcing_item")}>
            New sourcing item
          </button>
        </div>
      </header>
      <div className="st-tabs" role="tablist" aria-label="Product lists">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-active" : ""}
            onClick={() => {
              setTab(key);
              if (key !== "listings") setOpenListing(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === "sections" ? (
        <SectionsPanel token={token} categories={categories} />
      ) : (
        <div className={openListing ? "st-split has-editor" : "st-split"}>
          <div className="st-list-pane">
            {tab !== "listings" && (
              <form
                className="st-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void load();
                }}
              >
                <input type="search" aria-label="Search products" placeholder="Search by name" value={query} onChange={(event) => setQuery(event.target.value)} />
                <button type="submit" className="secondary-button">
                  Search
                </button>
              </form>
            )}
            {loading && <p className="operations-muted">Loading…</p>}
            {tab === "listings" ? (
              listings.length ? (
                <ul className="st-list" aria-label="Listings in progress">
                  {listings.map((item) => (
                    <li key={item.id}>
                      <button type="button" className={openListing === item.id ? "st-row-button is-open" : "st-row-button"} onClick={() => setOpenListing(item.id)}>
                        <Thumb url={item.media[0]?.url} type={item.media[0]?.media_type} />
                        <span className="st-row-text">
                          <strong>{item.title || "Untitled"}</strong>
                          <small>
                            {item.kind === "store_product" ? "Store product" : "Sourcing item"}
                            {item.action === "update" ? " · edit" : ""}
                          </small>
                        </span>
                        <span className={`st-pill is-${item.status}`}>{LISTING_STATUS_LABEL[item.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && <p className="operations-empty-copy">No listings yet. Start one with New store product or New sourcing item.</p>
              )
            ) : products.length ? (
              <ul className="st-list" aria-label={tab === "store" ? "Store products" : "Sourcing items"}>
                {products.map((product) => (
                  <li key={product.id} className="st-product-row">
                    <Thumb url={product.media_url} type={product.media_type} alt={product.name} />
                    <span className="st-row-text">
                      <strong>{product.name}</strong>
                      <small>
                        {categoryLabel(categories, product.category_ref)} ·{" "}
                        {product.source === "shopify"
                          ? money(product.price_min, product.currency)
                          : `${product.price_min ? `from ${money(product.price_min, product.currency)}` : "no price guide"}${product.min_order ? ` · min ${product.min_order}` : ""}${leadTime(product.lead_time_min_days, product.lead_time_max_days) ? ` · ${leadTime(product.lead_time_min_days, product.lead_time_max_days)}` : ""}`}
                      </small>
                    </span>
                    {product.state && <span className={`st-pill is-${product.state}`}>{STATE_LABEL[product.state]}</span>}
                    <span className="st-row-actions">
                      {product.open_listing_id ? (
                        <button type="button" className="ops-link-button" onClick={() => { setTab("listings"); setOpenListing(product.open_listing_id || null); }}>
                          Open edit
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ops-link-button"
                          disabled={product.source === "shopify" && !shopifyConnected}
                          onClick={() => void start(product.source === "shopify" ? "store_product" : "sourcing_item", product.id)}
                        >
                          Edit
                        </button>
                      )}
                      {canManage && product.shopify_admin_url && (
                        <a className="ops-link-button" href={product.shopify_admin_url} target="_blank" rel="noreferrer">
                          Shopify ↗
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              !loading && <p className="operations-empty-copy">Nothing here yet.</p>
            )}
          </div>
          {openListing && (
            <div className="st-editor-pane">
              <button type="button" className="operations-back-to-queue" onClick={() => setOpenListing(null)}>
                ← Back to the list
              </button>
              <ListingEditor token={token} listingId={openListing} categories={categories} onChanged={() => void load()} />
              {onOpenWorkItem && (
                <p className="operations-muted">The listing's steps, deadline and history are on its work item in the Queue.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Store sections
// ---------------------------------------------------------------------------------------------
type Candidate = { id: string; name: string; media_url?: string | null; media_type?: "image" | "video" | null; price?: number | null; currency?: string; source?: string };

export function SectionEditor({
  token,
  section,
  categories,
  defaultStart,
  onSaved,
  onCancel,
}: {
  token: string;
  section?: StoreSection | null;
  categories: Category[];
  defaultStart?: string;
  onSaved: (section: StoreSection) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(section?.title || "");
  const [hook, setHook] = useState(section?.hook || "");
  const [style, setStyle] = useState<StoreSection["style"]>(section?.style || "deal");
  const [accent, setAccent] = useState<StoreSection["accent"]>(section?.accent || "pink");
  const [categoryRef, setCategoryRef] = useState<string | null>(section?.category_ref || null);
  const [startsAt, setStartsAt] = useState(section?.starts_at?.slice(0, 16) || defaultStart || "");
  const [endsAt, setEndsAt] = useState(section?.ends_at?.slice(0, 16) || "");
  const [priority, setPriority] = useState(String(section?.priority ?? 100));
  const [minItems, setMinItems] = useState(String(section?.min_items ?? 3));
  const [picked, setPicked] = useState<Candidate[]>(
    (section?.items || []).map((item) => ({ id: item.id, name: item.name, media_url: item.media_url, media_type: item.media_type, price: item.price, currency: item.currency || undefined })),
  );
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      apiRequest<{ products: Candidate[] }>(`/operations/store/section-candidates?q=${encodeURIComponent(query.trim())}`, token)
        .then((data) => alive && setCandidates(data.products || []))
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, token]);
  const pickedIds = new Set(picked.map((item) => item.id));
  function suggest() {
    const prices = picked.map((item) => item.price).filter((value): value is number => typeof value === "number");
    if (prices.length) setHook(`From ${money(Math.min(...prices), picked[0]?.currency)}`.replace(".00", ""));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        hook: hook.trim(),
        style,
        accent,
        category_ref: categoryRef,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        priority: Number(priority) || 100,
        min_items: Number(minItems) || 3,
        status: "published",
        product_ids: picked.map((item) => item.id),
      };
      const data = await apiRequest<{ section: StoreSection }>(section ? `/operations/store/sections/${section.id}` : "/operations/store/sections", token, {
        method: section ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      onSaved(data.section);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The section could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="st-section-editor" onSubmit={save} aria-label={section ? `Edit section ${section.title}` : "New section"}>
      <div className="st-row">
        <Field label="Title">
          <input required maxLength={60} value={title} placeholder="Dollar deals" onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Hook" hint="True for every product in it">
          <span className="st-inline">
            <input maxLength={40} value={hook} placeholder="3 from $0.99" onChange={(event) => setHook(event.target.value)} />
            <button type="button" className="ops-link-button" onClick={suggest} disabled={!picked.length}>
              Suggest
            </button>
          </span>
        </Field>
      </div>
      <div className="st-row">
        <Field label="Style">
          <select value={style} onChange={(event) => setStyle(event.target.value as StoreSection["style"])}>
            <option value="deal">Deal: prices and discounts</option>
            <option value="trend">Trend: new or viral</option>
            <option value="category">Category: one category</option>
          </select>
        </Field>
        <Field label="Colour">
          <select value={accent} onChange={(event) => setAccent(event.target.value as StoreSection["accent"])}>
            {["pink", "navy", "gold", "green", "purple"].map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority" hint="Lower shows first">
          <input type="number" min="0" max="1000" value={priority} onChange={(event) => setPriority(event.target.value)} />
        </Field>
        <Field label="Minimum live products">
          <input type="number" min="1" max="12" value={minItems} onChange={(event) => setMinItems(event.target.value)} />
        </Field>
      </div>
      {style === "category" && <CategoryPicker categories={categories} value={categoryRef} onChange={setCategoryRef} />}
      <div className="st-row">
        <Field label="Goes live" hint="Empty: now">
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </Field>
        <Field label="Ends (optional)">
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </Field>
      </div>
      <div className="st-picker">
        <div>
          <span className="st-label">
            In this section ({picked.length} of 12)
          </span>
          {picked.length ? (
            <ol className="st-picked">
              {picked.map((item, index) => (
                <li key={item.id}>
                  <Thumb url={item.media_url} type={item.media_type} alt={item.name} />
                  <span>{item.name}</span>
                  <span className="st-media-actions">
                    <button type="button" aria-label={`Move ${item.name} earlier`} disabled={index === 0} onClick={() => setPicked((list) => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Remove ${item.name}`} onClick={() => setPicked((list) => list.filter((entry) => entry.id !== item.id))}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="operations-muted">Pick 3 to 12 live products.</p>
          )}
        </div>
        <div>
          <input type="search" aria-label="Find products for the section" placeholder="Find live products" value={query} onChange={(event) => setQuery(event.target.value)} />
          <ul className="st-candidates">
            {candidates
              .filter((item) => !pickedIds.has(item.id))
              .slice(0, 20)
              .map((item) => (
                <li key={item.id}>
                  <button type="button" disabled={picked.length >= 12} onClick={() => setPicked((list) => [...list, item])}>
                    <Thumb url={item.media_url} type={item.media_type} alt={item.name} />
                    <span>
                      {item.name}
                      <small>{item.source === "shopify" ? money(item.price, item.currency) : item.price ? `from ${money(item.price, item.currency)}` : "sourcing"}</small>
                    </span>
                    <b aria-hidden="true">+</b>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="st-editor-actions">
        <button type="submit" className="primary-button" disabled={busy || !title.trim()}>
          {section ? "Save section" : "Create section"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SectionTile({ section, onEdit }: { section: StoreSection; onEdit?: () => void }) {
  return (
    <article className={`st-section-tile accent-${section.accent} is-${section.state}`} aria-label={section.title}>
      <header>
        <strong>{section.title}</strong>
        {section.hook && <span className="st-hook">{section.hook}</span>}
      </header>
      <div className="st-section-items">
        {section.items.slice(0, 3).map((item) => (
          <span key={item.id} className={item.live ? "" : "is-out"} title={item.live ? item.name : `${item.name} (not live)`}>
            <Thumb url={item.media_url} type={item.media_type} alt={item.name} />
          </span>
        ))}
      </div>
      <footer>
        <span className={`st-pill is-section-${section.state}`}>{SECTION_STATE_LABEL[section.state]}</span>
        <small>
          {section.live_count} of {section.items.length} live
          {section.ends_at ? ` · ends ${new Date(section.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
        </small>
        {onEdit && (
          <button type="button" className="ops-link-button" onClick={onEdit}>
            Edit
          </button>
        )}
      </footer>
    </article>
  );
}

export function SectionsPanel({ token, categories }: { token: string; categories: Category[] }) {
  const [sections, setSections] = useState<StoreSection[]>([]);
  const [editing, setEditing] = useState<StoreSection | "new" | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{ sections: StoreSection[] }>("/operations/store/sections", token);
      setSections(data.sections || []);
      const wanted = new URLSearchParams(window.location.search).get("section");
      if (wanted) {
        const found = (data.sections || []).find((item) => item.id === wanted);
        if (found) setEditing(found);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sections could not be loaded.");
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  if (editing) {
    return (
      <SectionEditor
        token={token}
        categories={categories}
        section={editing === "new" ? null : editing}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }
  return (
    <div className="st-sections">
      <div className="st-sections-head">
        <p>Themed tiles on members' Browse. Each needs its minimum of live products to show.</p>
        <button type="button" className="primary-button" onClick={() => setEditing("new")}>
          New section
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {sections.length ? (
        <div className="st-section-grid">
          {sections.map((section) => (
            <SectionTile key={section.id} section={section} onEdit={() => setEditing(section)} />
          ))}
        </div>
      ) : (
        <p className="operations-empty-copy">No sections yet. The built-in Flash sale and New this week tiles fill themselves.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Panels inside Store team work items
// ---------------------------------------------------------------------------------------------
export function StoreFlowPanel({
  token,
  item,
  flow,
  canAct,
  canManage,
  onClaim,
  onChanged,
}: {
  token: string;
  item: WorkItem;
  flow: NonNullable<import("./types").FlowContext>;
  canAct: boolean;
  canManage: boolean;
  onClaim: () => void;
  onChanged: () => void;
}) {
  const categories = useCategories(token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(flow.prep?.announcement || "");
  const [editingSection, setEditingSection] = useState(false);
  const live = !["completed", "cancelled"].includes(item.status);
  useEffect(() => setAnnouncement(flow.prep?.announcement || ""), [flow.prep?.announcement, item.id]);
  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(path, token, { method: "POST", body: JSON.stringify(body) });
      setNotice(done);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }
  const messages = (error || notice) && (
    <p className={error ? "form-error" : "operations-notice"} role={error ? "alert" : "status"}>
      {error || notice}
    </p>
  );
  const product = flow.product;
  const productFacts = product && (
    <div className="st-flow-product">
      <Thumb url={product.media_url} type={product.media_type} alt={product.name} />
      <dl className="ops-facts">
        <div><dt>Product</dt><dd>{product.name}</dd></div>
        <div><dt>Kind</dt><dd>{product.source === "shopify" ? "Store product" : "Sourcing item"}</dd></div>
        <div><dt>Category</dt><dd>{categoryLabel(categories, product.category_ref)}</dd></div>
        <div>
          <dt>Price</dt>
          <dd>{product.source === "shopify" ? money(product.price_min, product.currency) : product.price_min ? `from ${money(product.price_min, product.currency)}` : "—"}</dd>
        </div>
        {product.sold_out_since && <div><dt>Sold out since</dt><dd>{new Date(product.sold_out_since).toLocaleDateString()}</dd></div>}
      </dl>
      {canManage && product.shopify_admin_url && (
        <a className="ops-link-button" href={product.shopify_admin_url} target="_blank" rel="noreferrer">
          Open in Shopify ↗
        </a>
      )}
    </div>
  );
  switch (flow.kind) {
    case "store_listing":
      return flow.listing ? (
        <ListingEditor token={token} listingId={flow.listing.id} categories={categories} onChanged={onChanged} onClaim={!canManage && live && !canAct ? onClaim : undefined} />
      ) : (
        <p className="operations-muted">The listing is no longer available.</p>
      );
    case "unmapped_product":
      return (
        <div className="ops-flow">
          {productFacts}
          {live && canAct ? (
            <form
              className="st-flow-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (category) void act(`/operations/work-items/${item.id}/map-category`, { category_ref: category }, "Category saved.");
              }}
            >
              <CategoryPicker categories={categories} value={category || product?.category_ref || null} onChange={setCategory} label="FayFort category" />
              <button type="submit" className="primary-button" disabled={busy || !category}>
                Save category
              </button>
            </form>
          ) : (
            live && <p className="operations-muted">Claim this work to choose the category.</p>
          )}
          {messages}
        </div>
      );
    case "retire_product": {
      const meta = item.metadata || {};
      const waitingForAdmin = Boolean(meta.retire_requested_by) && item.status === "waiting";
      return (
        <div className="ops-flow">
          {productFacts}
          <p className="st-callout">{String(meta.reason || "")}</p>
          {waitingForAdmin && (
            <p className="st-callout is-warning">Asked to retire: {String(meta.retire_reason || "")}</p>
          )}
          {live && (canAct || (waitingForAdmin && canManage)) ? (
            <div className="st-flow-form">
              <label className="st-field">
                <span className="st-label">Reason</span>
                <input value={reason} maxLength={500} placeholder={waitingForAdmin ? "Why you agree or keep it" : "Why keep it, or why retire it"} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="st-editor-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    void act(
                      `/operations/work-items/${item.id}/retire`,
                      { decision: "retire", reason: reason.trim() },
                      meta.store_product && !canManage ? "Sent to an administrator to archive in Shopify." : "Retired.",
                    )
                  }
                >
                  {meta.store_product ? (canManage ? "Archive in Shopify" : "Ask to retire") : "Retire"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void act(`/operations/work-items/${item.id}/retire`, { decision: "keep", reason: reason.trim() }, "Kept.")}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            live && !waitingForAdmin && <p className="operations-muted">Claim this work to decide.</p>
          )}
          {messages}
        </div>
      );
    }
    case "merch_section":
      return flow.section ? (
        editingSection ? (
          <SectionEditor
            token={token}
            categories={categories}
            section={flow.section}
            onSaved={() => {
              setEditingSection(false);
              setNotice("Section saved. This work is finished.");
              onChanged();
            }}
            onCancel={() => setEditingSection(false)}
          />
        ) : (
          <div className="ops-flow">
            <SectionTile section={flow.section} />
            <ul className="st-section-check">
              {flow.section.items.map((entry) => (
                <li key={entry.id} className={entry.live ? "" : "is-out"}>
                  {entry.name} {entry.live ? "" : "· not live"}
                </li>
              ))}
            </ul>
            {live && canAct ? (
              <button type="button" className="primary-button" onClick={() => setEditingSection(true)}>
                Edit the section
              </button>
            ) : (
              live && <p className="operations-muted">Claim this work to edit the section.</p>
            )}
            {messages}
          </div>
        )
      ) : (
        <p className="operations-muted">The section is no longer available.</p>
      );
    case "campaign_giveaway":
    case "campaign_sale": {
      const campaign = flow.campaign;
      const giveaway = flow.kind === "campaign_giveaway";
      const prep = flow.prep || ({} as NonNullable<typeof flow.prep>);
      const save = (body: Record<string, unknown>, done: string) => void act(`/operations/work-items/${item.id}/campaign`, body, done);
      return (
        <div className="ops-flow">
          <dl className="ops-facts">
            <div><dt>{giveaway ? "Giveaway" : "Flash sale"}</dt><dd>{campaign?.title || String(item.metadata?.title || "")}</dd></div>
            <div><dt>Starts</dt><dd>{campaign?.starts_at ? new Date(campaign.starts_at).toLocaleString() : "—"}</dd></div>
            <div><dt>Ends</dt><dd>{campaign?.ends_at ? new Date(campaign.ends_at).toLocaleString() : "—"}</dd></div>
            {giveaway ? (
              <>
                <div><dt>Prize</dt><dd>{campaign?.prize_text || "—"}</dd></div>
                <div><dt>Winners</dt><dd>{campaign?.winner_count ?? 1}</dd></div>
              </>
            ) : (
              <div><dt>Discount</dt><dd>{campaign?.discount_type === "percentage" ? `${campaign?.value}% off` : money(campaign?.value)}{campaign?.code ? ` · code ${campaign.code}` : ""}</dd></div>
            )}
          </dl>
          {(flow.products || []).length > 0 && (
            <ul className="st-campaign-products">
              {(flow.products || []).map((entry) => (
                <li key={entry.id}>
                  <Thumb url={entry.media_url} type={entry.media_type} alt={entry.name} />
                  <span>
                    {entry.name}
                    <small>
                      {entry.in_stock === false ? "Sold out" : typeof entry.total_inventory === "number" ? `${entry.total_inventory} in stock` : "In stock"}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {live && canAct ? (
            <div className="st-checklist">
              <label>
                <input type="checkbox" checked={Boolean(prep.prize_ready_at)} disabled={busy} onChange={(event) => save({ prize_ready: event.target.checked }, "Saved.")} />
                {giveaway ? "The prize is ready for every winner" : "Every sale product is in stock with good photos"}
              </label>
              <label>
                <input type="checkbox" checked={Boolean(prep.section_ready_at)} disabled={busy} onChange={(event) => save({ section_ready: event.target.checked }, "Saved.")} />
                {giveaway ? "It reads well on Browse" : "The Flash sale section looks right"}
              </label>
              <label className="st-field">
                <span className="st-label">Announcement</span>
                <textarea rows={3} maxLength={2000} value={announcement} placeholder="The post or message announcing it" onChange={(event) => setAnnouncement(event.target.value)} />
              </label>
              <button type="button" className="secondary-button" disabled={busy || announcement === (prep.announcement || "")} onClick={() => save({ announcement }, "Announcement saved.")}>
                Save announcement
              </button>
            </div>
          ) : (
            live && <p className="operations-muted">Claim this work to prepare the campaign.</p>
          )}
          {messages}
        </div>
      );
    }
    default:
      return null;
  }
}

