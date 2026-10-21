/** Store team shapes (docs/CATALOG_MERCHANDISING_PLAN.md), as the API returns them. */

export type ListingMedia = {
  media_type: "image" | "video";
  url: string;
  alt?: string | null;
  source?: "upload" | "url" | "instagram" | "existing" | "trend";
};

export type StoreListing = {
  id: string;
  kind: "store_product" | "sourcing_item";
  kind_label?: string;
  action: "create" | "update";
  status: "draft" | "in_review" | "changes_requested" | "published" | "cancelled" | "failed";
  product_id: string | null;
  shopify_product_id: string | null;
  shopify_admin_url?: string | null;
  trend_item_id: string | null;
  title: string;
  description: string;
  category_ref: string | null;
  option_name: string | null;
  option_values: string[];
  price: number | null;
  compare_at_price: number | null;
  cost: number | null;
  currency: string | null;
  price_guide_min: number | null;
  /** Shop page the item was added from (sourcing items added by link). */
  source_url?: string | null;
  price_guide_max: number | null;
  min_order: number | null;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  availability_status: "available" | "sourcing" | "unavailable";
  media: ListingMedia[];
  planned_live_at: string | null;
  review_note: string | null;
  error: string | null;
  submitted_at: string | null;
  published_at: string | null;
  updated_at: string;
  missing?: string[];
  steps?: { details: boolean; media: boolean; price: boolean };
  channels_published?: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  source: "shopify" | "fayfort";
  shopify_product_id?: string | null;
  shopify_status?: string | null;
  shopify_admin_url?: string | null;
  category_ref: string | null;
  category_needs_mapping?: boolean;
  description?: string;
  availability_status?: string;
  price_min?: number | null;
  price_max?: number | null;
  compare_at_max?: number | null;
  currency?: string | null;
  in_stock?: boolean | null;
  total_inventory?: number | null;
  min_order?: number | null;
  lead_time_min_days?: number | null;
  lead_time_max_days?: number | null;
  active?: boolean;
  media_url?: string | null;
  media_type?: "image" | "video" | null;
  sold_out_since?: string | null;
  retired_at?: string | null;
  created_at?: string;
  state?: "live" | "draft" | "editing" | "in_review" | "sold_out" | "hidden" | "archived" | "retired";
  open_listing_id?: string | null;
};

export type SectionItem = {
  id: string;
  name: string;
  media_url?: string | null;
  media_type?: "image" | "video" | null;
  source?: string;
  price?: number | null;
  currency?: string | null;
  live: boolean;
};

export type StoreSection = {
  id: string;
  title: string;
  hook: string;
  style: "deal" | "trend" | "category";
  accent: "pink" | "navy" | "gold" | "green" | "purple";
  category_ref: string | null;
  starts_at: string;
  ends_at: string | null;
  priority: number;
  min_items: number;
  status: "draft" | "published" | "archived";
  refresh_round?: number;
  items: SectionItem[];
  live_count: number;
  state: "draft" | "scheduled" | "live" | "hidden" | "ended" | "archived";
  suggested_hook?: string;
};

export type CampaignPrep = {
  kind: "giveaway" | "sale";
  source_id: string;
  prize_ready_at?: string | null;
  section_ready_at?: string | null;
  announcement?: string | null;
  ready_at?: string | null;
  ready?: boolean;
};

export type Campaign = {
  id: string;
  title: string;
  description?: string;
  prize_text?: string | null;
  prize_product_id?: string | null;
  discount_type?: string;
  value?: number;
  code?: string | null;
  product_ids?: string[];
  starts_at: string;
  ends_at: string;
  winner_count?: number;
  status?: string;
  drawn_at?: string | null;
};

export type Category = { source_ref: string; category: string; group_name?: string | null; product_type?: string | null };

export type ScheduleEntry = {
  id: string;
  type: "giveaway" | "sale" | "section" | "launch" | "deadline" | "recurring";
  title: string;
  at: string;
  status: "planned" | "scheduled" | "done" | "overdue" | "waiting" | "live";
  href: string;
  detail: string;
  work_item_id: string | null;
  department: string | null;
  worker_id: string | null;
};

export const STATE_LABEL: Record<NonNullable<CatalogProduct["state"]>, string> = {
  live: "Live",
  draft: "Draft in Shopify",
  editing: "Being edited",
  in_review: "Waiting for review",
  sold_out: "Sold out",
  hidden: "Hidden",
  archived: "Archived",
  retired: "Retired",
};

export const LISTING_STATUS_LABEL: Record<StoreListing["status"], string> = {
  draft: "Being prepared",
  in_review: "Waiting for review",
  changes_requested: "Changes asked",
  published: "Published",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const AVAILABILITY_LABEL: Record<StoreListing["availability_status"], string> = {
  sourcing: "Sourced on request",
  available: "Quick to source",
  unavailable: "Not available now",
};

export const SECTION_STATE_LABEL: Record<StoreSection["state"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  hidden: "Hidden: too few live products",
  ended: "Ended",
  archived: "Archived",
};

export function money(amount: number | string | null | undefined, currency?: string | null) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return String(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ""}`.trim();
  }
}

export function leadTime(min?: number | null, max?: number | null) {
  if (min === null && max === null) return "";
  if (min === undefined && max === undefined) return "";
  if (max === null || max === undefined || max === min) return `${min} days`;
  return `${min ?? 0}–${max} days`;
}
