import { FormEvent, useEffect, useState } from "react";
import { memberSoundsEnabled, setMemberSoundsEnabled } from "../memberSound";
import { MemberThemePicker } from "../MemberThemePicker";
import { supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { MemberSecuritySection } from "../auth/MemberSecuritySection";
import { MemberEmailPreferences } from "./MemberEmailPreferences";
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

/** Member settings: used by the /member/settings page and by the Settings pop-up in the chat header. */
export function MemberSettingsPanel({
  onProfileChange,
  onOpenPlans,
}: {
  onProfileChange?: (profile: Record<string, unknown>) => void;
  onOpenPlans?: () => void;
}) {
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
  useEffect(() => {
    if (profile && onProfileChange) onProfileChange(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  const addressStarted = Boolean(
    shipping.shipping_address_line1 ||
      shipping.shipping_address_line2 ||
      shipping.shipping_city ||
      shipping.shipping_region ||
      shipping.shipping_postal_code ||
      shipping.shipping_country,
  );
  if (loading) return <p role="status">Checking your member sign-in…</p>;
  if (!token)
    return (
      <p role="status">
        Sign in to your member account to open settings. <a href="/member/account">Member sign in</a>
      </p>
    );
  return (
    <div className="member-settings-panel">
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
          Plan upgrades open soon.
        </p>
        {onOpenPlans ? (
          <button type="button" className="secondary-button member-plan-link" onClick={onOpenPlans}>
            Compare member plans
          </button>
        ) : (
          <a className="secondary-button member-plan-link" href="/member/membership">
            View member plans
          </a>
        )}
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
