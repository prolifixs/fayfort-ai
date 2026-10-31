/** Phones: the top bar and tab bar slide away while scrolling down and come back on scrolling up or stopping. */
import { expect, test } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

test("the bars slide away while scrolling down on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page);
  await page.goto("/member/home");
  const shell = page.locator(".mapp");
  await expect(page.locator(".mapp-tabbar")).toBeVisible();
  await expect(page.locator(".member-home-today")).toBeVisible();
  const panel = page.locator(".member-home");
  const box = await panel.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 200);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }
  await expect(shell).toHaveClass(/bars-hidden/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/scroll-bars/hidden-phone.png" });
  const tabbar = await page.locator(".mapp-tabbar").boundingBox();
  expect(tabbar?.height ?? 0).toBeLessThan(4);
  // Stopping brings them back.
  await expect(shell).not.toHaveClass(/bars-hidden/, { timeout: 3000 });
  await page.waitForTimeout(400);
  expect((await page.locator(".mapp-tabbar").boundingBox())?.height).toBeGreaterThan(50);
  await page.screenshot({ path: "test-results/scroll-bars/back-phone.png" });
  // Down again, then up: they come back straight away.
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(80);
  await page.mouse.wheel(0, 300);
  await expect(shell).toHaveClass(/bars-hidden/);
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, -200);
  await expect(shell).not.toHaveClass(/bars-hidden/, { timeout: 600 });
});

test("the bars stay put on a laptop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signedInMember(page);
  await page.goto("/member/home");
  await expect(page.locator(".member-home-today")).toBeVisible();
  await page.mouse.move(700, 500);
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 150);
  await page.waitForTimeout(200);
  await expect(page.locator(".mapp")).not.toHaveClass(/bars-hidden/);
});
