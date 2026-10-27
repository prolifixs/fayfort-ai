import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

/** Member plan rules as the API reports them (app/membership/plans.py). */
export type MemberPlanSummary = {
  tier: "free" | "standard" | "pro";
  deposit: { rate: number; reason: string; standing?: { ok: boolean; requests: number; purchases: number } | null };
  consultation: ConsultationQuote;
  contacts: ContactStatus;
};
export type ConsultationQuote = {
  tier: string;
  price: number;
  currency: string;
  included: boolean;
  included_left: number;
  full_price: number;
};
export type ContactPack = { id: "single" | "pack5"; credits: number; price: number; currency: string };
export type ContactStatus = {
  tier: string;
  credits: number;
  pro_allowance_left: number;
  pro_allowance: number;
  packs: ContactPack[];
};
export type Consultation = {
  id: string;
  topic: string;
  plan: string;
  price: number;
  currency: string;
  included: boolean;
  status: "awaiting_payment" | "requested" | "scheduled" | "completed" | "cancelled";
  conversation_id: string | null;
  invoice_url?: string | null;
  created_at: string;
  existing?: boolean;
  booking?: ConsultationBooking | null;
};
export type ConsultationBooking = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: "held" | "confirmed" | "completed" | "no_show" | "cancelled";
  hold_expires_at: string | null;
  call_link: string | null;
  refund: string | null;
  reschedule_count: number;
  can_change?: boolean;
  change_note?: string | null;
};
export type DirectoryType = "market" | "service_provider" | "hotel" | "restaurant";
export type DirectoryRecord = {
  id: string;
  record_type: DirectoryType;
  title: string;
  verified: boolean;
  /** verified | unknown | unverified | conflicting */
  verification?: string;
  free: boolean;
  unlocked: boolean;
  /** LANDED owner: the address is free (part of the LANDED snapshot). */
  landed?: boolean;
  public: Record<string, unknown> & { categories?: string[] };
  private?: Record<string, unknown> & {
    contacts?: { contact_name?: string; phone_wechat?: string; floor_or_stall?: string; best_time?: string; verified?: boolean }[];
  };
  method?: string;
  contacts?: ContactStatus;
};

export type LandedStatus = {
  owner: boolean;
  order_name: string | null;
  snapshot_date: string;
  baserow_closes: string;
  includes: string;
};

export function formatMoney(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function useMemberPlan(accessToken: string | null) {
  const [plan, setPlan] = useState<MemberPlanSummary | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    apiRequest<MemberPlanSummary>("/members/plan", accessToken)
      .then((result) => mounted && setPlan(result && result.deposit && result.consultation && result.contacts ? result : null))
      .catch(() => mounted && setPlan(null));
    return () => {
      mounted = false;
    };
  }, [accessToken, version]);
  return { plan, reload: () => setVersion((v) => v + 1) };
}

/** One line telling the member what deposit their plan pays on a sourcing request. */
export function depositNote(plan: MemberPlanSummary | null, expectedTotal?: number | null): string {
  if (!plan) return "A sourcing deposit may apply. It counts toward your order when you buy.";
  const rate = plan.deposit.rate;
  if (rate === 0) return "No deposit on your Pro plan while you keep buying regularly.";
  const percent = `${Math.round(rate * 100)}%`;
  const amount = expectedTotal && expectedTotal > 0 ? ` (about ${formatMoney(expectedTotal * rate)})` : "";
  return `Your plan pays a ${percent} deposit${amount} once FayFort accepts the request. It counts toward your order; it isn't refunded if you don't buy.`;
}

export const RANK_NAMES: Record<number, string> = { 1: "Browser", 2: "Scout", 3: "Hunter", 4: "Insider", 5: "Founder's Circle" };

/** Rank and points as the API reports them (app/membership/ranks.py). */
export type RankStatus = {
  rank: number;
  subrank: number;
  name: string;
  step: number;
  score: number;
  balance: number;
  window_days: number;
  current_at: number;
  next: { rank: number; subrank: number; name: string; at: number } | null;
  grace: { below: boolean; ends_at: string | null; days: number };
  ranks: { rank: number; name: string; at: number }[];
  earn: { kind: string; label: string; points: string }[];
  rewards: { id: "contact_credit"; label: string; cost: number; credits: number }[];
  perks: { rank: number; label: string; active: boolean }[];
  recent: { kind: string; label: string; points: number; occurred_at: string }[];
};

export function useMemberRank(accessToken: string | null | undefined) {
  const [rank, setRank] = useState<RankStatus | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    apiRequest<RankStatus>("/members/rank", accessToken)
      .then((result) => {
        if (!mounted) return;
        setRank(result && typeof result.score === "number" && Array.isArray(result.earn) ? result : null);
        setError("");
      })
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : "Your rank could not be loaded."));
    return () => {
      mounted = false;
    };
  }, [accessToken, version]);
  return { rank, setRank, error, reload: () => setVersion((v) => v + 1) };
}

/** The member's Stripe subscription (app/billing). */
export type SubscriptionView = {
  available: boolean;
  plan: "standard" | "pro" | null;
  status: string;
  paused: boolean;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  continuous_since: string | null;
  months: number;
  has_customer: boolean;
  prices: Record<"standard" | "pro", { monthly: number; yearly?: number; currency: string }>;
  /** Yearly prices exist in Stripe (12 x monthly, no discount). */
  yearly_available?: boolean;
  /** How the current plan is billed. */
  interval?: "month" | "year";
  max_pause_months: number;
  past_due?: boolean;
  grace_ends?: string | null;
  paused_from?: string | null;
  disputed?: boolean;
  first_month?: boolean;
};

export function useSubscription(accessToken: string | null | undefined) {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    apiRequest<SubscriptionView>("/members/subscription", accessToken)
      .then((result) => mounted && setSubscription(result && result.prices ? result : null))
      .catch(() => mounted && setSubscription(null));
    return () => {
      mounted = false;
    };
  }, [accessToken, version]);
  return { subscription, setSubscription, reload: () => setVersion((v) => v + 1) };
}
