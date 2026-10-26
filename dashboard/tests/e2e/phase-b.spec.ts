import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Phase B (docs/OPERATIONS_FIXES_PLAN.md): Conversations views with member-app chats, and claim-first work.
 * Screenshots in test-results/phase-b/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const OUT = "test-results/phase-b";
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

const memberChats = [
  { id: "mc9", title: "Need a supplier for lace wigs", member_name: "Ada Obi", last_activity_at: iso(3), handled_by: "ai", work_item_id: null, linked_request_id: null,
    last_message: { sender_type: "member", content: "Can someone from the team confirm the price?", created_at: iso(3) } },
  { id: "mc8", title: "Container from Yiwu", member_name: "Bola Ade", last_activity_at: iso(40), handled_by: "staff", work_item_id: "w1", linked_request_id: null,
    last_message: { sender_type: "worker", content: "I'll check the freight quote today.", created_at: iso(40) } },
];

for (const size of SIZES) {
  test(`Conversations views and member-app chats on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.route("**/operations/member-chats**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/member-chats")) return route.fulfill({ json: { chats: memberChats } });
      return route.fulfill({ json: { chat: memberChats[0], messages: [
        { id: "x1", sender_type: "member", content: "Hi, I need 10 lace wigs.", created_at: iso(10) },
        { id: "x2", sender_type: "assistant", content: "Happy to help. What length and density?", created_at: iso(9) },
        { id: "x3", sender_type: "member", content: "Can someone from the team confirm the price?", created_at: iso(3) },
      ] } });
    });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    if (size.width < 900) await page.getByRole("button", { name: /menu/i }).first().click().catch(() => undefined);
    await nav.getByRole("button", { name: /Conversations/ }).click();
    const tabs = page.getByRole("tablist", { name: "Which chats" });
    await expect(tabs.getByRole("tab", { name: "Waiting for a person" })).toHaveAttribute("aria-selected", "true");
    await tabs.getByRole("tab", { name: "Member app" }).click();
    await expect(page.getByRole("list", { name: "Member chats" }).getByText("Ada Obi")).toBeVisible();
    await page.getByRole("button", { name: /Ada Obi/ }).click();
    await expect(page.getByRole("button", { name: "Take over and reply" })).toBeVisible();
    await expect(page.getByText("Hi, I need 10 lace wigs.")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/member-chats-${size.name}.png` });
  });

  test(`unclaimed work offers Claim and continue on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?workItem=w3");
    await expect(page.getByRole("button", { name: /Claim/ }).first()).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/claim-first-${size.name}.png` });
  });
}
