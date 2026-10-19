import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShiftGate } from "./ShiftGate";
import { ShiftControl } from "./ShiftControl";
import { CustomerWorkspace } from "./workspace/WorkspaceDataPage";
import { AnalyticsPage } from "./workspace/AnalyticsPage";
import { CommercePage } from "./staff/CommercePage";
import { PageHelp } from "./staff/PageHelp";
import { ThemeStudioPage } from "./ThemeStudioPage";

vi.mock("../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
let routes: (url: string, init?: RequestInit) => unknown;

beforeEach(() => {
  localStorage.clear();
  routes = () => ({});
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const data = routes(String(input), init);
    return data instanceof Response ? data : ok(data);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const offShift = { shift: null, today_seconds: 3600, week_seconds: 7200, server_time: "2026-10-19T08:00:00Z" };
const onShift = {
  shift: { id: "s1", started_at: "2026-10-19T08:00:00Z", ended_at: null, worked_seconds: 60, break_seconds: 0, on_break: false },
  today_seconds: 3660,
  week_seconds: 7260,
  server_time: "2026-10-19T08:01:00Z",
};

describe("clock in before using the dashboards", () => {
  it("keeps a worker out until they clock in, and closes again on clock-out", async () => {
    let state: unknown = offShift;
    routes = (url, init) => {
      if (url.endsWith("/workers/me/shift/clock-in") && init?.method === "POST") return (state = onShift);
      if (url.endsWith("/workers/me/shift/clock-out") && init?.method === "POST") return (state = offShift);
      if (url.endsWith("/workers/me/shift")) return state;
      return {};
    };
    render(
      <ShiftGate accessToken="t" required>
        <ShiftControl accessToken="t" />
        <p>Control Center page</p>
      </ShiftGate>,
    );
    expect(await screen.findByRole("heading", { name: "Clock in to start" })).toBeInTheDocument();
    expect(screen.queryByText("Control Center page")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    expect(await screen.findByText("Control Center page")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /On shift/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clock out" }));
    expect(await screen.findByRole("heading", { name: "Clock in to start" })).toBeInTheDocument();
  });

  it("never gates administrators, and doesn't lock anyone out of an older API", async () => {
    routes = () => offShift;
    const { unmount } = render(
      <ShiftGate accessToken="t" required={false}>
        <p>Admin page</p>
      </ShiftGate>,
    );
    expect(screen.getByText("Admin page")).toBeInTheDocument();
    unmount();
    routes = () => new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    render(
      <ShiftGate accessToken="t" required>
        <p>Worker page</p>
      </ShiftGate>,
    );
    expect(await screen.findByText("Worker page")).toBeInTheDocument();
  });
});

describe("Customers shows every chat", () => {
  it("reads a chat the AI handled alone right on the customer page", async () => {
    routes = (url) => {
      if (url.includes("/customers/c1"))
        return {
          customer: { id: "c1", channel: "instagram", external_customer_id: "ig-1", profile: { name: "Ada" }, updated_at: "2026-10-18T10:00:00Z" },
          conversations: [{ id: "conv1", channel: "instagram", status: "open", summary: "Asked about wigs", created_at: "2026-10-18T10:00:00Z", last_message_at: "2026-10-18T10:05:00Z" }],
          requests: [],
        };
      if (url.includes("/conversations/conv1/messages"))
        return {
          messages: [
            { id: "m1", sender_type: "customer", content: "Do you have 22 inch body wave?", created_at: "2026-10-18T10:00:00Z" },
            { id: "m2", sender_type: "ai", content: "Yes, here are two options.", created_at: "2026-10-18T10:01:00Z" },
          ],
        };
      return {};
    };
    const openConversation = vi.fn();
    render(
      <CustomerWorkspace
        customers={[{ id: "c1", channel: "instagram", external_customer_id: "ig-1", profile: { name: "Ada" }, updated_at: "2026-10-18T10:00:00Z" } as never]}
        accessToken="t"
        businessId="b1"
        setActive={() => undefined}
        openConversation={openConversation}
        openRequest={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ada/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Read chat" }));
    const thread = await screen.findByRole("region", { name: "Chat on Instagram" });
    expect(within(thread).getByText("Do you have 22 inch body wave?")).toBeInTheDocument();
    expect(within(thread).getByText("Yes, here are two options.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in Conversations to reply" }));
    expect(openConversation).toHaveBeenCalledWith(expect.objectContaining({ id: "conv1" }));
  });
});

describe("analytics charts", () => {
  it("shows headline numbers, the budget and the charts", async () => {
    const day = (bucket: string, values: Record<string, number>) => ({ bucket, ...values });
    routes = (url) => {
      if (url.includes("/analytics/charts"))
        return {
          days: 7, bucket: "day", start: "", end: "", truncated: false,
          totals: { conversations: { value: 12, change: 0.5 }, handoffs: { value: 3, change: -0.25 }, events: { value: 40, change: null },
            messages: { value: 30 }, ai_calls: { value: 55, change: null }, ai_cost_usd: { value: 0.0125 } },
          groups: [{ key: "messages", label: "Messages" }, { key: "handoffs", label: "Handoffs" }],
          activity: [day("2026-10-18", { messages: 10, handoffs: 1 }), day("2026-10-19", { messages: 20, handoffs: 2 })],
          channels: ["instagram"],
          conversations: [day("2026-10-18", { instagram: 5 }), day("2026-10-19", { instagram: 7 })],
          handoffs: { series: [{ bucket: "2026-10-18", requested: 1 }, { bucket: "2026-10-19", requested: 2 }], by_status: { returned: 2, requested: 1 } },
          ai: { series: [{ bucket: "2026-10-18", calls: 20, tokens: 2000, cost_usd: 0.005 }, { bucket: "2026-10-19", calls: 35, tokens: 3000, cost_usd: 0.0075 }],
            by_operation: [{ operation: "response", calls: 40, tokens: 4000, cost_usd: 0.01 }] },
          top_events: [{ event_type: "channel.inbound.processed", label: "Messages received", count: 30 }],
        };
      if (url.includes("/ai-usage"))
        return { days: 7, sampled_requests: 0, summary_truncated: false, reported_usage_requests: 0, unknown_usage_requests: 0, prompt_tokens: 0,
          completion_tokens: 0, total_tokens: 0, source_messages: 0, message_call_distribution: {}, operations: {}, models: {}, providers: {},
          budget: { limit_usd: 25, committed_usd: 20, pending_usd: 3, remaining_usd: 2, month_start: "2026-10-01" } };
      if (url.includes("/analytics?")) return { days: 7, sampled_events: 0, summary_truncated: false, event_counts: {}, events: [], has_more: false, next_before_id: null };
      return {};
    };
    render(<AnalyticsPage accessToken="t" businessId="b1" />);
    const tiles = await screen.findByLabelText("Headline numbers");
    expect(within(tiles).getByText("Conversations started").parentElement).toHaveTextContent("12▲ 50% vs before");
    expect(within(tiles).getByText("Handed to a person").parentElement).toHaveTextContent("▼ 25%");
    expect(screen.getByRole("meter", { name: "AI budget used" })).toHaveAttribute("aria-valuenow", "92");
    expect(screen.getByText(/Nearly used up/)).toBeInTheDocument();
    for (const title of ["Activity", "New conversations", "Handed to a person", "AI model calls", "What the AI was doing", "Handoff outcomes", "Most common events"])
      expect(screen.getByRole("figure", { name: title })).toBeInTheDocument();
    expect(screen.getByText("Writing replies")).toBeInTheDocument();
    expect(screen.getByText("Returned to the AI")).toBeInTheDocument();
  });
});

describe("guides and what next", () => {
  it("opens a page guide the first time, then remembers it was seen", () => {
    const { unmount } = render(<PageHelp id="Human Agents" />);
    expect(screen.getByRole("button", { name: /How this works/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Return to automation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /How this works/ }));
    unmount();
    render(<PageHelp id="Human Agents" />);
    expect(screen.getByRole("button", { name: /How this works/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("tells staff what to do next with each giveaway, and picks prizes by name", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const giveaway = { prize_text: "Wig", winner_count: 1, draw_seed: null, winners: [] };
    routes = (url) => {
      if (url.includes("/platform/commerce/giveaways"))
        return {
          giveaways: [
            { ...giveaway, id: "g1", title: "Ended one", status: "open", starts_at: past, ends_at: past, entries: 4 },
            { ...giveaway, id: "g2", title: "Live one", status: "open", starts_at: past, ends_at: future, entries: 2 },
            { ...giveaway, id: "g3", title: "Drawn one", status: "drawn", starts_at: past, ends_at: past, entries: 9, draw_seed: "abc",
              winners: [{ member_id: "m1", rank: 1, prize_code: null, prize_error: null }] },
          ],
        };
      if (url.includes("/platform/commerce/products?q=wig"))
        return { products: [{ id: "p1", name: "Body wave wig 22 inch", price_min: 89, currency: "USD", in_stock: true, active: true }] };
      return {};
    };
    render(<CommercePage accessToken="t" initialTab="giveaways" />);
    expect(await screen.findByText(/It has ended with 4 entries. Press Draw winners/)).toBeInTheDocument();
    expect(screen.getByText(/Running. Members enter from the chat's front page/)).toBeInTheDocument();
    expect(screen.getByText(/1 winner's prize must be arranged by hand/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "How this page works" })).toHaveTextContent("Draw the winners");
    fireEvent.change(screen.getByRole("searchbox", { name: /Prize from the shop/ }), { target: { value: "wig" } });
    fireEvent.click(await screen.findByRole("option", { name: /Body wave wig 22 inch/ }));
    expect(within(screen.getByRole("list", { name: "Chosen products" })).getByText("Body wave wig 22 inch")).toBeInTheDocument();
  });

  it("points Member plans at Infrastructure → Connections when Stripe isn't connected", async () => {
    routes = (url) => (url.includes("/platform/billing/status") ? { configured: false } : {});
    render(<CommercePage accessToken="t" initialTab="billing" />);
    expect(await screen.findByText(/Go to Infrastructure → Connections and paste the Stripe secret key/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Infrastructure" })).toHaveAttribute("href", "/?page=infrastructure");
  });
});

describe("theme fonts", () => {
  it("offers pink palettes and a text font, and saves the font with the draft", async () => {
    const colors = { page_background: "#FFFFFF", surface: "#F7F9FA", text: "#17212B", muted_text: "#526170", accent: "#005A9C", accent_foreground: "#FFFFFF", border: "#637180", focus: "#005A9C" };
    routes = (url) =>
      url.endsWith("/platform/themes")
        ? { themes: [{ theme_id: "girl-boss", display_name: "Girl Boss", description: null, draft_display_name: "Girl Boss", draft_description: null, status: "draft",
            requires_paid: true, is_builtin: false, draft_revision: 1, published_revision: null, published: null,
            draft: { revision: 1, palette_preset: "ocean-blue", wrapper_style: "soft", colors } }] }
        : {};
    render(<ThemeStudioPage accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: /Girl Boss/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Starting palette" }), { target: { value: "girl-boss-pink" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Text font" }), { target: { value: "poppins" } });
    expect(document.getElementById("fayfort-font-poppins")).not.toBeNull();
    expect(screen.getByLabelText("Generated theme preview")).toHaveStyle({ fontFamily: '"Poppins", system-ui, sans-serif' });
    fireEvent.click(screen.getByRole("button", { name: "Save new draft revision" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/platform/themes/girl-boss/draft"))).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes("/platform/themes/girl-boss/draft"))!;
    const body = JSON.parse(String(init.body));
    expect(body.design.font_family).toBe("poppins");
    expect(body.design.colors.accent).toBe("#D6247A");
    expect(body.design.palette_preset).toBe("girl-boss-pink");
  });
});

describe("theme tone", () => {
  it("treats navy and charcoal as dark, blush and white as light", async () => {
    const { themeTone } = await import("./themeTone");
    expect(themeTone("#0B1A33")).toBe("dark");
    expect(themeTone("#161718")).toBe("dark");
    expect(themeTone("#FFF4F8")).toBe("light");
    expect(themeTone("#FFFFFF")).toBe("light");
  });
});
