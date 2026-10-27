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

function onboardingFor(identity: { departments: string[] }, over: Record<string, unknown>) {
  const checklist = [
    { key: "tour", title: "Take the welcome tour", how: "A walk through.", done: false },
    { key: "clock_in", title: "Clock in for your first shift", how: "Clock in at the top.", done: false },
    { key: "claim", title: "Claim your first item", how: "Press Claim.", done: false },
    { key: "guide_x", title: "Read how your desk works", how: "Guide.", done: false },
  ];
  return { show_tour: false, completed_at: null, job_title: "Sourcing agent", departments: identity.departments.slice().sort(), checklist, done: 0, total: checklist.length, ...over };
}
const rail = () => screen.findByRole("navigation", { name: "Operations desks" });
function desksFor(identity: { departments: string[]; can_manage: boolean }) {
  const all = ["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team"];
  return {
    mine: 1, mine_due_today: 0, mine_overdue: 0,
    desks: (identity.can_manage ? all : identity.departments).map((department) => ({
      department, total: 1, available: 1, mine: 0, waiting: 0, overdue: department === "sourcing" ? 1 : 0,
      stages: department === "sourcing" ? [{ key: "review", label: "Review", count: 1 }, { key: "sourcing", label: "Sourcing", count: 0 }] : [],
    })),
  };
}

function routeApi(identity: { user_id: string; departments: string[]; can_manage: boolean }, items: Record<string, unknown>[] = [sourcingItem, openItem], onboardingOver: Record<string, unknown> = {}) {
  mocks.apiRequest.mockImplementation(async (path: string) => {
    if (path === "/operations/me/onboarding") return onboardingFor(identity, onboardingOver);
    if (path === "/operations/me/departments") return identity;
    if (path.startsWith("/operations/work-items?")) return { work_items: items };
    if (path === "/operations/sourcing/batches") return { batches: [] };
    if (path === "/operations/desks") return desksFor(identity);
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
    fireEvent.click(within(await rail()).getByRole("button", { name: "Team" }));
    expect(await screen.findByRole("region", { name: "Workforce overview" })).toBeInTheDocument();
    fireEvent.click(within(await rail()).getByRole("button", { name: "Reports" }));
    expect(await screen.findByRole("region", { name: "Operations reports and reconciliation" })).toBeInTheDocument();
    fireEvent.click(within(await rail()).getByRole("button", { name: /My work/ }));
    // Administrators keep All work on My work.
    fireEvent.click(within(screen.getByRole("group", { name: "Queue scope" })).getByRole("button", { name: "All work" }));
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
    expect(filters).toBeInTheDocument();
    // Workers pick up work on their desk: open Fulfillment, then Free to pick up.
    fireEvent.click(within(await rail()).getByRole("button", { name: /Fulfillment/ }));
    expect(await screen.findByRole("region", { name: "Fulfillment desk" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(expect.stringMatching(/scope=desk.*department=fulfillment/), "staff-token"));
    fireEvent.click(within(screen.getByRole("group", { name: "Queue scope" })).getByRole("button", { name: "Free to pick up" }));
    fireEvent.click(await within(screen.getByRole("region", { name: "Operations work items" })).findByRole("button", { name: "Claim" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/work-2/claim", "staff-token", { method: "POST" }),
    );
    expect(await screen.findByText("Work claimed for 15 minutes.")).toBeInTheDocument();
  });

  it("opens on My work and filters a desk by its pipeline stage", async () => {
    const review = { ...sourcingItem, id: "work-3", summary: "[SYNTHETIC] New lamp request", status: "open", assigned_worker_id: null, desk_stage: "review" };
    const researching = { ...sourcingItem, id: "work-4", summary: "[SYNTHETIC] Lamp research", desk_stage: "sourcing" };
    routeApi({ user_id: "worker-1", departments: ["sourcing"], can_manage: false }, [review, researching]);
    window.history.replaceState(null, "", "/operations");
    render(<OperationsCenterPage />);
    const home = await screen.findByRole("region", { name: "My work" });
    expect(await within(home).findByRole("button", { name: /Sourcing.*1 free to pick up.*1 overdue/ })).toBeInTheDocument();
    const nav = await rail();
    expect(within(nav).queryByRole("button", { name: /Disputes/ })).not.toBeInTheDocument(); // only my desks
    expect(within(nav).queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
    fireEvent.click(within(home).getByRole("button", { name: /Sourcing/ }));
    const desk = await screen.findByRole("region", { name: "Sourcing desk" });
    expect(window.location.search).toContain("desk=sourcing");
    const strip = within(desk).getByRole("group", { name: "Pipeline" });
    fireEvent.click(within(strip).getByRole("button", { name: /Review/ }));
    const queue = screen.getByRole("region", { name: "Operations work items" });
    await waitFor(() => expect(within(queue).getByText("1 shown")).toBeInTheDocument());
    expect(within(queue).getByRole("button", { name: /New lamp request/ })).toBeInTheDocument();
    expect(within(queue).queryByRole("button", { name: /Lamp research/ })).not.toBeInTheDocument();
    fireEvent.click(within(strip).getByRole("button", { name: /All/ }));
    await waitFor(() => expect(within(queue).getByText("2 shown")).toBeInTheDocument());
    window.history.replaceState(null, "", "/");
  });

  it("lets the worker who claimed a sourcing request ask the member a question from the step panel", async () => {
    const mine = { ...sourcingItem, assigned_worker_id: "worker-1" };
    routeApi({ user_id: "worker-1", departments: ["sourcing"], can_manage: false }, [mine]);
    render(<OperationsCenterPage />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Operations work items" })).findByRole("button", { name: /Desk lamp sourcing/ }));
    expect(await screen.findByRole("region", { name: "Steps for this work" })).toBeInTheDocument();
    fireEvent.change(await screen.findByRole("combobox", { name: "Next request stage" }), { target: { value: "needs_member_input" } });
    const question = screen.getByRole("textbox", { name: /Your question for the member/ });
    expect(question).toBeRequired();
    fireEvent.change(question, { target: { value: "Which length would you like?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/workers/requests/request-1/events", "staff-token", {
        method: "POST", body: JSON.stringify({ stage: "needs_member_input", member_note: "Which length would you like?" }),
      }),
    );
  });

  it("asks for the delivery estimate before a request can move to Sourcing", async () => {
    const reviewing = { ...requestContext, eta_at: null, events: requestContext.events.slice(0, 1).concat([{ ...requestContext.events[0], id: "e9", sequence_no: 2, stage: "under_review" }]) };
    const mine = { ...sourcingItem, assigned_worker_id: "worker-1" };
    routeApi({ user_id: "worker-1", departments: ["sourcing"], can_manage: false }, [mine]);
    const base = mocks.apiRequest.getMockImplementation()!;
    mocks.apiRequest.mockImplementation(async (path: string, token: string, init?: RequestInit) =>
      path.endsWith("/source-context") ? { source_type: "member_request", request: reviewing } : base(path, token, init),
    );
    render(<OperationsCenterPage />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Operations work items" })).findByRole("button", { name: /Desk lamp sourcing/ }));
    expect(await screen.findByRole("region", { name: "Delivery estimate (ETA)" })).toBeInTheDocument();
    fireEvent.change(await screen.findByRole("combobox", { name: "Next request stage" }), { target: { value: "sourcing" } });
    fireEvent.change(screen.getByLabelText("Estimated delivery date", { selector: "input[aria-label]" }), { target: { value: "2030-01-05T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Update stage" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/workers/requests/request-1/events", "staff-token", expect.anything()),
    );
    const calls = mocks.apiRequest.mock.calls.map(([path]) => path);
    expect(calls.indexOf("/operations/work-items/work-1/due")).toBeGreaterThan(-1);
    expect(calls.indexOf("/operations/work-items/work-1/due")).toBeLessThan(calls.indexOf("/workers/requests/request-1/events"));
  });

  it("needs a reason to change an existing ETA", async () => {
    const withEta = { ...requestContext, eta_at: "2030-01-05T12:00:00Z", eta_updated_at: now, eta_changes: [] };
    const mine = { ...sourcingItem, assigned_worker_id: "worker-1", due_at: "2030-01-05T12:00:00Z" };
    routeApi({ user_id: "worker-1", departments: ["sourcing"], can_manage: false }, [mine]);
    const base = mocks.apiRequest.getMockImplementation()!;
    mocks.apiRequest.mockImplementation(async (path: string, token: string, init?: RequestInit) =>
      path.endsWith("/source-context") ? { source_type: "member_request", request: withEta } : base(path, token, init),
    );
    render(<OperationsCenterPage />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Operations work items" })).findByRole("button", { name: /Desk lamp sourcing/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Change the ETA" }));
    const form = screen.getByRole("form", { name: /Change the delivery estimate/ });
    fireEvent.change(within(form).getByLabelText("New date"), { target: { value: "2030-01-09T12:00" } });
    expect(within(form).getByRole("button", { name: "Save new date" })).toBeDisabled();
    fireEvent.change(within(form).getByRole("textbox", { name: /Reason for the change/ }), { target: { value: "Supplier restocks Friday" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save new date" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/work-1/due", "staff-token", {
        method: "POST", body: JSON.stringify({ due_at: new Date("2030-01-09T12:00").toISOString(), reason: "Supplier restocks Friday" }),
      }),
    );
  });

  it("lists finished work in the Archive and lets an admin reopen it with a reason", async () => {
    const done = { ...sourcingItem, id: "work-9", status: "completed", summary: "[SYNTHETIC] Packed order 1001",
      assigned_worker_id: null, claimed_until: null, completed_at: now };
    routeApi({ user_id: "admin-1", departments: [], can_manage: true }, [done]);
    render(<OperationsCenterPage />);
    fireEvent.click(within(await rail()).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(expect.stringMatching(/^\/operations\/work-items\?.*view=archive.*days=30/), "staff-token"),
    );
    fireEvent.click(await within(screen.getByRole("region", { name: "Operations work items" })).findByRole("button", { name: /Packed order 1001/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Reopen with a reason" }), { target: { value: "Customer wrote back" } });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/work-items/work-9/reopen", "staff-token", {
        method: "POST", body: JSON.stringify({ reason: "Customer wrote back" }),
      }),
    );
  });

  it("opens a guide for every desk and every work type from the Guide", async () => {
    routeApi({ user_id: "worker-1", departments: ["fulfillment"], can_manage: false }, [openItem]);
    render(<OperationsCenterPage />);
    fireEvent.click(within(await rail()).getByRole("button", { name: "Guide" }));
    const index = await screen.findByRole("complementary", { name: "Guides" });
    const topLevel = within(index).getAllByRole("button").map((button) => button.textContent || "");
    expect(topLevel).toEqual(expect.arrayContaining(["Welcome tour", "Fulfillment desk", "Sourcing desk", "Glossary"]));
    let workGuides = 0;
    for (const name of topLevel) {
      fireEvent.click(within(index).getByRole("button", { name }));
      expect(screen.getByRole("heading", { level: 2, name: name.replace(/ · \d+\/\d+$/, "") })).toBeInTheDocument();
      if (name.endsWith(" desk")) {
        const article = screen.getByRole("heading", { level: 2, name }).closest("article")!;
        for (const work of within(article).queryAllByRole("button").map((button) => button.textContent || "")) {
          fireEvent.click(within(screen.getByRole("heading", { level: 2, name }).closest("article")!).getByRole("button", { name: work }));
          expect(screen.getByRole("heading", { level: 2, name: work })).toBeInTheDocument();
          workGuides += 1;
          fireEvent.click(within(index).getByRole("button", { name }));
        }
      }
    }
    expect(workGuides).toBeGreaterThan(15);
    // Reading your own desk's guide ticks it on the checklist.
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/me/onboarding/guide_fulfillment", "staff-token", { method: "POST" });
    window.history.replaceState(null, "", "/");
  });

  it("welcomes a new worker with the tour on their first visit, then shows their first week", async () => {
    routeApi({ user_id: "worker-1", departments: ["sourcing", "conversation_intake"], can_manage: false }, [openItem], { show_tour: true });
    window.history.replaceState(null, "", "/operations");
    render(<OperationsCenterPage />);
    const tour = await screen.findByRole("dialog", { name: "Welcome to the FayFort team" });
    expect(within(tour).getByText(/You're on Conversations and Sourcing as Sourcing agent/)).toBeInTheDocument();
    for (let step = 0; step < 5; step += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next" }));
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Your first week" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Start working" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.apiRequest).toHaveBeenCalledWith("/operations/me/onboarding/tour", "staff-token", { method: "POST" });
    const week = await screen.findByRole("region", { name: "Your first week" }, { timeout: 3000 });
    expect(within(week).getByText(/1 of 4 done/)).toBeInTheDocument();
    expect(within(week).getByText("Clock in for your first shift")).toBeInTheDocument();
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
