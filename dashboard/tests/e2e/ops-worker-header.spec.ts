import { expect, test } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R1: a worker's Operations header has My account (instead of the Control Center link), the
 * shift clock and the chat availability switch, without the page scrolling sideways. Screenshots: test-results/ops-r1/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const API = "http://127.0.0.1:8001";

for (const size of SIZES) {
  test(`worker operations header fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.route(`${API}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/operations/me/departments")
        return route.fulfill({ json: { user_id: "staff-1", departments: ["conversation_intake", "member_support"], can_manage: false } });
      if (path.endsWith("/handoffs/availability")) return route.fulfill({ json: { availability: "offline", available_until: null, max_active_handoffs: 3 } });
      return route.fallback();
    });
    await page.goto("/operations");
    await expect(page.getByRole("link", { name: "My account" })).toHaveAttribute("href", "/?page=account");
    await expect(page.getByRole("link", { name: /Control Center/ })).toHaveCount(0);
    const chats = page.getByRole("button", { name: /Not taking chats/ });
    await expect(chats).toBeVisible();
    await chats.click();
    await expect(page.getByRole("dialog", { name: "Chat availability" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/ops-r1/header-${size.name}.png` });
  });
}
