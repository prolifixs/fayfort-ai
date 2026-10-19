import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

/** "How was Ada's help?": the member rates the FayFort team member who helped them, after a chat has gone quiet
 * for two hours or when an order is delivered. Shown in the chat (that conversation only) and in Orders & requests
 * (delivered orders). Ratings can be changed for 7 days. Hidden when there's nothing to rate. */

export type RatingPrompt = {
  id: string;
  title: string;
  kind: "chat" | "request";
  conversation_id: string | null;
  request_id: string | null;
  worker: { first_name: string; photo_url: string | null };
  rating: { stars: number; comment: string | null } | null;
};

const LABELS = ["", "Poor", "Not great", "Okay", "Good", "Excellent"];

export function WorkerRatingPrompts({ accessToken, conversationId, kind }: { accessToken: string; conversationId?: string | null; kind: "chat" | "request" }) {
  const [prompts, setPrompts] = useState<RatingPrompt[]>([]);
  const load = useCallback(() => {
    apiRequest<{ prompts?: RatingPrompt[] }>("/members/worker-ratings", accessToken)
      .then((result) => setPrompts(Array.isArray(result?.prompts) ? result.prompts : []))
      .catch(() => setPrompts([]));
  }, [accessToken]);
  useEffect(() => load(), [load, conversationId]);
  const shown = prompts.filter((p) => p.kind === kind && (kind === "request" || p.conversation_id === conversationId));
  if (!shown.length) return null;
  return (
    <div className={`worker-rating-prompts is-${kind}`}>
      {shown.map((prompt) => (
        <RatingCard key={prompt.id} prompt={prompt} accessToken={accessToken} onDone={load} focus={window.location.hash === `#rate-${prompt.id}` || (kind === "chat" && window.location.hash === "#rate")} />
      ))}
    </div>
  );
}

function RatingCard({ prompt, accessToken, onDone, focus }: { prompt: RatingPrompt; accessToken: string; onDone: () => void; focus: boolean }) {
  const [stars, setStars] = useState(prompt.rating?.stars || 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(prompt.rating?.comment || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(Boolean(prompt.rating));
  const [editing, setEditing] = useState(!prompt.rating);
  const [error, setError] = useState("");
  const name = prompt.worker.first_name || "the FayFort team";
  async function save(value = stars) {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/members/worker-ratings", accessToken, {
        method: "POST",
        body: JSON.stringify({ prompt_id: prompt.id, stars: value, comment: comment.trim() || null }),
      });
      setSaved(true);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your rating couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    setBusy(true);
    try {
      await apiRequest(`/members/worker-ratings/${prompt.id}/dismiss`, accessToken, { method: "POST" });
      onDone();
    } catch {
      setBusy(false);
    }
  }
  const shown = hover || stars;
  return (
    <article
      className={`worker-rating-card${focus ? " is-target" : ""}`}
      aria-label={`Rate ${name}'s help`}
      ref={(el) => {
        if (el && focus) el.scrollIntoView({ block: "center" });
      }}
    >
      <span className="worker-rating-face" aria-hidden="true">
        {prompt.worker.photo_url ? <img src={prompt.worker.photo_url} alt="" /> : name.slice(0, 1).toUpperCase()}
      </span>
      <div className="worker-rating-body">
        <strong>{saved && !editing ? `Thanks for rating ${name}` : `How was ${name}'s help?`}</strong>
        <small>{prompt.kind === "chat" ? `Your chat: ${prompt.title}` : `Your order: ${prompt.title}`}</small>
        {saved && !editing ? (
          <p className="worker-rating-done">
            {"★".repeat(stars)}
            <span>{"★".repeat(5 - stars)}</span>
            <button type="button" className="text-button" onClick={() => setEditing(true)}>
              Change
            </button>
          </p>
        ) : (
          <>
            <div className="worker-rating-stars" role="radiogroup" aria-label={`Rate ${name}`} onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}, ${LABELS[n]}`}
                  className={n <= shown ? "is-on" : ""}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setStars(n)}
                >
                  ★
                </button>
              ))}
              <span aria-hidden="true">{shown ? LABELS[shown] : ""}</span>
            </div>
            {stars > 0 && (
              <div className="worker-rating-form">
                <input maxLength={600} value={comment} placeholder={`Anything to tell ${name}? (optional)`} aria-label="Comment (optional)" onChange={(event) => setComment(event.target.value)} />
                <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Send"}
                </button>
              </div>
            )}
            {!prompt.rating && (
              <button type="button" className="worker-rating-skip" disabled={busy} onClick={() => void dismiss()}>
                Not now
              </button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
