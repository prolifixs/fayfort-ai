import { expect, test, type Page } from "@playwright/test";
import { manyProducts, signedInMember } from "./member-fixtures";

/** Layout QA for the member app at phone, iPad, laptop and desktop widths (docs/UX_LAYOUT_PLAN.md stage 7).
 * Screenshots land in test-results/ux/ for review: `npx playwright test member-layout`. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const SCREENS = [
  { name: "chat", path: "/member/chat?conversation=c1" },
  { name: "browse", path: "/member/chat?panel=catalog" },
  { name: "directory", path: "/member/chat?panel=directory" },
];

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  for (const screen of SCREENS) {
    test(`${screen.name} fits a ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await signedInMember(page);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForTimeout(400);
      await noSideScroll(page);
      await page.screenshot({ path: `test-results/ux/${screen.name}-${size.name}.png` });
    });
  }
}

test("menus and pop-ups close when you tap elsewhere or press Escape", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signedInMember(page);
  await page.goto("/member/chat?conversation=c1");
  const account = page.getByRole("button", { name: /open member account menu/i });
  await account.click();
  await expect(page.getByRole("menu", { name: /account/i })).toBeVisible();
  await page.mouse.click(700, 400);
  await expect(page.getByRole("menu", { name: /account/i })).toBeHidden();

  await page.getByRole("button", { name: /^notifications/i }).click();
  await expect(page.getByRole("dialog", { name: /notifications/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /notifications/i })).toBeHidden();

  await page.getByRole("button", { name: /^cart/i }).click();
  await expect(page.getByRole("dialog", { name: /cart/i })).toBeVisible();
  await page.mouse.click(700, 400);
  await expect(page.getByRole("dialog", { name: /cart/i })).toBeHidden();
});

test("phone: the sidebar is a drawer that closes on the scrim", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page);
  await page.goto("/member/chat?conversation=c1");
  const sidebar = page.getByRole("complementary", { name: /chats and navigation/i });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: /open menu/i }).click();
  await expect(sidebar).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/ux/drawer-phone.png" });
  await page.mouse.click(370, 400);
  await expect(sidebar).toBeHidden();
});

test("pop-ups and the product view at each size (screenshots for review)", async ({ page }) => {
  await signedInMember(page);
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto("/member/chat?panel=product&product=p1");
  await expect(page.getByRole("region", { name: "Product details" })).toBeVisible();
  await expect(page.getByRole("region", { name: /member product discovery chat/i })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: "test-results/ux/product-split-desktop.png" });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/member/chat?conversation=c1");
  await page.getByRole("button", { name: /open member account menu/i }).click();
  await page.screenshot({ path: "test-results/ux/account-menu-laptop.png" });
  await page.getByRole("menuitem", { name: /member tier/i }).click();
  await expect(page.getByRole("dialog", { name: /member tier/i })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/ux/tier-dialog-laptop.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^notifications/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/ux/notifications-laptop.png" });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/member/chat?panel=product&product=p1");
  await expect(page.getByRole("region", { name: "Product details" })).toBeVisible();
  await noSideScroll(page);
  await page.screenshot({ path: "test-results/ux/product-phone.png" });
  await page.getByRole("button", { name: /^cart/i }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/ux/cart-sheet-phone.png" });
  await page.mouse.click(200, 60);
  await expect(page.getByRole("dialog", { name: /cart/i })).toBeHidden();
  await page.getByRole("button", { name: /open menu/i }).click();
  await page.getByRole("button", { name: /open member account menu/i }).click();
  await page.getByRole("menuitem", { name: /virtual points/i }).click();
  await expect(page.getByRole("dialog", { name: /virtual points/i })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/ux/points-sheet-phone.png" });
});

for (const size of [SIZES[0], SIZES[2]]) {
  test(`ads for free members fit a ${size.name} and stay out of the way`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await page.route("**/members/shop/products?**", (route) => route.fulfill({ json: { products: manyProducts, categories: [] } }));
    await page.goto("/member/chat?panel=catalog");
    await page.locator('[data-placement="browse_top"]').scrollIntoViewIfNeeded();
    await expect(page.getByText("Go ad-free with Standard")).toBeVisible();
    await expect(page.locator('[data-placement="browse_feed"]')).toHaveCount(1);
    // The page limit is 3: Browse top + one in-feed ad, plus the desktop menu ad.
    expect(await page.locator(".fayfort-ad").count()).toBeLessThanOrEqual(3);
    await noSideScroll(page);
    await page.locator('[data-placement="browse_feed"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-placement="browse_feed"]').getByText("Find verified suppliers")).toBeVisible();
    await page.screenshot({ path: `test-results/ux/ads-browse-${size.name}.png` });
    await page.locator('[data-placement="browse_top"]').scrollIntoViewIfNeeded();
    await page.getByText("Go ad-free with Standard").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}
