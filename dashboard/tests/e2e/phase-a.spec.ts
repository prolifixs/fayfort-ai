import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";
import { signedInMember } from "./member-fixtures";

/** Phase A fixes (docs/OPERATIONS_FIXES_PLAN.md): chat takeover in Operations, the tour guide card, giveaway details.
 * Screenshots in test-results/phase-a/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const OUT = "test-results/phase-a";
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`member chat takeover in Operations on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?workItem=w1");
    await expect(page.getByRole("button", { name: "Take over from the AI" })).toBeVisible();
    await expect(page.getByText("The AI is answering this member.")).toBeVisible();
    await page.getByRole("button", { name: "Take over from the AI" }).scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/takeover-${size.name}.png` });
    await page.getByRole("button", { name: "Take over from the AI" }).click();
    await expect(page.getByText(/taken this chat over/)).toBeVisible();
  });

  test(`tour guide card and giveaway details on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await page.route("**/members/tours", (r) => r.fulfill({ json: { tours: [
      { id: "t1", city_label: "Guangzhou", summary: "Guangzhou, from 25 Nov 2026 for 1 day, 1 person", status: "quoted", invoice_url: "https://pay.example", conversation_id: "c1", quote_amount: 120, currency: "USD", guide_name: null },
      { id: "t2", city_label: "Yiwu", summary: "Yiwu, from 3 Dec 2026 for 2 days, 2 people", status: "requested", invoice_url: null, conversation_id: "c2", quote_amount: null, currency: "USD", guide_name: null },
    ], cities: {}, needs: {} } }));
    await page.goto("/member/chat?panel=tools&tool=tour");
    const card = page.getByRole("region", { name: "Tour guide in China" });
    await expect(card.getByText("Quote ready")).toBeVisible();
    const box = await card.boundingBox();
    expect(box!.height, "the card hugs its content").toBeLessThan(600);
    await expect(page.getByRole("button", { name: "Request a tour guide" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/tour-${size.name}.png`, fullPage: true });

    await page.goto("/member/chat?panel=catalog");
    await page.getByRole("button", { name: /Details and rules/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Win a lace front wig" });
    await expect(sheet.getByText("One free entry per member. No purchase needed.")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/giveaway-${size.name}.png` });
  });
}
