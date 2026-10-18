import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";
import { signedInMember } from "./member-fixtures";

/** Layout QA for the Store team, Schedule and member store sections (docs/CATALOG_MERCHANDISING_PLAN.md).
 * Screenshots land in test-results/store-team/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const OUT = "test-results/store-team";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`Products workspace and listing editor fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=products");
    const list = page.getByRole("list", { name: "Store products" });
    await expect(list.getByText("Kinky curly closure wig")).toBeVisible();
    await expect(list.getByText("Sold out")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/products-${size.name}.png`, fullPage: true });

    await page.getByRole("tab", { name: "In progress" }).click();
    await page.getByRole("button", { name: /Straight bob wig with bangs/ }).click();
    const editor = page.getByLabel("Listing: Straight bob wig with bangs");
    await expect(editor.getByText("Use a brighter first photo, please.")).toBeVisible();
    await expect(editor.getByRole("figure", { name: "Member preview" })).toContainText("-27%");
    await expect(editor.getByText("Margin 53%")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/listing-${size.name}.png`, fullPage: true });

    await page.getByRole("tab", { name: "Sections" }).click();
    await expect(page.getByRole("article", { name: "Wig week" })).toContainText("Hidden: too few live products");
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/sections-${size.name}.png`, fullPage: true });
  });

  test(`Schedule fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=schedule");
    await expect(page.getByRole("button", { name: /Pack and ship #1042/ })).toBeVisible();
    // Week view starts on Monday: on a Sunday tomorrow's giveaway is next week.
    if (!(await page.getByRole("button", { name: /Giveaway starts: Wig week/ }).isVisible()) && size.width >= 720)
      await page.getByRole("button", { name: "Later" }).click();
    await expect(page.getByRole("button", { name: /Giveaway starts: Wig week/ })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/schedule-${size.name}.png`, fullPage: true });
    if (size.width >= 1024) {
      await page.getByRole("button", { name: "Month" }).click();
      await expect(page.getByRole("grid", { name: "Month" })).toBeVisible();
      await page.screenshot({ path: `${OUT}/schedule-month-${size.name}.png`, fullPage: true });
      await page.getByRole("button", { name: /Plan something on/ }).first().click();
      await expect(page.getByRole("button", { name: "Schedule a giveaway" })).toBeVisible();
      await page.getByRole("button", { name: "Schedule a giveaway" }).click();
      await page.screenshot({ path: `${OUT}/schedule-plan-${size.name}.png` });
    }
  });

  test(`member Browse shows store sections on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await page.goto("/member/chat?panel=catalog");
    const tile = page.getByRole("region", { name: "Dollar deals" });
    await expect(tile.getByText("From $18")).toBeVisible();
    await expect(tile.getByRole("button", { name: /^Open / })).toHaveCount(3);
    await expect(page.getByRole("navigation", { name: "Shop by category" })).toContainText("Fabrics");
    await expect(page.getByRole("region", { name: "Giveaway: Win a lace front wig" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/browse-${size.name}.png`, fullPage: true });
    await tile.getByRole("button", { name: /Dollar deals/ }).click();
    await expect(page.getByRole("dialog", { name: "Dollar deals" }).getByRole("article")).toHaveCount(4);
    await page.screenshot({ path: `${OUT}/section-sheet-${size.name}.png` });
  });
}
