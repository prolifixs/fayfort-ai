import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Operations restructure R3: the Conversations desk with the chat, the customer card, Answers and Send to another
 * desk, at phone, iPad, laptop and wide desktop sizes. Screenshots: test-results/ops-r3/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "ipad", width: 820, height: 1180 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "wide", width: 1600, height: 960 },
];
const OUT = "test-results/ops-r3";

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of SIZES) {
  test(`conversations desk fits a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await page.goto("/operations?view=desk&desk=conversation_intake");
    const desk = page.getByRole("region", { name: "Conversations desk" });
    await expect(desk.getByRole("region", { name: "Member app chats" })).toBeVisible();
    await page.getByRole("region", { name: "Operations work items" }).getByRole("button", { name: /split payment/ }).click();
    const card = page.getByRole("complementary", { name: "Customer card" });
    await expect(card.getByRole("heading", { name: "Chioma" })).toBeVisible();
    await expect(card.getByText("Still needed: delivery city, preferred length")).toBeVisible();
    const answers = card.getByRole("region", { name: "Answers" });
    await answers.getByRole("searchbox", { name: "Search answers" }).fill("split payment");
    await answers.getByRole("button", { name: "Search" }).click();
    await expect(answers.getByRole("button", { name: /Can I split my payment/ })).toBeVisible();
    await noSideScroll(page);
    if (size.width >= 1200) {
      // Three panes side by side: the list, the chat and the customer.
      const [list, detail, pane] = await Promise.all([
        page.getByRole("region", { name: "Operations work items" }).boundingBox(),
        page.getByRole("region", { name: "Selected work details" }).boundingBox(),
        card.boundingBox(),
      ]);
      expect(list!.x).toBeLessThan(detail!.x);
      expect(detail!.x).toBeLessThan(pane!.x);
    }
    await page.screenshot({ path: `${OUT}/conversations-${size.name}.png`, fullPage: size.width >= 1200 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${OUT}/customer-card-${size.name}.png` });
  });
}
