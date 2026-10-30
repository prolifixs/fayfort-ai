/** HR and hiring H1: Control Center -> People -> Hiring. Screenshots in test-results/hr/. */
import { expect, test } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

const job = { id: "j1", slug: "sourcing-agent", title: "Sourcing agent", department: "sourcing", job_type: "full_time", location: "guangzhou",
  pay_range: null, show_pay: false, summary: "Find the right suppliers in Guangzhou for members.", duties: ["Search markets"], requirements: ["Mandarin"],
  questions: [{ id: "q1", label: "Have you worked in Baima market?", kind: "yes_no", options: [], required: true }], trial_task: true, trial_paid: true,
  status: "open", counts: { applied: 2, screening: 1, interview: 1 } };
const job2 = { ...job, id: "j2", slug: "member-support-specialist", title: "Member support specialist", status: "draft", counts: {} };
const people = [["Amaka Obi", "Lagos, Nigeria", "applied"], ["Kofi Mensah", "Accra, Ghana", "applied"], ["Li Wei", "Guangzhou, China", "screening"], ["Grace Wanjiru", "Nairobi, Kenya", "interview"]];
const applications = people.map(([name, location, stage], i) => ({ id: `a${i}`, job_id: "j1", job_title: "Sourcing agent", stage, name, location,
  email: `p${i}@example.com`, languages: "English", created_at: new Date(Date.now() - i * 86400000).toISOString() }));
const detail = { application: { id: "a0", stage: "applied", answers: [{ label: "Have you worked in Baima market?", answer: "Yes" }, { label: "Which shift suits you best?", answer: "Morning" }],
  cv_name: "amaka-cv.pdf", has_cv: true, portfolio_url: "https://linkedin.com/in/amaka", heard_from: "Instagram", close_reason: null, created_at: new Date().toISOString() },
  candidate: { full_name: "Amaka Obi", email: "amaka@example.com", phone: "+234 800 000 0000", location: "Lagos, Nigeria", languages: "English, Mandarin", retain_until: "2027-10-30" },
  job: { id: "j1", title: "Sourcing agent", trial_task: true }, other_applications: [],
  events: [{ id: "e1", kind: "applied", detail: {}, created_at: new Date().toISOString() }, { id: "e2", kind: "email_sent", detail: {}, created_at: new Date().toISOString() }] };

for (const size of [{ n: "laptop", w: 1440, h: 900 }, { n: "phone", w: 390, h: 844 }]) test(`people hiring ${size.n}`, async ({ page }) => {
  await page.setViewportSize({ width: size.w, height: size.h });
  await signedInStaff(page);
  await page.route("**/hr/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/hr/jobs") return route.fulfill({ json: { jobs: [job, job2], departments: { sourcing: "Sourcing desk", member_support: "Member support" }, job_types: { full_time: "Full time" }, locations: { guangzhou: "Guangzhou office" } } });
    if (path === "/hr/applications") return route.fulfill({ json: { applications, close_reasons: ["Language skills", "Other"], emailed_stages: ["screening", "interview", "trial_task", "offer", "not_moving_forward"] } });
    if (path.endsWith("/stage")) { moves.push(route.request().postDataJSON()); return route.fulfill({ json: detail }); }
    if (path.startsWith("/hr/applications/")) return route.fulfill({ json: detail });
    if (path === "/hr/access") return route.fulfill({ json: { workers: [{ user_id: "w1", name: "Ada Eze", status: "active", staff_role: "staff", job_title: "HR lead", hr_access: true }, { user_id: "w2", name: "Fay", status: "active", staff_role: "ceo", job_title: "CEO", hr_access: false }] } });
    return route.fulfill({ json: {} });
  });
  const moves: unknown[] = [];
  await page.goto("/?page=people");
  await expect(page.getByRole("region", { name: "Applied" })).toBeVisible();
  if (size.n === "laptop") {
    // Board on a computer: drag Kofi to Interview, choose not to email him.
    await expect(page.getByRole("radio", { name: "Board" })).toBeChecked();
    await page.getByRole("button", { name: /Kofi Mensah/ }).dragTo(page.getByRole("region", { name: "Interview" }));
    const dialog = page.getByRole("dialog", { name: "Move Kofi to Interview?" });
    await expect(dialog.getByRole("checkbox", { name: "Email Kofi about this" })).toBeChecked();
    await page.screenshot({ path: `test-results/hr/people-board-move-${size.n}.png` });
    await dialog.getByRole("checkbox", { name: "Email Kofi about this" }).uncheck();
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect.poll(() => moves).toEqual([{ stage: "interview", reason: null, notify: false }]);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/hr/people-hiring-${size.n}.png`, fullPage: size.n === "phone" });
  await page.getByRole("region", { name: "Applied" }).getByRole("button", { name: /Amaka Obi/ }).click();
  await expect(page.getByRole("dialog", { name: "Amaka Obi" }).getByText("Which shift suits you best?")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/hr/people-candidate-${size.n}.png` });
  await page.keyboard.press("Escape");
  if (size.n === "laptop") {
    await page.getByRole("button", { name: "New job" }).click();
    await page.screenshot({ path: `test-results/hr/people-new-job-${size.n}.png`, fullPage: true });
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("tab", { name: "HR access" }).click();
    await expect(page.getByRole("switch", { name: "HR access for Ada Eze" })).toBeChecked();
    await page.screenshot({ path: `test-results/hr/people-access-${size.n}.png` });
  }
});

test("old workforce links open the Team tab", async ({ page }) => {
  await signedInStaff(page);
  await page.goto("/?page=workforce");
  await expect(page.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
});

test("a candidate with a booked interview and scorecards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedInStaff(page);
  const soon = new Date(Date.now() - 2 * 3600000).toISOString();
  const withInterview = { ...detail, can_manage: true,
    interviews: [{ id: "i1", status: "completed", minutes: 45, window_days: 14, starts_at: soon, ends_at: soon, candidate_time_zone: "Africa/Lagos",
      call_link: "https://meet.google.com/abc-defg-hij", message: null, reschedule_count: 0, interviewers: [{ worker_id: "w1", name: "Ada Eze", booking_id: "b1" }, { worker_id: "w2", name: "Ben Li", booking_id: "b2" }] }],
    scorecards: { skills: ["Mandarin", "Market knowledge", "Attention to detail"], count: 1, hidden: 1, can_score: true, mine: null, cards: [], summary: null } };
  await page.route("**/hr/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/hr/jobs") return route.fulfill({ json: { jobs: [job], departments: { sourcing: "Sourcing desk" }, job_types: { full_time: "Full time" }, locations: { guangzhou: "Guangzhou office" } } });
    if (path === "/hr/applications") return route.fulfill({ json: { applications, close_reasons: [], emailed_stages: [] } });
    if (path.startsWith("/hr/applications/")) return route.fulfill({ json: withInterview });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?page=people");
  await page.getByRole("region", { name: "Applied" }).getByRole("button", { name: /Amaka Obi/ }).click();
  const panel = page.getByRole("dialog", { name: "Amaka Obi" });
  await expect(panel.getByText("1 scorecard hidden until you submit yours.")).toBeVisible();
  await panel.getByRole("radio", { name: "Mandarin: 4" }).check({ force: true });
  await panel.getByRole("heading", { name: "Interview" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/hr/people-interview-scorecard-laptop.png" });
});

test("an accepted offer and the Hire button", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedInStaff(page);
  const offer = { id: "o1", status: "accepted", job_title: "Sourcing agent", departments: ["sourcing"], staff_role: "staff", start_date: "2026-11-16",
    expires_on: "2026-11-06", letter: "Dear Amaka Obi,\n\nWe are delighted to offer you the role of Sourcing agent at FAYFORT International Trading.",
    signature_name: "Amaka Obi", responded_at: new Date().toISOString(), decline_reason: null };
  const withOffer = { ...detail, can_manage: true, application: { ...detail.application, stage: "offer" }, interviews: [], offers: [offer],
    scorecards: { skills: [], count: 2, hidden: 0, can_score: false, mine: null, cards: [], summary: null } };
  let hired = false;
  await page.route("**/hr/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/hr/jobs") return route.fulfill({ json: { jobs: [job], departments: {}, job_types: {}, locations: {} } });
    if (path === "/hr/applications") return route.fulfill({ json: { applications: applications.map((a, i) => (i === 0 ? { ...a, stage: "offer" } : a)), close_reasons: [], emailed_stages: [] } });
    if (path.endsWith("/hire")) { hired = true; return route.fulfill({ json: { ...withOffer, invitation: "new_account", application: { ...withOffer.application, stage: "hired" } } }); }
    if (path.startsWith("/hr/applications/")) return route.fulfill({ json: withOffer });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?page=people");
  await page.getByRole("region", { name: "Offer" }).getByRole("button", { name: /Amaka Obi/ }).click();
  const panel = page.getByRole("dialog", { name: "Amaka Obi" });
  await panel.getByRole("heading", { name: "Offer" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/hr/people-offer-accepted-laptop.png" });
  await panel.getByRole("button", { name: "Hire Amaka" }).click();
  await expect(panel.getByText("Hired. Their staff invitation is on its way by email.")).toBeVisible();
  expect(hired).toBe(true);
});

test("records: the team and one person's record", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedInStaff(page);
  const personal = { legal_name: "Benjamin Li", preferred_name: "Ben", phone: "+86 138 0000 0000", country: "China", city: "Guangzhou", date_of_birth: null, emergency_name: "Mei Li", emergency_relationship: "Sister", emergency_phone: "+86 139 0000 0000" };
  const team = [
    { worker_id: "w1", name: "Ada Eze", photo_url: null, staff_role: "staff", job_title: "HR lead", start_date: "2025-06-02", status: "active", has_record: true, probation_due: false, probation_end: null, policies_to_read: 0 },
    { worker_id: "w2", name: "Ben Li", photo_url: null, staff_role: "staff", job_title: "Sourcing agent", start_date: "2026-07-01", status: "active", has_record: true, probation_due: true, probation_end: "2026-10-01", policies_to_read: 1 },
    { worker_id: "w3", name: "Amaka Obi", photo_url: null, staff_role: "staff", job_title: "Sourcing agent", start_date: "2026-11-16", status: "starting", has_record: true, probation_due: false, probation_end: "2027-02-16", policies_to_read: 3 },
  ];
  const person = { worker_id: "w2", name: "Ben Li", photo_url: null, staff_role: "staff", account_status: "active", status: "active", desks: ["Sourcing desk"],
    job: { job_title: "Sourcing agent", job_type: "full_time", location: "guangzhou", start_date: "2026-07-01", probation_end: "2026-10-01", hours_per_week: 40, manager_id: "w1", status: "active", probation_passed_at: null },
    manager_name: "Ada Eze", personal,
    documents: [{ id: "d1", kind: "offer", kind_label: "Offer letter", title: "Signed offer: Sourcing agent", file_name: null, file_size: null, offer_id: "o1", visible_to_worker: true, created_at: "2026-06-20T00:00:00Z" },
      { id: "d2", kind: "contract", kind_label: "Contract", title: "Employment contract", file_name: "contract.pdf", file_size: 120000, offer_id: null, visible_to_worker: true, created_at: "2026-06-28T00:00:00Z" }],
    policies: [{ id: "p1", title: "Code of conduct", summary: "", version: 1, published_at: "2026-09-01", accepted_at: "2026-09-02T00:00:00Z", accepted_before: false },
      { id: "p2", title: "Customer data handling", summary: "", version: 2, published_at: "2026-10-28", accepted_at: null, accepted_before: true }],
    timeline: [{ id: "e2", kind: "policy_accepted", detail: { title: "Code of conduct" }, created_at: "2026-09-02T00:00:00Z", actor_name: "Ben Li" },
      { id: "e1", kind: "hired", detail: { job_title: "Sourcing agent" }, created_at: "2026-06-20T00:00:00Z", actor_name: "Ada Eze" }] };
  await page.route("**/hr/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/hr/jobs") return route.fulfill({ json: { jobs: [], departments: {}, job_types: {}, locations: {} } });
    if (path === "/hr/applications") return route.fulfill({ json: { applications: [], close_reasons: [], emailed_stages: [] } });
    if (path === "/hr/people") return route.fulfill({ json: { people: team } });
    if (path.startsWith("/hr/people/")) return route.fulfill({ json: { person } });
    if (path === "/hr/policies") return route.fulfill({ json: { policies: [
      { id: "p1", title: "Code of conduct", summary: "How we treat members, suppliers and each other.", body: "", status: "published", version: 1, published_at: "2026-09-01", has_changes: false, accepted: 3, team_size: 3 },
      { id: "p2", title: "Customer data handling", summary: "Keeping members' details private and safe.", body: "", status: "published", version: 2, published_at: "2026-10-28", has_changes: false, accepted: 1, team_size: 3 },
      { id: "p3", title: "Working hours and shifts", summary: "Clocking in, breaks and being reachable.", body: "", status: "draft", version: 0, published_at: null, has_changes: true, accepted: 0, team_size: 3 }] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?page=people");
  await page.getByRole("tab", { name: "Policies" }).click();
  await expect(page.getByText("v2 · 1/3 accepted")).toBeVisible();
  await page.getByRole("heading", { name: "Policies", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/hr/people-policies-laptop.png" });
  await page.getByRole("tab", { name: "Records" }).click();
  await page.getByRole("button", { name: /Ben Li/ }).click();
  await expect(page.getByRole("dialog", { name: "Ben Li" }).getByRole("button", { name: "Pass probation" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/hr/people-record-laptop.png" });
});

for (const size of [{ n: "laptop", w: 1440, h: 900 }, { n: "phone", w: 390, h: 844 }]) test(`time off calendar ${size.n}`, async ({ page }) => {
  await page.setViewportSize({ width: size.w, height: size.h });
  await signedInStaff(page);
  const base = { half_day: null, note: null, decided_at: null, decision_note: null, approver_name: null };
  const leave = [
    { ...base, id: "l1", worker_id: "w2", leave_type: "annual", type_name: "Annual leave", status: "approved", start_date: "2026-11-09", end_date: "2026-11-13", days: 4, name: "Ben Li" },
    { ...base, id: "l2", worker_id: "w1", leave_type: "sick", type_name: "Sick leave", status: "approved", start_date: "2026-11-03", end_date: "2026-11-03", days: 1, name: "Ada Eze" },
    { ...base, id: "l3", worker_id: "w3", leave_type: "annual", type_name: "Annual leave", status: "requested", start_date: "2026-11-23", end_date: "2026-11-27", days: 5, name: "Amaka Obi", note: "Going home for my sister's wedding", clashing_bookings: 1 },
  ];
  await page.route("**/hr/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/hr/jobs") return route.fulfill({ json: { jobs: [], departments: {}, job_types: {}, locations: {} } });
    if (path === "/hr/applications") return route.fulfill({ json: { applications: [], close_reasons: [], emailed_stages: [] } });
    if (path === "/hr/time-off") return route.fulfill({ json: { month: "2026-11", first: "2026-11-01", last: "2026-11-30", leave, waiting: [leave[2]],
      holidays: [{ day: "2026-11-11", name: "Company day" }], work_days: [0, 1, 2, 3, 4, 5] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?page=people");
  await page.getByRole("tab", { name: "Time off" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("heading", { name: "Waiting for an answer" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/hr/people-time-off-${size.n}.png`, fullPage: size.n === "phone" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
});
