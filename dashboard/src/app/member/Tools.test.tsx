import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null, openedAt: { pathname: "", search: "", hash: "" } }));

import { ToolsPanel } from "./ToolsPanel";

const ok = (data: unknown, status = 200) => ({ ok: true, status, json: async () => data, headers: new Headers() }) as Response;
let calls: { url: string; method: string; body?: unknown }[] = [];
let tours: unknown[] = [];

beforeEach(() => {
  calls = [];
  tours = [{ id: "t0", summary: "Yiwu, from 2 Nov 2026 for 2 days, 1 person", city_label: "Yiwu", status: "quoted", quote_amount: 250,
    currency: "USD", invoice_url: "https://shop.example/inv/1", conversation_id: "c7", guide_name: null }];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.endsWith("/members/tours") && method === "POST")
      return ok({ tour: { id: "t1", summary: "Guangzhou, from 1 Dec 2026 for 3 days, 2 people", city_label: "Guangzhou", status: "requested",
        quote_amount: null, currency: "USD", invoice_url: null, conversation_id: "c8", guide_name: null } }, 201);
    if (url.endsWith("/members/tours")) return ok({ tours });
    if (url.includes("/members/tours/calendar")) {
      const days = [];
      for (let d = new Date("2026-11-25T12:00:00Z"); d <= new Date("2026-12-31T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        days.push({ date, state: date < "2026-11-27" ? "too_soon" : date === "2026-12-04" ? "full" : "open" });
      }
      return ok({ days, earliest: "2026-11-27", notice_days: 2 });
    }
    if (url.includes("/members/plan")) return ok({ tier: "free", consultation: { price: 100, currency: "USD", included: false, tier: "free" }, contacts: null });
    if (url.includes("/members/consultations")) return ok({ consultations: [] });
    return ok({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tools", () => {
  it("shows the four tools and opens the tour guide request", async () => {
    render(<ToolsPanel accessToken="t" />);
    const grid = screen.getByRole("navigation", { name: "Choose a tool" });
    for (const name of ["Virtual consultation", "Tour guide in China", "Supplier directory", "Supplier contacts"])
      expect(within(grid).getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    fireEvent.click(within(grid).getByRole("button", { name: /Tour guide in China/ }));
    expect(await screen.findByRole("link", { name: "Pay $250" })).toHaveAttribute("href", "https://shop.example/inv/1");
    fireEvent.click(screen.getByRole("button", { name: "Request a tour guide" }));
    expect(await screen.findByText("November 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nov 26, too soon/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("button", { name: /Dec 4, guides fully booked/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Dec 1$/ }));
    expect(screen.getByRole("button", { name: /Dec 1$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Arriving Tue, Dec 1, guide until Thu, Dec 3/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("People"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Canton Fair"));
    fireEvent.click(screen.getByRole("button", { name: "Request a guide" }));
    expect(await screen.findByText(/Request sent/)).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      city: "guangzhou", arrival_date: "2026-12-01", days: 3, people: 2, needs: ["canton_fair"] }));
  });
});
