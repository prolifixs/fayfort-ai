import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { supabaseClient } from "../../lib/supabase";
import { friendlyAuthError } from "./authLinks";

// AD2: two-step verification (authenticator app, TOTP) is required for every FayFort team account.
// The API enforces the same rule once STAFF_MFA_REQUIRED is switched on.
const STAFF_MFA_ENFORCED = (import.meta.env.VITE_STAFF_MFA as string | undefined) !== "off";
// AD5: a staff browser session ends after 12 hours without activity.
export const STAFF_IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;
const ACTIVITY_KEY = "fayfort-staff-last-activity";

type GateState =
  | { kind: "checking" }
  | { kind: "open" }
  | { kind: "challenge"; factorId: string }
  | { kind: "enroll"; factorId: string; qrCode: string; secret: string }
  | { kind: "error"; message: string };

function readActivity(): number | null {
  try {
    const value = Number(localStorage.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
function writeActivity(now = Date.now()) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    /* storage unavailable: idle timeout is best-effort */
  }
}

/** Signs a staff browser out after 12 idle hours; activity is any click, key press or focus. */
function useStaffIdleTimeout(active: boolean) {
  useEffect(() => {
    if (!active || !supabaseClient) return;
    const last = readActivity();
    if (last && Date.now() - last > STAFF_IDLE_LIMIT_MS) {
      void supabaseClient.auth.signOut();
      return;
    }
    writeActivity();
    let throttle = 0;
    const touch = () => {
      const now = Date.now();
      if (now - throttle > 60_000) {
        throttle = now;
        writeActivity(now);
      }
    };
    const check = window.setInterval(() => {
      const seen = readActivity();
      if (seen && Date.now() - seen > STAFF_IDLE_LIMIT_MS) void supabaseClient?.auth.signOut();
    }, 5 * 60_000);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    window.addEventListener("focus", touch);
    return () => {
      window.clearInterval(check);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("focus", touch);
    };
  }, [active]);
}

/**
 * Wraps every staff surface. With a signed-in session it requires an MFA-verified (aal2) session:
 * first-time staff enrol an authenticator app, everyone else enters a code. Without a session it
 * renders its children, which show their own sign-in.
 */
export function StaffMfaGate({ signedIn, email, children }: { signedIn: boolean; email?: string; children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useStaffIdleTimeout(signedIn);

  const evaluate = useCallback(async () => {
    if (!signedIn || !STAFF_MFA_ENFORCED) {
      setState({ kind: "open" });
      return;
    }
    const mfa = supabaseClient?.auth.mfa;
    if (!mfa) {
      setState({ kind: "error", message: "Two-step verification isn't available on this site." });
      return;
    }
    try {
      const { data: level, error: levelError } = await mfa.getAuthenticatorAssuranceLevel();
      if (levelError) throw levelError;
      if (level?.currentLevel === "aal2") {
        setState({ kind: "open" });
        return;
      }
      const { data: factors, error: listError } = await mfa.listFactors();
      if (listError) throw listError;
      const verified = (factors?.totp || []).find((factor) => factor.status === "verified");
      if (verified) {
        setState({ kind: "challenge", factorId: verified.id });
        return;
      }
      // Clear abandoned enrolments so a fresh QR code can be issued.
      for (const factor of factors?.all || [])
        if (factor.status !== "verified") await mfa.unenroll({ factorId: factor.id });
      const { data: enrolled, error: enrollError } = await mfa.enroll({
        factorType: "totp",
        friendlyName: `FayFort authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) throw enrollError;
      setState({ kind: "enroll", factorId: enrolled.id, qrCode: enrolled.totp.qr_code, secret: enrolled.totp.secret });
    } catch (reason) {
      setState({ kind: "error", message: friendlyAuthError(reason, "Two-step verification could not start.") });
    }
  }, [signedIn]);

  useEffect(() => {
    setState({ kind: "checking" });
    void evaluate();
  }, [evaluate]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!supabaseClient || (state.kind !== "challenge" && state.kind !== "enroll")) return;
    setBusy(true);
    setError("");
    const { error: verifyError } = await supabaseClient.auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code: code.replace(/\s+/g, ""),
    });
    setBusy(false);
    if (verifyError) {
      setError(
        /invalid|expired|code/i.test(verifyError.message)
          ? "That code didn't work. Check the time on your phone and enter the newest 6-digit code."
          : friendlyAuthError(verifyError, "Verification failed."),
      );
      return;
    }
    setCode("");
    void evaluate();
  }

  if (state.kind === "open") return <>{children}</>;

  const signOut = (
    <button type="button" className="text-button" onClick={() => void supabaseClient?.auth.signOut()}>
      Sign out
    </button>
  );
  return (
    <div className="auth-page">
      <section className="auth-card staff-mfa-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT TEAM ACCOUNT</label>
        {state.kind === "checking" && (
          <>
            <h1>Checking your sign-in</h1>
            <p role="status">Confirming two-step verification…</p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <h1>Two-step verification</h1>
            <p className="form-error" role="alert">
              {state.message}
            </p>
            <button type="button" className="primary-button" onClick={() => void evaluate()}>
              Try again
            </button>
          </>
        )}
        {state.kind === "enroll" && (
          <>
            <h1>Set up two-step verification</h1>
            <p>
              FayFort team accounts need an authenticator app (Google Authenticator, 1Password, Authy or similar). Scan
              this code, then enter the 6-digit code the app shows.
            </p>
            <img className="staff-mfa-qr" src={state.qrCode} alt="QR code for your authenticator app" />
            <details className="staff-mfa-secret">
              <summary>Can't scan? Enter this key instead</summary>
              <code>{state.secret}</code>
            </details>
          </>
        )}
        {state.kind === "challenge" && (
          <>
            <h1>Enter your verification code</h1>
            <p>Open your authenticator app and enter the 6-digit code for {email || "your FayFort account"}.</p>
          </>
        )}
        {(state.kind === "enroll" || state.kind === "challenge") && (
          <form onSubmit={verify}>
            <label htmlFor="staff-mfa-code">6-digit code</label>
            <input
              id="staff-mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? "Checking…" : state.kind === "enroll" ? "Turn on two-step verification" : "Verify"}
            </button>
          </form>
        )}
        {state.kind === "challenge" && (
          <p className="quiet-note">Lost your phone? Ask a FayFort platform administrator to reset two-step verification.</p>
        )}
        <p className="quiet-note">{signOut}</p>
      </section>
    </div>
  );
}
