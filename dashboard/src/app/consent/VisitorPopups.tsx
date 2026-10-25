import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import { CONSENT_EVENT, POPUP_COOKIE, VISITS_COOKIE, isMember, readConsent, readCookie, writeCookie } from "../../lib/consent";

/** Popups for signed-out visitors on the app's catalog (owner request, 2026-10-25; same rules as fayfort.com,
 * web/src/consent/VisitorPopups.tsx): product cards on the first visit, the newsletter from the second, at most one per
 * visit, none for 7 days after closing, never for members or before the cookie choice. */
type Pick = { name: string; price: number | null; currency: string | null; price_guide: boolean; image_url: string };
type Kind = "products" | "newsletter";
const SESSION_KEY = "ff_popup_session";
const IMAGE_HOSTS = ["https://lirauxdhnknfiqjnulxb.supabase.co/", "https://cdn.shopify.com/"];
const DELAY_MS = 4000;

function sessionFlag(key: string, set = false): boolean {
  try {
    if (set) window.sessionStorage.setItem(key, "1");
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function countVisit(): number {
  const visits = Number(readCookie(VISITS_COOKIE) || "0") || 0;
  if (sessionFlag("ff_visit_counted")) return visits;
  sessionFlag("ff_visit_counted", true);
  writeCookie(VISITS_COOKIE, String(visits + 1), 365);
  return visits + 1;
}

function priceLine(pick: Pick) {
  if (pick.price === null) return "Ask for a price";
  let text = `${pick.currency || "USD"} ${pick.price}`;
  try {
    text = new Intl.NumberFormat("en-US", { style: "currency", currency: pick.currency || "USD", maximumFractionDigits: pick.price % 1 ? 2 : 0 }).format(pick.price);
  } catch {
    /* keep the plain form */
  }
  return pick.price_guide ? `From ${text}` : text;
}

function NewsletterSignup({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("busy");
    try {
      const response = await fetch(`${API_BASE}/public/newsletter/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "catalog_popup" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "We couldn’t sign you up just now.");
      setState("done");
      onDone();
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "We couldn’t sign you up just now.");
    }
  }
  if (state === "done")
    return (
      <p className="ffn-done" role="status">
        Almost there: check your inbox and tap the link to confirm.
      </p>
    );
  return (
    <form className="ffn-form" onSubmit={(event) => void submit(event)}>
      <label className="ffn-label" htmlFor="ffn-email-catalog">
        Email address
      </label>
      <div className="ffn-row">
        <input id="ffn-email-catalog" type="email" required maxLength={320} autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button type="submit" disabled={state === "busy"}>
          {state === "busy" ? "Signing up…" : "Subscribe"}
        </button>
      </div>
      {state === "error" && (
        <p className="ffn-error" role="alert">
          {message}
        </p>
      )}
      <p className="ffn-fine">Weekly finds and early access to giveaways. Unsubscribe any time.</p>
    </form>
  );
}

export function VisitorPopups() {
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const shown = useRef(false);
  useEffect(() => {
    const check = () => setReady(Boolean(readConsent()) && !isMember() && !readCookie(POPUP_COOKIE) && !sessionFlag(SESSION_KEY));
    check();
    window.addEventListener(CONSENT_EVENT, check);
    return () => window.removeEventListener(CONSENT_EVENT, check);
  }, []);
  const show = useCallback((next: Kind) => {
    if (shown.current) return;
    shown.current = true;
    sessionFlag(SESSION_KEY, true);
    setKind(next);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const visits = countVisit();
    const next: Kind = visits < 2 ? "products" : "newsletter";
    if (next === "products") {
      fetch(`${API_BASE}/public/site/go`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { picks?: Pick[] } | null) =>
          setPicks((body?.picks || []).filter((p) => p?.name && IMAGE_HOSTS.some((host) => p.image_url?.startsWith(host))).slice(0, 4)),
        )
        .catch(() => setPicks([]));
    }
    const timer = window.setTimeout(() => show(next), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, show]);
  const close = useCallback(() => {
    writeCookie(POPUP_COOKIE, "1", 7);
    setKind(null);
  }, []);
  useEffect(() => {
    if (!kind) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, close]);
  if (!kind) return null;
  const view: Kind = kind === "products" && picks.length < 2 ? "newsletter" : kind;
  return (
    <aside className="ffp-card" role="dialog" aria-modal="false" aria-labelledby="ffp-title">
      <button type="button" className="ffp-close" aria-label="Close" onClick={close}>
        ×
      </button>
      {view === "products" ? (
        <>
          <p className="ffp-kicker">Sourced in China</p>
          <h2 id="ffp-title">Join free to shop these</h2>
          <ul className="ffp-picks">
            {picks.map((pick) => (
              <li key={pick.image_url}>
                <a href="/member/signup" onClick={close}>
                  <img src={pick.image_url} alt="" loading="lazy" />
                  <span>{pick.name}</span>
                  <b>{priceLine(pick)}</b>
                </a>
              </li>
            ))}
          </ul>
          <div className="ffp-actions">
            <a className="ffp-primary" href="/member/signup" onClick={close}>
              Join free
            </a>
            <a className="ffp-secondary" href="/member/account" onClick={close}>
              Sign in
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="ffp-kicker">FayFort newsletter</p>
          <h2 id="ffp-title">New finds from China, every week</h2>
          <p className="ffp-lede">The best products we source, straight to your inbox, plus early access to our giveaways.</p>
          <NewsletterSignup onDone={() => writeCookie(POPUP_COOKIE, "1", 30)} />
        </>
      )}
    </aside>
  );
}
