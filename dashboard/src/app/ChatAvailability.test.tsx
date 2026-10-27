import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAvailability } from "./ChatAvailability";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, headers: new Headers() }) as Response;

describe("chat availability in the Operations header", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("shows the worker's chat status and turns chats on for eight hours", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        calls.push({ url, method, body: init?.body ? String(init.body) : undefined });
        if (url.endsWith("/dashboard/businesses")) return ok({ businesses: [{ business_id: "b1" }] });
        if (method === "PATCH") return ok({ availability: "available", available_until: new Date(Date.now() + 8 * 3600_000).toISOString(), max_active_handoffs: 3 });
        return ok({ availability: "offline", available_until: null, max_active_handoffs: 3 });
      }),
    );
    render(<ChatAvailability accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: /Not taking chats/ }));
    fireEvent.click(screen.getByRole("button", { name: "Take chats for 8 hours" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Taking chats/ })).toBeInTheDocument());
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toMatch(/\/businesses\/b1\/handoffs\/availability$/);
    const body = JSON.parse(patch?.body || "{}");
    expect(body.availability).toBe("available");
    const hoursAhead = (new Date(body.available_until).getTime() - Date.now()) / 3600_000;
    expect(hoursAhead).toBeGreaterThan(7.9);
    expect(hoursAhead).toBeLessThanOrEqual(8);
  });
  it("stays hidden for someone without a chat seat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ detail: "no" }), headers: new Headers() }) as Response));
    const { container } = render(<ChatAvailability accessToken="t" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
