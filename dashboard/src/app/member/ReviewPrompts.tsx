import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";

/** Orders & requests → "How was it?": once an order or sourcing request ships, the member can rate it and say a few
 * words. Reviews go to the FayFort team, who publish them on www.fayfort.com. Hidden when nothing is waiting. */

type Invite = { id: string; title: string; kind: "request" | "order"; created_at: string };
type Listing = { invites: Invite[]; defaults: { display_name: string | null; country: string | null } };

const LABELS = ["", "Poor", "Not great", "Okay", "Good", "Excellent"];

export function ReviewPrompts({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<Listing | null>(null);
  const [thanks, setThanks] = useState("");
  const load = useCallback(() => {
    apiRequest<Partial<Listing>>("/members/reviews", accessToken)
      .then((next) => setData({ invites: Array.isArray(next?.invites) ? next.invites : [], defaults: next?.defaults || { display_name: null, country: null } }))
      .catch(() => setData(null)); // Reviews are optional: never block Orders & requests.
  }, [accessToken]);
  useEffect(() => load(), [load]);
  const target = window.location.hash.startsWith("#review-") ? window.location.hash.slice("#review-".length) : "";
  if (!data?.invites.length && !thanks) return null;
  return (
    <section className="review-prompts" aria-label="Review your orders">
      <div className="review-prompts-head">
        <h3>How was it?</h3>
        <p>Your review helps other buyers trust FayFort. It takes a minute, and our team reads every one.</p>
      </div>
      {thanks && (
        <p className="review-thanks" role="status">
          {thanks}
        </p>
      )}
      {data?.invites.map((invite) => (
        <ReviewPrompt
          key={invite.id}
          invite={invite}
          defaults={data.defaults}
          accessToken={accessToken}
          focus={invite.id === target}
          onDone={(message) => {
            setThanks(message);
            load();
          }}
        />
      ))}
    </section>
  );
}

function ReviewPrompt({
  invite,
  defaults,
  accessToken,
  focus,
  onDone,
}: {
  invite: Invite;
  defaults: Listing["defaults"];
  accessToken: string;
  focus: boolean;
  onDone: (message: string) => void;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [name, setName] = useState(defaults.display_name || "");
  const [country, setCountry] = useState(defaults.country || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);
  const open = rating > 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/members/reviews", accessToken, {
        method: "POST",
        body: JSON.stringify({ invite_id: invite.id, rating, body: body.trim(), display_name: name.trim(), country: country.trim() || null }),
      });
      onDone("Thank you! Your review is with the FayFort team and appears on fayfort.com once it's checked.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your review could not be sent. Please try again.");
      setBusy(false);
    }
  }
  async function dismiss() {
    setBusy(true);
    try {
      await apiRequest(`/members/reviews/invites/${invite.id}/dismiss`, accessToken, { method: "POST" });
      onDone("");
    } catch {
      setBusy(false);
    }
  }
  const shown = hover || rating;
  return (
    <article ref={ref} className={`review-prompt${open ? " is-open" : ""}${focus ? " is-target" : ""}`} aria-label={`Review ${invite.title}`}>
      <div className="review-prompt-top">
        <div>
          <small>{invite.kind === "order" ? "Shop order · shipped" : "Sourcing request · shipped"}</small>
          <strong>{invite.title}</strong>
        </div>
        <div className="review-prompt-stars" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}, ${LABELS[n]}`}
              className={n <= shown ? "is-on" : ""}
              onMouseEnter={() => setHover(n)}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
          <span aria-hidden="true">{shown ? LABELS[shown] : "Tap to rate"}</span>
        </div>
      </div>
      {open ? (
        <form className="review-prompt-form" onSubmit={submit}>
          <label>
            Tell other buyers how it went
            <textarea
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              value={body}
              placeholder="Did it arrive as described? How was the team?"
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="review-prompt-row">
            <label>
              Name shown
              <input required maxLength={60} value={name} placeholder="First name and initial" onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Country
              <input maxLength={60} value={country} placeholder="Optional" onChange={(event) => setCountry(event.target.value)} />
            </label>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="review-prompt-actions">
            <button className="primary-button" disabled={busy || body.trim().length < 10 || !name.trim()}>
              {busy ? "Sending…" : "Send review"}
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => void dismiss()}>
              Not now
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="review-prompt-skip" disabled={busy} onClick={() => void dismiss()}>
          Don't ask about this one
        </button>
      )}
    </article>
  );
}
