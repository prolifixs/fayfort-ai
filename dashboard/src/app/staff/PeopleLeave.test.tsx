import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveSettingsPanel, MyTimeOff, TimeOffPanel } from "./PeopleLeave";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));
const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
const request = { id: "t1", worker_id: "w2", leave_type: "annual", type_name: "Annual leave", status: "requested", start_date: "2026-11-09", end_date: "2026-11-13",
  half_day: null, days: 4, note: "Family visit", decided_at: null, decision_note: null, name: "Ben Li", approver_name: null, clashing_bookings: 2 };
const mine = {
  types: [{ key: "annual", name: "Annual leave" }, { key: "sick", name: "Sick leave" }],
  balances: [{ key: "annual", name: "Annual leave", allowance: 12, used: 2, pending: 4, left: 6 }, { key: "unpaid", name: "Unpaid leave", allowance: null, used: 0, pending: 0, left: null }],
  requests: [], to_answer: [request], work_days: [0, 1, 2, 3, 4],
};

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/hr/my/time-off") && init?.method === "POST") return ok({ ...mine, requests: [{ ...request, worker_id: "me", name: "Me", id: "t2", clashing_bookings: 0 }] }, 201);
    if (url.includes("/hr/my/time-off")) return ok(mine);
    if (url.includes("/hr/time-off/t1/decide")) return ok({ time_off: { ...request, status: "approved" } });
    if (url.includes("/hr/time-off?month=")) return ok({ month: "2026-11", first: "2026-11-01", last: "2026-11-30", leave: [{ ...request, status: "approved" }], waiting: [request],
      holidays: [{ day: "2026-11-11", name: "Company day" }], work_days: [0, 1, 2, 3, 4] });
    if (url.includes("/hr/leave-settings")) return ok({ leave_types: [{ key: "annual", name: "Annual leave", yearly_days: null, needs_approval: true, active: true }], work_days: [0, 1, 2, 3, 4], holidays: [] });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Time off", () => {
  it("shows balances, asks for time off and lets a manager answer their team", async () => {
    render(<MyTimeOff accessToken="t" />);
    expect(await screen.findByText(/6 days left of 12 days · 4 days waiting/)).toBeInTheDocument();
    const team = screen.getByText("Requests from your team").parentElement!;
    expect(within(team).getByText(/2 bookings in those days/)).toBeInTheDocument();
    fireEvent.click(within(team).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/time-off/t1/decide"), expect.objectContaining({ body: JSON.stringify({ decision: "approve", note: null }) })));
    fireEvent.click(screen.getByRole("button", { name: "Ask for time off" }));
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-11-16" } });
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "afternoon" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => {
      const sent = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/hr/my/time-off") && init?.method === "POST");
      expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ leave_type: "annual", start_date: "2026-11-16", end_date: "2026-11-16", half_day: "afternoon", note: null });
    });
    expect(await screen.findByText("Request sent. You'll get a notice when it's answered.")).toBeInTheDocument();
  });

  it("shows who is away in the month and what is waiting", async () => {
    render(<TimeOffPanel accessToken="t" />);
    expect(await screen.findByText("Waiting for an answer")).toBeInTheDocument();
    const calendar = await screen.findByRole("grid");
    expect(within(calendar).getAllByRole("gridcell", { name: /Ben Li away/ })).toHaveLength(5);
    expect(within(calendar).getByText("Company day")).toBeInTheDocument();
  });

  it("saves allowances", async () => {
    render(<LeaveSettingsPanel accessToken="t" />);
    fireEvent.change(await screen.findByLabelText("Annual leave days a year"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save leave settings" }));
    await waitFor(() => {
      const sent = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(sent?.[1]?.body)).leave_types[0]).toEqual({ key: "annual", yearly_days: 12, active: true, needs_approval: true });
    });
  });
});
