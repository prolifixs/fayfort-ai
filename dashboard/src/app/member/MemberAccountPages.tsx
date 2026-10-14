import { memberSoundsEnabled, setMemberSoundsEnabled } from "../memberSound";
import { MemberThemePicker } from "../MemberThemePicker";
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
import { MemberSecuritySection } from "../auth/MemberSecuritySection";
import { MemberEmailPreferences } from "./MemberEmailPreferences";
import { useCaptcha } from "../auth/Turnstile";
import {
  type MemberShippingForm,
  emptyMemberShipping,
  formatMemberTier,
  memberCountryOptions,
  memberDialCodes,
  memberDialOptions,
  memberShippingFromProfile,
  splitMemberPhone,
} from "./memberShared";

export function MemberRoutePage() {
  if (window.location.pathname === "/member/notifications") return <MemberNotificationsPage />;
  if (window.location.pathname === "/member/products") return <MemberProductsPage />;
  if (window.location.pathname === "/member/chat") return <MemberChatPage />;
  if (window.location.pathname === "/member/settings") return <MemberSettingsPage />;
  if (window.location.pathname === "/member/membership") return <MemberMembershipPage />;
  if (window.location.pathname === "/member/rewards") return <MemberRewardsPage />;
  return <MemberAccountPage />;
}

export function MemberAccountPage() {
  const [mode, setMode] = useState<"signup" | "signin">(
    window.location.pathname === "/member/account" ? "signin" : "signup",
  );
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
      } else if (isEmailCallback && next) void loadMemberProfile(next.access_token, next.user.email);
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
          options: { emailRedirectTo: authCallbackUrl("member", "signup"), captchaToken: captcha.captchaToken },
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
        if (data.session && (await loadMemberProfile(data.session.access_token, data.user.email)))
          window.location.assign("/member/chat");
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
    <div className="auth-page">
      <section className="auth-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT MEMBER ACCOUNT</label>
        <h1>{profile ? "Your member account" : mode === "signup" ? "Create your account" : "Member sign in"}</h1>
        <p>
          {profile
            ? "Your member identity is separate from business workspaces and staff access."
            : "Use email and password. We’ll send a verification link before member access is enabled."}
        </p>
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
        <a href="/">Return to FayFort Control Center</a>
      </section>
    </div>
  );
}

export function MemberSettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<string[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [shipping, setShipping] = useState<MemberShippingForm>(emptyMemberShipping);
  const [phoneCountry, setPhoneCountry] = useState("US");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(memberSoundsEnabled);
  function hydrateShipping(profileData: Record<string, unknown>) {
    const saved = memberShippingFromProfile(profileData);
    setShipping(saved);
    const parsed = splitMemberPhone(saved.shipping_phone);
    setPhoneLocal(parsed.number);
    setPhoneCountry(parsed.country);
  }
  useEffect(() => {
    let mounted = true;
    const client = supabaseClient;
    if (!client) {
      setLoading(false);
      return;
    }
    client.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const accessToken = data.session?.access_token || null;
      setToken(accessToken);
      setAccountEmail(data.session?.user.email || "");
      if (accessToken) {
        try {
          const member = await apiRequest<{ profile: Record<string, unknown> }>("/members/me", accessToken);
          setProfile(member.profile);
          hydrateShipping(member.profile);
          const { data: identityData, error: identityError } = await client.auth.getUserIdentities();
          if (identityError) throw identityError;
          if (mounted) setProviders((identityData?.identities || []).map((identity) => identity.provider));
        } catch (reason) {
          if (mounted) setError(reason instanceof Error ? reason.message : "Member settings could not be loaded.");
        }
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);
  async function linkGoogle() {
    if (!supabaseClient) return;
    setBusy(true);
    setError("");
    setNotice("Continue in the Google sign-in window to link your account.");
    sessionStorage.setItem("member-settings-return", "true");
    try {
      const { error: authError } = await supabaseClient.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/member/account` },
      });
      if (authError) throw authError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google could not be linked.");
      setBusy(false);
    }
  }
  async function uploadProfilePhoto() {
    if (!token || !photoFile) return;
    if (photoFile.size > 5 * 1024 * 1024) {
      setError("Profile photos must be 5 MiB or smaller.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(photoFile.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    setPhotoBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ profile_photo_url: string }>("/members/me/profile-photo", token, {
        method: "POST",
        body: photoFile,
        headers: { "Content-Type": photoFile.type },
      });
      setProfile((current) => (current ? { ...current, profile_photo_url: result.profile_photo_url } : current));
      setPhotoFile(null);
      setNotice("Profile photo updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile photo could not be uploaded.");
    } finally {
      setPhotoBusy(false);
    }
  }
  async function removeProfilePhoto() {
    if (!token) return;
    setPhotoBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/members/me/profile-photo", token, { method: "DELETE" });
      setProfile((current) => (current ? { ...current, profile_photo_url: null } : current));
      setPhotoFile(null);
      setNotice("Profile photo removed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile photo could not be removed.");
    } finally {
      setPhotoBusy(false);
    }
  }
  async function saveShipping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const dial = memberDialCodes[phoneCountry] || "";
      const phone = phoneLocal.trim()
        ? phoneCountry === "INTL"
          ? phoneLocal.trim()
          : `${dial} ${phoneLocal.trim()}`
        : "";
      const payload = { ...shipping, shipping_phone: phone };
      const result = await apiRequest<{ profile: Record<string, unknown> }>("/members/me", token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setProfile(result.profile);
      hydrateShipping(result.profile);
      setNotice("Shipping details saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shipping details could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function clearShipping() {
    if (!token) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ profile: Record<string, unknown> }>("/members/me", token, {
        method: "PATCH",
        body: JSON.stringify(Object.fromEntries(Object.keys(emptyMemberShipping).map((key) => [key, null]))),
      });
      setProfile(result.profile);
      setShipping(emptyMemberShipping);
      setPhoneCountry("US");
      setPhoneLocal("");
      setNotice("Saved shipping details cleared.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Shipping details could not be cleared.");
    } finally {
      setBusy(false);
    }
  }
  function updateShipping(field: keyof MemberShippingForm, value: string) {
    setShipping((current) => ({ ...current, [field]: value }));
    setNotice("");
  }
  if (!dashboardAuthConfigured) return <SetupScreen />;
  const addressStarted = Boolean(
    shipping.shipping_address_line1 ||
      shipping.shipping_address_line2 ||
      shipping.shipping_city ||
      shipping.shipping_region ||
      shipping.shipping_postal_code ||
      shipping.shipping_country,
  );
  return (
    <div className="auth-page member-settings-page">
      <section className="auth-card member-settings-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT MEMBER</label>
        <h1>Settings</h1>
        <p>Manage your sign-in methods, profile appearance, and membership options.</p>
        {loading ? (
          <p role="status">Checking your member sign-in…</p>
        ) : !token ? (
          <p role="status">
            Sign in to your member account to open settings. <a href="/member/account">Member sign in</a>
          </p>
        ) : (
          <>
            <section className="member-settings-section" aria-labelledby="member-settings-signin">
              <h2 id="member-settings-signin">Sign-in methods</h2>
              <p>Link a provider to keep using the same member profile, saved products, and requests.</p>
              <div className="member-identity-row">
                <strong>Google</strong>
                {providers.includes("google") ? (
                  <span role="status">Connected</span>
                ) : (
                  <button className="secondary-button" disabled={busy} onClick={() => void linkGoogle()}>
                    {busy ? "Connecting…" : "Link Google"}
                  </button>
                )}
              </div>
              <div className="member-identity-row">
                <strong>Email and password</strong>
                <span>{providers.includes("email") ? "Connected" : "Not set up"}</span>
              </div>
            </section>
            <MemberSecuritySection email={accountEmail} hasPassword={providers.includes("email")} />
            <MemberEmailPreferences accessToken={token} />
            <section className="member-settings-section" aria-labelledby="member-settings-photo">
              <h2 id="member-settings-photo">Profile photo</h2>
              <p>
                Upload a JPEG, PNG, or WebP image up to 5 MiB. Your photo is stored privately and shown on your account
                menu.
              </p>
              <div className="member-photo-controls">
                {typeof profile?.profile_photo_url === "string" && (
                  <img className="member-photo-preview" src={profile.profile_photo_url} alt="Current profile" />
                )}
                <label className="member-photo-file-label">
                  Choose photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      setPhotoFile(event.target.files?.[0] || null);
                      setError("");
                      setNotice("");
                    }}
                  />
                </label>
                {photoFile && (
                  <>
                    <small>
                      {photoFile.name} · {(photoFile.size / 1024 / 1024).toFixed(2)} MiB
                    </small>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={photoBusy}
                      onClick={() => void uploadProfilePhoto()}
                    >
                      {photoBusy ? "Uploading…" : "Upload photo"}
                    </button>
                  </>
                )}
                {typeof profile?.profile_photo_url === "string" && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={photoBusy}
                    onClick={() => void removeProfilePhoto()}
                  >
                    {photoBusy ? "Working…" : "Remove photo"}
                  </button>
                )}
              </div>
            </section>
            <section className="member-settings-section" aria-labelledby="member-settings-shipping">
              <h2 id="member-settings-shipping">Phone and shipping address</h2>
              <p>Save contact and address details for shipping. You can edit or clear these details at any time.</p>
              <form className="member-shipping-form" onSubmit={(event) => void saveShipping(event)}>
                <div className="member-phone-field">
                  <span>Phone number</span>
                  <div className="member-phone-input">
                    <select
                      aria-label="Phone country code"
                      autoComplete="tel-country-code"
                      value={phoneCountry}
                      onChange={(event) => {
                        setPhoneCountry(event.target.value);
                        setNotice("");
                      }}
                    >
                      <option value="INTL">International number</option>
                      {memberDialOptions.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name} ({country.dial})
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Phone number"
                      type="tel"
                      autoComplete="tel-national"
                      maxLength={40}
                      value={phoneLocal}
                      onChange={(event) => {
                        setPhoneLocal(event.target.value);
                        setNotice("");
                      }}
                      placeholder="555 123 4567"
                    />
                  </div>
                </div>
                <label>
                  Address line 1
                  <input
                    autoComplete="address-line1"
                    maxLength={160}
                    required={addressStarted}
                    value={shipping.shipping_address_line1}
                    onChange={(event) => updateShipping("shipping_address_line1", event.target.value)}
                    placeholder="Street address"
                  />
                </label>
                <label>
                  Address line 2 <span className="quiet-note">(optional)</span>
                  <input
                    autoComplete="address-line2"
                    maxLength={160}
                    value={shipping.shipping_address_line2}
                    onChange={(event) => updateShipping("shipping_address_line2", event.target.value)}
                    placeholder="Apartment, suite, unit"
                  />
                </label>
                <div className="member-shipping-grid">
                  <label>
                    City or town
                    <input
                      autoComplete="address-level2"
                      maxLength={100}
                      required={addressStarted}
                      value={shipping.shipping_city}
                      onChange={(event) => updateShipping("shipping_city", event.target.value)}
                    />
                  </label>
                  <label>
                    State, province, or region
                    <input
                      autoComplete="address-level1"
                      maxLength={100}
                      value={shipping.shipping_region}
                      onChange={(event) => updateShipping("shipping_region", event.target.value)}
                    />
                  </label>
                </div>
                <div className="member-shipping-grid">
                  <label>
                    ZIP or postal code
                    <input
                      autoComplete="postal-code"
                      maxLength={32}
                      value={shipping.shipping_postal_code}
                      onChange={(event) => updateShipping("shipping_postal_code", event.target.value)}
                    />
                  </label>
                  <label>
                    Country
                    <select
                      autoComplete="country-name"
                      required={addressStarted}
                      value={shipping.shipping_country}
                      onChange={(event) => updateShipping("shipping_country", event.target.value)}
                    >
                      <option value="">Select country</option>
                      {shipping.shipping_country &&
                        !memberCountryOptions.some((country) => country.name === shipping.shipping_country) && (
                          <option value={shipping.shipping_country}>{shipping.shipping_country}</option>
                        )}
                      {memberCountryOptions.map((country) => (
                        <option key={country.code} value={country.name}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="member-shipping-actions">
                  <button className="primary-button" type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save shipping details"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy || !Object.values(shipping).some(Boolean)}
                    onClick={() => void clearShipping()}
                  >
                    Clear saved details
                  </button>
                </div>
              </form>
            </section>
            <section className="member-settings-section" aria-labelledby="member-settings-theme">
              <h2 id="member-settings-theme">Theme</h2>
              <p>
                Saved theme:{" "}
                <strong>
                  {profile
                    ? String(profile.selected_theme || "base") === "base"
                      ? "FayFort base"
                      : String(profile.selected_theme)
                    : "Unavailable"}
                </strong>
                . Preview published themes before applying. Standard and Pro members can apply premium themes.
              </p>
              {token && (
                <MemberThemePicker
                  accessToken={token}
                  onApplied={(themeId) => {
                    setProfile((current) => (current ? { ...current, selected_theme: themeId } : current));
                    setNotice("Theme preference saved.");
                  }}
                />
              )}
            </section>
            <section className="member-settings-section" aria-labelledby="member-settings-sounds">
              <h2 id="member-settings-sounds">Chat and notification sounds</h2>
              <p>Play a soft sound when a new chat reply or notification arrives on this device.</p>
              <label className="member-sound-setting">
                <input
                  type="checkbox"
                  checked={soundsEnabled}
                  onChange={(event) => {
                    setSoundsEnabled(event.target.checked);
                    setMemberSoundsEnabled(event.target.checked);
                  }}
                />
                <span>
                  <strong>Enable sounds</strong>
                  <small>{soundsEnabled ? "Sounds are on for this device." : "Sounds are off for this device."}</small>
                </span>
              </label>
            </section>
            <section className="member-settings-section" aria-labelledby="member-settings-plan">
              <h2 id="member-settings-plan">Membership price tier</h2>
              <p>
                Current member plan: <strong>{profile ? formatMemberTier(profile.member_tier) : "Unavailable"}</strong>.
                Prices and checkout are not available yet.
              </p>
              <a className="secondary-button member-plan-link" href="/member/membership">
                View member plans
              </a>
            </section>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
          </>
        )}
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
        <b className="brand-mark">F</b>
        <label>FAYFORT MEMBER</label>
        <h1>Member plans</h1>
        <p>Plans belong to your member account. The internal Client account tools are for FayFort staff only.</p>
        {loading ? (
          <p role="status">Loading member plan…</p>
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
                <div className="member-plan-list">
                  <article className="member-plan-card">
                    <small>MEMBER PLAN</small>
                    <h2>Free</h2>
                    <p>FayFort base theme and member account features.</p>
                    <strong>{currentTier === "Free" ? "Current plan" : "Available"}</strong>
                  </article>
                  <article className="member-plan-card">
                    <small>MEMBER PLAN</small>
                    <h2>Standard</h2>
                    <p>Premium theme access. Other Standard benefits will be announced later.</p>
                    <strong>{currentTier === "Standard" ? "Current plan" : "Details coming soon"}</strong>
                  </article>
                  <article className="member-plan-card">
                    <small>MEMBER PLAN</small>
                    <h2>Pro</h2>
                    <p>
                      Premium theme access, plus sourcing, consulting, and service-fee waivers when the Pro entitlement
                      and fee system are active.
                    </p>
                    <strong>{currentTier === "Pro" ? "Current plan" : "Details coming soon"}</strong>
                  </article>
                </div>
                <p className="quiet-note">
                  No subscription is being sold or charged here. Plan activation and pricing will be added after billing
                  rules are approved.
                </p>
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

export function MemberRewardsPage() {
  const [view, setView] = useState<"points" | "tier">(() =>
    new URLSearchParams(window.location.search).get("view") === "tier" ? "tier" : "points",
  );
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    if (!supabaseClient) {
      setLoading(false);
      return;
    }
    supabaseClient.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token;
      if (accessToken) {
        try {
          await apiRequest("/members/me", accessToken);
          if (mounted) setSignedIn(true);
        } catch {
          if (mounted) setSignedIn(false);
        }
      }
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);
  function selectView(next: "points" | "tier") {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState({}, "", url);
  }
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <div className="auth-page member-rewards-page">
      <section className="auth-card member-rewards-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT MEMBER</label>
        <h1>Points and tier</h1>
        <div className="member-rewards-tabs" role="tablist" aria-label="Member points and tier">
          <button type="button" role="tab" aria-selected={view === "points"} onClick={() => selectView("points")}>
            Virtual points
          </button>
          <button type="button" role="tab" aria-selected={view === "tier"} onClick={() => selectView("tier")}>
            Member tier
          </button>
        </div>
        {loading ? (
          <p role="status">Checking your member sign-in…</p>
        ) : !signedIn ? (
          <p role="status">
            Sign in to view your member account. <a href="/member/account">Member sign in</a>
          </p>
        ) : (
          <section
            className="member-rewards-blank"
            role="tabpanel"
            aria-label={view === "points" ? "Virtual points details" : "Member tier details"}
          />
        )}
        <a href="/member/chat">Back to chat</a>
      </section>
    </div>
  );
}
