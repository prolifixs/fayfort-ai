import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R5: the Member support desk (bookings today, invoices, giveaways) and a dispute's case file
 * (order, payments, chat side by side), at phone, iPad and desktop. Screenshots: test-results/ops-r5/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];
const OUT = "test-results/ops-r5";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`member support and disputes fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=desk&desk=member_support");
    const desk = page.getByRole("region", { name: "Member support desk" });
    await expect(desk.getByRole("region", { name: "Bookings today" })).toBeVisible();
    const invoices = desk.getByRole("region", { name: "Invoices" });
    await expect(invoices.getByText(/Didn't send: The member's email bounced/)).toBeVisible();
    await expect(invoices.getByText(/Unpaid since/)).toBeVisible();
    const giveaways = desk.getByRole("region", { name: "Giveaways" });
    await expect(giveaways.getByText(/214 entries · draw 1/)).toBeVisible();
    await expect(giveaways.getByRole("button", { name: "Draw" })).toBeVisible();
    await noSideScroll(page);
    await desk.screenshot({ path: `${OUT}/member-support-${size.name}.png` });

    await page.getByRole("navigation", { name: "Operations desks" }).getByRole("button", { name: /^Disputes/ }).click();
    await page.getByRole("region", { name: "Operations work items" }).getByRole("button", { name: /damaged lace/ }).click();
    const file = page.getByRole("region", { name: "Case file" });
    await expect(file.getByText("Amaka Obi · Pro plan · order dispute")).toBeVisible();
    await expect(file.getByRole("region", { name: "The order" }).getByText("Body wave lace front wig 22 inch · 180.00 USD")).toBeVisible();
    await expect(file.getByRole("region", { name: "Payments" }).getByText("Deposit · 45.00 USD")).toBeVisible();
    await expect(file.getByRole("region", { name: "The chat" }).getByText(/The lace is torn/)).toBeVisible();
    await expect(file.getByRole("link", { name: /Open the order payment in Shopify/ })).toHaveAttribute("href", /admin.shopify.com/);
    await noSideScroll(page);
    await file.screenshot({ path: `${OUT}/case-file-${size.name}.png` });
  });
}
