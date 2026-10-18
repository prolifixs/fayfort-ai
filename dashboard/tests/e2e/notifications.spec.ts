import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";
import { signedInMember } from "./member-fixtures";

/** Layout QA for the notifications redesign: the open work item in the queue, the staff inbox and pop-up,
 * and the member pop-up. Screenshots land in test-results/notifications/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1536, height: 960 },
];
const OUT = "test-results/notifications";
const API = "**/operations/me/notifications";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

for (const size of SIZES) {
  test(`open work item is highlighted on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations");
    const card = page.locator('[data-work-id="w1"]');
    await card.locator(".operations-work-select").click();
    if (size.width >= 1024) {
      await expect(card).toHaveClass(/is-selected/);
      await expect(card.getByText("Viewing")).toBeVisible();
      await noSideScroll(page);
      await page.screenshot({ path: `${OUT}/queue-selected-${size.name}.png` });
    } else {
      await page.screenshot({ path: `${OUT}/queue-detail-${size.name}.png` });
    }
  });

  test(`staff inbox and pop-up fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.clock.install();
    await signedInStaff(page);
    let arrived = false;
    await page.route(API, (route) => {
      const base = [
        { id: "on1", work_item_id: "w1", notification_type: "assigned", title: "Assigned: TikTok wig", body: "Member support", created_at: minutesAgo(9), read_at: null, href: "/operations?workItem=w1" },
        { id: "on0", work_item_id: null, notification_type: "review_done", title: "Listing published", body: "Body wave wig is live", created_at: "2026-01-02T10:00:00Z", read_at: "2026-01-02T11:00:00Z", href: "/operations" },
      ];
      const fresh = arrived ? [{ id: "on2", work_item_id: "w4", notification_type: "work_overdue", title: "Overdue: Pack and ship #1042", body: "Was due 2 hours ago", created_at: minutesAgo(0), read_at: null, href: "/operations?workItem=w4" }] : [];
      return route.fulfill({ json: { notifications: [...fresh, ...base], unread_count: fresh.length + 1, sound_enabled: true } });
    });
    await page.goto("/operations");
    await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();
    arrived = true;
    await page.clock.fastForward(31_000);
    const toast = page.getByRole("status", { name: "New notification" });
    await expect(toast).toContainText("Overdue: Pack and ship #1042");
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/staff-toast-${size.name}.png`, animations: "disabled" });
    await toast.getByRole("button", { name: "Close notification" }).click();
    await page.getByRole("button", { name: /Notifications, 2 unread/ }).click();
    const panel = page.getByRole("region", { name: "Worker notifications" });
    await expect(panel.getByRole("region", { name: "Today" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mark all read" })).toBeEnabled();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/staff-inbox-${size.name}.png` });
    await panel.getByText("Sound options").click();
    await expect(panel.getByLabel("Urgent sound (overdue work, alerts)")).toHaveValue("alert");
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/staff-sounds-${size.name}.png` });
  });

  test(`member pop-up fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    let arrived = false;
    await page.route((url) => url.pathname === "/members/notifications", (route) => {
      const fresh = arrived ? [
        { id: "m3", notification_type: "worker_reply", title: "FayFort replied", body: "We found the wig in 3 lengths. Want the price list?", created_at: minutesAgo(0), read_at: null, href: "/member/chat?conversation=other" },
        { id: "m4", notification_type: "order_update", title: "Order shipped", body: "Your order #1042 is on the way.", created_at: minutesAgo(0), read_at: null, href: "/member/chat?panel=orders" },
      ] : [];
      return route.fulfill({ json: { notifications: [...fresh, { id: "n1", title: "Your request is being sourced", body: "We found 3 suppliers.", created_at: minutesAgo(90), read_at: null, href: "/member/chat?panel=requests" }], unread_count: fresh.length + 1 } });
    });
    await page.goto("/member/chat");
    await expect(page.getByRole("button", { name: /Notifications, 1 unread/ }).first()).toBeVisible();
    arrived = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const toast = page.getByRole("status", { name: "New notification" });
    await expect(toast).toContainText("2 new updates");
    await expect(toast).toHaveCount(1);
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/member-toast-${size.name}.png`, animations: "disabled" });
    await expect(toast).toBeHidden({ timeout: 8000 });
  });
}
