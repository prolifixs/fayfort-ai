import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeoplePage, type HrJob } from "./PeoplePage";

vi.mock("../../lib/supabase", () => ({ dashboardAuthConfigured: true, supabaseClient: null }));

const ok = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: new Headers() }) as Response;
let fetchMock: ReturnType<typeof vi.fn>;
const job: HrJob = {
  id: "j1", slug: "sourcing-agent", title: "Sourcing agent", department: "sourcing", job_type: "full_time", location: "guangzhou",
  pay_range: null, show_pay: false, summary: "Find suppliers.", duties: ["Search markets"], requirements: ["Mandarin"], questions: [],
  trial_task: false, trial_paid: false, status: "draft", counts: { applied: 1 },
};
const options = { departments: { sourcing: "Sourcing desk" }, job_types: { full_time: "Full time" }, locations: { guangzhou: "Guangzhou office" } };
const detail = {
  application: { id: "a1", stage: "applied", answers: [{ label: "Worked in Baima?", answer: "Yes" }], cv_name: "amaka-cv.pdf", has_cv: true,
    portfolio_url: null, heard_from: "Instagram", close_reason: null, created_at: "2026-10-30T10:00:00Z" },
  candidate: { full_name: "Amaka Obi", email: "amaka@example.com", phone: null, location: "Lagos", languages: "English", retain_until: "2027-10-30" },
  job: { id: "j1", title: "Sourcing agent", trial_task: false }, other_applications: [],
  events: [{ id: "e1", kind: "applied", detail: {}, created_at: "2026-10-30T10:00:00Z" }],
};

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/hr/jobs") && init?.method === "POST") return ok({ job: { ...job, id: "j2", title: JSON.parse(String(init.body)).title } }, 201);
    if (url.includes("/hr/jobs/j1/status")) return ok({ job: { ...job, status: "open" } });
    if (url.endsWith("/hr/jobs")) return ok({ jobs: [job], ...options });
    if (url.includes("/hr/applications/a1/stage")) return ok({ ...detail, application: { ...detail.application, stage: "interview" } });
    if (url.includes("/hr/applications/a1")) return ok(detail);
    if (url.includes("/hr/applications")) return ok({ applications: [{ id: "a1", job_id: "j1", job_title: "Sourcing agent", stage: "applied",
      created_at: "2026-10-30T10:00:00Z", name: "Amaka Obi", email: "amaka@example.com", location: "Lagos", languages: "English" }] });
    if (url.includes("/hr/access")) return ok({ workers: [{ user_id: "w1", name: "Ada", status: "active", staff_role: "staff", job_title: "HR lead", hr_access: false }] });
    return ok({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Control Center People", () => {
  it("lists jobs and applications by stage, opens a candidate and moves them on", async () => {
    render(<PeoplePage accessToken="t" platformAdmin={false} />);
    expect(screen.queryByRole("tab", { name: "HR access" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Sourcing agent/ })).toHaveTextContent("1 new");
    const applied = await screen.findByRole("region", { name: "Applied" });
    fireEvent.click(within(applied).getByRole("button", { name: /Amaka Obi/ }));
    const panel = await screen.findByRole("dialog", { name: "Amaka Obi" });
    expect(await within(panel).findByText("Worked in Baima?")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Open CV (amaka-cv.pdf)" })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Stage"), { target: { value: "interview" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/applications/a1/stage"), expect.objectContaining({ method: "POST" })));
  });

  it("creates a job with questions and opens a job on the careers page", async () => {
    render(<PeoplePage accessToken="t" platformAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "New job" }));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Store assistant" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a question" }));
    fireEvent.change(screen.getByLabelText("Question 1"), { target: { value: "Can you start in November?" } });
    fireEvent.change(screen.getByLabelText("Answer type for question 1"), { target: { value: "yes_no" } });
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/hr/jobs") && init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body)).questions).toEqual([{ label: "Can you start in November?", kind: "yes_no", options: [], required: true }]);
    });
    fireEvent.click(await screen.findByRole("button", { name: /Sourcing agent/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open on the careers page" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/jobs/j1/status"), expect.objectContaining({ body: JSON.stringify({ status: "open" }) })));
  });

  it("lets the owner give HR access", async () => {
    render(<PeoplePage accessToken="t" platformAdmin />);
    fireEvent.click(screen.getByRole("tab", { name: "HR access" }));
    fireEvent.click(await screen.findByRole("switch", { name: "HR access for Ada" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/access/w1"), expect.objectContaining({ method: "PUT", body: JSON.stringify({ hr_access: true }) })));
  });
});
