import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Layout QA for the Control Center at phone, iPad, laptop and desktop widths (docs/CONTROL_CENTER_UX_PLAN.md stage 7).
 * Screenshots land in test-results/staff-ux/ for review: `npx playwright test staff-layout`. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const PAGES = ["Overview", "Conversations", "Customers", "Requests", "Channels & Connections", "Human Agents", "Settings"];
const OUT = "test-results/staff-ux";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}
async function openPage(page: Page, width: number, label: string) {
  if (width < 1024) await page.getByRole("button", { name: "Open menu" }).click();
  const escaped = label.replace(/[&]/g, "\\&");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: new RegExp(`^${escaped}( |$)`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
}

for (const size of SIZES) {
  test(`Control Center pages fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    for (const label of PAGES) {
      await openPage(page, size.width, label);
      await page.waitForTimeout(300);
      await noSideScroll(page);
      await page.screenshot({ path: `${OUT}/${label.replace(/[^a-z]+/gi, "-").toLowerCase()}-${size.name}.png` });
    }
  });

  test(`a conversation reads like a chat on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/");
    await openPage(page, size.width, "Conversations");
    await page.getByRole("button", { name: /Amaka Obi/ }).first().click();
    const thread = page.getByRole("region", { name: "Conversation messages" });
    await expect(thread).toBeVisible();
    // The customer is on the left and FayFort (AI and staff) on the right.
    const customer = await thread.locator(".staff-thread-row.is-them .staff-thread-bubble").first().boundingBox();
    const fayfort = await thread.locator(".staff-thread-row.is-us .staff-thread-bubble").first().boundingBox();
    expect(customer && fayfort && customer.x < fayfort.x).toBeTruthy();
    await expect(page.getByRole("textbox", { name: "Reply to customer" })).toBeVisible();
    if (size.width < 1024) await expect(page.getByRole("button", { name: "← All conversations" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/conversation-${size.name}.png` });
  });
}

test("phone: the Control Center menu is a drawer that closes on the scrim", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInStaff(page);
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Control Center navigation" });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(sidebar).toBeVisible();
  await page.mouse.click(370, 500);
  await expect(sidebar).toBeHidden();
});

test("Operations Center puts the queue first and keeps chats in the shared thread", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signedInStaff(page);
  await page.goto("/operations");
  await expect(page.getByRole("tab", { name: "Queue" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Workforce overview" })).toHaveCount(0);
  const queue = page.getByRole("region", { name: "Operations work items" });
  await queue.getByRole("button", { name: /split payment/ }).click();
  await expect(page.getByRole("region", { name: "Business conversation messages" })).toBeVisible();
  await queue.getByRole("button", { name: /TikTok wig/ }).click();
  await expect(page.getByRole("region", { name: "Member conversation messages" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reply to member" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/operations-laptop.png`, fullPage: true });
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByRole("region", { name: "Workforce overview" })).toBeVisible();
});
