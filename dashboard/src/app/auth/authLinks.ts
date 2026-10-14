// Shared helpers for every Supabase Auth email link and OAuth return.
// All links land on /auth/callback; /worker/accept stays as an alias for invitations already sent.

export type AuthAudience = "member" | "staff";
export type AuthLinkType = "signup" | "invite" | "recovery" | "email_change" | "magiclink" | "oauth" | "unknown";

export const PASSWORD_MIN_LENGTH = 10;

export interface AuthCallbackInfo {
  type: AuthLinkType;
  audience: AuthAudience;
  errorCode: string;
  errorDescription: string;
}

const KNOWN_TYPES: AuthLinkType[] = ["signup", "invite", "recovery", "email_change", "magiclink"];

/** Reads the callback URL before supabase-js clears the hash. */
export function parseAuthCallback(location: Pick<Location, "pathname" | "search" | "hash">): AuthCallbackInfo {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const read = (key: string) => hash.get(key) || query.get(key) || "";
  const rawType = read("type");
  let type: AuthLinkType = (KNOWN_TYPES as string[]).includes(rawType) ? (rawType as AuthLinkType) : "unknown";
  if (type === "unknown" && query.get("code")) type = "oauth";
  const rawAudience = query.get("audience");
  const audience: AuthAudience =
    rawAudience === "staff" || rawAudience === "member"
      ? rawAudience
      : location.pathname === "/worker/accept" || type === "invite"
        ? "staff"
        : "member";
  return {
    type,
    audience,
    errorCode: read("error_code") || read("error"),
    errorDescription: read("error_description").replace(/\+/g, " "),
  };
}

/** The redirect every auth email or OAuth flow should use. */
export function authCallbackUrl(audience: AuthAudience, type?: AuthLinkType): string {
  const params = new URLSearchParams({ audience });
  if (type) params.set("type", type);
  return `${window.location.origin}/auth/callback?${params.toString()}`;
}

export function forgotPasswordPath(audience: AuthAudience): string {
  return `/auth/forgot?audience=${audience}`;
}

export function homePathFor(audience: AuthAudience): string {
  return audience === "staff" ? "/" : "/member/account";
}

/** Returns a list of unmet password rules; empty means the password is acceptable. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`At least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Za-z]/.test(password)) problems.push("At least one letter");
  if (!/[0-9]/.test(password)) problems.push("At least one number");
  return problems;
}

/** Plain-language versions of Supabase Auth errors that never reveal whether an account exists. */
export function friendlyAuthError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  const code =
    reason && typeof reason === "object" && "code" in reason ? String((reason as { code?: unknown }).code || "") : "";
  const text = `${code} ${message}`.toLowerCase();
  if (text.includes("invalid login credentials") || text.includes("invalid_credentials"))
    return "That email and password don't match. Check them, or reset your password.";
  if (text.includes("email not confirmed") || text.includes("email_not_confirmed"))
    return "Verify your email first. Use the link we sent, or ask for a new one.";
  if (text.includes("otp_expired") || text.includes("expired"))
    return "This link has expired or was already used. Ask for a new one below.";
  if (text.includes("same_password") || text.includes("different from the old"))
    return "Choose a password you haven't used for this account.";
  if (text.includes("weak_password") || text.includes("password should"))
    return "That password is too weak. Use a longer one with letters and numbers.";
  if (text.includes("captcha")) return "The security check didn't complete. Try again.";
  if (text.includes("rate limit") || text.includes("over_email_send_rate_limit") || text.includes("429"))
    return "Too many attempts. Wait a minute, then try again.";
  return message || fallback;
}
