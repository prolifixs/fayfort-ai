import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkforcePage, relativeTime, type WorkerSummary } from "./WorkforcePage";

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const worker = (overrides: Partial<WorkerSummary>): WorkerSummary => ({
  user_id: "w-1",
  email: "ada@example.com",
  display_name: "Ada",
  status: "active",
  online: true,
  last_seen_at: iso(10_000),
  last_sign_in_at: iso(3_600_000),
  invited_at: iso(86_400_000 * 5),
  activated_at: iso(86_400_000 * 4),
  deactivated_at: null,
  handoff_availability: "available",
  mfa_enrolled: true,
  email_confirmed: true,
  open_work_count: 2,
  invitation: null,
  ...overrides,
});
const directory = {
  workers: [
    worker({}),
    worker({ user_id: "w-2", email: "ben@example.com", display_name: "Ben", online: false, last_seen_at: iso(4 * 60_000), mfa_enrolled: false }),
    worker({
      user_id: "w-3", email: "new@example.com", display_name: null, status: "invited", online: false, last_seen_at: null,
      last_sign_in_at: null, invitation: { sent_at: iso(3 * 86_400_000), expires_at: iso(2 * 86_400_000), expired: true, count: 1 },
    }),
  ],
  summary: { total: 3, active: 2, online: 1, invited: 1, inactive: 0, without_mfa: 1 },
  online_window_seconds: 90,
  generated_at: new Date(now).toISOString(),
};
const profile = {
  ...worker({ user_id: "w-2", email: "ben@example.com", display_name: "Ben", online: false, last_seen_at: iso(4 * 60_000) }),
  departments: ["conversation_intake"],
  current_work: [{ id: "item-1", summary: "Reply to customer", department: "conversation_intake", status: "claimed", priority: "high", updated_at: iso(60_000) }],
  recent_activity: [{ work_item_id: "item-1", event_type: "claimed", next_status: "claimed", reason: null, created_at: iso(120_000) }],
  audit: [{ action: "invited", actor_id: "admin", detail: {}, created_at: iso(86_400_000 * 5) }],
  auth_events: [{ event_action: "login", ip_address: "203.0.113.4", created_at: iso(3_600_000) }],
};

let fetchMock: ReturnType<typeof vi.fn>;
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, headers: new Headers() }) as Response;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/platform/workers") && (!init?.method || init.method === "GET")) return ok(directory);
    if (url.endsWith("/platform/workers/w-2")) return ok({ worker: profile });
    if (url.endsWith("/platform/workers/w-2/deactivate"))
      return ok({ worker: { status: "inactive" }, released: { handoffs: 1, work_items: 1, member_requests: 0 } });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("relative times", () => {
  it("reads naturally", () => {
    expect(relativeTime(null)).toBe("Never");
    expect(relativeTime(iso(10_000), now)).toBe("just now");
    expect(relativeTime(iso(4 * 60_000), now)).toBe("4 min ago");
    expect(relativeTime(iso(3 * 3_600_000), now)).toBe("3 h ago");
    expect(relativeTime(iso(3 * 86_400_000), now)).toBe("3 days ago");
  });
});

describe("worker directory", () => {
  it("lists every worker with presence, timestamps, invitation state and two-step status", async () => {
    render(<WorkforcePage accessToken="admin-token" />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByRole("img", { name: "Online" })).toBeInTheDocument();
    expect(within(rows[1]).getByText("Online now")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("img", { name: "Offline" })).toBeInTheDocument();
    expect(within(rows[2]).getByText("4 min ago")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Not set up")).toBeInTheDocument();
    expect(within(rows[3]).getByText(/Link expired/)).toBeInTheDocument();
    expect(screen.getByText("Active without two-step").nextElementSibling).toHaveTextContent("1");
  });

  it("filters by search, status and online", async () => {
    render(<WorkforcePage accessToken="admin-token" />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "ben" } });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "invited" } });
    expect(within(screen.getByRole("table")).getByText("new@example.com")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
    fireEvent.click(screen.getByLabelText("Online only"));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("opens a worker profile with work, sign-ins and audit, and deep-links it", async () => {
    render(<WorkforcePage accessToken="admin-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    const page = await screen.findByRole("region", { name: "Worker profile" });
    expect(await within(page).findByRole("heading", { name: "Ben" })).toBeInTheDocument();
    expect(window.location.search).toBe("?worker=w-2");
    expect(within(page).getByText("Reply to customer")).toBeInTheDocument();
    expect(within(page).getByText(/203\.0\.113\.4/)).toBeInTheDocument();
    expect(within(page).getByText("Invited", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(within(page).getByRole("button", { name: "← All workers" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("requires a reason and confirmation before deactivating", async () => {
    window.history.replaceState({}, "", "/?worker=w-2");
    render(<WorkforcePage accessToken="admin-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    expect(screen.getByText(/signed out everywhere/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason (kept in the audit log)"), { target: { value: "Contract ended" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/2 assignments went back to the queue/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/platform/workers/w-2/deactivate"));
    expect(call?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ reason: "Contract ended" }) });
  });

  it("shows API errors instead of an empty list", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ detail: "Platform administrator access is required." }), headers: new Headers() }) as Response);
    render(<WorkforcePage accessToken="worker-token" />);
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => /Platform administrator/.test(node.textContent || ""))).toBe(true));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
