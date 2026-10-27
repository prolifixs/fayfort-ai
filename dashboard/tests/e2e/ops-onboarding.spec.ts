import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R7: a new worker's welcome tour on their first visit, the first-week checklist and the Guide
 * by desk, at phone, iPad and desktop. Screenshots: test-results/ops-r7/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];
const API = "http://127.0.0.1:8001";
const OUT = "test-results/ops-r7";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

async function newWorker(page: Page) {
  await signedInStaff(page);
  let tourDone = false;
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/operations/me/departments")
      return route.fulfill({ json: { user_id: "staff-1", departments: ["conversation_intake", "sourcing"], can_manage: false } });
    if (url.pathname === "/operations/me/onboarding/tour") {
      tourDone = true;
      return route.fulfill({ json: { progress: { tour: "now" } } });
    }
    if (url.pathname.startsWith("/operations/me/onboarding/")) return route.fulfill({ json: { progress: {} } });
    if (url.pathname === "/operations/me/onboarding")
      return route.fulfill({ json: {
        show_tour: !tourDone, completed_at: tourDone ? "now" : null, job_title: "Customer care agent", departments: ["conversation_intake", "sourcing"],
        checklist: [
          { key: "tour", title: "Take the welcome tour", how: "A two-minute walk through the Operations Center.", done: tourDone },
          { key: "clock_in", title: "Clock in for your first shift", how: "Clock in at the top of the page when you start.", done: true },
          { key: "chats", title: "Take chats for a shift", how: "Use the chat switch next to the shift clock.", done: false },
          { key: "claim", title: "Claim your first item", how: "Open a desk, pick something free to pick up and press Claim.", done: false },
          { key: "guide_conversation_intake", title: "Read how the Conversations desk works", how: "Guide → your desk.", done: false, desk: "conversation_intake" },
          { key: "finish_conversation_intake", title: "Finish your first Conversations item", how: "Follow the steps bar to the end.", done: false, desk: "conversation_intake" },
        ],
        done: tourDone ? 2 : 1, total: 6,
      } });
    if (url.pathname.endsWith("/handoffs/availability")) return route.fulfill({ json: { availability: "offline", available_until: null, max_active_handoffs: 3 } });
    return route.fallback();
  });
}

for (const size of SIZES) {
  test(`welcome tour, checklist and guide fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await newWorker(page);
    await page.goto("/operations");
    const tour = page.getByRole("dialog", { name: "Welcome to the FayFort team" });
    await expect(tour.getByText(/You're on Conversations and Sourcing as Customer care agent/)).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/tour-1-${size.name}.png` });
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "Start and end your shift" }).getByText(/Take chats for 8 hours/)).toBeVisible();
    for (let step = 0; step < 4; step += 1) await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
    await page.screenshot({ path: `${OUT}/tour-6-${size.name}.png` });
    await page.getByRole("dialog").getByRole("button", { name: "Start working" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const week = page.getByRole("region", { name: "Your first week" });
    await expect(week.getByText(/2 of 6 done/)).toBeVisible();
    await noSideScroll(page);
    await week.screenshot({ path: `${OUT}/first-week-${size.name}.png` });
    await week.getByRole("button", { name: "See the checklist" }).click();
    const checklist = page.getByRole("list", { name: "First-week checklist" });
    await expect(checklist.getByText("Take chats for a shift")).toBeVisible();

    const index = page.getByRole("complementary", { name: "Guides" });
    await index.getByRole("button", { name: "Conversations desk" }).click();
    const article = page.getByRole("heading", { level: 2, name: "Conversations desk" }).locator("xpath=ancestor::article");
    await expect(article.getByText("Send to another desk")).toBeVisible();
    await expect(article.getByRole("button", { name: /Answering a customer|chat/i }).first()).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/guide-desk-${size.name}.png`, fullPage: true });
  });
}
