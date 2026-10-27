import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R4: the Sourcing desk (trends and group buys, deposits due, batches, catalog search, money
 * stages on the strip) and the Fulfillment desk (shop orders), at phone, iPad and desktop. Screenshots: test-results/ops-r4/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];
const OUT = "test-results/ops-r4";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`sourcing and fulfillment desks fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=desk&desk=sourcing");
    const desk = page.getByRole("region", { name: "Sourcing desk" });
    const strip = desk.getByRole("group", { name: "Pipeline" });
    await expect(strip.getByRole("button", { name: /Deposit due/ })).toBeVisible();
    await expect(strip.getByRole("button", { name: /Chosen/ })).toBeAttached();
    const trends = desk.getByRole("region", { name: "Trends and group buys" });
    await expect(trends.getByText("37 want this")).toBeVisible();
    await expect(trends.getByText("Ready to invoice")).toBeVisible();
    await trends.getByRole("button", { name: "Start a group buy" }).click();
    await expect(trends.getByRole("form", { name: /Start a group buy for Satin hair bonnet/ })).toBeVisible();
    await expect(desk.getByRole("region", { name: "Deposits due" }).getByText(/Free · 50% · about 90.00 USD/)).toBeVisible();
    const catalog = desk.getByRole("region", { name: "Already in the catalog?" });
    await catalog.getByRole("searchbox", { name: "Search the catalog" }).fill("lace");
    await catalog.getByRole("button", { name: "Search" }).click();
    await expect(catalog.getByText("Sourcing catalog · 2.10 USD–2.80 · min 50 · 7–12 days")).toBeVisible();
    await noSideScroll(page);
    await desk.screenshot({ path: `${OUT}/sourcing-${size.name}.png` });

    await page.getByRole("navigation", { name: "Operations desks" }).getByRole("button", { name: /^Fulfillment/ }).click();
    const orders = page.getByRole("region", { name: "Fulfillment desk" }).getByRole("region", { name: "Shop orders" });
    await expect(orders.getByText("#1042 · 3 items")).toBeVisible();
    await expect(orders.getByText(/6 shipped this week/)).toBeVisible();
    await noSideScroll(page);
    await page.getByRole("region", { name: "Fulfillment desk" }).screenshot({ path: `${OUT}/fulfillment-${size.name}.png` });
  });
}
