import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationsCenterPage } from "./OperationsCenter";
import { businessReplyNotice } from "./operations/useOperationsCenter";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock("../lib/api", () => ({
  apiRequest: mocks.apiRequest,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));
vi.mock("../lib/supabase", () => ({
  dashboardAuthConfigured: true,
  supabaseClient: { auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange } },
}));

const now = "2026-10-13T12:00:00Z";
const sourcingItem = {
  id: "work-1", department: "sourcing", work_type: "member_request", status: "claimed", priority: "normal",
  summary: "[SYNTHETIC] Desk lamp sourcing", next_action: "Find two supplier options", waiting_on: null,
  waiting_reason: null, due_at: null, assigned_worker_id: "admin-1", assigned_automation_key: null,
  claimed_until: "2026-10-13T12:15:00Z", version: 3, member_request_id: "request-1", member_conversation_id: null,
  business_id: null, business_conversation_id: null, handoff_id: null, dispute_case_id: null, created_at: now,
};
const openItem = { ...sourcingItem, id: "work-2", summary: "[SYNTHETIC] Open fulfillment", department: "fulfillment",
  status: "open", assigned_worker_id: null, member_request_id: null, claimed_until: null };
const requestContext = {
  id: "request-1", product_name_snapshot: null, request_title: "[SYNTHETIC] Desk lamp", request_description: "Warm light",
  source_type: "description", source_url: null, created_at: now, updated_at: now, recurring_schedule: null,
  events: [
    { id: "e1", sequence_no: 1, stage: "submitted", member_note: null, details: {}, media: [], created_at: now },
    { id: "e2", sequence_no: 2, stage: "sourcing", member_note: null, details: {}, media: [], created_at: now },
  ],
};
const workforce = {
  workers: [{ user_id: "worker-1", status: "active", handoff_availability: "available", handoff_available_until: null,
    handoff_max_active: 3, online: true, last_seen_at: now, departments: ["sourcing"], active_work_count: 1,
    current_work: [] }],
  summary: { active_workers: 1, online_workers: 1, active_work_items: 2, automation_owned_work_items: 0, automation_work: [] },
  online_window_seconds: 90,
};
const automationHealth = { summary: { recent_runs: 0, failed_runs: 0, enabled_schedules: 0, schedule_issues: 0 },
  recent_runs: [], schedule_issues: [] };
const report = {
  generated_at: now, period_days: 30,
  work: { total: 2, active: 2, due_overdue: 0, by_department: { sourcing: { claimed: 1 } }, aging: {} },
  sourcing: { requests_by_latest_stage: { sourcing: 1 }, candidates_added: 0, member_options_shared: 0, member_options_selected: 0 },
  disputes: { opened_in_period: 0, active: 0, by_status: {} },
  automation: { runs_in_period: 0, failed_in_period: 0, enabled_schedules: 0, schedules_with_issues: 0 },
  reconciliation: { actionable_requests_missing_work: 0, terminal_requests_with_active_work: 0, active_disputes_missing_work: 0, expired_claims: 0 },
  data_limit_reached: false,
};

function routeApi(identity: { user_id: string; departments: string[]; can_manage: boolean }, items = [sourcingItem, openItem]) {
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path === "/operations/me/departments") return identity;
    if (path.startsWith("/operations/work-items?")) return { work_items: items };
    if (path === "/operations/sourcing/batches") return { batches: [] };
    if (path === "/operations/workforce") return workforce;
    if (path === "/operations/automation-health") return automationHealth;
    if (path.startsWith("/operations/reports?")) return report;
    if (path === "/operations/presence") return {};
    if (path === "/operations/me/notifications") return { notifications: [], unread_count: 0, sound_enabled: false };
    if (path.endsWith("/notes")) return { notes: [] };
    if (path.endsWith("/checklist")) return { items: [] };
    if (path.endsWith("/events")) return { events: [{ id: "we1", sequence_no: 1, event_type: "claimed", actor_type: "worker",
      previous_department: null, next_department: null, previous_status: "open", next_status: "claimed", reason: null, created_at: now }] };
    if (path.endsWith("/mention-options")) return { workers: [] };
    if (path.endsWith("/source-context")) return { source_type: "member_request", request: requestContext };
    if (path.endsWith("/sourcing-candidates")) return { candidates: [] };
    if (path.endsWith("/claim")) return {};
    return {};
  });
}

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "staff-token" } } });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Operations Center", () => {
  it("shows admin workforce, reports, and the queue, then loads the selected request's working context", async () => {
    routeApi({ user_id: "admin-1", departments: [], can_manage: true });
    render(<OperationsCenterPage />);
    expect(await screen.findByRole("region", { name: "Workforce overview" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Operations reports and reconciliation" })).toBeInTheDocument();
    const queue = screen.getByRole("region", { name: "Operations work items" });
    expect(within(queue).getByText("2 shown")).toBeInTheDocument();
    fireEvent.click(within(queue).getByRole("button", { name: /Desk lamp sourcing/ }));
    const detail = screen.getByRole("region", { name: "Selected work details" });
    expect(await within(detail).findByRole("heading", { name: "Member request context" })).toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "Research candidates" })).toBeInTheDocument();
    expect(within(detail).getByRole("heading", { name: "Work history" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/work-1/source-context", "staff-token"),
    );
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/work-1/sourcing-candidates", "staff-token");
  });

  it("keeps workforce and reports admin-only and lets a worker claim available work", async () => {
    routeApi({ user_id: "worker-1", departments: ["fulfillment"], can_manage: false }, [openItem]);
    render(<OperationsCenterPage />);
    const filters = await screen.findByRole("navigation", { name: "Operations queue filters" });
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/me/departments", "staff-token"));
    expect(screen.queryByRole("region", { name: "Workforce overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Operations reports and reconciliation" })).not.toBeInTheDocument();
    expect(mocks.apiRequest).not.toHaveBeenCalledWith("/operations/workforce", "staff-token");
    fireEvent.click(within(within(filters).getByRole("group", { name: "Queue scope" })).getByRole("button", { name: /Available/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Claim / renew" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/work-2/claim", "staff-token", { method: "POST" }),
    );
    expect(await screen.findByText("Work claimed for 15 minutes.")).toBeInTheDocument();
  });

  it("explains business reply delivery outcomes to staff", () => {
    expect(businessReplyNotice("sent")).toBe("Reply sent to the customer.");
    expect(businessReplyNotice("recorded_not_delivered")).toMatch(/nothing was sent to the customer/);
    expect(businessReplyNotice("rejected", "response_window_expired")).toMatch(/within 24 hours/);
    expect(businessReplyNotice("disabled", "outbound_disabled")).toMatch(/outbound delivery is turned off/);
    expect(businessReplyNotice("unknown", "provider_result_uncertain")).toMatch(/could not be confirmed/);
    expect(businessReplyNotice("blocked", "delivery_fields_missing")).toBe("Reply saved. Delivery status: blocked (delivery fields missing).");
  });
});
