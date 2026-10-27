import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** UI facelift phase 2 (docs/UI_FACELIFT_PLAN.md): the navy frame, the approved menu, the phone tab bar, and every
 * section at its own address inside the one shell. Screenshots land in test-results/facelift/ for review. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const SCREENS = [
  { name: "chat", path: "/member/chat?conversation=c1", heading: /./ },
  { name: "shop", path: "/member/shop", heading: "Shop" },
  { name: "orders", path: "/member/orders", heading: "Orders & requests" },
  { name: "settings", path: "/member/settings", heading: "Settings" },
  { name: "membership", path: "/member/membership", heading: "Membership" },
  { name: "not-found", path: "/member/browse", heading: "Page not found" },
];

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  for (const screen of SCREENS) {
    test(`${screen.name} in the shell on a ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await signedInMember(page);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      if (size.name === "phone" && screen.name !== "chat") {
        const tabs = page.getByRole("navigation", { name: "Sections" });
        await expect(tabs).toBeVisible();
        await expect(tabs.getByRole("link")).toHaveCount(4);
      }
      await page.waitForTimeout(450);
      await noSideScroll(page);
      await page.screenshot({ path: `test-results/facelift/${screen.name}-${size.name}.png` });
    });
  }
}

test("the phone tab bar moves between sections and More opens the full menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page);
  await page.goto("/member/shop");
  const tabs = page.getByRole("navigation", { name: "Sections" });
  await tabs.getByRole("link", { name: "Orders" }).click();
  await expect(page).toHaveURL(/\/member\/orders$/);
  await tabs.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("navigation", { name: "Member navigation" });
  await expect(menu.getByRole("link", { name: "Membership" })).toBeVisible();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "test-results/facelift/menu-phone.png" });
});
