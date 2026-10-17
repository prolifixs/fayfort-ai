// Carries a conversation from FayFort AI on www.fayfort.com into the member chat (website chat, owner decision 2).
// The website's Join free / Sign in links carry ?site_chat=<code>. The code is kept in this browser and, on sign-up,
// in the new account's sign-up details, so it still works if the verification email opens in another browser.
import type { Session } from "@supabase/supabase-js";
import { apiRequest } from "../../lib/api";

const KEY = "ff_site_chat_code";
const CODE = /^[A-Za-z0-9_-]{16,64}$/;

function stored(): string {
  try {
    return window.localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

/** Reads ?site_chat= from the address (once), keeps it and tidies the address. Returns the pending code, if any. */
export function rememberSiteChatCode(): string {
  const url = new URL(window.location.href);
  const fromLink = url.searchParams.get("site_chat") || "";
  if (fromLink) {
    url.searchParams.delete("site_chat");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    if (CODE.test(fromLink)) {
      try {
        window.localStorage.setItem(KEY, fromLink);
      } catch {
        /* Private windows: the sign-up details still carry it. */
      }
      return fromLink;
    }
  }
  return stored();
}

function forget() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Copies a pending website chat into the member's chats. Returns the new chat's id, or null. */
export async function claimPendingSiteChat(accessToken: string, session: Session | null): Promise<string | null> {
  const code = stored();
  const fromSignUp = String((session?.user?.user_metadata as Record<string, unknown> | undefined)?.site_chat_code || "");
  if (!code && !fromSignUp) return null;
  try {
    const result = await apiRequest<{ conversation_id: string | null }>("/members/site-chat/claim", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(code ? { code } : {}),
    });
    forget();
    return result.conversation_id || null;
  } catch {
    // Keep the code for the next visit; the chat itself still opens.
    return null;
  }
}
