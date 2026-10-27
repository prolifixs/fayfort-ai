/**
 * Member panel addresses (docs/UI_FACELIFT_PLAN.md, phase 2). Every section of the member panel has its own path,
 * and every one of them opens inside the same shell (sidebar, top bar, phone tab bar).
 *
 * Old links keep working: /member/chat?panel=… (emails, notifications and the website still send these),
 * /member/products and /member/rewards. They open the right section and the address is tidied to the new path.
 */

export type MemberPanel =
  | "chat"
  | "catalog"
  | "finds"
  | "saved"
  | "requests"
  | "product"
  | "tools"
  | "settings"
  | "membership"
  | "notifications"
  | "notfound";

/** The path each section lives at. "notfound" keeps whatever address the member typed. */
export const PANEL_PATHS: Record<Exclude<MemberPanel, "notfound">, string> = {
  chat: "/member/chat",
  catalog: "/member/shop",
  finds: "/member/finds",
  saved: "/member/saved",
  requests: "/member/orders",
  product: "/member/product",
  tools: "/member/tools",
  settings: "/member/settings",
  membership: "/member/membership",
  notifications: "/member/notifications",
};

/** Paths that open the sign-in and sign-up page instead of the shell. */
export const MEMBER_AUTH_PATHS = ["/member/account", "/member/signup"];

const PATH_PANELS = new Map(Object.entries(PANEL_PATHS).map(([panel, path]) => [path, panel as MemberPanel]));

// ?panel= values from before the paths existed. "directory" moved into Tools on 2026-10-20.
const LEGACY_PANELS: Record<string, MemberPanel> = {
  catalog: "catalog",
  browse: "catalog",
  shop: "catalog",
  finds: "finds",
  saved: "saved",
  requests: "requests",
  orders: "requests",
  product: "product",
  tools: "tools",
  directory: "tools",
  settings: "settings",
  membership: "membership",
  notifications: "notifications",
};

function trimSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** Which section an address opens. */
export function panelFor(pathname: string, search: string, hash = ""): MemberPanel {
  const path = trimSlash(pathname);
  const params = new URLSearchParams(search);
  if (path === "/member/chat" || path === "/member/share") {
    const legacy = params.get("panel");
    return (legacy && LEGACY_PANELS[legacy]) || "chat";
  }
  if (path === "/member" || path === "/member/rewards") return "chat";
  // The old products page also held requests: its #request-, #review- and #rate- links belong to Orders.
  if (path === "/member/products") {
    if (/^#(request|review|rate)-/.test(hash)) return "requests";
    return params.get("saved") === "true" ? "saved" : "catalog";
  }
  const panel = PATH_PANELS.get(path);
  if (!panel) return "notfound";
  // A product address without a product shows the shop.
  if (panel === "product" && !params.get("product")) return "catalog";
  return panel;
}

/** The tidy address for a section, keeping deep-link details such as ?product=, ?tool=, ?find= and #request-…. */
export function panelHref(panel: MemberPanel, search = "", hash = ""): string {
  if (panel === "notfound") return PANEL_PATHS.chat;
  const params = new URLSearchParams(search);
  params.delete("panel");
  if (panel !== "saved") params.delete("saved");
  if (panel !== "product") params.delete("product");
  const query = params.toString();
  return `${PANEL_PATHS[panel]}${query ? `?${query}` : ""}${hash}`;
}

/** The address to show instead of an old-style one, or null when the current one is already tidy. */
export function canonicalHref(pathname: string, search: string, hash: string): string | null {
  const panel = panelFor(pathname, search, hash);
  if (panel === "notfound") return null;
  // The Android share target keeps its own handling in the chat.
  if (trimSlash(pathname) === "/member/share") return null;
  const next = panelHref(panel, search, hash);
  return next === `${pathname}${search}${hash}` ? null : next;
}

/** True for paths that belong to the member shell (everything under /member/ except sign-in and sign-up). */
export function isShellPath(pathname: string): boolean {
  const path = trimSlash(pathname);
  return (path === "/member" || path.startsWith("/member/")) && !MEMBER_AUTH_PATHS.includes(path);
}
