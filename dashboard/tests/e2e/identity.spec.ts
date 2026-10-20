import { expect, test } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** The required name card on a member with no name yet. Screenshots in test-results/identity/. */
for (const size of [{ name: "laptop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 844 }]) {
  test(`required name card, ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    let saved = false;
    await signedInMember(page, { noName: () => !saved });
    await page.route(/\/members\/me\/(identity|username)(\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/username")) return route.fulfill({ json: { username: url.searchParams.get("u"), available: true, reason: null } });
      if (route.request().method() === "PUT") {
        saved = true;
        return route.fulfill({ json: { first_name: "Jordan", last_name: "Mensah", username: "jordanm", display_name: "Jordan Mensah", complete: true } });
      }
      return route.fulfill({ json: { first_name: null, last_name: null, username: null, complete: false, suggestion: { first_name: "Jordan", last_name: "", username: "" } } });
    });
    await page.goto("/member/chat?conversation=c1");
    const card = page.getByRole("dialog", { name: "Tell us who you are" });
    await expect(card).toBeVisible();
    await expect(card.getByLabel("First name")).toHaveValue("Jordan");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/identity/card-empty-${size.name}.png` });
    await card.getByLabel("Surname").fill("Mensah");
    await card.getByLabel("Username").fill("jordanm");
    await expect(card.getByText("@jordanm is free.")).toBeVisible();
    await page.screenshot({ path: `test-results/identity/card-filled-${size.name}.png` });
    await card.getByRole("button", { name: "Save and continue" }).click();
    await expect(card).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
