import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdSlot, AdsProvider, type MemberAdsConfig } from "./ads";
import { AdsPage } from "../staff/AdsPage";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;

const house = {
  id: "c1",
  advertiser: "FayFort",
  headline: "Go ad-free with Standard",
  body: "No ads, lower deposits.",
  cta_label: "See plans",
  target_url: "action:plans",
  tone: "brand" as const,
  weight: 1,
};
const partner = { ...house, id: "c2", headline: "Ship with Acme", cta_label: "Visit", target_url: "https://acme.example" };

function config(overrides: Partial<Extract<MemberAdsConfig, { show: true }>> = {}): MemberAdsConfig {
  return {
    show: true,
    max_per_screen: 2,
    google: null,
    placements: [
      { key: "browse_top", shape: "banner", priority: 10, google: null, creatives: [house] },
      { key: "browse_feed", shape: "feed", priority: 20, google: null, creatives: [partner] },
      { key: "sidebar", shape: "square", priority: 60, google: null, creatives: [house] },
    ],
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById("fayfort-adsbygoogle")?.remove();
});

function page(onUpgrade = vi.fn()) {
  return render(
    <AdsProvider accessToken="member" planKey="free" onUpgrade={onUpgrade}>
      <AdSlot placement="browse_top" />
      <AdSlot placement="browse_feed" />
      <AdSlot placement="sidebar" />
      <AdSlot placement="product_detail" />
    </AdsProvider>,
  );
}

describe("member ads", () => {
  it("shows custom ads to free members up to the page limit, by priority", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).endsWith("/members/ads") ? ok(config()) : ok({ recorded: 1 }),
    );
    const onUpgrade = vi.fn();
    page(onUpgrade);
    expect(await screen.findByText("Ship with Acme")).toBeTruthy();
    expect(screen.getByText("Go ad-free with Standard")).toBeTruthy();
    expect(screen.getAllByLabelText("Advertisement")).toHaveLength(2); // the sidebar waits: limit is 2
    expect(document.querySelector('[data-placement="sidebar"]')).toBeNull();
    expect(screen.getAllByText(/^Ad · FayFort$/)).toHaveLength(2);
    const partnerLink = screen.getByText("Ship with Acme").closest("a")!;
    expect(partnerLink.getAttribute("href")).toBe("https://acme.example");
    expect(partnerLink.getAttribute("rel")).toBe("noopener sponsored");
    fireEvent.click(screen.getByText("Go ad-free with Standard"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/members/ads/events") && String(init?.body).includes('"click"'))).toBe(true),
    );
    fireEvent.click(screen.getAllByText("Remove ads")[0]);
    expect(onUpgrade).toHaveBeenCalledTimes(2);
  });

  it("paid members get nothing and the Google script never loads", async () => {
    fetchMock.mockResolvedValue(ok({ show: false, reason: "paid_plan" }));
    page();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByLabelText("Advertisement")).toBeNull();
    expect(document.getElementById("fayfort-adsbygoogle")).toBeNull();
  });

  it("loads Google only for free members with a Google placement, in test mode when set", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).endsWith("/members/ads")
        ? ok(
            config({
              google: { client: "ca-pub-1234567890123456", test: true },
              placements: [
                { key: "browse_top", shape: "banner", priority: 10, google: { slot: "1234567890", format: "horizontal" }, creatives: [house] },
              ],
            }),
          )
        : ok({}),
    );
    page();
    await waitFor(() => expect(document.querySelector("ins.adsbygoogle")).not.toBeNull());
    const unit = document.querySelector("ins.adsbygoogle")!;
    expect(unit.getAttribute("data-ad-client")).toBe("ca-pub-1234567890123456");
    expect(unit.getAttribute("data-ad-slot")).toBe("1234567890");
    expect(unit.getAttribute("data-adtest")).toBe("on");
    expect(document.getElementById("fayfort-adsbygoogle")?.getAttribute("src")).toContain("client=ca-pub-1234567890123456");
    // Google has nothing to show: the custom ad takes the slot.
    act(() => unit.setAttribute("data-ad-status", "unfilled"));
    expect(await screen.findByText("Go ad-free with Standard")).toBeTruthy();
  });
});

const overview = {
  settings: { enabled: true, google_enabled: false, google_client: null, google_test_mode: false, max_per_screen: 3 },
  placements: [
    {
      key: "browse_top",
      label: "Browse: top banner",
      description: "Between rails and filters.",
      enabled: true,
      source: "google_then_custom",
      google_slot_id: null,
      google_format: "horizontal",
      google_layout_key: null,
      shape: "banner",
      priority: 10,
    },
  ],
  creatives: [{ ...house, name: "Placeholder: go ad-free", status: "active", placements: ["browse_top"], starts_at: null, ends_at: null, is_placeholder: true }],
  stats: { days: 30, placements: { browse_top: { impressions: 12, clicks: 3, google_impressions: 0, custom_impressions: 12 } }, creatives: { c1: { impressions: 12, clicks: 3 } } },
  ads_txt: null,
};

describe("Control Center ads", () => {
  it("saves the AdSense publisher ID and shows placements, custom ads and results", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/platform/ads/settings") && init?.method === "PUT") return ok({ settings: overview.settings });
      return ok(overview);
    });
    render(<AdsPage accessToken="admin" />);
    expect(await screen.findByText(/Google isn't set up yet/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("ca-pub-1234567890123456"), { target: { value: "ca-pub-1234567890123456" } });
    fireEvent.click(screen.getByLabelText("Show Google ads"));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith("/platform/ads/settings") && init?.method === "PUT");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ google_client: "ca-pub-1234567890123456", google_enabled: true });
    });

    fireEvent.click(screen.getByRole("tab", { name: "Placements" }));
    expect(await screen.findByText("Browse: top banner")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("1234567890"), { target: { value: "5555555555" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/platform/ads/placements/browse_top") && String(init?.body).includes("5555555555"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Custom ads" }));
    expect(await screen.findByText("Placeholder: go ad-free")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add custom ad" }));
    expect(screen.getByRole("form", { name: "New custom ad" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    expect(await screen.findByRole("table", { name: "Results by placement" })).toBeTruthy();
  });
});
