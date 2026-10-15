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
};
export type DirectoryType = "market" | "service_provider" | "hotel" | "restaurant";
export type DirectoryRecord = {
  id: string;
  record_type: DirectoryType;
  title: string;
  verified: boolean;
  free: boolean;
  unlocked: boolean;
  public: Record<string, unknown> & { categories?: string[] };
  private?: Record<string, unknown> & {
    contacts?: { contact_name?: string; phone_wechat?: string; floor_or_stall?: string; best_time?: string; verified?: boolean }[];
  };
  method?: string;
  contacts?: ContactStatus;
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
