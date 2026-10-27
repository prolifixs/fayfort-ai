import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsultationCard, DirectoryPanel } from "./MemberPerks";
import { MemberAccountDialogs } from "./MemberAccountDialogs";
import { PlanBilling } from "./PlanBilling";
import { type ContactStatus, depositNote, type MemberPlanSummary } from "./membershipApi";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
const contacts: ContactStatus = {
  tier: "free",
  credits: 0,
  pro_allowance_left: 0,
  pro_allowance: 0,
  packs: [
    { id: "single", credits: 1, price: 15, currency: "USD" },
    { id: "pack5", credits: 5, price: 50, currency: "USD" },
  ],
};
const market = {
  id: "m1",
  record_type: "market",
  title: "Guangzhou Hair Market",
  verified: true,
  free: false,
  unlocked: false,
  public: { place_name: "Guangzhou Hair Market", city: "Guangzhou", categories: ["Wigs"] },
};
const plan: MemberPlanSummary = {
  tier: "free",
  deposit: { rate: 0.5, reason: "free_rate" },
  consultation: { tier: "free", price: 100, currency: "USD", included: false, included_left: 0, full_price: 100 },
  contacts,
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("member plan perks", () => {
  it("explains the deposit for each plan", () => {
    expect(depositNote(plan, 300)).toMatch(/50% deposit \(about \$150\).*counts toward your order/);
    expect(depositNote({ ...plan, deposit: { rate: 0, reason: "pro_good_standing" } })).toMatch(/No deposit/);
  });

  it("keeps supplier details locked until bought, then shows them", async () => {
    let credits = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/members/directory?")) return ok({ results: [market], contacts: { ...contacts, credits } });
      if (url.endsWith("/members/contact-credits"))
        return ok({ invoice: { id: "i1", invoice_url: "https://shop.example/i/1", amount: 50, currency: "USD", status: "sent" } }, 201);
      if (url.endsWith("/members/directory/unlock")) {
        if (!credits) return ok({ detail: "You have no contact credits left. Buy a contact to unlock it." }, 402);
        return ok({
          record: {
            ...market,
            unlocked: true,
            private: { address_en: "12 Wig Road", contacts: [{ contact_name: "Ms Li", phone_wechat: "wx-li" }] },
            contacts: { ...contacts, credits: credits - 1 },
          },
        });
      }
      return ok({});
    });
    render(<DirectoryPanel accessToken="t" />);
    const list = await screen.findByRole("list");
    expect(within(list).getByText("Guangzhou Hair Market")).toBeInTheDocument();
    expect(screen.queryByText("12 Wig Road")).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText(/no contact credits left/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "5 contacts · $50" }));
    expect(await screen.findByRole("link", { name: "Pay $50" })).toHaveAttribute("href", "https://shop.example/i/1");
    credits = 5;
    fireEvent.click(within(list).getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("12 Wig Road")).toBeInTheDocument();
    expect(screen.getByText("wx-li")).toBeInTheDocument();
  });

  it("LANDED owners see the address free and others can claim with their order number", async () => {
    let owner = false;
    const claims: unknown[] = [];
    const landedStatus = () => ({ owner, order_name: owner ? "#1001" : null, snapshot_date: "25 October 2026",
      baserow_closes: "30 November 2026", includes: "" });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/members/landed/claim")) {
        claims.push(JSON.parse(String(init?.body)));
        owner = true;
        return ok(landedStatus());
      }
      if (url.endsWith("/members/landed")) return ok(landedStatus());
      if (url.includes("/members/directory?"))
        return ok({
          results: [owner ? { ...market, verified: false, verification: "unknown", landed: true, private: { address_en: "12 Wig Road" } }
            : { ...market, verified: false, verification: "unknown" }],
          contacts,
        });
      return ok({});
    });
    render(<DirectoryPanel accessToken="t" />);
    const list = await screen.findByRole("list");
    expect(within(list).getByText("Not yet confirmed")).toBeInTheDocument();
    expect(screen.queryByText("12 Wig Road")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Claim your access" }));
    fireEvent.change(screen.getByLabelText("Order number"), { target: { value: "#1001" } });
    fireEvent.change(screen.getByLabelText("Purchase email"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim access" }));
    expect(await screen.findByText(/LANDED owner · order #1001/)).toBeInTheDocument();
    expect(claims).toEqual([{ order_name: "#1001", email: "me@example.com" }]);
    expect(await screen.findByText("12 Wig Road")).toBeInTheDocument();
    expect(screen.getByText("Free with LANDED")).toBeInTheDocument();
    expect(screen.getByText("Stall and contact details are locked.")).toBeInTheDocument();
  });

  it("books a paid consultation and shows the payment link", async () => {
    const booked: unknown[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/members/consultations") && init?.method === "POST") {
        booked.push(JSON.parse(String(init.body)));
        return ok({ consultation: { id: "c1" } }, 201);
      }
      if (url.includes("/members/bookings/slots"))
        return ok({ available: true, host: { name: "Fay", job_title: "CEO" }, message: null,
          rules: { minutes: 60, cancel_cutoff_hours: 24, hold_hours: 24 },
          slots: [{ starts_at: "2026-11-04T06:00:00+00:00", ends_at: "2026-11-04T07:00:00+00:00" },
                  { starts_at: "2026-11-05T06:00:00+00:00", ends_at: "2026-11-05T07:00:00+00:00" }] });
      if (url.endsWith("/members/consultations"))
        return ok({
          consultations: booked.length
            ? [{ id: "c1", topic: "Wig suppliers", status: "awaiting_payment", price: 100, currency: "USD", invoice_url: "https://shop.example/i/2", conversation_id: null }]
            : [],
        });
      return ok({});
    });
    const onChange = vi.fn();
    render(<ConsultationCard accessToken="t" plan={plan} onChange={onChange} />);
    expect(screen.getByText("$100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book a consultation" }));
    fireEvent.change(screen.getByLabelText("What would you like to discuss?"), { target: { value: "Wig suppliers" } });
    const book = screen.getByRole("button", { name: "Book · $100" });
    expect(book).toBeDisabled();
    const times = await screen.findByLabelText("Time");
    fireEvent.click(within(times).getAllByRole("button")[0]);
    expect(book).toBeEnabled();
    expect(screen.getByText(/We hold this time for 24 hours/)).toBeInTheDocument();
    fireEvent.click(book);
    expect(await screen.findByRole("link", { name: "Pay $100" })).toHaveAttribute("href", "https://shop.example/i/2");
    expect(booked).toEqual([{ topic: "Wig suppliers", starts_at: "2026-11-04T06:00:00+00:00", time_zone: expect.any(String) }]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("books without a time while booking times aren't open, and moves a booked time", async () => {
    const posted: { url: string; body: unknown }[] = [];
    const booking = { id: "b1", starts_at: "2026-11-04T06:00:00+00:00", ends_at: "2026-11-04T07:00:00+00:00", status: "confirmed",
      hold_expires_at: null, call_link: null, refund: null, reschedule_count: 0, can_change: true, change_note: null };
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        return ok({ consultation: { id: "c2" }, booking }, 201);
      }
      if (url.includes("/members/bookings/slots"))
        return ok({ available: true, host: null, message: null, rules: { minutes: 60, cancel_cutoff_hours: 24, hold_hours: 24 },
          slots: [{ starts_at: "2026-11-06T06:00:00+00:00", ends_at: "2026-11-06T07:00:00+00:00" }] });
      if (url.endsWith("/members/consultations"))
        return ok({ consultations: [{ id: "c1", topic: "Wigs", status: "scheduled", price: 100, currency: "USD", conversation_id: "k1", booking }] });
      return ok({});
    });
    render(<ConsultationCard accessToken="t" plan={plan} onChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change time" }));
    const times = await screen.findByLabelText("Time");
    fireEvent.click(within(times).getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^Move to/ }));
    await waitFor(() => expect(posted[0]).toEqual({ url: expect.stringContaining("/members/bookings/b1/move"), body: { starts_at: "2026-11-06T06:00:00+00:00" } }));
    expect(await screen.findByText(/was moved/)).toBeInTheDocument();
    cleanup();

    posted.length = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        return ok({ consultation: { id: "c3" } }, 201);
      }
      if (url.includes("/members/bookings/slots"))
        return ok({ available: false, host: null, slots: [], message: "Booking times open soon.", rules: { minutes: 60, cancel_cutoff_hours: 24, hold_hours: 24 } });
      return ok({ consultations: [] });
    });
    render(<ConsultationCard accessToken="t" plan={plan} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Book a consultation" }));
    fireEvent.change(screen.getByLabelText("What would you like to discuss?"), { target: { value: "Shipping" } });
    expect(await screen.findByText("Booking times open soon.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book · $100" }));
    await waitFor(() => expect(posted[0]?.body).toEqual({ topic: "Shipping" }));
  });

  it("shows rank progress and spends points on a contact credit", async () => {
    const status = (balance: number) => ({
      rank: 2, subrank: 1, name: "Scout", step: 6, score: 295, balance, window_days: 90, current_at: 250,
      next: { rank: 2, subrank: 2, name: "Scout", at: 350 }, grace: { below: false, ends_at: null, days: 30 },
      ranks: [], earn: [{ kind: "order", label: "Paid order", points: "50 + 1 per $1 (up to 250 per order)" }],
      rewards: [{ id: "contact_credit", label: "1 supplier contact credit", cost: 500, credits: 1 }],
      perks: [{ rank: 4, label: "Standard rates on the Free plan", active: false }],
      recent: [{ kind: "order", label: "Paid order", points: 170, occurred_at: "2026-10-14T00:00:00Z" }],
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/members/points/redeem") && init?.method === "POST") return ok(status(100));
      if (url.endsWith("/members/rank")) return ok(status(600));
      return ok({});
    });
    const profile = { rank_level: 2, subrank: 1, member_tier: "free", points_balance: 0 };
    const view = render(
      <MemberAccountDialogs kind="tier" profile={profile} onClose={() => {}} onOpen={() => {}} settings={null} accessToken="t" />,
    );
    expect(await screen.findByText(/55 more for Scout 2/)).toBeInTheDocument();
    expect(screen.getByText("From Insider")).toBeInTheDocument();
    view.unmount();
    render(<MemberAccountDialogs kind="points" profile={profile} onClose={() => {}} onOpen={() => {}} settings={null} accessToken="t" />);
    expect(await screen.findByText("600")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(await screen.findByText("100")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 supplier contact credit added");
  });

  it("sends members to Stripe to subscribe, and lets subscribers manage or pause", async () => {
    const view = {
      available: true, plan: null, status: "none", paused: false, current_period_end: null, cancel_at_period_end: false,
      continuous_since: null, months: 0, has_customer: false, max_pause_months: 3,
      prices: { standard: { monthly: 19, currency: "usd" }, pro: { monthly: 49, currency: "usd" } },
    };
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const posted: string[] = [];
    let current: Record<string, unknown> = view;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") posted.push(url.replace(/^.*\/members/, "/members") + " " + (init.body || ""));
      if (url.endsWith("/members/subscription/checkout")) return ok({ url: "https://checkout.stripe.com/c/pay/cs_1" });
      if (url.endsWith("/members/subscription/pause")) return ok({ ...current, paused: true, plan: "pro" });
      if (url.endsWith("/members/subscription")) return ok(current);
      return ok({});
    });
    const first = render(<PlanBilling accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Get Pro · $49/month" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1"));
    expect(posted[0]).toContain('{"plan":"pro","interval":"month"}');
    first.unmount();
    current = { ...view, plan: "pro", status: "active", current_period_end: "2026-11-15T00:00:00Z", months: 2, has_customer: true };
    render(<PlanBilling accessToken="t" />);
    expect(await screen.findByText(/2 months in a row/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause instead of cancelling" }));
    expect(await screen.findByRole("button", { name: "Resume my plan" })).toBeInTheDocument();
  });

  it("offers yearly at twelve times the monthly price", async () => {
    const view = {
      available: true, yearly_available: true, plan: null, status: "none", paused: false, current_period_end: null,
      cancel_at_period_end: false, continuous_since: null, months: 0, has_customer: false, max_pause_months: 3,
      prices: { standard: { monthly: 5.99, yearly: 71.88, currency: "usd" }, pro: { monthly: 14.99, yearly: 179.88, currency: "usd" } },
    };
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const posted: string[] = [];
    let current: Record<string, unknown> = view;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") posted.push(String(init.body || ""));
      if (url.endsWith("/members/subscription/checkout")) return ok({ url: "https://checkout.stripe.com/c/pay/cs_2" });
      if (url.endsWith("/members/subscription")) return ok(current);
      return ok({});
    });
    const first = render(<PlanBilling accessToken="t" />);
    expect(await screen.findByRole("button", { name: "Get Standard · $5.99/month" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Yearly"));
    expect(screen.getByText(/12 months paid at once at the same price/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get Standard · $71.88/year" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_2"));
    expect(posted[0]).toBe('{"plan":"standard","interval":"year"}');
    first.unmount();
    current = { ...view, plan: "pro", status: "active", interval: "year", current_period_end: "2027-10-26T00:00:00Z", months: 1, has_customer: true, first_month: true };
    render(<PlanBilling accessToken="t" />);
    expect(await screen.findByText("$179.88/year")).toBeInTheDocument();
    expect(screen.queryByText(/First paid month/)).toBeNull();
    expect(screen.getByText(/renew every month of your year/)).toBeInTheDocument();
  });
});
