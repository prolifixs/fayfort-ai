import { expect, test } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** Monthly or yearly plans (owner request 2026-10-26). Screenshot in test-results/yearly/. */
test("members can choose yearly billing on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInMember(page);
  await page.route("**/members/subscription", (route) => route.fulfill({ json: {
    available: true, yearly_available: true, plan: null, status: "none", paused: false, current_period_end: null,
    cancel_at_period_end: false, continuous_since: null, months: 0, has_customer: false, max_pause_months: 3,
    prices: { standard: { monthly: 5.99, yearly: 71.88, currency: "usd" }, pro: { monthly: 14.99, yearly: 179.88, currency: "usd" } },
  } }));
  await page.goto("/member/membership");
  const yearly = page.getByLabel("Yearly");
  await yearly.waitFor();
  await page.getByRole("radiogroup", { name: "Billing" }).getByText("Yearly").click();
  await expect(yearly).toBeChecked();
  await expect(page.getByRole("button", { name: "Get Pro · $179.88/year" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Billing" }).scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => {
    const wide = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 6).map((el) => `${el.tagName}.${(el as HTMLElement).className}`);
    return { by: document.documentElement.scrollWidth - window.innerWidth, wide };
  });
  await page.screenshot({ path: "test-results/yearly/upgrade-phone.png" });
  expect(overflow.by).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/yearly/upgrade-phone.png" });
});
