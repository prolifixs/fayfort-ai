import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null, openedAt: { pathname: "", search: "", hash: "" } }));

import { ToursPanel } from "./ToursPanel";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, headers: new Headers() }) as Response;
let calls: { url: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.includes("/operations/tours?"))
      return ok({ needs: { canton_fair: "Canton Fair" }, tours: [{ id: "t1", member_name: "Jordan Mensah", city_label: "Guangzhou",
        summary: "Guangzhou, from 1 Dec 2026 for 3 days, 2 people", arrival_date: "2026-12-01", days: 3, people: 2, needs: ["canton_fair"],
        hotel_area: "Pazhou", whatsapp: "+234 800", notes: null, status: "requested", quote_amount: null, currency: "USD", guide_name: null, work_item_id: "w1" }] });
    return ok({ tour: {} });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Operations tour bookings", () => {
  it("sends a quote for a requested tour", async () => {
    const openWork = vi.fn();
    render(<ToursPanel token="t" onOpenWorkItem={openWork} />);
    expect(await screen.findByText("Jordan Mensah")).toBeInTheDocument();
    expect(screen.getByText("Canton Fair")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Pending completion");
    fireEvent.change(screen.getByLabelText("Quote"), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("button", { name: "Send quote" }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/operations/tours/t1/quote"))?.body).toEqual({ amount: 450, currency: "USD", note: "" }));
    fireEvent.click(screen.getByRole("button", { name: "Open the chat with the member" }));
    expect(openWork).toHaveBeenCalledWith("w1");
  });
});
