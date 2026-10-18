// The four chat tools under the message box. Shared by the toolbar and the tour, so the tour shows the same icons.
import type { ReactNode } from "react";

export type ChatToolKey = "link" | "photo" | "request" | "attach";

export const CHAT_TOOLS: Record<ChatToolKey, { label: string; short: string; tip: string; icon: ReactNode }> = {
  link: {
    label: "Paste a link",
    short: "Link",
    tip: "Copied a TikTok, Instagram or shop link? Tap here and we find that product, or the closest match.",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M9 4h6v3H9z" />
        <path d="M8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16" />
        <path d="M10.5 15.5 13.5 12.5M9.5 13l-.8.8a2 2 0 0 0 2.8 2.8l.8-.8m2.2-2.6.8-.8a2 2 0 0 0-2.8-2.8l-.8.8" />
      </svg>
    ),
  },
  photo: {
    label: "Ask a person to review a photo",
    short: "Photo",
    tip: "Send a photo of a product. A FayFort person tells you what it is and whether we can source it.",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m4 17 5-5 3 3 3-4 5 6" />
      </svg>
    ),
  },
  request: {
    label: "Create a sourcing request",
    short: "Request",
    tip: "Ready to buy? Start a sourcing request: what you want, how many and your budget. We find suppliers and send you options.",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 7.5h14l1 13H4l1-13Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2M12 12v4m-2-2h4" />
      </svg>
    ),
  },
  attach: {
    label: "Link an existing request",
    short: "Attach",
    tip: "Already made a request? Attach this chat to it, so the team sees the conversation with your request. It appears once you have a request.",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M10 13.5 14 9.5" />
        <path d="M8 16H6a4 4 0 0 1 0-8h4m4 0h4a4 4 0 0 1 0 8h-4" />
      </svg>
    ),
  },
};

const VISITS_KEY = "ff_chat_tool_label_visits";
export const LABEL_VISITS = 3;

/** Counts dashboard visits (once per page load) so the tool names show under the icons for the first few. */
export function chatToolLabelsVisible(): boolean {
  try {
    const counted = Number(window.sessionStorage.getItem(VISITS_KEY + "_counted") || 0);
    let visits = Number(window.localStorage.getItem(VISITS_KEY) || 0);
    if (!counted) {
      visits += 1;
      window.localStorage.setItem(VISITS_KEY, String(visits));
      window.sessionStorage.setItem(VISITS_KEY + "_counted", "1");
    }
    return visits <= LABEL_VISITS;
  } catch {
    return false;
  }
}
