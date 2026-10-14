import { useCallback, useEffect, useRef, useState } from "react";

// Cloudflare Turnstile site key. It is public by design (it is sent to every visitor's browser).
// The secret key lives only in Supabase Auth → Attack Protection.
// Leave empty to disable the check (local development, or before Supabase captcha is switched on).
const TURNSTILE_SITE_KEY = ((import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) || "").trim();
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

export function turnstileEnabled(): boolean {
  return TURNSTILE_SITE_KEY.length > 0;
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

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: "interaction-only",
          callback: (value: string) => onToken(value),
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            setError("The security check could not complete. Refresh the page and try again.");
          },
        });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Security check unavailable."));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken]);
  return (
    <div className="auth-captcha">
      <div ref={container} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
