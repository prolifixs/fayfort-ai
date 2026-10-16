import { OperationsCenterPage } from "./OperationsCenter";
import { MemberThemeRuntime } from "./MemberThemeRuntime";
import { ThemePreviewPage } from "./ThemePreviewPage";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { AuthCallbackPage, ForgotPasswordPage } from "./auth/AuthPages";
import { EmailUnsubscribePage } from "./EmailUnsubscribePage";
import { forgotPasswordPath, friendlyAuthError } from "./auth/authLinks";
import { useCaptcha } from "./auth/Turnstile";
import { StaffMfaGate } from "./auth/StaffMfaGate";
import type { ReactNode } from "react";
import { MemberPhotoReviewApp } from "./staff/MemberPhotoReview";
import { MemberRoutePage } from "./member/MemberAccountPages";
import { SetupScreen } from "./SetupScreen";
import { DashboardWorkspace } from "./workspace/DashboardWorkspace";
// Member app styles (tokens are loaded first in main.tsx).
import "./member/member.css";

export function App() {
  if (window.location.pathname === "/operations")
    return (
      <StaffRoute>
        <OperationsCenterPage />
      </StaffRoute>
    );
  if (window.location.pathname === "/platform/themes/preview")
    return (
      <StaffRoute>
        <ThemePreviewPage />
      </StaffRoute>
    );
  if (window.location.pathname === "/auth/callback" || window.location.pathname === "/worker/accept")
    return <AuthCallbackPage />;
  if (window.location.pathname === "/auth/forgot") return <ForgotPasswordPage />;
  if (window.location.pathname === "/email/unsubscribe") return <EmailUnsubscribePage />;
  if (window.location.pathname === "/worker/member-reviews") return <MovedToOperations />;
  if (window.location.pathname === "/platform/member-reviews")
    return (
      <StaffRoute>
        <MemberPhotoReviewApp platformAdmin={true} />
      </StaffRoute>
    );
  if (window.location.pathname.startsWith("/member/"))
    return (
      <MemberThemeRuntime>
        <MemberRoutePage />
      </MemberThemeRuntime>
    );
  return <ControlCenterApp />;
}

/** Staff pages opened directly by URL still require two-step verification when signed in. */
function StaffRoute({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!supabaseClient) {
      setSession(null);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data }) => mounted && setSession(data.session));
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, next) => mounted && setSession(next));
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  if (session === undefined) return null;
  return (
    <StaffMfaGate key={session ? "in" : "out"} signedIn={Boolean(session)} email={session?.user.email}>
      {children}
    </StaffMfaGate>
  );
}

export function ControlCenterApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const captcha = useCaptcha();

  useEffect(() => {
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthError("");
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabaseClient) return;
    setSigningIn(true);
    setAuthError("");
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: email.trim(),
      password,
      options: { captchaToken: captcha.captchaToken },
    });
    if (error) setAuthError(friendlyAuthError(error, "Sign-in failed. Try again."));
    captcha.reset();
    setSigningIn(false);
  }
  async function signOut() {
    await supabaseClient?.auth.signOut();
  }

  if (!dashboardAuthConfigured) return <SetupScreen />;
  if (authLoading)
    return (
      <div className="auth-page">
        <section className="auth-card">
          <b className="brand-mark">F</b>
          <h1>Loading your workspace</h1>
          <p>Checking your FayFort sign-in session.</p>
        </section>
      </div>
    );
  if (!session)
    return (
      <div className="auth-page">
        <section className="auth-card">
          <b className="brand-mark">F</b>
          <label>FAYFORT CONTROL CENTER</label>
          <h1>Sign in</h1>
          <p>Use an active FayFort team account to open internal client accounts.</p>
          <form onSubmit={signIn}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {captcha.widget}
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button className="primary-button" disabled={signingIn || !captcha.ready}>
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="quiet-note">
            <a href={forgotPasswordPath("staff")}>Forgot your password?</a>
          </p>
          <p className="quiet-note">
            <a href="/member/signup">Create a FayFort member account</a>
          </p>
        </section>
      </div>
    );
  return (
    <StaffMfaGate signedIn email={session.user.email}>
      <DashboardWorkspace
      accessToken={session.access_token}
      signedInEmail={session.user.email || ""}
      platformAdmin={
        session.user.app_metadata?.platform_admin === true ||
        session.user.app_metadata?.roles?.includes("platform_admin")
      }
      onSignOut={signOut}
      eventStreaming={import.meta.env.VITE_DASHBOARD_EVENTS_ENABLED !== "false"}
      />
    </StaffMfaGate>
  );
}

// Re-exported so existing imports from "./App" keep working.
export { DashboardWorkspace } from "./workspace/DashboardWorkspace";
export { WorkerInvitationAcceptancePage, WorkerPasswordResetPage, WorkerProvisioningPage } from "./staff/WorkerPages";

/** Photo reviews are Operations Center work items now; old links land there. */
function MovedToOperations() {
  useEffect(() => {
    window.location.replace("/operations");
  }, []);
  return (
    <main className="auth-page">
      <p role="status">
        Photo reviews moved to the <a href="/operations">Operations Center</a>.
      </p>
    </main>
  );
}
