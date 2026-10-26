import { expect, test } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** The old version signed in through the retired Control Center form (before one sign-in for everyone, captcha and
 * two-step verification), so it could never pass. Sign-in itself is covered by auth-layout.spec.ts. */
test("operator lands on the Control Center with their client accounts and every request carries the session", async ({ page }) => {
  let authorization = "";
  page.on("request", (request) => {
    if (request.url().includes("/dashboard/businesses")) authorization = request.headers()["authorization"] || "";
  });
  await signedInStaff(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByLabel("Client account")).toContainText("FayFort Hair Lagos");
  expect(authorization).toMatch(/^Bearer \S+/);
});
