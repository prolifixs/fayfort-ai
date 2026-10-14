import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { supabaseClient } from "../../lib/supabase";
import { SetupScreen } from "../SetupScreen";
import { dashboardAuthConfigured } from "../../lib/supabase";
import { WorkerInvitationAcceptancePage } from "../staff/WorkerPages";
import { friendlyAuthError, homePathFor, parseAuthCallback, type AuthAudience } from "./authLinks";
import { RequestLinkForm } from "./RequestLinkForm";
import { SetPasswordForm } from "./SetPasswordForm";

function AuthCard({ audience, title, children }: { audience: AuthAudience; title: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-card">
        <b className="brand-mark">F</b>
        <label>{audience === "staff" ? "FAYFORT TEAM ACCOUNT" : "FAYFORT MEMBER ACCOUNT"}</label>
        <h1>{title}</h1>
        {children}
      </section>
    </div>
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

/**
 * /auth/callback (and the /worker/accept alias) — finishes every Supabase Auth email link and OAuth return:
 * sign-up verification, worker invitation, password recovery, email change and magic links.
 */
export function AuthCallbackPage() {
  const [info] = useState(() => parseAuthCallback(window.location));
  const [session, setSession] = useState<Session | null | undefined>(info.errorCode ? null : undefined);
  const [recovery, setRecovery] = useState(info.type === "recovery");
  const [passwordSaved, setPasswordSaved] = useState(false);

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

  const { audience, type } = info;
  const settled = session !== undefined;
  const finishesSignIn = !recovery && type !== "invite";

  useEffect(() => {
    // Verification, email change and OAuth returns need no further input: continue to the right home.
    if (settled && session && finishesSignIn && type !== "email_change") window.location.replace(homePathFor(audience));
  }, [settled, session, finishesSignIn, type, audience]);

  if (!dashboardAuthConfigured) return <SetupScreen />;
  if (!settled)
    return (
      <AuthCard audience={audience} title="One moment">
        <p role="status">Checking your link…</p>
      </AuthCard>
    );

  if (!session)
    return (
      <AuthCard audience={audience} title="This link can't be used">
        <p role="alert">
          {info.errorCode
            ? friendlyAuthError(`${info.errorCode} ${info.errorDescription}`, "This link is no longer valid.")
            : "This link has expired or was already used, or it was opened in a different browser."}
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
        <a className="primary-button auth-link-button" href={audience === "staff" ? "/" : "/member/chat"}>
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
        <a className="primary-button auth-link-button" href={homePathFor(audience)}>
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
