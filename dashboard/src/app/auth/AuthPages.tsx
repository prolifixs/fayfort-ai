import type { EmailOtpType, Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { openedAt, supabaseClient } from "../../lib/supabase";
import { SetupScreen } from "../SetupScreen";
import { dashboardAuthConfigured } from "../../lib/supabase";
import { WorkerInvitationAcceptancePage } from "../staff/WorkerPages";
import { friendlyAuthError, homePathFor, parseAuthCallback, type AuthAudience } from "./authLinks";
import { RequestLinkForm } from "./RequestLinkForm";
import { SetPasswordForm } from "./SetPasswordForm";
import { AuthPage } from "./AuthPage";
import { landingFor, type Landing } from "./landing";
import { takeReturn } from "../../lib/returnTo";
import { FayfortLoader } from "../brand/FayfortLogo";

function AuthCard({ audience, title, children }: { audience: AuthAudience; title: string; children: ReactNode }) {
  return (
    <AuthPage staff={audience === "staff"}>
      <section className="auth-card">
        <label>{audience === "staff" ? "FAYFORT TEAM ACCOUNT" : "FAYFORT ACCOUNT"}</label>
        <h1>{title}</h1>
        {children}
      </section>
    </AuthPage>
  );
}

function audienceFromQuery(): AuthAudience {
  return new URLSearchParams(window.location.search).get("audience") === "staff" ? "staff" : "member";
}

/** /auth/forgot — request a password reset link for a member or a FayFort team account. */
export function ForgotPasswordPage() {
  const audience = audienceFromQuery();
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <AuthCard audience={audience} title="Reset your password">
      <p>Enter the email you sign in with. We'll send a link to choose a new password.</p>
      <RequestLinkForm kind="recovery" audience={audience} />
      <p className="quiet-note">
        <a href={homePathFor(audience)}>Back to sign in</a>
      </p>
    </AuthCard>
  );
}

const CODE_STEP_WORDING: Record<string, { title: string; text: string; button: string }> = {
  recovery: { title: "Reset your password", text: "Click below to choose a new password.", button: "Continue to reset password" },
  signup: { title: "Confirm your email", text: "Click below to confirm your email and open your account.", button: "Confirm my email" },
  invite: { title: "Join the FayFort team", text: "Click below to accept your invitation and set a password.", button: "Accept invitation" },
  email_change: { title: "Confirm your new email", text: "Click below to confirm this email address.", button: "Confirm email" },
  magiclink: { title: "Sign in to FayFort", text: "Click below to finish signing in.", button: "Sign in" },
  unknown: { title: "Continue to FayFort", text: "Click below to continue.", button: "Continue" },
};

/**
 * /auth/callback (and the /worker/accept alias) — finishes every Supabase Auth email link and OAuth return:
 * sign-up verification, worker invitation, password recovery, email change and magic links.
 */
export function AuthCallbackPage() {
  const [info] = useState(() =>
    // Prefer the address as first opened; supabase-js may already have cleared its #… part.
    parseAuthCallback(openedAt.pathname === window.location.pathname && openedAt.hash ? openedAt : window.location),
  );
  const [session, setSession] = useState<Session | null | undefined>(info.errorCode ? null : undefined);
  const [recovery, setRecovery] = useState(info.type === "recovery");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [home, setHome] = useState<Landing | null>(null);
  // FayFort's email links carry a one-time code that is used only when the person clicks Continue, so email
  // scanners that open links can't use it up, and the link works in any browser or on any device.
  const [codeStep, setCodeStep] = useState<"waiting" | "checking" | "done">(info.tokenHash ? "waiting" : "done");
  const [codeError, setCodeError] = useState("");

  useEffect(() => {
    if (!supabaseClient || info.errorCode) {
      setSession(null);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (mounted) setSession(next);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [info.errorCode]);

  async function confirmCode() {
    if (!supabaseClient) return;
    setCodeStep("checking");
    setCodeError("");
    const otpType: EmailOtpType = info.type === "unknown" || info.type === "oauth" ? "email" : (info.type as EmailOtpType);
    const { data, error } = await supabaseClient.auth.verifyOtp({ token_hash: info.tokenHash, type: otpType });
    // The code is single-use: take it out of the address bar either way.
    const clean = new URL(window.location.href);
    clean.searchParams.delete("token_hash");
    window.history.replaceState(null, "", clean.pathname + clean.search);
    if (error || !data.session) {
      setCodeError(friendlyAuthError(error, "This link is no longer valid."));
      setSession(null);
      setCodeStep("done");
      return;
    }
    if (info.type === "recovery") setRecovery(true);
    setSession(data.session);
    setCodeStep("done");
  }

  const { audience, type } = info;
  const settled = session !== undefined;
  const finishesSignIn = !recovery && type !== "invite" && codeStep === "done";

  useEffect(() => {
    // Where this account belongs is worked out from the account, not from the link (one sign-in for everyone).
    if (!session) return;
    let alive = true;
    void landingFor(session).then((landing) => alive && setHome(landing));
    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    // Verification, email change and OAuth returns need no further input: continue to the right home.
    if (settled && session && home && finishesSignIn && type !== "email_change") window.location.replace(takeReturn() || home);
  }, [settled, session, home, finishesSignIn, type]);

  if (!dashboardAuthConfigured) return <SetupScreen />;
  if (codeStep !== "done") {
    const wording = CODE_STEP_WORDING[type] || CODE_STEP_WORDING.unknown;
    return (
      <AuthCard audience={audience} title={wording.title}>
        <p>{wording.text}</p>
        <button
          type="button"
          className="primary-button auth-link-button"
          disabled={codeStep === "checking"}
          onClick={() => void confirmCode()}
        >
          {codeStep === "checking" ? "One moment…" : wording.button}
        </button>
      </AuthCard>
    );
  }
  if (!settled)
    return (
      <AuthCard audience={audience} title="One moment">
        <FayfortLoader label="Checking your link…" />
      </AuthCard>
    );

  if (!session)
    return (
      <AuthCard audience={audience} title="This link can't be used">
        <p role="alert">
          {codeError
            ? codeError
            : info.errorCode
              ? friendlyAuthError(`${info.errorCode} ${info.errorDescription}`, "This link is no longer valid.")
              : "This link has expired or was already used. Links work once, and only the newest one you asked for works."}
        </p>
        {type === "invite" ? (
          <p>Ask a FayFort platform administrator to resend your invitation. If you already set a password, sign in.</p>
        ) : (
          <>
            <p>{type === "signup" ? "Get a new verification link:" : "Get a new link:"}</p>
            <RequestLinkForm kind={type === "signup" ? "signup" : "recovery"} audience={audience} />
          </>
        )}
        <p className="quiet-note">
          <a href={homePathFor(audience)}>Go to sign in</a>
        </p>
      </AuthCard>
    );

  if ((recovery || type === "invite") && !passwordSaved)
    return (
      <AuthCard audience={audience} title={type === "invite" ? "Set your password" : "Set a new password"}>
        <p>
          {type === "invite"
            ? `Welcome to FayFort. Choose a password for ${session.user.email || "your team account"}.`
            : `Choose a new password for ${session.user.email || "your account"}.`}
        </p>
        <SetPasswordForm
          submitLabel={type === "invite" ? "Save password" : "Update password"}
          onDone={() => setPasswordSaved(true)}
        />
      </AuthCard>
    );

  if (type === "invite") return <WorkerInvitationAcceptancePage accessToken={session.access_token} />;

  if (recovery)
    return (
      <AuthCard audience={audience} title="Password updated">
        <p role="status">Your password has been changed. Other devices stay signed in until you sign them out.</p>
        <a className="primary-button auth-link-button" href={home || (audience === "staff" ? "/" : "/member/chat")}>
          Continue
        </a>
      </AuthCard>
    );

  if (type === "email_change")
    return (
      <AuthCard audience={audience} title="Email confirmed">
        <p role="status">
          {session.user.new_email
            ? `Almost done: also confirm the link we sent to ${session.user.new_email}.`
            : `Your sign-in email is now ${session.user.email}.`}
        </p>
        <a className="primary-button auth-link-button" href={home || homePathFor(audience)}>
          Continue
        </a>
      </AuthCard>
    );

  return (
    <AuthCard audience={audience} title="Signing you in">
      <p role="status">Your email is confirmed. Taking you to your account…</p>
    </AuthCard>
  );
}
