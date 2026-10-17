import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebsitePage } from "./WebsitePage";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
let posts: { id: string; kind: string; shortcode: string; label: string | null; active: boolean; sort_order: number }[];

beforeEach(() => {
  posts = [
    { id: "a", kind: "reel", shortcode: "REEL111", label: "Market day", active: true, sort_order: 10 },
    { id: "b", kind: "p", shortcode: "POST222", label: null, active: true, sort_order: 20 },
  ];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
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
});
