import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Layout QA for Operations → Bookings and Add staff (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md). Screenshots in test-results/bookings/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const OUT = "test-results/bookings";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`Bookings fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=bookings");
    const row = page.getByRole("button", { name: /Consultation with Amaka Obi/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("Add the call link")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/list-${size.name}.png`, fullPage: true });
    await row.click();
    const detail = page.getByRole("article", { name: "Booking" });
    await expect(detail.getByLabel("Call link")).toBeVisible();
    await detail.getByRole("button", { name: "Move" }).click();
    await expect(detail.getByRole("group", { name: "Free times" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/detail-${size.name}.png`, fullPage: true });

    await page.getByRole("tab", { name: "Calendar" }).click();
    await expect(page.getByRole("grid", { name: "Week" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/calendar-${size.name}.png`, fullPage: true });

    await page.getByRole("tab", { name: "CEO's hours" }).click();
    await expect(page.getByLabel("Monday from")).toHaveValue("14:00");
    await expect(page.getByText("Canton Fair")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/hours-${size.name}.png`, fullPage: true });
  });

  test(`Add staff fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/?page=workforce");
    await page.getByLabel("Find an account").fill("amaka");
    await expect(page.getByText("Already on the team")).toBeVisible();
    await page.getByRole("button", { name: "Choose amaka.obi@example.com" }).click();
    await page.getByLabel(/Personal assistant to the CEO/).check();
    await expect(page.getByRole("button", { name: "Send invitation" })).toBeEnabled();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/add-staff-${size.name}.png`, fullPage: true });
  });
}
