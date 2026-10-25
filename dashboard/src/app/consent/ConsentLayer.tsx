import { useEffect } from "react";
import { supabaseClient } from "../../lib/supabase";
import { MEMBER_COOKIE, writeCookie } from "../../lib/consent";
import CookieBanner from "./CookieBanner";

/** Cookie banner for app.fayfort.com, and the ff_member flag: once someone signs in here, fayfort.com and the
 * catalog stop showing them visitor popups (web/src/consent/consent.ts). */
export function ConsentLayer() {
  useEffect(() => {
    // Sign-in links (/auth/callback, /worker/accept) handle the session themselves; don't touch it there.
    const path = window.location.pathname;
    if (!supabaseClient || path.startsWith("/auth/") || path === "/worker/accept") return;
    let mounted = true;
    const mark = (signedIn: boolean) => {
      if (mounted && signedIn) writeCookie(MEMBER_COOKIE, "1", 365);
    };
    supabaseClient.auth
      .getSession()
      .then(({ data }) => mark(Boolean(data.session)))
      .catch(() => undefined);
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => mark(Boolean(session)));
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  return <CookieBanner />;
}
