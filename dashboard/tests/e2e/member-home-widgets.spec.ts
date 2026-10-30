/** Home widgets: Today with the two clocks, the Finds countdown and fan, and the giveaway ticket or strip. */
import { expect, test } from "@playwright/test";
import { API, signedInMember } from "./member-fixtures";

const tile = (a: string, b: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="40" height="50" fill="url(#g)"/></svg>`)}`;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000 + 5 * 3_600_000).toISOString();
const finds = {
  drop: { title: "Drop 12", release_at: "2026-10-26T00:00:00Z" },
  finds: [
    { id: "f1", name: "Marble side table", media_url: tile("#d9c7b0", "#8a6f55"), media_type: "image", locked: false },
    { id: "f2", name: "Boucle armchair", media_url: tile("#f3e6d8", "#c8a98a"), media_type: "image", locked: false },
    { id: "f3", name: "", media_url: null, media_type: null, locked: true },
  ],
  next_drop: { title: "Drop 13", opens_for_you: inDays(8) },
};

for (const size of [{ n: "laptop", w: 1280, h: 900 }, { n: "phone", w: 390, h: 844 }]) {
  test(`home widgets with a giveaway on a ${size.n}`, async ({ page }) => {
    await page.setViewportSize({ width: size.w, height: size.h });
    await signedInMember(page);
    await page.route(`${API}/members/finds`, (route) => route.fulfill({ json: finds }));
    const saved: unknown[] = [];
    await page.route(`${API}/members/finds/alerts`, (route) => {
      const body = route.request().postDataJSON() as { on: boolean };
      saved.push(body);
      return route.fulfill({ json: { drop_alerts: body.on } });
    });
    await page.goto("/member/home");
    const today = page.locator(".member-home-today");
    await expect(today.getByRole("heading", { level: 2 })).toContainText(/Good (morning|afternoon|evening)/);
    await expect(today.locator(".member-home-clock")).toHaveCount(2);
    await expect(today.locator(".member-home-gz")).toContainText("Guangzhou");
    await expect(today).toHaveAttribute("data-phase", /dawn|day|dusk|night/);
    const findsCard = page.locator(".member-home-finds");
    await expect(findsCard.locator(".member-home-big strong")).toHaveText(/^8d \d+h$/);
    await expect(findsCard.locator(".member-home-fan li")).toHaveCount(3);
    await expect(findsCard.locator(".member-home-fan-locked")).toHaveCount(1);
    const bell = findsCard.getByRole("button", { name: "Notify me" });
    await expect(bell).toHaveAttribute("aria-pressed", "false");
    await bell.click();
    await expect(findsCard.getByRole("button", { name: "We'll email you" })).toHaveAttribute("aria-pressed", "true");
    expect(saved).toEqual([{ on: true }]);
    const ticket = page.locator(".member-home-giveaway");
    await expect(ticket.getByRole("button", { name: "Enter free" })).toBeVisible();
    await expect(page.locator(".member-home-strip")).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/home/home-widgets-${size.n}.png` });
    await page.locator(".member-home-feature").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/home/home-widgets-${size.n}-lower.png` });
  });
}

test("with no giveaway, Finds takes the full width and a slim strip points to the shop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signedInMember(page);
  await page.route(`${API}/members/finds`, (route) => route.fulfill({ json: { drop: null, finds: [], next_drop: null } }));
  await page.route(`${API}/members/shop/home`, (route) => route.fulfill({ json: { rails: [], giveaways: [] } }));
  await page.goto("/member/home");
  await expect(page.locator(".member-home-feature.is-solo")).toBeVisible();
  await expect(page.locator(".member-home-finds .member-home-big strong")).toHaveText("Mondays");
  await expect(page.locator(".member-home-fan")).toHaveAttribute("aria-hidden", "true");
  const strip = page.locator(".member-home-strip");
  await expect(strip).toContainText("No giveaway right now.");
  await strip.getByRole("link", { name: "Visit the shop" }).click();
  await expect(page).toHaveURL(/\/member\/shop/);
  await page.goto("/member/home");
  await page.waitForTimeout(600);
  await page.locator(".member-home-strip").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/home/home-widgets-no-giveaway-laptop.png" });
});
