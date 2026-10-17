import { useCallback, useEffect, useRef, useState } from "react";

// Cloudflare Turnstile site key. It is public by design (it is sent to every visitor's browser).
// The secret key lives only in Supabase Auth → Attack Protection.
// Leave empty to disable the check (local development, or before Supabase captcha is switched on).
const TURNSTILE_SITE_KEY = ((import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? (import.meta.env.MODE === "test" ? "" : "0x4AAAAAAFXDNL6ChJqA7UCK")).trim();
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("The security check could not load."));
      };
      document.head.appendChild(script);
    });
  return scriptPromise;
}

/** The widget only works on the hostnames registered in Cloudflare (app.fayfort.com), so it stays off elsewhere. */
export function turnstileEnabled(hostname = window.location.hostname): boolean {
  return TURNSTILE_SITE_KEY.length > 0 && (hostname === "fayfort.com" || hostname.endsWith(".fayfort.com"));
}

/**
 * Holds a single-use Turnstile token for one form.
 * `captchaToken` is undefined when Turnstile is disabled, so callers can pass it straight to supabase-js.
 */
export function useCaptcha() {
  const [token, setToken] = useState("");
  const [resetCount, setResetCount] = useState(0);
  const reset = useCallback(() => {
    setToken("");
    setResetCount((value) => value + 1);
  }, []);
  const enabled = turnstileEnabled();
  return {
    enabled,
    ready: !enabled || token.length > 0,
    captchaToken: enabled ? token : undefined,
    reset,
    widget: enabled ? <TurnstileWidget key={resetCount} onToken={setToken} /> : null,
  };
}

const AUTO_RETRIES = 2;

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  // Bumping this remounts the widget ("Try again") without reloading the page or losing what was typed.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    let retries = 0;
    let retryTimer: number | undefined;
    setError("");
    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          // A page left open a long time gets a fresh check by itself instead of failing at "Sign in".
          "refresh-expired": "auto",
          callback: (value: string) => {
            setError("");
            onToken(value);
          },
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            // Brief network drops are common: try again quietly before asking the person to do anything.
            if (retries < AUTO_RETRIES && widgetId && window.turnstile) {
              retries += 1;
              const id = widgetId;
              retryTimer = window.setTimeout(() => window.turnstile?.reset(id), 1500 * retries);
              return true;
            }
            setError("The security check couldn't finish. Check your connection, then try again.");
            return true;
          },
        });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Security check unavailable."));
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, attempt]);
  return (
    <div className="auth-captcha">
      <div ref={container} />
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
