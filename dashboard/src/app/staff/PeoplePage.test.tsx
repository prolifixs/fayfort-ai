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
  interviews: [], can_manage: true,
  scorecards: { skills: ["Mandarin", "Market knowledge"], count: 0, hidden: 0, can_score: false, mine: null, cards: [], summary: null },
};

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/hr/jobs") && init?.method === "POST") return ok({ job: { ...job, id: "j2", title: JSON.parse(String(init.body)).title } }, 201);
    if (url.includes("/hr/jobs/j1/status")) return ok({ job: { ...job, status: "open" } });
    if (url.endsWith("/hr/jobs")) return ok({ jobs: [job], ...options });
    if (url.includes("/hr/interviewers")) return ok({ workers: [{ user_id: "w1", name: "Ada", job_title: "HR lead" }, { user_id: "w2", name: "Ben", job_title: null }] });
    if (url.includes("/hr/applications/a1/interviews")) return ok({ ...detail, interviews: [{ id: "i1", status: "proposed", minutes: 45, window_days: 14,
      starts_at: null, ends_at: null, candidate_time_zone: null, call_link: null, message: null, reschedule_count: 0, interviewers: [{ worker_id: "w1", name: "Ada", booking_id: null }] }] }, 201);
    if (url.includes("/hr/my-interviews")) return ok({ interviews: [{ id: "i9", status: "completed", minutes: 30, window_days: 14, starts_at: "2026-10-29T03:00:00Z",
      ends_at: "2026-10-29T03:30:00Z", candidate_time_zone: null, call_link: null, message: null, reschedule_count: 0, application_id: "a1",
      candidate: "Amaka Obi", job_title: "Sourcing agent", scorecard_done: false }] });
    if (url.includes("/hr/interviews/i9/scorecard")) return ok({ scorecards: { ...detail.scorecards, count: 1, can_score: true,
      mine: { ratings: { Mandarin: 4, "Market knowledge": 3 }, decision: "yes", note: null },
      cards: [{ interviewer: "You", ratings: { Mandarin: 4, "Market knowledge": 3 }, decision: "yes", note: null, submitted_at: "2026-10-29T04:00:00Z", is_mine: true }], summary: null } });
    if (url.includes("/hr/applications/a1/stage")) return ok({ ...detail, application: { ...detail.application, stage: "interview" } });
    if (url.includes("/hr/applications/a1")) return ok(detail);
    if (url.includes("/hr/applications")) return ok({ close_reasons: ["Language skills", "Other"], emailed_stages: ["screening", "interview", "not_moving_forward"], applications: [{ id: "a1", job_id: "j1", job_title: "Sourcing agent", stage: "applied",
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
  it("arranges an interview with chosen interviewers", async () => {
    render(<PeoplePage accessToken="t" platformAdmin={false} />);
    fireEvent.click(within(await screen.findByRole("region", { name: "Applied" })).getByRole("button", { name: /Amaka Obi/ }));
    const panel = await screen.findByRole("dialog", { name: "Amaka Obi" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Arrange an interview" }));
    fireEvent.click(await within(panel).findByRole("checkbox", { name: /Ada/ }));
    fireEvent.change(within(panel).getByLabelText("Length"), { target: { value: "45" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send interview invitation" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/applications/a1/interviews"),
      expect.objectContaining({ body: JSON.stringify({ interviewer_ids: ["w1"], minutes: 45, window_days: 14, call_link: null, message: null }) })));
    expect(await within(panel).findByText("Waiting for the candidate to pick a time")).toBeInTheDocument();
  });

  it("lets an interviewer without HR access score a candidate from My interviews", async () => {
    detail.can_manage = false;
    detail.scorecards = { ...detail.scorecards, can_score: true };
    detail.interviews = [{ id: "i9", status: "completed", minutes: 30, window_days: 14, starts_at: "2026-10-29T03:00:00Z", ends_at: "2026-10-29T03:30:00Z",
      candidate_time_zone: null, call_link: null, message: null, reschedule_count: 0 }] as never;
    render(<PeoplePage accessToken="t" platformAdmin={false} canHire={false} hasInterviews />);
    expect(screen.queryByRole("tab", { name: "Hiring" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Amaka Obi.*Score now/ }));
    const panel = await screen.findByRole("dialog", { name: "Amaka Obi" });
    expect(within(panel).queryByRole("button", { name: "Arrange an interview" })).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText("Stage")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("radio", { name: "Mandarin: 4" }));
    fireEvent.click(within(panel).getByRole("radio", { name: "Market knowledge: 3" }));
    fireEvent.click(within(panel).getByRole("radio", { name: "Yes" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Submit scorecard" }));
    expect(await within(panel).findByText("You")).toBeInTheDocument();
    detail.can_manage = true;
    detail.interviews = [];
    detail.scorecards = { ...detail.scorecards, can_score: false };
  });

  it("lists jobs and applications by stage, opens a candidate and moves them on", async () => {
    render(<PeoplePage accessToken="t" platformAdmin={false} />);
    expect(screen.queryByRole("tab", { name: "HR access" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Sourcing agent/ })).toHaveTextContent("1 new");
    const applied = await screen.findByRole("region", { name: "Applied" });
    fireEvent.click(within(applied).getByRole("button", { name: /Amaka Obi/ }));
    const panel = await screen.findByRole("dialog", { name: "Amaka Obi" });
    expect(await within(panel).findByText("Worked in Baima?")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Open CV (amaka-cv.pdf)" })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Stage"), { target: { value: "not_moving_forward" } });
    expect(within(panel).getByRole("button", { name: "Move" })).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText(/Reason/), { target: { value: "Language skills" } });
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Email Amaka about this" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/hr/applications/a1/stage"),
      expect.objectContaining({ body: JSON.stringify({ stage: "not_moving_forward", reason: "Language skills", notify: false }) })));
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
