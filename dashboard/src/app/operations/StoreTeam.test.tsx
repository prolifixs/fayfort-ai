import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null, openedAt: { pathname: "", search: "", hash: "" } }));

import { ListingEditor, ProductsWorkspace, StoreFlowPanel } from "./StoreTeam";
import { SchedulePanel } from "./SchedulePanel";
import { GUIDES, playbookSteps, currentStepIndex, TOOL_GUIDES } from "./playbooks";
import { BrowsePanel } from "../member/ShopPanels";
import type { WorkItem } from "./types";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, headers: new Headers() }) as Response;
const categories = [{ source_ref: "HAIR-WIG", category: "Wigs", group_name: "Hair", product_type: "Wig" }];
const draft = {
  id: "l1", kind: "sourcing_item", action: "create", status: "draft", product_id: null, shopify_product_id: null, trend_item_id: null,
  title: "Lace front wig", description: "", category_ref: null, option_name: null, option_values: [], price: null,
  compare_at_price: null, cost: null, currency: "USD", price_guide_min: null, price_guide_max: null, min_order: null,
  lead_time_min_days: null, lead_time_max_days: null, availability_status: "sourcing", media: [], planned_live_at: null,
  review_note: null, error: null, submitted_at: null, published_at: null, updated_at: "2026-10-18T10:00:00Z",
  missing: ["a category", "at least one photo or video"], steps: { details: false, media: false, price: false },
};
let calls: { url: string; method: string; body?: unknown }[] = [];
let listing: Record<string, unknown> = draft;
let canPublish = false;

beforeEach(() => {
  calls = [];
  listing = { ...draft };
  canPublish = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.includes("/operations/store/categories")) return ok({ categories });
    if (url.includes("/operations/store/products?tab=store"))
      return ok({ products: [
        { id: "p1", name: "Body wave wig", source: "shopify", category_ref: "HAIR-WIG", price_min: 60, currency: "USD", in_stock: false, state: "sold_out", shopify_admin_url: "https://admin.shopify.com/store/x/products/1" },
      ], shopify_connected: true, can_publish: canPublish });
    if (url.includes("/operations/store/products?tab=listings")) return ok({ listings: [listing] });
    if (url.endsWith("/operations/store/listings") && method === "POST") return ok({ listing });
    if (url.includes("/operations/store/listings/l1/from-link")) {
      listing = { ...listing, title: "Marble dining table", price_guide_min: 1250, source_url: "https://shop.example.com/p/table" };
      return ok({ listing, read: true, filled: ["name", "rough price", "cover photo"], notes: [] });
    }
    if (url.includes("/operations/store/listings/l1/publish")) {
      listing = { ...listing, status: "published" };
      return ok({ listing });
    }
    if (url.includes("/operations/store/listings/l1/send-back")) {
      listing = { ...listing, status: "changes_requested", review_note: "Brighter photo" };
      return ok({ listing });
    }
    if (url.includes("/operations/store/listings/l1")) return ok({ listing, work_item: null, can_edit: !canPublish, can_publish: canPublish });
    if (url.includes("/operations/schedule"))
      return ok({ entries: [
        { id: "deadline:w1", type: "deadline", title: "List a store product: Ankara set", at: new Date().toISOString(), status: "overdue", href: "/operations?workItem=w1", detail: "", work_item_id: "w1", department: "store_team", worker_id: null },
        { id: "giveaway:g1:start", type: "giveaway", title: "Giveaway starts: Wig week", at: new Date(Date.now() + 3600_000).toISOString(), status: "scheduled", href: "/?page=shop&tab=giveaways", detail: "", work_item_id: null, department: null, worker_id: null },
      ], can_plan: true, workers: [] });
    if (url.includes("/members/shop/sections/s1"))
      return ok({ section: { id: "s1", title: "Dollar deals", hook: "3 from $1", style: "deal", accent: "pink", total: 4,
        items: ["A", "B", "C", "D"].map((n) => ({ id: `c${n}`, name: `Clip ${n}`, price: 1, currency: "USD", source: "shopify", buyable: true })) } });
    if (url.includes("/members/shop/products")) return ok({ products: [], total: 0, groups: [], categories: [], has_more: false });
    if (url.includes("/operations/work-items/w9/campaign")) return ok({ ready: false });
    return ok({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Products workspace", () => {
  it("lists store products with their state and starts a sourcing listing", async () => {
    render(<ProductsWorkspace token="t" canManage={false} />);
    const list = await screen.findByRole("list", { name: "Store products" });
    expect(within(list).getByText("Body wave wig")).toBeInTheDocument();
    expect(within(list).getByText("Sold out")).toBeInTheDocument();
    expect(within(list).queryByText("Shopify ↗")).not.toBeInTheDocument(); // workers don't get the Shopify link
    fireEvent.click(screen.getByRole("button", { name: "New sourcing item" }));
    expect(await screen.findByLabelText("Listing: Lace front wig")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/operations/store/listings") && c.method === "POST" && (c.body as { kind: string }).kind === "sourcing_item")).toBe(true);
    expect((await screen.findByText(/Before review, add:/)).closest("p")).toHaveTextContent("at least one photo or video");
    expect(screen.getByRole("figure", { name: "Member preview" })).toHaveTextContent("Request this item");
  });

  it("fills a sourcing listing from a product link and shows the source to staff", async () => {
    render(<ListingEditor token="t" listingId="l1" categories={categories} />);
    fireEvent.change(await screen.findByLabelText("Product link"), { target: { value: "https://shop.example.com/p/table" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill from link" }));
    expect(await screen.findByText(/Filled in: name, rough price, cover photo/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes("/from-link"))?.body).toEqual({ url: "https://shop.example.com/p/table" });
    expect(screen.getByRole("link", { name: "shop.example.com" })).toHaveAttribute("href", "https://shop.example.com/p/table");
    expect(screen.getByText(/members don't see this link/)).toBeInTheDocument();
  });

  it("lets an administrator publish or send back, never a worker", async () => {
    listing = { ...draft, status: "in_review", missing: [] };
    canPublish = true;
    render(<ListingEditor token="t" listingId="l1" categories={categories} />);
    fireEvent.change(await screen.findByLabelText("What should change"), { target: { value: "Brighter photo" } });
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    expect(await screen.findByText("Sent back to the worker with your note.")).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes("/send-back"))?.body).toEqual({ note: "Brighter photo" });
    cleanup();
    listing = { ...draft, status: "in_review", missing: [] };
    canPublish = false;
    render(<ListingEditor token="t" listingId="l1" categories={categories} />);
    expect(await screen.findByText(/With an administrator for review/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });
});

describe("Browse shop by category", () => {
  it("opens a top category from its photo tile and can go back to everything", async () => {
    render(
      <BrowsePanel
        accessToken="t"
        onOpen={() => undefined}
        onWant={() => undefined}
        onEnter={() => undefined}
        home={{ rails: [], giveaways: [], intent: { active: false },
          category_tiles: [{ key: "Home, Furniture & Interior", label: "Furniture from China", count: 22, image_url: "https://cdn.example/t.jpg" }] }}
      />,
    );
    const tiles = screen.getByRole("region", { name: "Category tiles" });
    fireEvent.click(within(tiles).getByRole("button", { name: /Furniture from China/ }));
    expect(await screen.findByText("Showing Furniture from China")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url.includes("top=Home%2C+Furniture+%26+Interior"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(screen.queryByText("Showing Furniture from China")).not.toBeInTheDocument();
  });
});

describe("Store team work items", () => {
  it("prepares a campaign with the three checks", async () => {
    const item = { id: "w9", status: "claimed", work_type: "prepare_campaign", department: "store_team", assigned_worker_id: "u1", metadata: { campaign_kind: "giveaway" } } as unknown as WorkItem;
    render(
      <StoreFlowPanel
        token="t"
        item={item}
        flow={{ kind: "campaign_giveaway", metadata: {}, prep: { kind: "giveaway", source_id: "g1" }, campaign: { id: "g1", title: "Wig week", starts_at: "2026-10-20T10:00:00Z", ends_at: "2026-10-27T10:00:00Z", prize_text: "One wig" } }}
        canAct
        canManage={false}
        onClaim={() => undefined}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText("The prize is ready for every winner"));
    await waitFor(() => expect(calls.find((c) => c.url.includes("/campaign"))?.body).toEqual({ prize_ready: true }));
  });

  it("has steps and a guide for every Store team work type", () => {
    for (const key of ["list_store_product", "list_sourcing_item", "map_product", "retire_listing", "refresh_section", "prepare_campaign"]) {
      expect(GUIDES[key]?.department).toBe("store_team");
    }
    expect(Object.keys(TOOL_GUIDES)).toEqual(["products_workspace", "store_sections", "schedule"]);
    const item = { id: "w1", status: "waiting", work_type: "list_store_product", department: "store_team", assigned_worker_id: "u1", metadata: { listing_kind: "store_product" } } as unknown as WorkItem;
    const steps = playbookSteps({
      item, userId: "u1", canManage: false, request: null, candidates: 0, payments: null, memberConversation: null, businessConversation: null, handoff: null, dispute: null,
      flow: { kind: "store_listing", metadata: {}, listing: { ...(draft as unknown as import("./storeTypes").StoreListing), kind: "store_product", status: "in_review", steps: { details: true, media: true, price: true } } },
    });
    const now = steps[currentStepIndex(steps)];
    expect(now.title).toBe("Administrator review");
    expect(now.waitingOn).toBe("administrator");
  });
});

describe("Schedule", () => {
  it("shows the list view and opens the work item behind a deadline", async () => {
    const opened: string[] = [];
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });
    render(<SchedulePanel token="t" canManage myDepartments={[]} onOpenWorkItem={(id) => opened.push(id)} onOpenProducts={() => undefined} />);
    const deadline = await screen.findByRole("button", { name: /List a store product: Ankara set/ });
    expect(deadline).toHaveTextContent("Overdue");
    fireEvent.click(deadline);
    expect(opened).toEqual(["w1"]);
    expect(screen.getAllByRole("button", { name: /Plan something on/ }).length).toBeGreaterThan(0);
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  });
});

describe("Member Browse", () => {
  it("shows store section tiles and opens the whole section", async () => {
    const cards = ["A", "B", "C"].map((n) => ({ id: `c${n}`, name: `Clip ${n}`, price: 1, currency: "USD", source: "shopify" as const, buyable: true,
      badges: [{ key: "discount" as const, label: "-50%" }], compare_at_price: 2 }));
    render(
      <BrowsePanel
        accessToken="t"
        onOpen={() => undefined}
        onWant={() => undefined}
        onEnter={() => undefined}
        home={{ rails: [], giveaways: [], intent: { active: false }, category_bar: [{ kind: "group", key: "Hair", label: "Hair", count: 3 }],
          sections: [{ id: "s1", title: "Dollar deals", hook: "3 from $1", style: "deal", accent: "pink", total: 4, items: cards }] }}
      />,
    );
    const tile = screen.getByRole("region", { name: "Dollar deals" });
    expect(within(tile).getByText("3 from $1")).toBeInTheDocument();
    expect(within(tile).getAllByRole("button", { name: /Open Clip/ })).toHaveLength(3);
    expect(screen.getByRole("navigation", { name: "Shop by category" })).toHaveTextContent("Hair");
    fireEvent.click(within(tile).getByRole("button", { name: /Dollar deals/ }));
    const sheet = await screen.findByRole("dialog", { name: "Dollar deals" });
    await waitFor(() => expect(within(sheet).getAllByRole("article")).toHaveLength(4));
  });
});
