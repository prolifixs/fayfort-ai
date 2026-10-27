import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** UI facelift phase 2 (docs/UI_FACELIFT_PLAN.md): the navy frame, the approved menu, the phone tab bar, and every
 * section at its own address inside the one shell. Screenshots land in test-results/facelift/ for review. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const SCREENS = [
  { name: "home", path: "/member/home", heading: "Home" },
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
      if (size.name === "phone") {
        // The menu is on every section; in a conversation it starts folded to a handle.
        if (screen.name === "chat") await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
        else await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveCount(4);
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

test("in a chat the phone menu opens from its handle, folds again, and folds while typing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page);
  await page.goto("/member/chat?conversation=c1");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const tabs = page.getByRole("navigation", { name: "Sections" });
  await expect(tabs).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/facelift/chat-menu-open-phone.png" });
  await page.getByLabel("Message FayFort").focus();
  await expect(tabs).toBeHidden();
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await tabs.getByRole("button", { name: "Fold the menu" }).click();
  await expect(tabs).toBeHidden();
});

test("a product on a tablet keeps the menu within reach", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await signedInMember(page);
  await page.goto("/member/product?product=p1");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/facelift/product-tablet.png" });
});

test("on a laptop the menu folds to icons and stays folded", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signedInMember(page);
  await page.goto("/member/home");
  await page.getByRole("button", { name: "Fold the menu" }).click();
  await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
  const width = await page.locator("#member-sidebar").evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThan(90);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/facelift/menu-folded-laptop.png" });
  await page.reload();
  await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
  await page.getByRole("button", { name: "Open the menu" }).click();
});

test("the shop stays steady while it loads and scrolls", async ({ page }) => {
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await signedInMember(page);
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/member/shop");
    await page.waitForTimeout(900);
    for (let i = 0; i < 6; i++) {
      await page.locator(".shop-browse").hover();
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(150);
    }
    const shift = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(shift, `layout shift at ${size.width}px`).toBeLessThan(0.1);
  }
});
