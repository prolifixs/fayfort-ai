import { FormEvent, useState } from "react";
import { supabaseClient } from "../../lib/supabase";
import { authCallbackUrl, friendlyAuthError, homePathFor, type AuthAudience } from "./authLinks";
import { SetPasswordForm } from "./SetPasswordForm";

/**
 * Password, sign-in email and session controls for the signed-in account.
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
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState("");
  const [emailError, setEmailError] = useState("");
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabaseClient) return;
    setEmailBusy(true);
    setEmailNotice("");
    setEmailError("");
    try {
      const address = newEmail.trim();
      if (address.toLowerCase() === email.toLowerCase()) throw new Error("That is already your sign-in email.");
      const { error } = await supabaseClient.auth.updateUser(
        { email: address },
        { emailRedirectTo: authCallbackUrl(audience, "email_change") },
      );
      if (error) throw error;
      setNewEmail("");
      setEmailNotice(
        `We sent confirmation links to ${email} and ${address}. Your sign-in email changes after both are confirmed.`,
      );
    } catch (reason) {
      setEmailError(friendlyAuthError(reason, "Your email could not be changed."));
    } finally {
      setEmailBusy(false);
    }
  }

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

      <form className="account-security-email" onSubmit={changeEmail} aria-label="Sign-in email change">
        <label htmlFor={`${audience}-new-email`}>Change sign-in email</label>
        <input
          id={`${audience}-new-email`}
          type="email"
          autoComplete="email"
          placeholder="new@example.com"
          required
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
        />
        <button className="secondary-button" disabled={emailBusy}>
          {emailBusy ? "Sending…" : "Send confirmation"}
        </button>
      </form>
      {emailNotice && <p role="status">{emailNotice}</p>}
      {emailError && (
        <p className="form-error" role="alert">
          {emailError}
        </p>
      )}

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
