import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R2: the rail, My work and a desk with its pipeline strip and tool cards, at phone, iPad and
 * desktop sizes. Screenshots: test-results/ops-r2/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];
const OUT = "test-results/ops-r2";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`desks fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations");
    const rail = page.getByRole("navigation", { name: "Operations desks" });
    await expect(rail.getByRole("button", { name: /My work/ })).toHaveAttribute("aria-current", "page");
    const home = page.getByRole("region", { name: "My work" });
    await expect(home.getByRole("button", { name: /Sourcing.*4 free to pick up.*1 overdue/ })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/mywork-${size.name}.png` });

    await rail.getByRole("button", { name: /^Sourcing/ }).click();
    const desk = page.getByRole("region", { name: "Sourcing desk" });
    await expect(desk.getByRole("group", { name: "Pipeline" }).getByRole("button", { name: /Review/ })).toBeVisible();
    await expect(page).toHaveURL(/desk=sourcing/);
    await desk.getByText("How this desk works").click();
    await expect(desk.getByText("Where its work goes next")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/sourcing-${size.name}.png`, fullPage: true });

    await rail.getByRole("button", { name: /^Store team/ }).click();
    const store = page.getByRole("region", { name: "Store team desk" });
    await expect(store.getByRole("region", { name: "Products" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/store-${size.name}.png` });
    await store.getByRole("button", { name: "Open Products" }).click();
    await expect(rail.getByRole("button", { name: "Products" })).toHaveAttribute("aria-current", "page");
  });
}
