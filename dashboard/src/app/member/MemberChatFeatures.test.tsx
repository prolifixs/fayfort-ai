import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  dashboardAuthConfigured: true,
  openedAt: { pathname: "", search: "", hash: "" },
  supabaseClient: {
    auth: {
      getSession: authMocks.getSession,
      onAuthStateChange: authMocks.onAuthStateChange,
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null }) },
    },
  },
}));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
const at = "2026-10-14T00:00:00Z";
const open = { id: "chat-open", title: "Wigs", retention_hold: false, created_at: at, last_activity_at: at };
const kept = { id: "chat-kept", title: "Office chairs order", retention_hold: true, linked_request_id: "r1", created_at: at, last_activity_at: at };
const old = { id: "chat-old", title: "Ankara fabric order", retention_hold: true, linked_request_id: "r2", created_at: at, last_activity_at: at,
  archived_at: "2026-10-16T00:00:00Z", archived_by: "auto" };
let archivedIds: string[];
let sentBodies: Record<string, unknown>[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  archivedIds = ["chat-old"];
  sentBodies = [];
  window.localStorage.clear();
  authMocks.getSession.mockResolvedValue({ data: { session: { access_token: "member-token", user: { user_metadata: {} } } }, error: null });
  authMocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const all: Array<{ id: string; archived_at?: string } & Record<string, unknown>> = [open, kept, old];
    if (url.endsWith("/members/me")) return ok({ profile: { user_id: "member-1" }, completion: { percent: 100, done: 5, total: 5, address_ready: true, items: [] } });
    if (url.endsWith("/members/conversations?archived=true"))
      return ok({ conversations: all.filter((c) => archivedIds.includes(c.id)).map((c) => ({ ...c, archived_at: c.archived_at || "2026-10-18T00:00:00Z" })) });
    if (url.endsWith("/members/conversations") && method === "GET")
      return ok({ conversations: all.filter((c) => !archivedIds.includes(c.id)), archived_count: archivedIds.length });
    const archive = url.match(/\/members\/conversations\/([^/]+)\/(archive|unarchive)$/);
    if (archive && method === "POST") {
      archivedIds = archive[2] === "archive" ? [...archivedIds, archive[1]] : archivedIds.filter((id) => id !== archive[1]);
      return ok({ conversation_id: archive[1], archived_at: archive[2] === "archive" ? "2026-10-18T00:00:00Z" : null });
    }
    if (url.includes("/members/shop/products/p1"))
      return ok({ product: { id: "p1", name: "Body wave wig", price: 120, currency: "USD", group_name: "Hair", description: "Soft.", buyable: true, saved: false },
        variants: [{ id: "v1", title: "22 inch", price: 120, sale_price: null, compare_at_price: null, available: true, options: [] }],
        media: [{ media_type: "image", url: "https://cdn.example/w.jpg" }], pairs_with: [] });
    if (url.endsWith("/members/conversations") && method === "POST")
      return ok({ conversation: { id: "chat-new", title: "New chat", retention_hold: false, created_at: at, last_activity_at: at } }, 201);
    const sent = url.match(/\/members\/conversations\/([^/]+)\/messages$/);
    if (sent && method === "POST") {
      const body = JSON.parse(String(init?.body));
      sentBodies.push({ chat: sent[1], ...body });
      return ok({
        member_message: { id: `m${sentBodies.length}`, sender_type: "member", content: body.content, related_product_ids: [], product_ref: body.product_id || null, created_at: at },
        assistant_message: { id: `a${sentBodies.length}`, sender_type: "assistant", content: "Yes, it comes in natural black.", related_product_ids: [], created_at: at },
        products: [], find_it: null,
        referenced_product: body.product_id ? { id: "p1", name: "Body wave wig", price: 120, currency: "USD", media_type: "image", media_url: "https://cdn.example/w.jpg" } : null,
      }, 201);
    }
    if (url.includes("/messages")) return ok({ messages: [], products: [] });
    if (url.endsWith("/members/requests")) return ok({ requests: [] });
    if (url.endsWith("/members/shop/home")) return ok({ rails: [], giveaways: [], intent: { active: false } });
    if (url.endsWith("/members/cart")) return ok({ lines: [], subtotal: 0, currency: "USD", impulse: { pairs_with: [], ending_soon: [] } });
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

describe("chat Archive", () => {
  it("keeps finished chats out of the list, tells the member, and opens the Archive", async () => {
    window.history.replaceState({}, "", "/member/chat");
    render(<App />);
    const chats = await screen.findByRole("region", { name: "Your chats" });
    expect(await within(chats).findByText("Office chairs order")).toBeInTheDocument();
    expect(within(chats).queryByText("Ankara fabric order")).not.toBeInTheDocument();
    expect(within(chats).getByText("1 finished chat moved to Archive.")).toBeInTheDocument();
    fireEvent.click(within(chats).getByRole("button", { name: /Archive\s*1/ }));
    const archive = await screen.findByRole("region", { name: "Archived chats" });
    expect(await within(archive).findByText("Ankara fabric order")).toBeInTheDocument();
    expect(within(archive).getByText(/Archived Oct 1[56]/)).toBeInTheDocument();
    fireEvent.click(within(archive).getByRole("button", { name: /^Ankara fabric order/ }));
    expect(await screen.findByText(/kept as your record/)).toBeInTheDocument();
    // Going back: the notice is gone once the Archive has been seen.
    fireEvent.click(within(archive).getByRole("button", { name: "← Chats" }));
    expect(screen.queryByText("1 finished chat moved to Archive.")).not.toBeInTheDocument();
  });

  it("archives a chat kept with a request instead of deleting it; ordinary chats are still deleted", async () => {
    window.history.replaceState({}, "", "/member/chat");
    render(<App />);
    const chats = await screen.findByRole("region", { name: "Your chats" });
    fireEvent.click(await within(chats).findByRole("button", { name: "Chat options for Wigs" }));
    expect(within(chats).getByRole("menuitem", { name: "Delete chat" })).toBeInTheDocument();
    expect(within(chats).queryByRole("menuitem", { name: "Archive chat" })).not.toBeInTheDocument();
    fireEvent.click(within(chats).getByRole("button", { name: "Chat options for Office chairs order" }));
    fireEvent.click(within(chats).getByRole("menuitem", { name: "Archive chat" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/chat-kept/archive") && init?.method === "POST")).toBe(true));
    expect(await screen.findByText("Chat moved to Archive. It's kept as your record.")).toBeInTheDocument();
    await waitFor(() => expect(within(chats).queryByText("Office chairs order")).not.toBeInTheDocument());
    expect(within(chats).getByRole("button", { name: /Archive\s*2/ })).toBeInTheDocument();
  });
});

describe("ask about a product", () => {
  it("on a computer attaches the open product to the message box, sends it, and shows it on the message", async () => {
    window.localStorage.setItem("ff_product_ask_tip_seen", "1");
    window.history.replaceState({}, "", "/member/chat?panel=product&product=p1");
    render(<App />);
    const attached = await screen.findByLabelText("Asking about Body wave wig");
    expect(within(attached).getByText("$120.00")).toBeInTheDocument();
    // Send to: the current chat by default; new chat and open chats offered, never a chat kept with a request.
    fireEvent.click(within(attached).getByRole("button", { name: /Send to:/ }));
    const menu = within(attached).getByRole("menu", { name: "Send this product to" });
    expect(within(menu).getByRole("menuitem", { name: "+ New chat" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Wigs/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Office chairs order/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    const input = screen.getByRole("textbox", { name: "Message FayFort" });
    fireEvent.change(input, { target: { value: "Does this come in black?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Yes, it comes in natural black.")).toBeInTheDocument();
    expect(sentBodies[0]).toMatchObject({ content: "Does this come in black?", product_id: "p1" });
    expect(screen.getByRole("button", { name: "Open Body wave wig" })).toBeInTheDocument();
    // Removing the product: the next message is a plain one.
    fireEvent.click(screen.getByRole("button", { name: "Stop asking about this product" }));
    fireEvent.change(input, { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(sentBodies).toHaveLength(2));
    expect(sentBodies[1]).not.toHaveProperty("product_id");
  });

  it("on a phone opens a Pinterest-style sheet: New chat first, then recent open chats", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      window.history.replaceState({}, "", "/member/chat?panel=product&product=p1");
      render(<App />);
      expect(await screen.findByText(/Ask about this product\./)).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Ask about this product" }));
      const sheet = screen.getByRole("dialog", { name: "Ask about this product in" });
      const buttons = within(sheet).getAllByRole("button").map((button) => button.textContent || "");
      expect(buttons.findIndex((text) => text.includes("New chat"))).toBeLessThan(buttons.findIndex((text) => text.includes("Wigs")));
      expect(within(sheet).queryByText("Office chairs order")).not.toBeInTheDocument();
      fireEvent.click(within(sheet).getByRole("button", { name: /Wigs/ }));
      expect(await screen.findByLabelText("Asking about Body wave wig")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Ask about this product in" })).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});
