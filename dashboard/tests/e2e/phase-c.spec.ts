import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** Bookings batch 3 (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md): consultation time picker, change time, tour calendar.
 * Screenshots in test-results/phase-c/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const OUT = "test-results/phase-c";
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}
const day = (offset: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
function slots() {
  const out = [];
  for (let offset = 2; offset < 9; offset += 1) {
    const base = day(offset);
    if ([0, 6].includes(base.getUTCDay())) continue;
    for (let half = 0; half < 17; half += 1) {
      const start = new Date(base.getTime() + (1 * 60 + half * 30) * 60_000);
      out.push({ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600_000).toISOString() });
    }
  }
  return out;
}

for (const size of SIZES) {
  test(`consultation time picker on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    const booked = { id: "b1", starts_at: slots()[3].starts_at, ends_at: slots()[3].ends_at, status: "confirmed", hold_expires_at: null,
      call_link: "https://meet.google.com/abc-defg-hij", refund: null, reschedule_count: 0, can_change: true, change_note: null };
    await page.route("**/members/bookings/slots**", (route) => route.fulfill({ json: {
      available: true, host: { name: "Fay", job_title: "CEO" }, message: null, rules: { minutes: 60, cancel_cutoff_hours: 24, hold_hours: 24 }, slots: slots() } }));
    await page.route("**/members/consultations", (route) => route.fulfill({ json: {
      consultations: [{ id: "c1", topic: "Wig suppliers before the Canton Fair", status: "scheduled", price: 100, currency: "USD", conversation_id: "k1", booking: booked }] } }));
    await page.goto("/member/chat?panel=tools&tool=consultation");
    await expect(page.getByRole("link", { name: "Join call" })).toBeVisible();
    await page.getByRole("button", { name: "Book a consultation" }).click();
    await page.getByLabel("What would you like to discuss?").fill("Shipping a container from Yiwu");
    const times = page.getByLabel("Time");
    await times.getByRole("button").nth(2).click();
    await expect(page.getByText(/We hold this time for 24 hours/)).toBeVisible();
    await page.getByRole("group", { name: "Choose a time" }).scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/consultation-${size.name}.png` });
  });

  test(`tour arrival calendar on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await page.route("**/members/tours/calendar**", (route) => {
      const days = [];
      for (let offset = 0; offset < 120; offset += 1) {
        const date = day(offset).toISOString().slice(0, 10);
        days.push({ date, state: offset < 2 ? "too_soon" : offset === 9 || offset === 10 ? "full" : "open" });
      }
      return route.fulfill({ json: { days, earliest: days[2].date, notice_days: 2 } });
    });
    await page.route("**/members/tours", (route) => route.fulfill({ json: { tours: [], cities: {}, needs: {} } }));
    await page.goto("/member/chat?panel=tools&tool=tour");
    await page.getByRole("button", { name: "Request a tour guide" }).click();
    const calendar = page.getByRole("group", { name: "Arrival date" });
    await expect(calendar).toBeVisible();
    const target = day(5).toISOString().slice(0, 10);
    if (target.slice(0, 7) !== day(0).toISOString().slice(0, 7)) await calendar.getByRole("button", { name: "Next month" }).click();
    await calendar.locator("button.tour-day:not([disabled])").filter({ hasText: new RegExp(`^${Number(target.slice(8))}$`) }).first().click();
    await expect(calendar.getByText(/^Arriving /)).toBeVisible();
    await calendar.scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/tour-calendar-${size.name}.png` });
  });
}
