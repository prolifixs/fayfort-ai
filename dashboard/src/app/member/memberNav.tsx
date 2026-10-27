import type { MemberPanel } from "./memberRoutes";

/**
 * Member menu, in the order the owner approved (docs/UI_FACELIFT_PLAN.md, 27 Oct 2026). One line-icon family:
 * 24px grid, drawn with the shell's 1.75 stroke. `tour` is the anchor the member tour points at.
 */
export type NavItem = { panel: MemberPanel; label: string; short?: string; icon: string; tour?: string };

const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  chats: "M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.4-3.5A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z",
  shop: "M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8zM9 8V7a3 3 0 0 1 6 0v1",
  finds: "M12 3l2.2 5.6L20 9.3l-4.4 3.8L17 19l-5-3.1L7 19l1.4-5.9L4 9.3l5.8-.7z",
  orders: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  saved: "M6 4h12v16l-6-4-6 4z",
  tools: "M4 7h16v13H4zM8 3v4M16 3v4M4 11h16M8 15h3",
  membership: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z",
  notifications: "M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  more: "M4 7h16M4 12h16M4 17h16",
};

export const MEMBER_NAV: NavItem[] = [
  { panel: "home", label: "Home", icon: ICONS.home, tour: "home" },
  { panel: "chat", label: "Chats", icon: ICONS.chats, tour: "chats-nav" },
  { panel: "catalog", label: "Shop", icon: ICONS.shop, tour: "browse" },
  { panel: "finds", label: "Finds", icon: ICONS.finds, tour: "finds" },
  { panel: "requests", label: "Orders & requests", short: "Orders", icon: ICONS.orders, tour: "requests" },
  { panel: "saved", label: "Saved", icon: ICONS.saved, tour: "saved" },
  { panel: "tools", label: "Bookings & tools", short: "Tools", icon: ICONS.tools, tour: "directory" },
];

export const MEMBER_ACCOUNT_NAV: NavItem[] = [
  { panel: "membership", label: "Membership", icon: ICONS.membership },
  { panel: "settings", label: "Settings", icon: ICONS.settings },
  { panel: "notifications", label: "Notifications", icon: ICONS.notifications },
];

/** Phone tab bar: Home, Chats, Shop, Orders and More (opens the full menu, where Finds, Saved and the rest are). */
export const MEMBER_TABS: (NavItem | { panel: "more"; label: string; icon: string })[] = [
  MEMBER_NAV[0],
  MEMBER_NAV[1],
  MEMBER_NAV[2],
  MEMBER_NAV[4],
  { panel: "more", label: "More", icon: ICONS.more },
];

export function NavIcon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={d} />
    </svg>
  );
}
