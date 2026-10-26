import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiRequest } from "../../lib/api";
import { supabaseClient } from "../../lib/supabase";
import { rememberReturn } from "../../lib/returnTo";
import { AuthPage } from "../auth/AuthPage";
import { BrandMark, FayfortLoader } from "../brand/FayfortLogo";

/**
 * /staff/join?token=… (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md §8): someone with an account accepts a staff invitation.
 * Signed out: they sign in first and come back here. Signed in as the invited account: Accept makes them staff, then
 * the Control Center asks them to set up two-step verification.
 */
type Invitation = {
  email_hint: string | null;
  role_label: string;
  job_title: string | null;
  invited_by: string | null;
  expired: boolean;
};

export function StaffJoinPage() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") || "");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This invitation link is incomplete. Open it again from the email.");
      return;
    }
    apiRequest<{ invitation: Invitation }>(`/staff/invitations/${encodeURIComponent(token)}`, "")
      .then((result) => setInvitation(result.invitation))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This invitation could not be checked."));
  }, [token]);

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

  function signIn() {
    rememberReturn(`/staff/join?token=${encodeURIComponent(token)}`);
    window.location.assign("/member/account");
  }

  async function signOut() {
    rememberReturn(`/staff/join?token=${encodeURIComponent(token)}`);
    await supabaseClient?.auth.signOut();
    window.location.assign("/member/account");
  }

  async function accept() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ worker: { staff_role: string } }>("/staff/invitations/accept", session.access_token, {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setAccepted(result.worker.staff_role);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invitation could not be accepted.");
    } finally {
      setBusy(false);
    }
  }

  const wrongAccount = error.includes("different account");
  return (
    <AuthPage staff>
      <section className="auth-card staff-join" aria-labelledby="staff-join-title">
        <BrandMark />
        <label>FAYFORT TEAM</label>
        {accepted ? (
          <>
            <h1 id="staff-join-title">You're on the team</h1>
            <p role="status">
              Welcome to FayFort. Open the Control Center: it will ask you to set up two-step verification with an
              authenticator app the first time. Your member account, orders and chats stay as they are.
            </p>
            <a className="primary-button auth-link-button" href="/">
              Open the Control Center
            </a>
          </>
        ) : !invitation && !error ? (
          <FayfortLoader label="Checking your invitation…" />
        ) : !invitation ? (
          <>
            <h1 id="staff-join-title">Invitation not available</h1>
            <p role="alert">{error}</p>
          </>
        ) : (
          <>
            <h1 id="staff-join-title">Join the FayFort team</h1>
            <p>
              {invitation.invited_by ? `${invitation.invited_by} invited you` : "You're invited"} to join as{" "}
              <strong>{invitation.role_label}</strong>
              {invitation.job_title ? ` (${invitation.job_title})` : ""}, using the account you already have.
            </p>
            {invitation.expired ? (
              <p role="alert">This invitation has expired. Ask a FayFort administrator to send a new one.</p>
            ) : session === undefined ? (
              <FayfortLoader label="Checking your sign-in…" />
            ) : !session ? (
              <>
                <p>Sign in with {invitation.email_hint || "the email the invitation was sent to"}, then you'll come back here to accept.</p>
                <button type="button" className="primary-button" onClick={signIn}>
                  Sign in to accept
                </button>
              </>
            ) : (
              <>
                <p>
                  Signed in as <strong>{session.user.email}</strong>.
                </p>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void accept()}>
                  {busy ? "Accepting…" : "Accept invitation"}
                </button>
                {error && <p role="alert">{error}</p>}
                {wrongAccount && (
                  <button type="button" className="secondary-button" onClick={() => void signOut()}>
                    Sign out and use {invitation.email_hint || "the invited account"}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>
    </AuthPage>
  );
}
