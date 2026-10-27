import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R6: the Store team desk (next Finds drop, listings, coming up, Products), at phone, iPad and
 * desktop. Screenshots: test-results/ops-r6/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`store team desk fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=desk&desk=store_team");
    const desk = page.getByRole("region", { name: "Store team desk" });
    const drop = desk.getByRole("region", { name: "Next Finds drop" });
    await expect(drop.getByRole("progressbar", { name: "How full the next drop is" })).toHaveAttribute("aria-valuenow", "6");
    await expect(drop.getByText("4 more to fill it.")).toBeVisible();
    await expect(desk.getByRole("region", { name: "Listings" }).getByText("Changes asked for")).toBeVisible();
    await expect(desk.getByRole("region", { name: "Coming up" }).getByText("Weekend wig sale starts")).toBeVisible();
    await noSideScroll(page);
    await desk.screenshot({ path: `test-results/ops-r6/store-${size.name}.png` });
    await drop.getByRole("button", { name: "Open Finds" }).click();
    await expect(page.getByRole("navigation", { name: "Operations desks" }).getByRole("button", { name: "Products" })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/tab=finds/);
  });
}
