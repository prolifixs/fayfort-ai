import { FormEvent, useEffect, useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { authCallbackUrl, friendlyAuthError, type AuthAudience } from "./authLinks";
import { useCaptcha } from "./Turnstile";

export const LINK_COOLDOWN_SECONDS = 60;

/**
 * Sends a password-reset link or a new sign-up verification link.
 * The confirmation is the same whether or not an account exists, so the form never reveals who has one.
 */
export function RequestLinkForm({
  kind,
  audience,
  initialEmail = "",
  submitLabel,
}: {
  kind: "recovery" | "signup";
  audience: AuthAudience;
  initialEmail?: string;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const captcha = useCaptcha();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabaseClient || cooldown > 0) return;
    setBusy(true);
    setError("");
    try {
      const address = email.trim();
      const { error: authError } =
        kind === "recovery"
          ? await supabaseClient.auth.resetPasswordForEmail(address, {
              redirectTo: authCallbackUrl(audience, "recovery"),
              captchaToken: captcha.captchaToken,
            })
          : await supabaseClient.auth.resend({
              type: "signup",
              email: address,
              options: { emailRedirectTo: authCallbackUrl(audience, "signup"), captchaToken: captcha.captchaToken },
            });
      if (authError) throw authError;
      setSent(true);
      setCooldown(LINK_COOLDOWN_SECONDS);
    } catch (reason) {
      setError(friendlyAuthError(reason, "We couldn't send the email. Try again in a minute."));
    } finally {
      captcha.reset();
      setBusy(false);
    }
  }

  const label = submitLabel || (kind === "recovery" ? "Email me a reset link" : "Resend verification email");
  return (
    <form onSubmit={submit} aria-label={kind === "recovery" ? "Request a password reset" : "Resend verification"}>
      <label htmlFor={`request-link-${kind}`}>Email</label>
      <input
        id={`request-link-${kind}`}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {captcha.widget}
      {sent && (
        <p role="status">
          {kind === "recovery"
            ? "If an account uses that email, a reset link is on its way. Use the newest email; older links stop working."
            : "If that email is waiting for verification, a new link is on its way."}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy || cooldown > 0 || !captcha.ready}>
        {busy ? "Sending…" : cooldown > 0 ? `You can send another in ${cooldown}s` : label}
      </button>
    </form>
  );
}
