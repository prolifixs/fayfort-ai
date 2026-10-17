import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebsitePage } from "./WebsitePage";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
const chatSettings = { enabled: true, visitor_daily_limit: 20, network_daily_limit: 60, daily_reply_cap: 400 };
let posts: { id: string; kind: string; shortcode: string; label: string | null; active: boolean; sort_order: number }[];

beforeEach(() => {
  posts = [
    { id: "a", kind: "reel", shortcode: "REEL111", label: "Market day", active: true, sort_order: 10 },
    { id: "b", kind: "p", shortcode: "POST222", label: null, active: true, sort_order: 20 },
  ];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/platform/site/chat/settings")) return ok({ settings: chatSettings });
    if (url.includes("/platform/site/chat/")) return ok({ messages: [
      { id: "m1", sender_type: "visitor", content: "Do you ship to Ghana?", created_at: "2026-10-17T08:00:00Z" },
      { id: "m2", sender_type: "assistant", content: "Yes, we ship to Ghana.", created_at: "2026-10-17T08:00:05Z" },
    ] });
    if (url.endsWith("/platform/site/chat")) return ok({ settings: chatSettings, today: { replies: 3, conversations: 2 }, conversations: [
      { id: "v1", first_page: "/", first_message: "Do you ship to Ghana?", message_count: 2, joined: true,
        created_at: "2026-10-17T08:00:00Z", last_activity_at: "2026-10-17T08:00:05Z" },
    ] });
    if (url.endsWith("/platform/site/instagram") && init?.method === "POST") return ok({ post: { id: "c" } }, 201);
    if (url.includes("/platform/site/instagram-order")) return ok({ posts });
    if (url.includes("/platform/site/instagram/")) return ok({ post: posts[0] });
    return ok({ posts });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Control Center website page", () => {
  it("lists posts, adds a link, reorders, hides and previews", async () => {
    render(<WebsitePage accessToken="admin" />);
    expect(await screen.findByText("Reel · REEL111")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("https://www.instagram.com/reel/…"), { target: { value: "https://www.instagram.com/p/NEW333/" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/platform/site/instagram") && i?.method === "POST" && String(i.body).includes("NEW333"))).toBe(true),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/instagram-order"));
      expect(JSON.parse(String(call![1]!.body))).toEqual({ ids: ["b", "a"] });
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Hide" })[0]);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/platform/site/instagram/a") && String(i?.body).includes('"active":false'))).toBe(true),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]);
    expect(screen.getByTitle("Preview of REEL111").getAttribute("src")).toBe("https://www.instagram.com/reel/REEL111/embed/");
  });

  it("shows website chat settings and what visitors asked", async () => {
    render(<WebsitePage accessToken="admin" />);
    const row = await screen.findByRole("button", { name: /Do you ship to Ghana\?/ });
    expect(screen.getByText("Joined")).toBeInTheDocument();
    fireEvent.click(row);
    expect(await screen.findByText("Yes, we ship to Ghana.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Show FayFort AI on the website"));
    fireEvent.click(screen.getByRole("button", { name: "Save chat settings" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/platform/site/chat/settings"));
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ enabled: false, visitor_daily_limit: 20 });
    });
  });
});
