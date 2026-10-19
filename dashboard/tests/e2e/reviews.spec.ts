import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";
import { signedInMember } from "./member-fixtures";

/** Layout QA for customer reviews: Control Center → Website → Customer reviews, and the member's "How was it?"
 * prompt in Orders & requests. Screenshots land in test-results/reviews/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const OUT = "test-results/reviews";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`staff review checking fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/?page=website");
    const panel = page.getByRole("region", { name: "Customer reviews" });
    await expect(panel.getByRole("listitem", { name: "Review from Test A." })).toBeVisible();
    await expect(panel.getByRole("listitem", { name: "Review from Test B." }).getByText("Verified order")).toBeVisible();
    await noSideScroll(page);
    await panel.screenshot({ path: `${OUT}/staff-reviews-${size.name}.png` });
    await panel.getByRole("button", { name: "Open the screenshot" }).click();
    await expect(page.getByRole("dialog", { name: "Screenshot" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/staff-screenshot-${size.name}.png` });
  });

  test(`member review prompt fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await page.goto("/member/chat?panel=requests");
    const prompt = page.getByRole("article", { name: "Review Body wave wig 22 inch" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("radio", { name: "5 stars, Excellent" }).click();
    await expect(prompt.getByLabel("Name shown")).toHaveValue("Jordan M.");
    await prompt.getByLabel("Tell other buyers how it went").fill("Arrived exactly as described.");
    await noSideScroll(page);
    await page.getByRole("region", { name: "Review your orders" }).screenshot({ path: `${OUT}/member-prompt-${size.name}.png` });
  });
}
