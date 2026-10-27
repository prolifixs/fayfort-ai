import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseFile, GiveawaysCard, InvoicesCard } from "./SupportTools";
import type { WorkItem } from "./types";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiRequest: mocks.apiRequest }));
afterEach(() => { cleanup(); mocks.apiRequest.mockReset(); });

const overview = {
  unpaid_days: 3,
  failed_invoices: [{ id: "i2", member_name: "Amaka", title: "Bonnets", amount: 21, currency: "USD", status: "failed", kind: "order", error: "Email bounced", work_item_id: "w7" }],
  unpaid_invoices: [],
  giveaways_to_draw: [{ id: "g1", title: "Wig week", ends_at: "2026-10-26T00:00:00Z", winners: 2, entries: 214, work_item_id: "w8" }],
  giveaways_running: [],
};
const item = { id: "w9", department: "disputes", work_type: "membership_dispute", status: "claimed", assigned_worker_id: "me" } as WorkItem;

describe("Member support cards and the case file", () => {
  it("opens failed invoices and giveaways to draw", () => {
    const open = vi.fn();
    render(<><InvoicesCard data={overview} onOpen={open} /><GiveawaysCard data={overview} onOpen={open} /></>);
    expect(within(screen.getByRole("region", { name: "Invoices" })).getByText(/Didn't send: Email bounced/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "Invoices" })).getByRole("button", { name: "Open" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Giveaways" })).getByRole("button", { name: "Draw" }));
    expect(open.mock.calls).toEqual([["w7"], ["w8"]]);
  });

  it("shows a card dispute with its deadline and the Stripe link", async () => {
    mocks.apiRequest.mockResolvedValue({ case_file: {
      kind: "card_dispute", member: { name: "Tunde", profile: { member_tier: "standard" } }, order: null,
      dispute: { amount: 5.99, currency: "USD", reason: "fraudulent", status: "needs_response", evidence_due_by: "2026-11-03T00:00:00Z" },
      payments: [{ title: "Standard plan", amount: 5.99, currency: "USD", status: "paid", paid_at: "2026-10-01T00:00:00Z", disputed: true }],
      links: [{ label: "Answer it in Stripe", url: "https://dashboard.stripe.com/disputes/dp_1" }], chat: null, chat_locked: true,
    } });
    render(<CaseFile token="t" item={item} />);
    const file = await screen.findByRole("region", { name: "Case file" });
    expect(within(file).getByText("Tunde · Standard plan · card dispute on a membership payment")).toBeInTheDocument();
    expect(within(file).getByText("Fraudulent")).toBeInTheDocument();
    expect(within(file).getByText(/The disputed payment/)).toBeInTheDocument();
    expect(within(file).getByRole("link", { name: /Answer it in Stripe/ })).toHaveAttribute("href", "https://dashboard.stripe.com/disputes/dp_1");
    expect(within(file).getByText("Claim this case to read the member's chat.")).toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/w9/case-file", "t");
  });
});
