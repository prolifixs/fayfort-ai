import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CookieBanner from "./CookieBanner";
import { VisitorPopups } from "./VisitorPopups";
import { readConsent } from "../../lib/consent";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, headers: new Headers() }) as Response;
const pick = (n: number) => ({ name: `Product ${n}`, price: 10 * n, currency: "USD", price_guide: n === 1, image_url: `https://cdn.shopify.com/p${n}.jpg` });

function clearCookies() {
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(() => {
  clearCookies();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cookie banner", () => {
  it("asks once and remembers the choice", () => {
    render(<CookieBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    expect(screen.getByRole("switch", { name: /Marketing/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(readConsent()?.marketing).toBe(false);
    expect(screen.queryByRole("region", { name: /Cookie/ })).not.toBeInTheDocument();
    cleanup();
    render(<CookieBanner />);
    expect(screen.queryByText("Cookies on FayFort")).not.toBeInTheDocument();
  });
});

describe("catalog popups for visitors", () => {
  it("shows product cards to a signed-out first-time visitor after the cookie choice", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ picks: [pick(1), pick(2), pick(3), pick(4), pick(5)] })));
    document.cookie = `ff_consent=m0.t${Date.now()}; path=/`;
    render(<VisitorPopups />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(screen.getByRole("heading", { name: "Join free to shop these" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("From $10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.cookie).toContain("ff_popup=1");
  });

  it("offers the newsletter from the second visit and never shows anything to members", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ok({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = `ff_consent=m1.t${Date.now()}; path=/`;
    document.cookie = "ff_visits=1; path=/";
    render(<VisitorPopups />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(screen.getByRole("heading", { name: "New finds from China, every week" })).toBeInTheDocument();
    vi.useRealTimers();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "v@example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    });
    expect(await screen.findByText(/check your inbox/)).toBeInTheDocument();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body))).toEqual({ email: "v@example.com", source: "catalog_popup" });
    cleanup();
    window.sessionStorage.clear();
    clearCookies();
    document.cookie = `ff_consent=m1.t${Date.now()}; path=/`;
    document.cookie = "ff_member=1; path=/";
    vi.useFakeTimers();
    render(<VisitorPopups />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits for the cookie choice", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ picks: [] })));
    render(<VisitorPopups />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
