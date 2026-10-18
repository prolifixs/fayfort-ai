import { FormEvent, useEffect, useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { friendlyAuthError } from "./authLinks";
import { PasswordFields, passwordPairError, type PasswordPair } from "./PasswordFields";

function needsReauthentication(reason: unknown): boolean {
  const code =
    reason && typeof reason === "object" && "code" in reason ? String((reason as { code?: unknown }).code || "") : "";
  const message = reason instanceof Error ? reason.message.toLowerCase() : "";
  return code === "reauthentication_needed" || message.includes("reauthentication");
}

/** Supabase refuses a password change on an account with an authenticator until the code has been entered (AAL2). */
function needsAuthenticator(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message.toLowerCase() : String(reason || "").toLowerCase();
  return message.includes("aal2") || message.includes("insufficient_aal");
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
  // Accounts with an authenticator app (all FayFort staff): the 6-digit code comes first, on the same form.
  const [mfaCode, setMfaCode] = useState("");
  const [mfaNeeded, setMfaNeeded] = useState(false);
  useEffect(() => {
    const mfa = supabaseClient?.auth.mfa;
    if (!mfa?.getAuthenticatorAssuranceLevel) return;
    let alive = true;
    mfa
      .getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (alive && data?.currentLevel === "aal1" && data?.nextLevel === "aal2") setMfaNeeded(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  async function verifyAuthenticator(): Promise<boolean> {
    const mfa = supabaseClient!.auth.mfa;
    const { data: factors, error: listError } = await mfa.listFactors();
    if (listError) throw listError;
    const factor = (factors?.totp || []).find((item) => item.status === "verified");
    if (!factor) return true;
    const { error: verifyError } = await mfa.challengeAndVerify({ factorId: factor.id, code: mfaCode.replace(/\s+/g, "") });
    if (verifyError) {
      setError("That authenticator code didn't work. Check the time on your phone and enter the newest 6-digit code.");
      return false;
    }
    setMfaNeeded(false);
    return true;
  }

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
    if (mfaNeeded && !/^\d{6}$/.test(mfaCode.replace(/\s+/g, ""))) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      if (mfaNeeded && !(await verifyAuthenticator())) return;
      const attributes = awaitingCode ? { password: pair.password, nonce: nonce.trim() } : { password: pair.password };
      const { error: authError } = await supabaseClient.auth.updateUser(attributes);
      if (authError) throw authError;
      setPair({ password: "", confirm: "" });
      setNonce("");
      setAwaitingCode(false);
      onDone();
    } catch (reason) {
      if (needsAuthenticator(reason)) {
        setMfaNeeded(true);
        setError("Enter the 6-digit code from your authenticator app, then save again.");
      } else if (!awaitingCode && needsReauthentication(reason)) {
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
      {mfaNeeded && (
        <div className="auth-mfa-step">
          <label htmlFor="password-mfa-code">Authenticator code</label>
          <p className="quiet-note">This account uses an authenticator app. Enter its 6-digit code to change the password.</p>
          <input
            id="password-mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value)}
            placeholder="123 456"
          />
        </div>
      )}
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
