import { useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { friendlyAuthError, homePathFor, type AuthAudience } from "./authLinks";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * Password and session controls for the signed-in account. The sign-in email is shown but can't be changed
 * here (members and staff alike).
 * Used by member Settings and by the staff account panel in the Control Center.
 */
export function AccountSecuritySection({
  audience,
  email,
  hasPassword,
}: {
  audience: AuthAudience;
  email: string;
  hasPassword: boolean;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState("");
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function signOutEverywhere() {
    if (!supabaseClient) return;
    setSignOutBusy(true);
    setSignOutError("");
    const { error } = await supabaseClient.auth.signOut({ scope: "global" });
    if (error) {
      setSignOutError(friendlyAuthError(error, "We couldn't sign out your other devices."));
      setSignOutBusy(false);
      return;
    }
    window.location.assign(homePathFor(audience));
  }

  return (
    <section className="member-settings-section account-security" aria-labelledby={`${audience}-security-heading`}>
      <h2 id={`${audience}-security-heading`}>Security</h2>
      <p>Signed in as {email || "your account"}.</p>

      <div className="member-identity-row">
        <strong>Password</strong>
        <button
          type="button"
          className="secondary-button"
          aria-expanded={passwordOpen}
          onClick={() => {
            setPasswordOpen((open) => !open);
            setPasswordNotice("");
          }}
        >
          {passwordOpen ? "Cancel" : hasPassword ? "Change password" : "Add a password"}
        </button>
      </div>
      {passwordOpen && (
        <SetPasswordForm
          submitLabel={hasPassword ? "Save new password" : "Add password"}
          onDone={() => {
            setPasswordOpen(false);
            setPasswordNotice("Your password has been updated.");
          }}
        />
      )}
      {passwordNotice && <p role="status">{passwordNotice}</p>}

      <div className="member-identity-row account-security-email" aria-label="Sign-in email">
        <div>
          <strong>Sign-in email</strong>
          <small>{email || "Not available"}</small>
        </div>
        <small className="quiet-note">
          {audience === "member"
            ? "Your sign-in email can't be changed here. Message us in chat if you need it changed."
            : "Your sign-in email can't be changed here. Ask a platform administrator if it needs to change."}
        </small>
      </div>

      <div className="member-identity-row">
        <div>
          <strong>Sign out of all devices</strong>
          <small>Ends every session for this account, including this one.</small>
        </div>
        <button type="button" className="secondary-button" disabled={signOutBusy} onClick={() => void signOutEverywhere()}>
          {signOutBusy ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
      {signOutError && (
        <p className="form-error" role="alert">
          {signOutError}
        </p>
      )}
    </section>
  );
}

export function MemberSecuritySection(props: { email: string; hasPassword: boolean }) {
  return <AccountSecuritySection audience="member" {...props} />;
}
