import { OperationsCenterPage } from "./OperationsCenter";
import { MemberThemeRuntime } from "./MemberThemeRuntime";
import { ThemePreviewPage } from "./ThemePreviewPage";
import { dashboardAuthConfigured, supabaseClient } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { WorkerInvitationCallback } from "./staff/WorkerPages";
import { MemberPhotoReviewApp } from "./staff/MemberPhotoReview";
import { MemberRoutePage } from "./member/MemberAccountPages";
import { SetupScreen } from "./SetupScreen";
import { DashboardWorkspace } from "./workspace/DashboardWorkspace";
// Keep last: preserves the original stylesheet cascade order.
import "./member-chat.css";

export function App() {
  if (window.location.pathname === "/operations") return <OperationsCenterPage />;
  if (window.location.pathname === "/platform/themes/preview") return <ThemePreviewPage />;
  if (window.location.pathname === "/worker/accept") return <WorkerInvitationCallback />;
  if (window.location.pathname === "/worker/member-reviews") return <MemberPhotoReviewApp platformAdmin={false} />;
  if (window.location.pathname === "/platform/member-reviews") return <MemberPhotoReviewApp platformAdmin={true} />;
  if (window.location.pathname.startsWith("/member/"))
    return (
      <MemberThemeRuntime>
        <MemberRoutePage />
      </MemberThemeRuntime>
    );
  return <ControlCenterApp />;
}

export function ControlCenterApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

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
    const { error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setAuthError(error.message);
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
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button className="primary-button" disabled={signingIn}>
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="quiet-note">
            <a href="/member/signup">Create a FayFort member account</a>
          </p>
        </section>
      </div>
    );
  return (
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
  );
}

// Re-exported so existing imports from "./App" keep working.
export { DashboardWorkspace } from "./workspace/DashboardWorkspace";
export { WorkerInvitationAcceptancePage, WorkerPasswordResetPage, WorkerProvisioningPage } from "./staff/WorkerPages";
