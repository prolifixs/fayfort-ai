/** UI facelift 4C and 4D: the account menu and pop-ups on the new design. Screenshots in test-results/facelift/. */
import { expect, test } from "@playwright/test";
import { signedInMember } from "./member-fixtures";
for (const size of [{ n: "laptop", w: 1280, h: 800 }, { n: "phone", w: 390, h: 844 }]) test(`surfaces ${size.n}`, async ({ page }) => {
  await page.setViewportSize({ width: size.w, height: size.h });
  await signedInMember(page);
  await page.goto("/member/home");
  await page.waitForTimeout(800);
  const shot = async (name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `test-results/facelift/surfaces-${name}-${size.n}.png` }); };
  const openAccount = async () => { if (size.n === "phone") await page.getByRole("button", { name: "Open menu" }).click(); await page.getByRole("button", { name: "Open member account menu" }).click(); };
  await openAccount(); await shot("account-menu");
  await page.getByRole("menuitem", { name: /Virtual points/ }).click(); await shot("points"); await page.keyboard.press("Escape");
  await openAccount(); await page.getByRole("menuitem", { name: /Member tier/ }).click(); await shot("tier"); await page.keyboard.press("Escape");
  await openAccount(); await page.getByRole("menuitem", { name: "Account details" }).click();
  // Photo, name and plan live in Account details (owner decision 29 Oct 2026).
  const account = page.getByRole("dialog", { name: "Account details" });
  await expect(account.getByRole("heading", { name: "Profile photo" })).toBeVisible();
  await expect(account.getByRole("heading", { name: "Plan", exact: true })).toBeAttached();
  await shot("account"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Notifications/ }).first().click(); await shot("notifications"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Cart/ }).click(); await shot("cart"); await page.keyboard.press("Escape");
  await page.goto("/member/settings"); await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { name: "Sign-in methods" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile photo" })).toHaveCount(0);
  await shot("settings");
  await page.goto("/member/membership"); await page.waitForTimeout(800); await shot("membership");
});
