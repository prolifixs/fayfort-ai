import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShiftControl } from "../ShiftControl";
import { RevenuePanel } from "./RevenuePanel";
import { ConnectionsSection } from "./ConnectionsSection";
import { FreshStart, TimesheetsPanel, type RatingSummary } from "./WorkerTeam";
import { WorkerRatingPrompts } from "../member/WorkerRatingPrompts";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
let routes: Record<string, (init?: RequestInit) => unknown>;
const now = new Date().toISOString();

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((path) => url.startsWith(path));
    return key ? ok(routes[key](init)) : ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

describe("clock in and out", () => {
  it("clocks in, then shows the running shift with break and clock out", async () => {
    let shift: unknown = null;
    routes["/workers/me/shift/clock-in"] = () => (shift = { id: "s1", worker_id: "w", started_at: now, ended_at: null, on_break: false, on_break_since: null, break_seconds: 0, worked_seconds: 3720, ended_by: null, note: null, flag: null }, { shift, today_seconds: 3720, week_seconds: 9000, server_time: now });
    routes["/workers/me/shift/clock-out"] = () => ((shift = null), { shift: null, today_seconds: 3720, week_seconds: 9000, server_time: now });
    routes["/workers/me/shift"] = () => ({ shift, today_seconds: 0, week_seconds: 0, server_time: now });
    render(<ShiftControl accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    const on = await screen.findByRole("button", { name: /On shift, 1h 02m/ });
    fireEvent.click(on);
    const pop = screen.getByRole("dialog", { name: "Your shift" });
    expect(within(pop).getByRole("button", { name: "Take a break" })).toBeInTheDocument();
    fireEvent.change(within(pop).getByLabelText("Note for this shift (optional)"), { target: { value: "Packed 6 orders" } });
    fireEvent.click(within(pop).getByRole("button", { name: "Clock out" }));
    expect(await screen.findByRole("button", { name: "Clock in" })).toBeInTheDocument();
    expect(JSON.parse(String(calls("/clock-out")[0][1]?.body))).toEqual({ note: "Packed 6 orders" });
  });

  it("reminds a clocked-out worker who claims work, without blocking", async () => {
    routes["/workers/me/shift"] = () => ({ shift: null, today_seconds: 0, week_seconds: 0, server_time: now });
    render(<ShiftControl accessToken="t" />);
    await screen.findByRole("button", { name: "Clock in" });
    act(() => {
      window.dispatchEvent(new CustomEvent("fayfort:work-claimed"));
    });
    expect(await screen.findByRole("dialog", { name: "Clock in reminder" })).toHaveTextContent("You just claimed work");
  });
});

describe("fresh start explainer", () => {
  const summary: RatingSummary = {
    count: 12, average: 4.6, average_90_days: 4.7, is_new: false, current: 4.8, current_count: 3,
    fresh_start: { every: 20, completed_tasks: 52, resets: 2, last_reset_at: now, tasks_to_go: 8 },
    distribution: {}, monthly: [],
  };
  it("tells workers how it works and how far they are", () => {
    render(<FreshStart summary={summary} audience="worker" />);
    const note = screen.getByRole("note", { name: "How the fresh start works" });
    expect(note).toHaveTextContent("Fresh start every 20 completed tasks");
    expect(note).toHaveTextContent("back to a perfect 5.0");
    expect(note).toHaveTextContent("8 tasks to the next fresh start");
    expect(note).toHaveTextContent("12 of 20 done · 2 fresh starts so far");
  });
  it("says when it's off", () => {
    render(<FreshStart summary={{ ...summary, fresh_start: { ...summary.fresh_start, every: 0, tasks_to_go: null } }} audience="worker" />);
    expect(screen.getByText(/Fresh start is off/)).toBeInTheDocument();
  });
});

describe("revenue", () => {
  const report = {
    range: { start: "2026-10-01", end: "2026-10-03", bucket: "day", time_zone: "China time" }, currency: "USD",
    tiles: { gross: 569, refunds: 20, net: 549, sales: 3, average_sale: 183, paying_customers: 2, previous_net: 100, change: 4.49, mrr: { amount: 49, members: { standard: 0, pro: 1 } } },
    streams: [{ key: "shop", label: "Shop" }, { key: "sourcing", label: "Sourcing orders" }, { key: "memberships", label: "Memberships" }],
    series: [
      { bucket: "2026-10-01", shop: 100, sourcing: 0, memberships: 0 },
      { bucket: "2026-10-02", shop: 0, sourcing: 400, memberships: 0 },
      { bucket: "2026-10-03", shop: 0, sourcing: 0, memberships: 49 },
    ],
    mix: [
      { key: "shop", label: "Shop", gross: 120, refunds: 20, net: 100, count: 1 },
      { key: "sourcing", label: "Sourcing orders", gross: 400, refunds: 0, net: 400, count: 1 },
      { key: "memberships", label: "Memberships", gross: 49, refunds: 0, net: 49, count: 1 },
    ],
    sources: { shopify: 500, stripe: 49 }, top_products: [{ title: "Body wave wig", revenue: 120, quantity: 1 }],
    countries: [{ country: "Ghana", net: 400 }], other_currencies: { GBP: 30 }, stripe_connected: false, data_since: "2026-10-01T00:00:00Z",
  };
  it("shows the tiles, the chart with a legend, a table view and the Stripe note", async () => {
    routes["/platform/revenue"] = () => report;
    render(<RevenuePanel accessToken="t" />);
    expect(await screen.findByText("$549")).toBeInTheDocument();
    expect(screen.getByText(/449%/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe isn't connected/)).toBeInTheDocument();
    expect(screen.getByText(/30.00 GBP/)).toBeInTheDocument();
    const chart = screen.getByRole("figure", { name: "Net revenue by stream" });
    expect(within(chart).getByRole("list", { name: "Legend" })).toHaveTextContent("Sourcing orders");
    fireEvent.click(within(chart).getByRole("button", { name: "Show as table" }));
    expect(within(chart).getByRole("table")).toHaveTextContent("$400.00");
    fireEvent.click(screen.getByRole("button", { name: "90 days" }));
    await waitFor(() => expect(calls("range=90d").length).toBeGreaterThan(0));
  });
});

describe("connections", () => {
  it("checks and saves a Stripe key without ever showing it again", async () => {
    const status = (connected: boolean) => ({
      shopify: { connected: true, store: "fayfort.myshopify.com", webhooks: true, manage: "Shop" },
      stripe: { connected, ready: connected, mode: connected ? "test" : "not_configured", source: connected ? "connections" : "none", key_hint: connected ? "sk_test_…a1B2" : null, problem: null, saved_at: null, manage: "Billing" },
      email: { connected: true, sending: true, from: "FayFort <updates@fayfort.com>", manage: "Email" },
    });
    routes["/platform/connections/stripe"] = () => status(true);
    routes["/platform/connections"] = () => status(false);
    render(<ConnectionsSection accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Stripe" }));
    const form = screen.getByRole("form", { name: "Connect Stripe" });
    const key = "sk_test_" + "a1B2".repeat(6);
    fireEvent.change(within(form).getByLabelText("Stripe secret key"), { target: { value: key } });
    expect(within(form).getByLabelText("Stripe secret key")).toHaveAttribute("type", "password");
    fireEvent.click(within(form).getByRole("button", { name: "Check and connect" }));
    expect(await screen.findByText(/Stripe is connected in test mode/)).toBeInTheDocument();
    expect(screen.getByText(/key sk_test_…a1B2/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(key);
    expect(JSON.parse(String(calls("/platform/connections/stripe")[0][1]?.body))).toEqual({ secret_key: key });
  });
  it("warns before a live key", async () => {
    routes["/platform/connections"] = () => ({
      shopify: { connected: false, store: null, webhooks: false, manage: "" }, email: { connected: false, sending: false, from: "", manage: "" },
      stripe: { connected: false, ready: false, mode: "not_configured", source: "none", key_hint: null, problem: null, saved_at: null, manage: "" },
    });
    render(<ConnectionsSection accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Stripe" }));
    fireEvent.change(screen.getByLabelText("Stripe secret key"), { target: { value: "sk_live_" + "x".repeat(24) } });
    expect(screen.getByRole("note")).toHaveTextContent("real money");
  });
});

describe("member rates a team member", () => {
  it("rates the chat's helper and can change it", async () => {
    routes["/members/worker-ratings"] = (init) =>
      init?.method === "POST" ? { rated: true } : {
        prompts: [
          { id: "p1", title: "Wig question", kind: "chat", conversation_id: "c1", request_id: null, worker: { first_name: "Ada", photo_url: null }, rating: null },
          { id: "p2", title: "Other chat", kind: "chat", conversation_id: "c2", request_id: null, worker: { first_name: "Tolu", photo_url: null }, rating: null },
        ],
      };
    render(<WorkerRatingPrompts accessToken="t" conversationId="c1" kind="chat" />);
    const card = await screen.findByRole("article", { name: "Rate Ada's help" });
    expect(screen.queryByRole("article", { name: "Rate Tolu's help" })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("radio", { name: "4 stars, Good" }));
    fireEvent.change(within(card).getByLabelText("Comment (optional)"), { target: { value: "Quick and kind" } });
    fireEvent.click(within(card).getByRole("button", { name: "Send" }));
    expect(await within(card).findByText("Thanks for rating Ada")).toBeInTheDocument();
    const post = calls("/members/worker-ratings").find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ prompt_id: "p1", stars: 4, comment: "Quick and kind" });
  });
});

describe("timesheets", () => {
  it("lists hours by day and approves a correction", async () => {
    routes["/platform/workforce/corrections/"] = () => ({ status: "approved" });
    routes["/platform/workforce/timesheets"] = () => ({
      start: "2026-10-19", days: ["2026-10-19", "2026-10-20"],
      workers: [{ user_id: "w1", name: "Ada Okafor", photo_url: null, days: { "2026-10-19": 9000, "2026-10-20": 0 }, total_seconds: 9000, on_shift: true, on_break: false, shifts: [] }],
      on_shift_now: [{ id: "s", worker_id: "w1", name: "Ada Okafor", started_at: now, ended_at: null, on_break: false, on_break_since: null, break_seconds: 0, worked_seconds: 60, ended_by: null, note: null, flag: null }],
      corrections: [{ id: "c1", shift_id: "s0", previous_started_at: now, previous_ended_at: now, proposed_started_at: now, proposed_ended_at: now, reason: "Forgot to clock out", created_at: now, worker: { name: "Ada Okafor" } }],
      coverage: [{ weekday: 0, hour: 10, covered: 1 }, { weekday: 0, hour: 11, covered: 0 }],
      support_hours: { days: "Mon-Sat", start: "09:30", end: "18:30", time_zone: "China time" },
    });
    render(<TimesheetsPanel accessToken="t" />);
    await screen.findByText("Ada Okafor", { selector: ".team-sheet-name span" , exact: false }).catch(() => undefined);
    const sheet = (await screen.findAllByRole("table")).find((table) => table.classList.contains("team-sheet"))!;
    expect(within(sheet).getByText("2h 30m", { selector: "td.team-sheet-total" })).toBeInTheDocument();
    expect(within(sheet).getByText("On shift")).toBeInTheDocument();
    expect(screen.getByLabelText("Mon 11: nobody on shift")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls("/platform/workforce/corrections/c1").length).toBe(1));
    expect(JSON.parse(String(calls("/platform/workforce/corrections/c1")[0][1]?.body))).toEqual({ decision: "approve" });
  });
});
