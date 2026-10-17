import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { FayfortLoader } from "../brand/FayfortLogo";

type Preferences = { conversations: boolean; fulfillment: boolean; notifications: boolean; newsletter: boolean };

const ROWS: { key: keyof Preferences; label: string; hint: string }[] = [
  { key: "conversations", label: "Chat replies", hint: "When someone at FayFort replies to you." },
  { key: "fulfillment", label: "Request updates", hint: "Sourcing, purchase, shipping and delivery updates." },
  { key: "notifications", label: "Account notifications", hint: "Photo reviews and recurring request changes." },
  { key: "newsletter", label: "Newsletter", hint: "News and offers from FayFort." },
];

/** Member Settings → Email notifications. */
export function MemberEmailPreferences({ accessToken }: { accessToken: string }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<keyof Preferences | null>(null);
  useEffect(() => {
    let mounted = true;
    apiRequest<{ preferences: Preferences }>("/members/me/email-preferences", accessToken)
      .then((result) => mounted && setPreferences(result.preferences))
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : "Email settings could not be loaded."));
    return () => {
      mounted = false;
    };
  }, [accessToken]);

  async function toggle(key: keyof Preferences) {
    if (!preferences) return;
    setSaving(key);
    setError("");
    try {
      const result = await apiRequest<{ preferences: Preferences }>("/members/me/email-preferences", accessToken, {
        method: "PUT",
        body: JSON.stringify({ [key]: !preferences[key] }),
      });
      setPreferences(result.preferences);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The setting could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="member-settings-section" aria-labelledby="member-settings-email">
      <h2 id="member-settings-email">Email notifications</h2>
      <p>Choose what FayFort emails you about. You'll still see every update in the app.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!preferences && !error && <FayfortLoader label="Loading…" />}
      {preferences &&
        ROWS.map((row) => (
          <label key={row.key} className="member-identity-row member-email-row">
            <span>
              <strong>{row.label}</strong>
              <small>{row.hint}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={`${row.label} emails`}
              checked={preferences[row.key]}
              disabled={saving === row.key}
              onChange={() => void toggle(row.key)}
            />
          </label>
        ))}
    </section>
  );
}
