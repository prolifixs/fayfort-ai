import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";
import { signedInMember } from "./member-fixtures";

/** Layout QA for hours, ratings, revenue and connections (docs/WORKFORCE_AND_REVENUE_PLAN.md).
 * Screenshots land in test-results/team-revenue/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const OUT = "test-results/team-revenue";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`revenue tab fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/?page=shop&tab=revenue");
    const panel = page.getByRole("region", { name: "Revenue" });
    await expect(panel.getByText("$17,780")).toBeVisible();
    await panel.getByRole("figure", { name: "Net revenue by stream" }).locator(".viz-col").nth(20).hover();
    await noSideScroll(page);
    await panel.screenshot({ path: `${OUT}/revenue-${size.name}.png` });
  });

  test(`workforce ratings and timesheets fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/?page=workforce");
    const directory = page.getByRole("region", { name: "FayFort worker directory" });
    await expect(directory.getByText("On shift")).toBeVisible();
    await noSideScroll(page);
    await directory.screenshot({ path: `${OUT}/directory-${size.name}.png` });
    await directory.getByRole("button", { name: /Test Worker A/ }).click();
    const ratings = page.getByRole("region", { name: "Customer ratings" });
    await expect(ratings.getByRole("note", { name: "How the fresh start works" })).toContainText("8 tasks to the next fresh start");
    await noSideScroll(page);
    await ratings.screenshot({ path: `${OUT}/ratings-${size.name}.png` });
    await page.goto("/?page=workforce#timesheets");
    const sheet = page.getByRole("region", { name: "Timesheets" });
    await expect(sheet.getByText("Correction requests")).toBeVisible();
    await noSideScroll(page);
    await sheet.screenshot({ path: `${OUT}/timesheets-${size.name}.png` });
  });

  test(`operations shift control fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations");
    const button = page.getByRole("button", { name: /On shift, 1h 59m/ });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole("dialog", { name: "Your shift" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/shift-${size.name}.png` });
  });

  test(`connections card fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/?page=infrastructure");
    const card = page.getByRole("region", { name: "Connections" });
    await card.getByRole("button", { name: "Connect Stripe" }).click();
    await expect(card.getByRole("form", { name: "Connect Stripe" })).toBeVisible();
    await noSideScroll(page);
    await card.screenshot({ path: `${OUT}/connections-${size.name}.png` });
  });

  test(`member rating card fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await page.goto("/member/chat?conversation=c1");
    const card = page.getByRole("article", { name: "Rate Ada's help" });
    await expect(card).toBeVisible();
    await expect(page.getByText("Ada · FayFort team")).toBeVisible();
    await card.getByRole("radio", { name: "5 stars, Excellent" }).click();
    await noSideScroll(page);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/member-rating-${size.name}.png` });
  });
}
