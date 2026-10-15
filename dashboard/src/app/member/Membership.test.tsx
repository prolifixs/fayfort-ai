import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsultationCard, DirectoryPanel } from "./MemberPerks";
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

  it("books a paid consultation and shows the payment link", async () => {
    const booked: unknown[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/members/consultations") && init?.method === "POST") {
        booked.push(JSON.parse(String(init.body)));
        return ok({ consultation: { id: "c1" } }, 201);
      }
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
    fireEvent.click(screen.getByRole("button", { name: "Book · $100" }));
    expect(await screen.findByRole("link", { name: "Pay $100" })).toHaveAttribute("href", "https://shop.example/i/2");
    expect(booked).toEqual([{ topic: "Wig suppliers" }]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
