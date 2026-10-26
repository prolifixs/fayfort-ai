import { apiRequest } from "../../lib/api";

/** The one product card shape the API returns for chat, rails, browse, cart suggestions and Find It. */
export type ShopCard = {
  id: string;
  name: string;
  description?: string;
  category_ref?: string | null;
  /** Readable category, for example "Dining tables". */
  category_label?: string | null;
  group_name?: string | null;
  source?: "shopify" | "fayfort";
  availability_status?: string;
  in_stock?: boolean | null;
  media_url?: string | null;
  media_type?: "image" | "video" | null;
  price?: number | null;
  price_max?: number | null;
  compare_at_price?: number | null;
  currency?: string;
  sale?: { id: string; title: string; ends_at: string; sale_price: number | null } | null;
  low_stock?: boolean;
  heat?: number;
  saved?: boolean | null;
  buyable?: boolean;
  /** Sourcing items: the price is a from–to guide, never a fixed price. */
  price_guide?: boolean;
  min_order?: number | null;
  lead_time?: { min: number | null; max: number | null } | null;
  held_for_giveaway?: boolean;
  badges?: { key: "discount" | "ending" | "prize" | "ships" | "sourced" | "new"; label: string }[];
};

/** A store section tile on Browse (docs/CATALOG_MERCHANDISING_PLAN.md §4). */
export type StoreSectionTile = {
  id: string;
  title: string;
  hook: string;
  style: "deal" | "trend" | "category";
  accent: "pink" | "navy" | "gold" | "green" | "purple";
  ends_at?: string | null;
  built_in?: "flash_sale" | "new_this_week" | null;
  total: number;
  items: ShopCard[];
};

export type CategoryBarItem = { kind: "group" | "category"; key: string; label: string; count: number; group?: string | null };

export type TrendCard = {
  id: string;
  url: string;
  platform: "tiktok" | "instagram" | "web";
  title: string;
  description?: string | null;
  image_url?: string | null;
  author_name?: string | null;
  site_name?: string | null;
  status: string;
  share_count: number;
  want_count: number;
  pool?: { target: number; price: number | null; currency: string | null; deadline?: string | null; progress: number | null } | null;
  member_wants?: boolean | null;
  linked_product?: ShopCard | null;
};

export type Rail = { key: string; title: string; kind?: "trend"; items: (ShopCard | TrendCard)[] };

export type Giveaway = {
  id: string;
  title: string;
  description: string;
  prize_text: string;
  ends_at: string;
  status: "open" | "drawn";
  entered: boolean;
  won: boolean;
  prize_code?: string | null;
  starts_at?: string;
  winner_count?: number;
  entry_count?: number;
  /** "Amaka O." style names of the winners, once drawn. */
  winners?: string[];
};

export type ShopHome = {
  rails: Rail[];
  giveaways: Giveaway[];
  intent: { active: boolean };
  sections?: StoreSectionTile[];
  category_bar?: CategoryBarItem[];
  /** Shop by category: top-level categories with a cover picture. */
  category_tiles?: CategoryTile[];
};

export type CategoryTile = { key: string; label: string; count: number; image_url: string };

export type FindItResult = {
  kind: "link" | "words";
  query: string;
  link: TrendCard | null;
  exact: ShopCard | null;
  alternatives: ShopCard[];
  source_it: { available: boolean; trend_item_id: string | null; title_hint: string | null };
};

export type CartLine = {
  variant_id: string;
  quantity: number;
  unit_price: number;
  variant_title: string;
  available: boolean;
  image_url?: string | null;
  product: ShopCard;
};

export type Cart = {
  lines: CartLine[];
  subtotal: number;
  currency: string;
  impulse: { pairs_with: ShopCard[]; ending_soon: ShopCard[] };
};

export type ProductDetail = {
  product: ShopCard & { description: string; vendor?: string | null };
  variants: {
    id: string;
    title: string;
    price: number;
    sale_price: number | null;
    compare_at_price: number | null;
    available: boolean;
    options: { name: string; value: string }[];
  }[];
  media: { media_type: "image" | "video"; url: string; preview_url?: string | null; alt?: string | null }[];
  pairs_with: ShopCard[];
};

export function money(value: number | null | undefined, currency = "USD") {
  if (value === null || value === undefined) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function isTrend(item: ShopCard | TrendCard): item is TrendCard {
  return "platform" in item && "want_count" in item;
}

const SESSION_KEY = "fayfort-shop-session";

/** A per-tab shopping session id; intent is read across sessions, so losing it is harmless. */
export function shopSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = (crypto.randomUUID?.() || String(Date.now())).slice(0, 64);
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return "session";
  }
}

type IntentEvent = {
  event_type: "view" | "search" | "category" | "save";
  product_id?: string;
  category_ref?: string;
  query?: string;
};

/** Fire-and-forget intent signals; shopping never waits on them. */
export function trackIntent(accessToken: string, events: IntentEvent[]) {
  if (!events.length) return;
  void apiRequest("/members/shop/events", accessToken, {
    method: "POST",
    body: JSON.stringify({ session_id: shopSessionId(), events }),
  }).catch(() => undefined);
}

export function timeLeft(endsAt: string, now = Date.now()): string {
  const ms = Date.parse(endsAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "Ended";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s left`;
}
