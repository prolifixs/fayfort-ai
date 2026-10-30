import { expect, test, type Page } from "@playwright/test";
import { API, signedInMember } from "./member-fixtures";

/** Screens from docs/MEMBER_DASHBOARD_UX_PLAN.md: Orders & requests, Archive, Ask about a product, plans in Settings,
 * and the chat-tools tour. Screenshots land in test-results/ux/. */
const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const event = (id: string, stage: string, days: number, note: string | null = null) => ({ id, sequence_no: 1, stage, member_note: note, created_at: at(days) });
const requests = [
  { id: "r1", request_title: "Office chairs for my shop", request_description: "Mesh back, 40 units", created_at: at(6), conversation_id: "c1",
    events: [event("e1", "submitted", 6), event("e2", "needs_member_input", 1, "Which colour would you like: black or grey?")] },
  { id: "r2", request_title: "Ionic hair dryers", request_description: "50 units, UK plug", created_at: at(9), eta_at: new Date(Date.now() + 18 * 86_400_000).toISOString(),
    events: [event("e3", "submitted", 9), event("e4", "sourcing", 3)] },
  { id: "r3", request_title: "Lace front wigs, 22 inch", request_description: null, created_at: at(20), eta_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    events: [event("e5", "item_in_warehouse", 2)] },
  { id: "r4", request_title: "Ankara fabric, 6 yards", request_description: null, created_at: at(40), events: [event("e6", "delivered", 8)] },
];

async function withRequests(page: Page) {
  await page.route(`${API}/members/requests`, (route) => route.fulfill({ json: { requests } }));
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/ux/${name}.png` });
}

for (const size of [{ name: "phone", width: 390, height: 844 }, { name: "laptop", width: 1280, height: 800 }]) {
  test(`Orders & requests reads clearly on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await signedInMember(page);
    await withRequests(page);
    await page.goto("/member/chat?panel=requests");
    const needs = page.getByRole("region", { name: "Needs you" });
    await expect(needs.getByText("We have a question about your request")).toBeVisible();
    await expect(page.getByRole("tab", { name: /In progress/ })).toBeVisible();
    await shoot(page, `orders-${size.name}`);
    await page.getByRole("button", { name: /Ionic hair dryers/ }).click();
    await expect(page.getByRole("list", { name: "Progress for Ionic hair dryers" })).toBeVisible();
    await shoot(page, `orders-open-${size.name}`);
  });
}

test("Archive in the chat list (laptop)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signedInMember(page);
  await page.route(`${API}/members/conversations`, (route) =>
    route.fulfill({ json: { conversations: [{ id: "c1", title: "Bob wig with bangs", retention_hold: false, created_at: at(2), last_activity_at: at(0) }], archived_count: 2 } }));
  await page.route(`${API}/members/conversations?archived=true`, (route) =>
    route.fulfill({ json: { conversations: [
      { id: "c8", title: "Ankara fabric order", retention_hold: true, linked_request_id: "r4", created_at: at(40), last_activity_at: at(8), archived_at: at(5), archived_by: "auto" },
      { id: "c9", title: "Hair dryer samples", retention_hold: true, linked_request_id: "r9", created_at: at(60), last_activity_at: at(30), archived_at: at(25), archived_by: "member" },
    ] } }));
  await page.goto("/member/chat?conversation=c1");
  await expect(page.getByText("2 finished chats moved to Archive.")).toBeVisible();
  await shoot(page, "archive-notice-laptop");
  await page.getByRole("button", { name: /Archive\s*2/ }).click();
  await expect(page.getByRole("region", { name: "Archived chats" }).getByText("Ankara fabric order")).toBeVisible();
  await shoot(page, "archive-list-laptop");
});

test("Ask about a product: desktop card and Send to menu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signedInMember(page);
  await page.goto("/member/chat?panel=product&product=p1");
  const attached = page.getByLabel(/^Asking about /);
  await expect(attached).toBeVisible();
  await attached.getByRole("button", { name: /Send to:/ }).click();
  await shoot(page, "product-ask-desktop");
});

test("Ask about a product: phone sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page);
  await page.goto("/member/chat?panel=product&product=p1");
  await shoot(page, "product-ask-phone-page");
  await page.getByRole("button", { name: "Ask about this product" }).click();
  await expect(page.getByRole("dialog", { name: "Ask about this product in" })).toBeVisible();
  await shoot(page, "product-ask-phone-sheet");
});

test("Plans live in Account details; the tier pop-up keeps the rank", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signedInMember(page);
  await page.goto("/member/chat?conversation=c1");
  await page.locator("[data-tour='account'] > button").first().click();
  await page.getByRole("menuitem", { name: /Member tier/ }).click();
  const tier = page.getByRole("dialog", { name: "Member tier" });
  await expect(tier.getByRole("table")).toHaveCount(0);
  await shoot(page, "tier-dialog-laptop");
  await tier.getByRole("button", { name: "Plan and billing" }).click();
  await expect(page.getByRole("dialog", { name: "Account details" }).getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await shoot(page, "account-plan-laptop");
});

test("The tour explains each chat tool (phone)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page, { newMember: true });
  await page.goto("/member/chat?conversation=c1");
  const tour = page.getByRole("dialog", { name: "Dashboard tour" });
  await expect(tour.getByText("Start a chat")).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Paste a link" })).toBeVisible();
  await shoot(page, "tour-tool-phone");
});
