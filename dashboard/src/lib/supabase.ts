import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * The address as the page first opened, read before supabase-js clears the #… part of an email link.
 * The callback page needs it to explain why a link failed (for example "otp_expired").
 */
export const openedAt: Pick<Location, "pathname" | "search" | "hash"> =
  typeof window === "undefined"
    ? { pathname: "/", search: "", hash: "" }
    : { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };

export const supabaseClient = url && anonKey ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
export const dashboardAuthConfigured = Boolean(url && anonKey);
