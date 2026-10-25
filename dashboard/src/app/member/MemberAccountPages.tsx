import { AuthPage } from "../auth/AuthPage";
import { landingFor } from "../auth/landing";
import { MemberNotificationsBar, MemberNotificationsPage } from "../MemberNotifications";
import { dashboardAuthConfigured, supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { FormEvent, useEffect, useState } from "react";
import { MemberProductsPage } from "./MemberProductsPage";
import { MemberChatPage } from "./MemberChatPage";
import { SetupScreen } from "../SetupScreen";
import { authCallbackUrl, forgotPasswordPath, friendlyAuthError } from "../auth/authLinks";
import { PasswordFields, passwordPairError, type PasswordPair } from "../auth/PasswordFields";
import { RequestLinkForm } from "../auth/RequestLinkForm";
import { useCaptcha } from "../auth/Turnstile";
import { formatMemberTier } from "./memberShared";
import { MemberSettingsPanel } from "./MemberSettingsPanel";
import { MemberPlanComparison } from "./MemberAccountDialogs";
import { PlanBilling } from "./PlanBilling";
import { BrandMark, FayfortLoader } from "../brand/FayfortLogo";
import { rememberSiteChatCode } from "./siteChatCarryOver";

export function MemberRoutePage() {
  if (window.location.pathname === "/member/notifications") return <MemberNotificationsPage />;
  if (window.location.pathname === "/member/products") return <MemberProductsPage />;
  if (window.location.pathname === "/member/chat" || window.location.pathname === "/member/share") return <MemberChatPage />;
  if (window.location.pathname === "/member/settings") return <MemberSettingsPage />;
  if (window.location.pathname === "/member/membership") return <MemberMembershipPage />;
  // Points and tier are pop-ups in the chat header now; old links land in the chat.
  if (window.location.pathname === "/member/rewards") {
    window.location.replace("/member/chat");
    return null;
  }
  return <MemberAccountPage />;
}

export function MemberAccountPage() {
  // One sign-in for everyone (docs/AUTH_PAGES_PLAN.md): only /member/signup opens in sign-up mode.
  const [mode, setMode] = useState<"signup" | "signin">(
    window.location.pathname === "/member/signup" ? "signup" : "signin",
  );
  // Arriving from FayFort AI on fayfort.com (?site_chat=…): that conversation follows the member into their chat.
  const [siteChatCode] = useState(() => rememberSiteChatCode());
  // Arriving from the LANDED page or the LANDED buyer email (?from=landed).
  const [fromLanded] = useState(() => new URLSearchParams(window.location.search).get("from") === "landed");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState<PasswordPair>({ password: "", confirm: "" });
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha();
  const [socialBusy, setSocialBusy] = useState<"google" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");

  async function loadMemberProfile(token: string, emailAddress?: string | null) {
    setAccessToken(token);
    try {
      const result = await apiRequest<{ profile: Record<string, unknown> }>("/members/me", token);
      setProfile(result.profile);
      setMemberEmail(emailAddress || "");
      setError("");
      setMessage("Your email is verified and your member account is ready.");
      return true;
    } catch (e) {
      setProfile(null);
      setError(e instanceof Error ? e.message : "Member profile could not be loaded.");
      return false;
    }
  }
  useEffect(() => {
    if (!supabaseClient) return;
    const isEmailCallback = window.location.pathname === "/member/account";
    let mounted = true;
    if (isEmailCallback)
      supabaseClient.auth.getSession().then(async ({ data }) => {
        if (mounted && data.session) {
          if ((await landingFor(data.session)) === "/") {
            window.location.assign("/");
            return;
          }
          const loaded = await loadMemberProfile(data.session.access_token, data.session.user.email);
          if (loaded && sessionStorage.getItem("member-settings-return") === "true") {
            sessionStorage.removeItem("member-settings-return");
            window.location.assign("/member/settings");
          }
        }
      });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      if (!next) {
        setProfile(null);
        setMemberEmail("");
        setAccessToken(null);
      } else if (isEmailCallback && next)
        void landingFor(next).then((landing) => {
          if (landing === "/") window.location.assign("/");
          else void loadMemberProfile(next.access_token, next.user.email);
        });
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabaseClient) return;
    setMessage("");
    setError("");
    if (mode === "signup") {
      const problem = passwordPairError(newPassword);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: authError } = await supabaseClient.auth.signUp({
          email: email.trim(),
          password: newPassword.password,
          options: {
            emailRedirectTo: authCallbackUrl("member", "signup"),
            captchaToken: captcha.captchaToken,
            // A conversation started with FayFort AI on fayfort.com follows the new member into their chat.
            data: siteChatCode ? { site_chat_code: siteChatCode } : undefined,
          },
        });
        if (authError) throw authError;
        setNewPassword({ password: "", confirm: "" });
        setAwaitingVerification(true);
        setMessage(
          "Check your email for a verification link. Your member profile is created automatically; verification is required before your account can be used.",
        );
      } else {
        const { data, error: authError } = await supabaseClient.auth.signInWithPassword({
          email: email.trim(),
          password,
          options: { captchaToken: captcha.captchaToken },
        });
        if (authError) throw authError;
        if (data.session) {
          // Staff and business owners continue to the Control Center (two-step verification runs there).
          if ((await landingFor(data.session)) === "/") window.location.assign("/");
          else if (await loadMemberProfile(data.session.access_token, data.user.email)) window.location.assign("/member/chat");
        }
      }
    } catch (e) {
      const text = `${e instanceof Error ? e.message : ""} ${(e as { code?: string })?.code || ""}`.toLowerCase();
      if (text.includes("not confirmed")) setAwaitingVerification(true);
      setError(friendlyAuthError(e, "Could not complete member sign-in."));
    } finally {
      captcha.reset();
      setBusy(false);
    }
  }
  async function startSocialSignIn(provider: "google") {
    if (!supabaseClient) return;
    setSocialBusy(provider);
    setMessage("");
    setError("");
    try {
      const { error: authError } = await supabaseClient.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/member/account` },
      });
      if (authError) throw authError;
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not start ${provider} sign-in.`);
      setSocialBusy(null);
    }
  }
  async function signOut() {
    await supabaseClient?.auth.signOut();
    setProfile(null);
    setMessage("You are signed out.");
  }
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <AuthPage>
      <section className="auth-card">
        <BrandMark />
        <label>{mode === "signup" && !profile ? "FAYFORT MEMBER ACCOUNT" : "FAYFORT ACCOUNT"}</label>
        <h1>{profile ? "Your member account" : mode === "signup" ? "Create your account" : "Sign in"}</h1>
        <p>
          {profile
            ? "Your member identity is separate from business workspaces and staff access."
            : mode === "signup"
              ? "Free to join. Use email and password; we’ll send a verification link before your account is enabled."
              : "Welcome back. Sign in to your FayFort account."}
        </p>
        {siteChatCode && !profile && (
          <p className="quiet-note site-chat-carry-note">Your chat with FayFort AI will be waiting in your FayFort chat.</p>
        )}
        {fromLanded && !profile && (
          <p className="quiet-note landed-signup-note">
            Bought LANDED? Use the email you bought it with and the addresses from your LANDED directory unlock
            automatically. Bought with another email? You can claim your access with your order number once you're in.
          </p>
        )}
        {!profile && (
          <>
            <div className="member-social-auth" aria-label="Social sign-in options">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || socialBusy !== null}
                onClick={() => void startSocialSignIn("google")}
              >
                {socialBusy === "google" ? "Connecting to Google…" : "Continue with Google"}
              </button>
            </div>
            <p className="member-auth-divider">
              <span>or use email</span>
            </p>
            <form onSubmit={submit}>
              <label htmlFor="member-email">Email</label>
              <input
                id="member-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode === "signup" ? (
                <PasswordFields
                  value={newPassword}
                  onChange={setNewPassword}
                  newLabel="Password"
                  confirmLabel="Confirm password"
                />
              ) : (
                <>
                  <label htmlFor="member-password">Password</label>
                  <input
                    id="member-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <a className="auth-inline-link" href={forgotPasswordPath("member")}>
                    Forgot your password?
                  </a>
                </>
              )}
              {captcha.widget}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {message && <p role="status">{message}</p>}
              <button className="primary-button" disabled={busy || socialBusy !== null || !captcha.ready}>
                {busy ? "Please wait…" : mode === "signup" ? "Create member account" : "Sign in"}
              </button>
            </form>
            {awaitingVerification && (
              <details className="auth-resend">
                <summary>Didn't get the verification email?</summary>
                <RequestLinkForm kind="signup" audience="member" initialEmail={email.trim()} />
              </details>
            )}
          </>
        )}
        {profile && (
          <>
            <p role="status">{message}</p>
            <MemberNotificationsBar accessToken={accessToken} />
            <section className="member-profile-summary" aria-label="Member account details">
              <div>
                <small>Email</small>
                <strong>{memberEmail || "Verified account"}</strong>
              </div>
            </section>
            <a className="primary-button member-products-link" href="/member/chat">
              Chat with FayFort
            </a>
            <a className="secondary-button member-products-link" href="/member/products">
              Browse products
            </a>
            <button className="primary-button" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        )}
        {!profile && (
          <p className="quiet-note">
            {mode === "signup" ? "Already registered?" : "Need an account?"}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setMessage("");
                setError("");
                setAwaitingVerification(false);
              }}
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
          </p>
        )}
      </section>
    </AuthPage>
  );
}

export function MemberSettingsPage() {
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <div className="auth-page member-settings-page">
      <section className="auth-card member-settings-card">
        <BrandMark />
        <label>FAYFORT MEMBER</label>
        <h1>Settings</h1>
        <p>Manage your sign-in methods, profile appearance, and membership options.</p>
        <MemberSettingsPanel />
        <a href="/member/chat">Back to chat</a>
      </section>
    </div>
  );
}

export function MemberMembershipPage() {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    if (!supabaseClient) {
      setLoading(false);
      return;
    }
    supabaseClient.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const accessToken = data.session?.access_token || null;
      setToken(accessToken);
      if (accessToken) {
        try {
          const result = await apiRequest<{ profile: Record<string, unknown> }>("/members/me", accessToken);
          if (mounted) setProfile(result.profile);
        } catch (reason) {
          if (mounted) setError(reason instanceof Error ? reason.message : "Membership details could not be loaded.");
        }
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);
  if (!dashboardAuthConfigured) return <SetupScreen />;
  const currentTier = formatMemberTier(profile?.member_tier);
  return (
    <div className="auth-page member-settings-page">
      <section className="auth-card member-membership-card">
        <BrandMark />
        <label>FAYFORT MEMBER</label>
        <h1>Member plans</h1>
        <p>Plans belong to your member account. The internal Client account tools are for FayFort staff only.</p>
        {loading ? (
          <FayfortLoader label="Loading member plan…" />
        ) : !token ? (
          <p role="status">
            Sign in to view your member plan. <a href="/member/account">Member sign in</a>
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {profile && (
              <>
                <p className="member-current-plan" role="status">
                  Your current plan: <strong>{currentTier}</strong>
                </p>
                <MemberPlanComparison currentTier={currentTier} />
                {token && <PlanBilling accessToken={token} />}
              </>
            )}
          </>
        )}
        <a href="/member/settings">Back to settings</a>
        <a href="/member/chat">Back to chat</a>
      </section>
    </div>
  );
}
