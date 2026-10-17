import { expect, test } from "@playwright/test";

/** Sign-in screens on the navy globe (docs/AUTH_PAGES_PLAN.md): the card is fully visible and nothing scrolls sideways. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const SCREENS = [
  { name: "control-center", path: "/", heading: "Sign in" },
  { name: "signin", path: "/member/account", heading: "Sign in" },
  { name: "signup", path: "/member/signup", heading: "Create your account" },
  { name: "forgot", path: "/auth/forgot?audience=member", heading: "Reset your password" },
  // A reset email link: the one-time code is used only when the person clicks Continue.
  { name: "reset-link", path: "/auth/callback?type=recovery&token_hash=e2e-code", heading: "Reset your password" },
];

for (const size of SIZES) {
  for (const screen of SCREENS) {
    test(`${screen.name} sign-in screen fits a ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await expect(page.locator(".auth-globe-canvas")).toHaveCount(1);
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
      const card = await page.locator(".auth-card").boundingBox();
      expect(card && card.x >= 0 && card.x + card.width <= size.width).toBeTruthy();
      await page.screenshot({ path: `test-results/ux/auth-${screen.name}-${size.name}.png`, fullPage: true });
    });
  }
}
