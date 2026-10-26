import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null, openedAt: { pathname: "", search: "", hash: "" } }));

import { BookingsPanel, type Booking } from "./BookingsPanel";

const CEO = "00000000-0000-0000-0000-00000000ce00";
const ME = "00000000-0000-0000-0000-00000000a551";
const reply = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];

const future = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
const booking: Booking = {
  id: "b1",
  kind: "consultation",
  status: "confirmed",
  starts_at: future,
  ends_at: new Date(Date.parse(future) + 3600_000).toISOString(),
  hold_expires_at: null,
  topic: "Help with Yiwu markets",
  brief: null,
  host_note: null,
  call_link: null,
  member_time_zone: "Africa/Lagos",
  reschedule_count: 0,
  cancel_reason: null,
  cancelled_by: null,
  refund: null,
  work_item_id: "w1",
  host_id: CEO,
  member_id: "m1",
  host: { user_id: CEO, name: "Fay", photo_url: null, staff_role: "ceo" },
  member_name: "Ada",
  conversation_id: "c1",
  payment: { status: "paid", amount: 85, currency: "USD" },
  when_china: "Thu 29 Oct, 15:00 China time",
  needs: ["call_link", "brief"],
};
const me = {
  user_id: ME,
  staff_role: "assistant",
  sees_all: true,
  admin: false,
  ceo_id: CEO,
  hosts: [
    { user_id: CEO, name: "Fay", photo_url: null, staff_role: "ceo", job_title: "CEO", is_self: false },
    { user_id: ME, name: "Amaka", photo_url: null, staff_role: "assistant", job_title: null, is_self: true },
  ],
  settings: {},
};

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/operations/bookings/me")) return reply(me);
      if (url.includes("/operations/bookings?view=")) return reply({ bookings: [booking] });
      if (url.endsWith("/operations/bookings/b1/details")) return reply({ booking: { ...booking, call_link: "https://meet.google.com/abc", needs: ["brief"] } });
      if (url.endsWith("/operations/bookings/b1/cancel")) return reply({ booking: { ...booking, status: "cancelled", refund: "due", needs: ["refund"] } });
      if (url.includes(`/operations/availability/${CEO}`) && method === "GET")
        return reply({ time_zone: "Asia/Shanghai", can_edit: true, weekly: [{ weekday: 2, start_time: "14:00", end_time: "18:00", kinds: ["consultation"] }], time_off: [] });
      if (url.includes(`/operations/availability/${CEO}`) && method === "PUT") return reply({ weekly: [] });
      return reply({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Operations bookings", () => {
  it("lists what needs doing and lets the assistant add the link and cancel with a refund", async () => {
    const openWork = vi.fn();
    render(<BookingsPanel token="t" tourTeam onOpenWorkItem={openWork} />);
    const row = await screen.findByRole("button", { name: /Consultation with Ada/ });
    expect(within(row).getByText("Add the call link")).toBeInTheDocument();
    expect(within(row).getByText(/With Fay/)).toBeInTheDocument();
    fireEvent.click(row);
    const detail = screen.getByRole("article", { name: "Booking" });
    expect(within(detail).getByText(/their time/)).toBeInTheDocument();
    fireEvent.change(within(detail).getByLabelText("Call link"), { target: { value: "https://meet.google.com/abc" } });
    fireEvent.click(within(detail).getByRole("button", { name: "Save link" }));
    expect(await within(detail).findByText(/Call link saved/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/b1/details"))?.body).toEqual({ call_link: "https://meet.google.com/abc" });

    fireEvent.click(within(detail).getByRole("button", { name: "Open the chat with the member" }));
    expect(openWork).toHaveBeenCalledWith("w1");

    fireEvent.click(within(detail).getByRole("button", { name: "Cancel booking" }));
    fireEvent.change(within(detail).getByLabelText("Reason (the member sees it)"), { target: { value: "CEO travelling" } });
    const submit = within(detail).getAllByRole("button", { name: "Cancel booking" }).at(-1)!;
    expect(submit).toBeDisabled();
    fireEvent.click(within(detail).getByLabelText(/Yes, refund/));
    fireEvent.click(submit);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/b1/cancel"))?.body).toEqual({ reason: "CEO travelling", refund: true }));
    expect(await within(detail).findByRole("button", { name: "Mark refunded" })).toBeInTheDocument();
  });

  it("edits the CEO's weekly hours", async () => {
    render(<BookingsPanel token="t" tourTeam={false} />);
    fireEvent.click(await screen.findByRole("tab", { name: "CEO's hours" }));
    expect(await screen.findByLabelText("Wednesday from")).toHaveValue("14:00");
    fireEvent.click(screen.getByRole("button", { name: "+ Add hours on Friday" }));
    fireEvent.change(screen.getByLabelText("Friday to"), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save weekly hours" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT" && c.url.includes("/operations/availability/"))?.body).toEqual({
      time_zone: "Asia/Shanghai",
      weekly: [
        { weekday: 2, start_time: "14:00", end_time: "18:00", kinds: ["consultation"] },
        { weekday: 4, start_time: "14:00", end_time: "17:00", kinds: ["consultation"] },
      ],
    }));
    expect(screen.queryByRole("tab", { name: "Tours" })).toBeNull();
  });
});
