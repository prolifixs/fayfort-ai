import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null, openedAt: { pathname: "", search: "", hash: "" } }));

import { OrdersPanel } from "./ShopPanels";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, headers: new Headers() }) as Response;
const event = (id: string, stage: string, note: string | null = null) => ({ id, sequence_no: 1, stage, member_note: note, created_at: "2026-10-12T10:00:00Z" });
const requests = [
  { id: "r-ask", request_title: "[SYNTHETIC ACCEPTANCE] Office chairs", request_description: null, created_at: "2026-10-10T00:00:00Z",
    events: [event("e1", "submitted"), event("e2", "needs_member_input", "Which colour?")] },
  { id: "r-moving", request_title: "Hair dryers", request_description: "Ionic, 50 units", created_at: "2026-10-10T00:00:00Z",
    eta_at: "2026-10-30T00:00:00Z", events: [event("e3", "sourcing")] },
  { id: "r-done", request_title: "Ankara fabric", request_description: null, created_at: "2026-10-01T00:00:00Z", events: [event("e4", "delivered")] },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/members/orders")) return ok({ orders: [], invoices: [], wanted: [] });
    if (url.endsWith("/members/requests")) return ok({ requests });
    if (url.includes("/members/addresses")) return ok({ addresses: [] });
    if (url.includes("/members/products")) return ok({ products: [], saved_product_ids: [], categories: [] });
    if (url.includes("/members/recurring")) return ok({ schedules: [] });
    return ok({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Orders & requests", () => {
  it("puts what needs the member first, with plain words and no test tags", async () => {
    render(<OrdersPanel accessToken="t" />);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    expect(await within(needs).findByText("We have a question about your request")).toBeInTheDocument();
    expect(within(needs).getByText("Office chairs")).toBeInTheDocument();
    expect(screen.queryByText(/SYNTHETIC/)).not.toBeInTheDocument();
    // In progress shows two compact cards; the delivered one waits under Completed.
    expect(screen.getByRole("tab", { name: /In progress\s*2/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Completed\s*1/ })).toBeInTheDocument();
    expect(screen.getByText("Finding suppliers")).toBeInTheDocument();
    expect(screen.getByText(/You'll get options to choose from/)).toBeInTheDocument();
    expect(screen.queryByText("Ankara fabric")).not.toBeInTheDocument();
    // Details stay closed until asked for.
    expect(screen.queryByRole("list", { name: "Update history for Hair dryers" })).not.toBeInTheDocument();
  });

  it("opens the request from Needs you, and the card shows its full detail", async () => {
    render(<OrdersPanel accessToken="t" />);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(await within(needs).findByRole("button", { name: "Answer" }));
    const form = await screen.findByRole("form", { name: /Answer FayFort about/ });
    expect(within(form).getByText(/Which colour/)).toBeInTheDocument();
  });

  it("searches, switches to Completed, and opens the new request form on demand", async () => {
    render(<OrdersPanel accessToken="t" />);
    await screen.findByText("Finding suppliers");
    expect(screen.queryByRole("textbox", { name: "Request title" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search orders and requests" }), { target: { value: "dryer" } });
    expect(screen.getByText("Hair dryers")).toBeInTheDocument();
    expect(screen.queryByText("Office chairs", { selector: ".member-request-summary strong" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search orders and requests" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: /Completed/ }));
    expect(screen.getByText("Ankara fabric")).toBeInTheDocument();
    expect(screen.getByText("Delivered", { selector: ".member-request-pill" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New request" }));
    expect(screen.getByRole("textbox", { name: "Request title" })).toBeInTheDocument();
  });
});
