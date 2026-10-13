import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfrastructurePage } from "./InfrastructurePage";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiRequest: mocks.apiRequest }));

const TUNNEL = "11111111-2222-3333-4444-555555555555";
const verified = {
  cloudflare: { status: "verified", safe_settings: { account_id: "a".repeat(32), zone_name: "fayfort.com", zone_status: "pending", name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"] } },
  tunnels: [{ id: TUNNEL, name: "fayfort-api-dev", status: "healthy", connections: [{ colo_name: "sjc06", client_version: "2026.9.3" }], hostnames: [{ hostname: "api-dev.fayfort.com", service: "http://127.0.0.1:8001" }] }],
  cloudflare_error_code: null,
  webhooks: [
    { channel: "instagram", public_url: "https://api-dev.fayfort.com", suggested_public_url: null, callback_url: "https://api-dev.fayfort.com/webhooks/instagram", last_preflight_at: null, last_preflight_ok: true, last_preflight_results: [{ name: "webhook verification challenge", ok: true, detail: "HTTP 200" }], last_event_at: "2026-10-13T15:00:00Z" },
    { channel: "messenger", public_url: null, suggested_public_url: null, callback_url: null, last_preflight_at: null, last_preflight_ok: null, last_preflight_results: [], last_event_at: null },
  ],
  local_api: { base_url: "http://127.0.0.1:8001", public_api_url: "https://api-dev.fayfort.com" },
  recent_events: [],
};
const notConfigured = { ...verified, cloudflare: { status: "not_configured", safe_settings: {} }, tunnels: [] };

beforeEach(() => mocks.apiRequest.mockReset());
afterEach(() => cleanup());

describe("Infrastructure page", () => {
  it("connects Cloudflare through the vault endpoint and clears the token field", async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => (String(path).startsWith("/platform/infrastructure/cloudflare/credentials") ? { status: "verified" } : notConfigured));
    render(<InfrastructurePage accessToken="admin-token" />);
    const form = await screen.findByRole("form", { name: "Cloudflare credentials" });
    expect(screen.queryByRole("region", { name: "Cloudflare tunnels" })).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("API token"), { target: { value: "cf-token-value-123456789012" } });
    fireEvent.change(within(form).getByLabelText("Account ID"), { target: { value: "0123456789abcdef0123456789abcdef" } });
    fireEvent.click(within(form).getByRole("button", { name: "Connect and verify" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/platform/infrastructure/cloudflare/credentials", "admin-token", {
      method: "PUT", body: JSON.stringify({ api_token: "cf-token-value-123456789012", account_id: "0123456789abcdef0123456789abcdef", zone_name: "fayfort.com" }),
    }));
    expect(await screen.findByText(/stored in the vault/)).toBeInTheDocument();
    expect(within(form).getByLabelText("API token")).toHaveValue("");
    expect(mocks.apiRequest.mock.calls.every(([path]) => typeof path === "string" && path.startsWith("/platform/infrastructure"))).toBe(true);
  });

  it("shows tunnel health, nameservers and webhook callback, and requires confirmation before a DNS change", async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => (path === "/platform/infrastructure/cloudflare/hostnames" ? { public_url: "https://api-dev.fayfort.com", dns: "created" } : verified));
    render(<InfrastructurePage accessToken="admin-token" />);
    expect(await screen.findByText(/ada.ns.cloudflare.com, bob.ns.cloudflare.com/)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the nameserver change at Hostinger/)).toBeInTheDocument();
    const tunnels = screen.getByRole("region", { name: "Cloudflare tunnels" });
    expect(within(tunnels).getByText("healthy")).toBeInTheDocument();
    expect(within(tunnels).getByText(/https:\/\/api-dev.fayfort.com → http:\/\/127.0.0.1:8001/)).toBeInTheDocument();
    const route = within(tunnels).getByRole("button", { name: "Route hostname" });
    expect(route).toBeDisabled();
    fireEvent.click(within(tunnels).getByLabelText("I confirm this DNS change"));
    fireEvent.click(route);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/platform/infrastructure/cloudflare/hostnames", "admin-token", {
      method: "POST", body: JSON.stringify({ tunnel_id: TUNNEL, label: "api-dev", confirm: true }),
    }));
    const webhooks = screen.getByRole("region", { name: "Webhook endpoints" });
    expect(within(webhooks).getByText("https://api-dev.fayfort.com/webhooks/instagram")).toBeInTheDocument();
    expect(within(webhooks).getByText("reachable")).toBeInTheDocument();
  });
});
