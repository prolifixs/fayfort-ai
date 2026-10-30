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
