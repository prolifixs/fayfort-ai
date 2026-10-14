import { FormEvent, useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { friendlyAuthError } from "./authLinks";
import { PasswordFields, passwordPairError, type PasswordPair } from "./PasswordFields";

function needsReauthentication(reason: unknown): boolean {
  const code =
    reason && typeof reason === "object" && "code" in reason ? String((reason as { code?: unknown }).code || "") : "";
  const message = reason instanceof Error ? reason.message.toLowerCase() : "";
  return code === "reauthentication_needed" || message.includes("reauthentication");
}

/**
 * Sets a new password for the signed-in identity (recovery, invitation or settings change).
 * When Supabase asks for a fresh reauthentication, it emails a one-time code and the form asks for it.
 */
export function SetPasswordForm({
  submitLabel = "Update password",
  busyLabel = "Updating password…",
  onDone,
}: {
  submitLabel?: string;
  busyLabel?: string;
  onDone: () => void;
}) {
  const [pair, setPair] = useState<PasswordPair>({ password: "", confirm: "" });
  const [nonce, setNonce] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const problem = passwordPairError(pair);
    if (problem) {
      setError(problem);
      return;
    }
    if (!supabaseClient) {
      setError("FayFort sign-in is not configured on this site.");
      return;
    }
    setBusy(true);
    try {
      const attributes = awaitingCode ? { password: pair.password, nonce: nonce.trim() } : { password: pair.password };
      const { error: authError } = await supabaseClient.auth.updateUser(attributes);
      if (authError) throw authError;
      setPair({ password: "", confirm: "" });
      setNonce("");
      setAwaitingCode(false);
      onDone();
    } catch (reason) {
      if (!awaitingCode && needsReauthentication(reason)) {
        const { error: codeError } = await supabaseClient.auth.reauthenticate();
        if (codeError) setError(friendlyAuthError(codeError, "We couldn't send a confirmation code."));
        else {
          setAwaitingCode(true);
          setNotice("For your security we emailed you a confirmation code. Enter it below, then save again.");
        }
      } else setError(friendlyAuthError(reason, "Password could not be updated. Request a new link and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PasswordFields value={pair} onChange={setPair} />
      {awaitingCode && (
        <>
          <label htmlFor="password-reauth-code">Confirmation code</label>
          <input
            id="password-reauth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={nonce}
            onChange={(event) => setNonce(event.target.value)}
          />
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
