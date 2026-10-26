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
import { StaffJoinPage } from "./staff/StaffJoinPage";
import { MemberAccountPage, MemberRoutePage } from "./member/MemberAccountPages";
import { AuthPage } from "./auth/AuthPage";
import { isPlatformAdmin, landingFor, type Landing } from "./auth/landing";
import { SetupScreen } from "./SetupScreen";
import { DashboardWorkspace } from "./workspace/DashboardWorkspace";
// Member app styles (tokens are loaded first in main.tsx).
import "./member/member.css";
import { FayfortLoader } from "./brand/FayfortLogo";
import { ConsentLayer } from "./consent/ConsentLayer";

/** Every app.fayfort.com page, plus the cookie banner (one choice shared with fayfort.com). */
export function App() {
  return (
    <>
      <AppRoutes />
      <ConsentLayer />
    </>
  );
}

function AppRoutes() {
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
  if (window.location.pathname === "/staff/join") return <StaffJoinPage />;
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
  const [landing, setLanding] = useState<Landing | null>(null);

  useEffect(() => {
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Members who open the Control Center go to their chat; the FayFort team stays (docs/AUTH_PAGES_PLAN.md).
  const userId = session?.user.id;
  useEffect(() => {
    if (!session) {
      setLanding(null);
      return;
    }
    let alive = true;
    void landingFor(session).then((next) => {
      if (!alive) return;
      if (next === "/member/chat") window.location.replace("/member/chat");
      else setLanding(next);
    });
    return () => {
      alive = false;
    };
    // Re-check only when the signed-in account changes, not on every token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function signOut() {
    await supabaseClient?.auth.signOut();
  }

  if (!dashboardAuthConfigured) return <SetupScreen />;
  if (authLoading || (session && !landing))
    return (
      <AuthPage staff>
        <section className="auth-opening" aria-label="Opening FayFort">
          <FayfortLoader size="lg" tone="dark" label="Opening FayFort…" />
        </section>
      </AuthPage>
    );
  // One sign-in for everyone: the same page members use (the old Control Center sign-in is gone).
  if (!session) return <MemberAccountPage />;
  return (
    <StaffMfaGate signedIn email={session.user.email}>
      <DashboardWorkspace
      accessToken={session.access_token}
      signedInEmail={session.user.email || ""}
      platformAdmin={isPlatformAdmin(session)}
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
