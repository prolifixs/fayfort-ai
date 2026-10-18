import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { CommercePage } from "../staff/CommercePage";
import { timeLeft } from "./commerceApi";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  dashboardAuthConfigured: true,
  supabaseClient: {
    auth: {
      getSession: authMocks.getSession,
      onAuthStateChange: authMocks.onAuthStateChange,
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }) },
    },
  },
}));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
const soon = new Date(Date.now() + 5 * 3600_000).toISOString();
const wig = {
  id: "p-wig", name: "Body wave wig", category_ref: "hair-wigs", group_name: "Hair", source: "shopify", in_stock: true,
  availability_status: "available", media_url: "https://cdn.example/w.jpg", media_type: "image", price: 120, currency: "USD",
  sale: { id: "s1", title: "Weekend drop", ends_at: soon, sale_price: 96 }, buyable: true, heat: 2,
};
const trend = {
  id: "t1", url: "https://tiktok.com/@hairqueen/video/1", platform: "tiktok", title: "Viral bob wig", image_url: null,
  author_name: "@hairqueen", status: "pooling", share_count: 9, want_count: 7,
  pool: { target: 10, price: 60, currency: "USD", progress: 0.7 }, member_wants: false, linked_product: null,
};
const chat = { id: "chat-1", title: "Wigs", retention_hold: false, created_at: "2026-10-14T00:00:00Z", last_activity_at: "2026-10-14T00:00:00Z" };
let fetchMock: ReturnType<typeof vi.fn>;
let cartLines: unknown[];
let addresses: unknown[];
let paidWith: unknown;
let cancelledConsultation: boolean;
let newMember: boolean;
let tourDone: boolean;
let savedCalls: string[];

beforeEach(() => {
  cartLines = [];
  addresses = [];
  paidWith = null;
  cancelledConsultation = false;
  newMember = false;
  tourDone = false;
  savedCalls = [];
  authMocks.getSession.mockResolvedValue({ data: { session: { access_token: "member-token" } }, error: null });
  authMocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (url.endsWith("/members/me/onboarding")) { tourDone = true; return ok({ onboarding_completed: true }); }
    if (url.endsWith("/members/me")) return ok({ profile: { user_id: "member-1" }, onboarding_completed: newMember ? false : undefined,
      completion: { percent: 40, done: 2, total: 5, address_ready: false, items: [] } });
    if (url.includes("/members/products/p-wig/saved")) { savedCalls.push(method); return ok({ saved: method === "POST" }); }
    if (url.includes("/members/shop/products?") && url.includes("saved_only=true")) return ok({ products: [{ ...wig, saved: true }], total: 1, groups: [], categories: [] });
    if (url.endsWith("/members/conversations")) return ok({ conversations: [chat] });
    if (url.endsWith("/members/requests")) return ok({ requests: [] });
    if (url.includes("/members/conversations/chat-1/messages") && method === "POST")
      return ok({
        member_message: { id: "m1", sender_type: "member", content: "https://tiktok.com/@hairqueen/video/1", related_product_ids: [], created_at: "2026-10-14T00:00:01Z" },
        assistant_message: { id: "m2", sender_type: "assistant", content: "Here's what I found for that video.", related_product_ids: ["p-wig"], created_at: "2026-10-14T00:00:02Z" },
        products: [wig],
        find_it: { kind: "link", query: "viral bob wig", link: { ...trend, status: "open", pool: null }, exact: null, alternatives: [wig], source_it: { available: true, trend_item_id: "t1", title_hint: "Viral bob wig" } },
      }, 201);
    if (url.includes("/members/conversations/chat-1/messages")) return ok({ messages: [], products: [] });
    if (url.endsWith("/members/shop/home"))
      return ok({ rails: [{ key: "ending_soon", title: "Ending soon", items: [wig] }, { key: "almost_sourced", title: "Almost sourced", kind: "trend", items: [trend] }], giveaways: [{ id: "g1", title: "Wig giveaway", description: "", prize_text: "A wig", ends_at: soon, status: "open", entered: false, won: false }], intent: { active: false } });
    if (url.endsWith("/members/cart/lines") && method === "PUT") {
      cartLines = [{ variant_id: "v1", quantity: 1, unit_price: 96, variant_title: "22 inch", available: true, product: wig }];
      return ok({ lines: cartLines, subtotal: 96, currency: "USD", impulse: { pairs_with: [], ending_soon: [] } });
    }
    if (url.endsWith("/members/cart/checkout")) return ok({ checkout_url: "https://fayfort.myshopify.com/cart/c/1" });
    if (url.endsWith("/members/cart")) return ok({ lines: cartLines, subtotal: 0, currency: "USD", impulse: { pairs_with: [], ending_soon: [] } });
    if (url.includes("/members/shop/products/p-wig"))
      return ok({ product: { ...wig, description: "Soft body wave." }, variants: [{ id: "v1", title: "22 inch", price: 120, sale_price: 96, compare_at_price: null, available: true, options: [] }], media: [{ media_type: "image", url: "https://cdn.example/w.jpg" }], pairs_with: [] });
    if (url.includes("/members/find-it/t1/want")) return ok({ request_id: "r1", want_count: 8 }, 201);
    if (url.includes("/members/giveaways/g1/enter")) return ok({ entered: true }, 201);
    if (url.endsWith("/members/orders"))
      return ok({ orders: [{ id: "o1", order_name: "#1001", source: "storefront", financial_status: "paid", fulfillment_status: "fulfilled", cancelled_at: null, total: 96, currency: "USD", line_items: [{ title: "Body wave wig", quantity: 1 }], tracking: [{ company: "DHL", number: "TRK1", url: "https://dhl.example/TRK1" }], status_url: "https://fayfort.myshopify.com/s/1", placed_at: "2026-10-14T00:00:00Z" }], invoices: [{ id: "i1", kind: "order", title: "Lace closure", amount: 45, currency: "USD", quantity: 1, invoice_url: "https://fayfort.myshopify.com/i/1", status: "sent", sent_at: null, paid_at: null }, { id: "i2", kind: "consultation", title: "FayFort consultation", amount: 100, currency: "USD", quantity: 1, invoice_url: "https://fayfort.myshopify.com/i/2", status: "sent", sent_at: null, paid_at: null }], wanted: [] });
    if (url.endsWith("/members/addresses") && init?.method === "POST") {
      addresses = [{ id: "a1", label: "Home", recipient_name: null, phone: null, line1: "12 Allen Avenue", line2: null, city: "Ikeja", region: null, postal_code: null, country: "Nigeria", is_default: true }];
      return ok({ addresses });
    }
    if (url.endsWith("/members/addresses")) return ok({ addresses, max: 2 });
    if (url.endsWith("/members/invoices/i1/pay")) { paidWith = JSON.parse(String(init?.body)); return ok({ invoice_url: "https://fayfort.myshopify.com/i/1" }); }
    if (url.endsWith("/members/invoices/i2/cancel")) { cancelledConsultation = true; return ok({ status: "cancelled" }); }
    if (url.includes("/members/shop/events")) return ok({ recorded: 1 }, 202);
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  sessionStorage.clear();
});

describe("shop inside the chat shell", () => {
  it("shows Hot rails and giveaways on the welcome screen and enters a giveaway", async () => {
    window.history.replaceState({}, "", "/member/chat");
    render(<App />);
    const rail = await screen.findByRole("region", { name: "Ending soon" });
    expect(within(rail).getByText("Body wave wig")).toBeInTheDocument();
    expect(within(rail).getByText(/\$96\.00/)).toBeInTheDocument();
    expect(within(rail).getByText(/left$/)).toBeInTheDocument();
    const pool = screen.getByRole("region", { name: "Almost sourced" });
    expect(within(pool).getByRole("progressbar", { name: "Pool progress" })).toHaveAttribute("aria-valuenow", "7");
    fireEvent.click(within(screen.getByRole("region", { name: "Giveaways" })).getByRole("button", { name: "Enter" }));
    expect(await screen.findByText("You're entered. Good luck!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "You're in" })).toBeDisabled();
  });

  it("turns a pasted link into Find It tiers and Source it joins the pool", async () => {
    window.history.replaceState({}, "", "/member/chat");
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Message FayFort" });
    fireEvent.change(input, { target: { value: "https://tiktok.com/@hairqueen/video/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const results = await screen.findByRole("region", { name: "Find It results" });
    expect(within(results).getByText("Not in the FayFort store yet.")).toBeInTheDocument();
    expect(within(results).getByText("Get something similar today")).toBeInTheDocument();
    fireEvent.click(within(results).getByRole("button", { name: "Source it" }));
    expect(await screen.findByText(/FayFort will source it for you/)).toBeInTheDocument();
    const want = fetchMock.mock.calls.find(([url]) => String(url).includes("/members/find-it/t1/want"));
    expect(JSON.parse(String(want?.[1]?.body))).toHaveProperty("session_id");
    expect(within(results).getByRole("button", { name: "You want this" })).toBeDisabled();
  });

  it("opens a product beside the chat, adds to cart and checks out on Shopify", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, pathname: "/member/chat", search: "" });
    window.history.replaceState({}, "", "/member/chat");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Body wave wig" }));
    const panel = await screen.findByRole("region", { name: "Product details" });
    expect(within(panel).getByRole("heading", { name: "Body wave wig" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Member product discovery chat" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Add to cart" }));
    expect(await within(panel).findByText("Added to your cart.")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/members/shop/events"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Cart, 1 item" }));
    const drawer = screen.getByRole("dialog", { name: "Your cart" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://fayfort.myshopify.com/cart/c/1"));
  });

  it("shows invoices to pay and store orders in Orders & requests", async () => {
    window.history.replaceState({}, "", "/member/chat?panel=requests");
    render(<App />);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const due = await within(needs).findByRole("region", { name: "Invoices to pay" });
    expect(within(due).getAllByRole("button", { name: "Pay invoice" })).toHaveLength(2);
    // A shipped order is finished: it lives under Completed.
    expect(screen.queryByRole("region", { name: "Shop orders in progress" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Completed/ }));
    const orders = screen.getByRole("region", { name: "Completed shop orders" });
    expect(within(orders).getByText(/#1001 · Shipped/)).toBeInTheDocument();
    expect(within(orders).getByRole("link", { name: "TRK1" })).toHaveAttribute("href", "https://dhl.example/TRK1");
  });

  it("asks for a delivery address before paying an order invoice", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    window.history.replaceState({}, "", "/member/chat?panel=requests");
    render(<App />);
    expect(await screen.findByText("Add a shipping address")).toBeInTheDocument();
    const due = screen.getByRole("region", { name: "Invoices to pay" });
    fireEvent.click(within(due).getAllByRole("button", { name: "Pay invoice" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Where should we deliver?" });
    const form = await within(dialog).findByRole("form", { name: "New address" });
    fireEvent.change(within(form).getByLabelText("Street address"), { target: { value: "12 Allen Avenue" } });
    fireEvent.change(within(form).getByLabelText("City or town"), { target: { value: "Ikeja" } });
    fireEvent.change(within(form).getByLabelText("Country"), { target: { value: "Nigeria" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save and use this address" }));
    const pay = await within(dialog).findByRole("button", { name: "Deliver here and pay" });
    await waitFor(() => expect(pay).toBeEnabled());
    expect(within(dialog).getByText(/12 Allen Avenue, Ikeja, Nigeria/)).toBeInTheDocument();
    fireEvent.click(pay);
    await waitFor(() => expect(paidWith).toEqual({ address_id: "a1" }));
    await waitFor(() => expect(tab.location.href).toBe("https://fayfort.myshopify.com/i/1"));
  });

  it("lets a member cancel a consultation they haven't paid for", async () => {
    window.history.replaceState({}, "", "/member/chat?panel=requests");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel consultation" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Cancel FayFort consultation" })).getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(cancelledConsultation).toBe(true));
  });

  it("walks a new member through the menu once, then remembers it", async () => {
    newMember = true;
    window.history.replaceState({}, "", "/member/chat");
    render(<App />);
    const tour = await screen.findByRole("dialog", { name: "Dashboard tour" });
    expect(within(tour).getByText("Start a chat")).toBeInTheDocument();
    fireEvent.click(within(tour).getByRole("button", { name: "Next" }));
    // The chat tools come next: one step for the toolbar, then one per tool.
    expect(within(tour).getByText("Your chat tools")).toBeInTheDocument();
    for (const title of ["Paste a link", "Ask a person to review a photo", "Create a sourcing request", "Link an existing request"]) {
      fireEvent.click(within(tour).getByRole("button", { name: "Next" }));
      expect(within(tour).getByRole("heading", { name: title })).toBeInTheDocument();
    }
    fireEvent.click(within(tour).getByRole("button", { name: "Next" }));
    expect(within(tour).getByText("Browse")).toBeInTheDocument();
    fireEvent.click(within(tour).getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(tourDone).toBe(true));
    expect(screen.queryByRole("dialog", { name: "Dashboard tour" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Profile 40%").length).toBeGreaterThan(0);
  });

  it("saves a shop product with the heart and lists it under Saved products", async () => {
    window.history.replaceState({}, "", "/member/chat?panel=product&product=p-wig");
    const { unmount } = render(<App />);
    const panel = await screen.findByRole("region", { name: "Product details" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Save product" }));
    await waitFor(() => expect(savedCalls).toEqual(["POST"]));
    expect(within(panel).getByRole("button", { name: "Remove from saved products" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    window.history.replaceState({}, "", "/member/chat?panel=saved");
    render(<App />);
    const saved = await screen.findByRole("region", { name: "Saved products" });
    expect(await within(saved).findByRole("article", { name: wig.name })).toBeInTheDocument();
  });

  it("prefills the composer from Android share", async () => {
    window.history.replaceState({}, "", "/member/share?text=Look&url=https%3A%2F%2Fvm.tiktok.com%2FZM1");
    render(<App />);
    const input = await screen.findByRole("textbox", { name: "Message FayFort" });
    expect(input).toHaveValue("Look https://vm.tiktok.com/ZM1");
    expect(window.location.pathname).toBe("/member/chat");
  });
});

describe("countdown text", () => {
  it("formats time left", () => {
    const now = Date.parse("2026-10-14T00:00:00Z");
    expect(timeLeft("2026-10-14T05:30:00Z", now)).toBe("5h 30m left");
    expect(timeLeft("2026-10-20T00:00:00Z", now)).toBe("6 days left");
    expect(timeLeft("2026-10-13T00:00:00Z", now)).toBe("Ended");
  });
});

describe("Control Center shop", () => {
  it("runs setup, shows the trend queue and opens a pool", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/platform/commerce/overview"))
        return ok({ connection: { store_domain: "fayfort.myshopify.com", admin_configured: true, storefront_configured: false, webhook_secret_configured: true, sync_enabled: true, webhook_url: "https://api.fayfort.com/commerce/shopify/webhooks", api_version: "2025-07" }, catalog: { shopify_products: 3, shopify_active: 3, in_stock: 2, needs_category: 1, fayfort_listings: 0 }, sync_runs: [], recent_webhooks: [], trends: { open: 1, pooling: 0, pools_ready: 0 }, invoices: { sent: 0, paid: 0, failed: 0 }, orders_7_days: { count: 0, total: 0 } });
      if (url.endsWith("/platform/commerce/setup")) return ok({ category_definition: "created", webhooks: { PRODUCTS_CREATE: "created" } });
      if (url.includes("/platform/commerce/trends/t1") && init?.method === "PUT") return ok({ trend: {} });
      if (url.includes("/platform/commerce/trends")) return ok({ trends: [{ ...trend, status: "open", pool: null, ready: false }] });
      return ok({});
    });
    render(<CommercePage accessToken="admin" />);
    expect(await screen.findByText(/Checkout uses cart links until the Storefront token is added/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Set up Shopify/ }));
    expect(await screen.findByText(/Shopify is set up: category field created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Trend queue & pools" }));
    fireEvent.click(await screen.findByRole("button", { name: "Link or pool" }));
    const form = screen.getByRole("form", { name: "Link or pool" });
    fireEvent.change(within(form).getByLabelText("Group price"), { target: { value: "55.00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Pool is open.")).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/trends/t1") && init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ status: "pooling", pool_target: 10, pool_price: "55.00", pool_currency: "USD" });
  });
});
