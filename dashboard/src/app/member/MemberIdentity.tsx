import { FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { BrandMark } from "../brand/FayfortLogo";

/** Name, surname and username (owner rule, 2026-10-19: required before the member app opens). */
export type MemberIdentity = { first_name: string | null; last_name: string | null; username: string | null };
type IdentityResponse = MemberIdentity & { complete: boolean; suggestion?: { first_name: string; last_name: string; username: string } };
type Check = { state: "idle" | "checking" | "ok" | "bad"; message: string };

const USERNAME_SHAPE = /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;
const cleanUsername = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();

/** The form, used by the required card and by Settings → Your name. */
export function MemberIdentityForm({
  accessToken,
  submitLabel = "Save",
  onSaved,
  autoFocus = false,
}: {
  accessToken: string;
  submitLabel?: string;
  onSaved: (identity: MemberIdentity & { display_name: string }) => void;
  autoFocus?: boolean;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [username, setUsername] = useState("");
  const [saved, setSaved] = useState<MemberIdentity | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle", message: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    apiRequest<IdentityResponse>("/members/me/identity", accessToken)
      .then((data) => {
        if (!alive) return;
        setSaved({ first_name: data.first_name, last_name: data.last_name, username: data.username });
        setFirst(data.first_name || data.suggestion?.first_name || "");
        setLast(data.last_name || data.suggestion?.last_name || "");
        setUsername(data.username || data.suggestion?.username || "");
      })
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        if (autoFocus) window.setTimeout(() => firstRef.current?.focus(), 50);
      });
    return () => {
      alive = false;
    };
  }, [accessToken, autoFocus]);
  // Is the username free? Checked as the member types, after a short pause.
  useEffect(() => {
    const value = cleanUsername(username);
    if (!value) return setCheck({ state: "idle", message: "" });
    if (saved?.username && value === saved.username) return setCheck({ state: "ok", message: "This is your username." });
    if (value.length < 3) return setCheck({ state: "bad", message: "At least 3 characters." });
    if (!USERNAME_SHAPE.test(value)) return setCheck({ state: "bad", message: "Letters, numbers, dots or underscores. Start and end with a letter or number." });
    setCheck({ state: "checking", message: "Checking…" });
    let alive = true;
    const timer = window.setTimeout(() => {
      apiRequest<{ available: boolean; reason: string | null }>(`/members/me/username?u=${encodeURIComponent(value)}`, accessToken)
        .then((result) => {
          if (alive) setCheck(result.available ? { state: "ok", message: `@${value} is free.` } : { state: "bad", message: result.reason || "That username is taken." });
        })
        .catch(() => alive && setCheck({ state: "idle", message: "" }));
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [username, accessToken, saved?.username]);
  const ready = first.trim().length > 0 && last.trim().length > 0 && check.state !== "bad" && check.state !== "checking" && cleanUsername(username).length >= 3;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<MemberIdentity & { display_name: string }>("/members/me/identity", accessToken, {
        method: "PUT",
        body: JSON.stringify({ first_name: first, last_name: last, username: cleanUsername(username) }),
      });
      setSaved(result);
      setNotice("Saved.");
      onSaved(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your name couldn't be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="member-identity-form" onSubmit={submit} aria-busy={loading}>
      <div className="member-identity-names">
        <label>
          <span>First name</span>
          <input ref={firstRef} required autoComplete="given-name" maxLength={60} value={first} onChange={(event) => setFirst(event.target.value)} />
        </label>
        <label>
          <span>Surname</span>
          <input required autoComplete="family-name" maxLength={60} value={last} onChange={(event) => setLast(event.target.value)} />
        </label>
      </div>
      <label className="member-identity-username">
        <span>Username</span>
        <span className={`member-identity-handle is-${check.state}`}>
          <b aria-hidden="true">@</b>
          <input
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={21}
            value={username}
            aria-label="Username"
            aria-describedby="member-identity-check"
            onChange={(event) => setUsername(event.target.value.replace(/\s/g, "").toLowerCase())}
          />
        </span>
        <small id="member-identity-check" className={`member-identity-check is-${check.state}`} role="status">
          {check.message || "3 to 20 characters: letters, numbers, dots or underscores."}
        </small>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && <p className="member-identity-saved" role="status">{notice}</p>}
      <button className="primary-button member-identity-submit" disabled={!ready || busy || loading}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

/** The required card: covers the member app until name, surname and username are saved. It can't be closed. */
export function MemberIdentityGate({
  accessToken,
  onDone,
  onSignOut,
}: {
  accessToken: string;
  onDone: (identity: MemberIdentity & { display_name: string }) => void;
  onSignOut?: () => void;
}) {
  return (
    <div className="member-identity-backdrop">
      <section className="member-identity-card" role="dialog" aria-modal="true" aria-labelledby="member-identity-title" aria-describedby="member-identity-why">
        <BrandMark />
        <h2 id="member-identity-title">Tell us who you are</h2>
        <p id="member-identity-why">
          Your name lets our team and suppliers know who they're helping. Your username is how you're known around FayFort. Fill all three to continue.
        </p>
        <MemberIdentityForm accessToken={accessToken} submitLabel="Save and continue" onSaved={onDone} autoFocus />
        {onSignOut && (
          <button type="button" className="member-identity-signout" onClick={onSignOut}>
            Not you? Sign out
          </button>
        )}
      </section>
    </div>
  );
}
