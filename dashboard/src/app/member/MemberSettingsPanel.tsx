import { FormEvent, useEffect, useState } from "react";
import { memberSoundsEnabled, setMemberSoundsEnabled } from "../memberSound";
import { SoundPicker } from "../SoundPicker";
import "../notifications.css";
import { MemberThemePicker } from "../MemberThemePicker";
import { supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { MemberSecuritySection } from "../auth/MemberSecuritySection";
import { MemberEmailPreferences } from "./MemberEmailPreferences";
import { formatMemberTier } from "./memberShared";
import { AddressBook, ProfileCompletionCard, type ProfileCompletion } from "./accountExtras";
import { FayfortLoader } from "../brand/FayfortLogo";
import { MemberPlanComparison } from "./MemberAccountDialogs";
import { PlanBilling } from "./PlanBilling";
import { useMemberPlan } from "./membershipApi";
import { MemberIdentityForm } from "./MemberIdentity";
import { CookieSettingsLink } from "../consent/CookieBanner";

/**
 * Member settings, in two parts (owner decision, 29 Oct 2026):
 *   part="account"   Account details: profile checklist, profile photo, name, plan and billing.
 *   part="settings"  Settings: privacy, sign-in and security, emails, addresses, theme and sounds.
 */
export function MemberSettingsPanel({
  part = "settings",
  onProfileChange,
  onCompletionChange,
  onPlanChange,
  onOpenSettings,
  onComparePlans,
  focus,
}: {
  part?: "account" | "settings";
  /** Account details: open Settings (for addresses and the phone number). */
  onOpenSettings?: () => void;
  /** Account details: open the full plan comparison on the Membership page. */
  onComparePlans?: () => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  onCompletionChange?: (completion: ProfileCompletion) => void;
  /** Called after a plan change so the chat page can refresh its own copy. */
  onPlanChange?: () => void;
  /** "plan" opens Settings scrolled to the Plan section ("See plans" links, the ad-free ad, back from checkout). */
  focus?: "plan";
}) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<string[]>([]);
  const [accountEmail, setAccountEmail] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [completion, setCompletion] = useState<ProfileCompletion | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(memberSoundsEnabled);
  const { reload: reloadPlan } = useMemberPlan(token);
  function planChanged() {
    reloadPlan();
    onPlanChange?.();
  }
  async function reloadCompletion() {
    if (!token) return;
    try {
      const member = await apiRequest<{ profile: Record<string, unknown>; completion?: ProfileCompletion }>("/members/me", token);
      setCompletion(member.completion || null);
      if (member.completion) onCompletionChange?.(member.completion);
    } catch {
      /* the address book shows its own errors */
    }
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
      setAccountEmail(data.session?.user?.email || "");
      if (accessToken) {
        try {
          const member = await apiRequest<{ profile: Record<string, unknown>; completion?: ProfileCompletion }>("/members/me", accessToken);
          setProfile(member.profile);
          setCompletion(member.completion || null);
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
  useEffect(() => {
    if (profile && onProfileChange) onProfileChange(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  useEffect(() => {
    if (focus !== "plan" || loading) return;
    const timer = window.setTimeout(
      () => document.getElementById("member-settings-plan-section")?.scrollIntoView?.({ behavior: "smooth", block: "start" }),
      60,
    );
    return () => window.clearTimeout(timer);
  }, [focus, loading]);
  if (loading) return <FayfortLoader label="Checking your member sign-in…" />;
  if (!token)
    return (
      <p role="status">
        Sign in to your member account to open settings. <a href="/member/account">Member sign in</a>
      </p>
    );
  if (part === "account")
    return (
      <div className="member-settings-panel member-settings-account">
      <ProfileCompletionCard
        completion={completion}
        onAction={(key) => {
          // The photo is here; addresses and the phone number are in Settings.
          if (key === "photo") document.getElementById("member-settings-photo")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
          else onOpenSettings?.();
        }}
      />
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
      {token && (
        <section className="member-settings-section" aria-labelledby="member-settings-name">
          <h2 id="member-settings-name">Your name</h2>
          <p>Your name and surname help our team know who they're helping. Your username is how you're known around FayFort.</p>
          <MemberIdentityForm
            accessToken={token}
            onSaved={(identity) => {
              setProfile((current) => ({ ...(current || {}), ...identity, identity_complete: true }));
              onProfileChange?.({ ...identity, identity_complete: true });
              void reloadCompletion();
            }}
          />
        </section>
      )}
      <section className="member-settings-section member-settings-plan" aria-labelledby="member-settings-plan" id="member-settings-plan-section">
        <h2 id="member-settings-plan">Plan</h2>
        <p>
          Your plan: <strong>{formatMemberTier(profile?.member_tier)}</strong>. Paid plans lower your sourcing deposit and
          consultation price and add supplier contacts.
        </p>
        {onComparePlans ? (
          <button type="button" className="secondary-button member-settings-compare" onClick={onComparePlans}>
            Compare Free, Standard and Pro
          </button>
        ) : (
          <MemberPlanComparison currentTier={formatMemberTier(profile?.member_tier)} />
        )}
        <PlanBilling accessToken={token} onChange={planChanged} />
      </section>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    );
  return (
    <div className="member-settings-panel">
      <section className="member-settings-section" aria-labelledby="member-settings-privacy">
        <h2 id="member-settings-privacy">Privacy</h2>
        <p>
          Choose which cookies FayFort may use on this browser. <CookieSettingsLink className="text-button" /> ·{" "}
          <a className="text-button" href="https://www.fayfort.com/cookies" target="_blank" rel="noreferrer">
            Cookie policy
          </a>
        </p>
      </section>
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
      <AddressBook accessToken={token} onChange={() => void reloadCompletion()} />
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
        <p>Play a sound when a new chat reply or notification arrives on this device.</p>
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
        <SoundPicker audience="member" disabled={!soundsEnabled} />
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
