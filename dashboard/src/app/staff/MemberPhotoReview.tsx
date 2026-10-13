import { dashboardAuthConfigured, supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { useCallback, useEffect, useState } from "react";
import { SetupScreen } from "../SetupScreen";
import type { MemberCatalogProduct, MemberChatMessage } from "../member/memberShared";

export function MemberPhotoReviewApp({ platformAdmin }: { platformAdmin: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabaseClient) {
      setLoading(false);
      return;
    }
    supabaseClient.auth.getSession().then(({ data, error }) => {
      setToken(data.session?.access_token || null);
      if (error) setError(error.message);
      setLoading(false);
    });
  }, []);
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <main className="auth-page member-chat-page">
      <section className="member-chat-shell">
        <header className="member-chat-header">
          <a className="brand-mark" href="/member/account">
            F
          </a>
          <div>
            <small>FAYFORT STAFF</small>
            <h1>Member photo reviews</h1>
          </div>
        </header>
        {loading ? (
          <p role="status">Checking staff sign-in…</p>
        ) : !token ? (
          <p role="status">Sign in to a FayFort staff account to view the review queue.</p>
        ) : (
          <MemberPhotoReviewQueue accessToken={token} platformAdmin={platformAdmin} />
        )}
      </section>
    </main>
  );
}

export function MemberPhotoReviewQueue({
  accessToken,
  platformAdmin,
}: {
  accessToken: string;
  platformAdmin: boolean;
}) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [workers, setWorkers] = useState<{ user_id: string; email: string | null }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<MemberCatalogProduct[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [context, setContext] = useState<Record<string, MemberChatMessage[] | undefined>>({});
  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ reviews: any[]; active_workers?: { user_id: string; email: string | null }[] }>(
        platformAdmin ? "/platform/member-reviews" : "/workers/member-reviews",
        accessToken,
      );
      setReviews(result.reviews || []);
      setWorkers(result.active_workers || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo review queue could not be loaded.");
    }
  }, [accessToken, platformAdmin]);
  useEffect(() => {
    void load();
  }, [load]);
  async function assign(reviewId: string, workerId: string) {
    setBusy(reviewId);
    setError("");
    try {
      await apiRequest(`/platform/member-reviews/${reviewId}/assignment`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ worker_id: workerId }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo review could not be assigned.");
    } finally {
      setBusy("");
    }
  }
  async function status(reviewId: string, value: "under_review" | "reviewed") {
    setBusy(reviewId);
    setError("");
    try {
      await apiRequest(`/workers/member-reviews/${reviewId}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review status could not be saved.");
    } finally {
      setBusy("");
    }
  }
  async function view(reviewId: string, mediaId: string) {
    setBusy(mediaId);
    setError("");
    try {
      const path = platformAdmin
        ? `/platform/member-reviews/${reviewId}/media/${mediaId}`
        : `/workers/member-reviews/${reviewId}/media/${mediaId}`;
      const result = await apiRequest<{ url: string }>(path, accessToken);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Photo could not be opened.");
    } finally {
      setBusy("");
    }
  }
  async function findProducts() {
    setBusy("catalog");
    setError("");
    try {
      const result = await apiRequest<{ products: MemberCatalogProduct[] }>(
        `/workers/member-reviews/catalog?search=${encodeURIComponent(search)}`,
        accessToken,
      );
      setCatalog(result.products || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The active catalog could not be searched.");
    } finally {
      setBusy("");
    }
  }
  async function toggleContext(reviewId: string) {
    if (context[reviewId] !== undefined) {
      setContext((current) => ({ ...current, [reviewId]: undefined }));
      return;
    }
    setBusy(`context:${reviewId}`);
    setError("");
    try {
      const result = await apiRequest<{ messages: MemberChatMessage[] }>(
        `/workers/member-reviews/${reviewId}/messages`,
        accessToken,
      );
      setContext((current) => ({ ...current, [reviewId]: result.messages || [] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The member chat could not be loaded.");
    } finally {
      setBusy("");
    }
  }
  async function sendReply(reviewId: string) {
    const content = (reply[reviewId] || "").trim();
    if (!content) return;
    setBusy(reviewId);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/workers/member-reviews/${reviewId}/reply`, accessToken, {
        method: "POST",
        body: JSON.stringify({ content, product_ids: selected[reviewId] || [] }),
      });
      setReply((current) => ({ ...current, [reviewId]: "" }));
      setSelected((current) => ({ ...current, [reviewId]: [] }));
      setNotice("Your reply was sent to the member chat.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reply could not be sent.");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="control-panel" aria-label="Member photo review queue">
      <div className="panel-heading">
        <div>
          <h2>Member photo reviews</h2>
          <p>
            Separate human-review queue. Images are private and expire 30 days after review, or after 30 days if still
            unreviewed.
          </p>
        </div>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {reviews.length === 0 ? (
        <p>No member photos are waiting in this queue.</p>
      ) : (
        reviews.map((review) => (
          <article className="member-request-card" key={review.id}>
            <h3>Photo review · {review.status.replaceAll("_", " ")}</h3>
            <small>Submitted {new Date(review.created_at).toLocaleString()}</small>
            {review.media?.map((media: any) => (
              <div className="record-actions" key={media.id}>
                <span>
                  {media.original_filename} · {(media.byte_size / 1024 / 1024).toFixed(2)} MiB · expires{" "}
                  {new Date(media.expires_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy === media.id}
                  onClick={() => void view(review.id, media.id)}
                >
                  View private photo
                </button>
              </div>
            ))}
            {!platformAdmin && (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  aria-expanded={context[review.id] !== undefined}
                  disabled={busy === "context:" + review.id}
                  onClick={() => void toggleContext(review.id)}
                >
                  {context[review.id] !== undefined
                    ? "Hide chat context"
                    : busy === "context:" + review.id
                      ? "Loading context…"
                      : "View member chat"}
                </button>
                {context[review.id] !== undefined && (
                  <div className="member-review-chat-context" aria-label="Member chat context">
                    {context[review.id]?.length ? (
                      context[review.id]?.map((message) => (
                        <p key={message.id}>
                          <strong>
                            {message.sender_type === "member"
                              ? "Member"
                              : message.sender_type === "worker"
                                ? "FayFort human support"
                                : "FayFort assistant"}
                          </strong>
                          <span>{message.content}</span>
                        </p>
                      ))
                    ) : (
                      <p>No chat messages yet.</p>
                    )}
                  </div>
                )}
              </>
            )}
            {platformAdmin ? (
              <label>
                Assign active worker
                <select
                  aria-label="Assign member photo reviewer"
                  value={review.assigned_worker_id || ""}
                  disabled={busy === review.id}
                  onChange={(event) => {
                    if (event.target.value) void assign(review.id, event.target.value);
                  }}
                >
                  <option value="">Unassigned</option>
                  {workers.map((worker) => (
                    <option key={worker.user_id} value={worker.user_id}>
                      {worker.email || worker.user_id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                {review.status === "assigned" && (
                  <div className="record-actions">
                    <button
                      className="secondary-button"
                      disabled={busy === review.id}
                      onClick={() => void status(review.id, "under_review")}
                    >
                      Start review
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy === review.id}
                      onClick={() => void status(review.id, "reviewed")}
                    >
                      Mark reviewed
                    </button>
                  </div>
                )}
                {review.status === "under_review" && (
                  <div className="record-actions">
                    <button
                      className="primary-button"
                      disabled={busy === review.id}
                      onClick={() => void status(review.id, "reviewed")}
                    >
                      Mark reviewed
                    </button>
                  </div>
                )}
                {review.status === "reviewed" && (
                  <section className="member-review-reply">
                    <h4>Reply to member</h4>
                    <p>
                      Summarize what the image appears to show. Product suggestions come only from active catalog
                      entries.
                    </p>
                    <label htmlFor={`review-reply-${review.id}`}>Message</label>
                    <textarea
                      id={`review-reply-${review.id}`}
                      maxLength={2000}
                      rows={3}
                      value={reply[review.id] || ""}
                      onChange={(event) => setReply((current) => ({ ...current, [review.id]: event.target.value }))}
                    />
                    <div className="member-review-catalog-search">
                      <label htmlFor={`review-catalog-${review.id}`}>Find active products to suggest</label>
                      <input
                        id={`review-catalog-${review.id}`}
                        maxLength={100}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search products or categories"
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy === "catalog"}
                        onClick={() => void findProducts()}
                      >
                        Search catalog
                      </button>
                    </div>
                    {catalog.length > 0 && (
                      <div className="member-review-catalog-list" aria-label="Active catalog products">
                        {catalog.map((product) => (
                          <label key={product.id}>
                            <input
                              type="checkbox"
                              checked={(selected[review.id] || []).includes(product.id)}
                              disabled={
                                !(selected[review.id] || []).includes(product.id) &&
                                (selected[review.id] || []).length >= 5
                              }
                              onChange={(event) =>
                                setSelected((current) => ({
                                  ...current,
                                  [review.id]: event.target.checked
                                    ? [...(current[review.id] || []), product.id]
                                    : (current[review.id] || []).filter((id) => id !== product.id),
                                }))
                              }
                            />
                            <span>
                              <strong>{product.name}</strong>
                              <small>
                                {product.category_ref || "Product"} · {product.availability_status.replaceAll("_", " ")}
                              </small>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy === review.id || !(reply[review.id] || "").trim()}
                      onClick={() => void sendReply(review.id)}
                    >
                      {busy === review.id ? "Sending…" : "Send reply"}
                    </button>
                  </section>
                )}
              </>
            )}
          </article>
        ))
      )}
    </section>
  );
}
