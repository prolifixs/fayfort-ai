/**
 * Where to go after signing in, for links that need an account first (a staff invitation, and later a booking slot
 * chosen on fayfort.com). Kept for a day in this browser; only FayFort app paths are accepted.
 */
const KEY = "ff_return_to";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ALLOWED = /^\/(staff\/join|member\/)[^\s]*$/;

export function safeReturnPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  return ALLOWED.test(path) ? path : null;
}

export function rememberReturn(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    /* storage blocked: the person opens the link again after signing in */
  }
}

/** The remembered path (once), or null. */
export function takeReturn(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    window.localStorage.removeItem(KEY);
    const saved = JSON.parse(raw) as { path?: string; at?: number };
    if (!saved.at || Date.now() - saved.at > MAX_AGE_MS) return null;
    return safeReturnPath(saved.path);
  } catch {
    return null;
  }
}
