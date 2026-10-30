import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyHr, PoliciesPanel, RecordsPanel } from "./PeopleRecords";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));
const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
const personal = { legal_name: null, preferred_name: null, phone: null, country: null, city: null, date_of_birth: null, emergency_name: null, emergency_relationship: null, emergency_phone: null };
const person = {
  worker_id: "w2", name: "Ben Li", photo_url: null, staff_role: "staff", account_status: "active", status: "active", desks: ["Sourcing desk"],
  job: { job_title: "Sourcing agent", job_type: "full_time", location: "guangzhou", start_date: "2026-03-01", probation_end: "2026-10-01", hours_per_week: 40, manager_id: null, status: "active", probation_passed_at: null },
  manager_name: null, personal, documents: [{ id: "d1", kind: "offer", kind_label: "Offer letter", title: "Signed offer: Sourcing agent", file_name: null, file_size: null, offer_id: "o1", visible_to_worker: true, created_at: "2026-02-20T00:00:00Z" }],
  policies: [{ id: "p1", title: "Customer data handling", summary: "", version: 2, published_at: "2026-10-01", accepted_at: null, accepted_before: true }],
  timeline: [{ id: "e1", kind: "hired", detail: { job_title: "Sourcing agent" }, created_at: "2026-02-20T00:00:00Z", actor_name: "Ada Eze" }],
};
const policy = { id: "p1", title: "Customer data handling", summary: "Keep details private.", body: "Use member details only for FayFort work.", status: "published", version: 2, published_at: "2026-10-01", has_changes: true, accepted: 3, team_size: 5 };

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/hr/people")) return ok({ people: [{ worker_id: "w2", name: "Ben Li", photo_url: null, staff_role: "staff", job_title: "Sourcing agent", start_date: "2026-03-01", status: "active", has_record: true, probation_due: true, probation_end: "2026-10-01", policies_to_read: 1 }] });
    if (url.includes("/hr/people/w2/probation")) return ok({ person: { ...person, job: { ...person.job, probation_passed_at: "2026-10-30T00:00:00Z" } } });
    if (url.includes("/hr/people/w2") && init?.method === "PUT") return ok({ person: { ...person, job: { ...person.job, hours_per_week: 35 } } });
    if (url.includes("/hr/people/w2")) return ok({ person });
    if (url.includes("/hr/documents/d1")) return ok({ text: "Dear Ben Li, we are delighted…", signed_by: "Ben Li", signed_at: "2026-02-19T00:00:00Z" });
    if (url.includes("/hr/policies/p1/publish")) return ok({ policy: { ...policy, version: 3, has_changes: false } });
    if (url.includes("/hr/policies/p1/acknowledgements")) return ok({ version: 2, people: [{ worker_id: "w2", name: "Ben Li", accepted_at: null }] });
    if (url.includes("/hr/policies")) return ok({ policies: [policy] });
    if (url.includes("/hr/my/time-off")) return ok({ types: [{ key: "annual", name: "Annual leave" }], balances: [], requests: [], to_answer: [], work_days: [0, 1, 2, 3, 4] });
    if (url.includes("/hr/my/policies/p1/accept")) return ok({ policies: [{ ...person.policies[0], accepted_at: "2026-10-30T00:00:00Z" }] });
    if (url.includes("/hr/my/policies/p1")) return ok({ policy: { id: "p1", title: "Customer data handling", body: "Use member details only for FayFort work.", version: 2 } });
    if (url.includes("/hr/my")) return ok({ job: { job_title: "Sourcing agent", job_type: "full_time", location: "guangzhou", start_date: "2026-03-01", probation_end: null, hours_per_week: 40, manager: "Ada Eze" },
      personal, documents: person.documents, policies: person.policies });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("People records, policies and My HR", () => {
  it("opens a record, passes probation, saves the job and reads the signed offer", async () => {
    render(<RecordsPanel accessToken="t" />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben Li.*Probation review/ }));
    const panel = await screen.findByRole("dialog", { name: "Ben Li" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Pass probation" }));
    expect(await within(panel).findByText("Probation passed.")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Hours a week"), { target: { value: "35" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save job details" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/people/w2"), expect.objectContaining({ method: "PUT" })));
    const sent = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ hours_per_week: 35, job_title: "Sourcing agent", manager_id: null });
    fireEvent.click(within(panel).getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("dialog", { name: "Signed offer" })).toHaveTextContent("Dear Ben Li");
  });

  it("publishes a new version after confirming", async () => {
    render(<PoliciesPanel accessToken="t" />);
    expect(await screen.findByText("v2 · 3/5 accepted · unpublished changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Customer data handling/ }));
    expect(await screen.findByText("Who has accepted version 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    expect(screen.getByText(/Publish this as version 3\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/policies/p1/publish"), expect.objectContaining({ method: "POST" })));
  });

  it("lets a team member read and accept a policy in My HR", async () => {
    render(<MyHr accessToken="t" />);
    expect(await screen.findByText("1 to read")).toBeInTheDocument();
    expect(screen.getByText("Updated: please read the new version")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read" }));
    const reader = await screen.findByRole("dialog", { name: "Customer data handling" });
    expect(within(reader).getByRole("button", { name: "Accept" })).toBeDisabled();
    fireEvent.click(within(reader).getByRole("checkbox"));
    fireEvent.click(within(reader).getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Thank you. Policy accepted.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/my/policies/p1/accept"), expect.objectContaining({ body: JSON.stringify({ version: 2 }) }));
  });
});
