import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** Ankara and Ghana Must Go patterns on member screens, the theme chooser, and the Tools page with the tour guide form.
 * Screenshots in test-results/patterns/. */
const OUT = "test-results/patterns";
const THEMES = {
  ankara: { name: "Ankara", font_family: "montserrat", colors: { page_background: "#FFF8EE", surface: "#FBEBD6", text: "#2A1A12", muted_text: "#6B4A33", accent: "#C2410C", accent_foreground: "#FFFFFF", border: "#8A6A55", focus: "#1E3FB8" } },
  "ghana-must-go": { name: "Ghana Must Go", font_family: "dm-sans", colors: { page_background: "#FFFFFF", surface: "#F5F3F0", text: "#141414", muted_text: "#55514E", accent: "#C8102E", accent_foreground: "#FFFFFF", border: "#6E6A66", focus: "#141414" } },
} as const;
type Key = keyof typeof THEMES;
const design = (key: Key) => ({ palette_preset: key, wrapper_style: "soft", colors: THEMES[key].colors, font_family: THEMES[key].font_family, pattern: key, pattern_strength: "bold" });

async function withTheme(page: Page, key: Key) {
  await page.route(/\/members\/(me\/theme|themes)$/, (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/members/themes"))
      return route.fulfill({ json: { member_tier: "standard", selected_theme: key, tries: { limit: 3, left: 3, next_at: null, seconds: 15 }, themes: (Object.keys(THEMES) as Key[]).map((id) => ({
        theme_id: id, display_name: THEMES[id].name, description: id === "ankara" ? "Warm cream and orange with a Kente-style Ankara pattern." : "Crisp white, black and red with the Ghana Must Go plaid.",
        requires_paid: true, can_apply: true, is_current: id === key, design: design(id) })) } });
    return route.fulfill({ json: { selected_theme: key, active_theme: { theme_id: key, display_name: THEMES[key].name, revision: 1, design: design(key) }, fallback_reason: null } });
  });
  await page.route(/\/members\/tours$/, (route) => route.fulfill({ json: { tours: [
    { id: "t0", summary: "Yiwu, from 2 Nov 2026 for 2 days, 1 person", city_label: "Yiwu", status: "quoted", quote_amount: 250, currency: "USD", invoice_url: "https://shop.example/inv", conversation_id: "c1", guide_name: null }] } }));
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const key of Object.keys(THEMES) as Key[]) {
  for (const size of [{ name: "laptop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 844 }]) {
    test(`${key} pattern and tools, ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await signedInMember(page);
      await withTheme(page, key);
      await page.goto("/member/chat?conversation=c1");
      await expect(page.locator(".member-theme-runtime")).toHaveAttribute("data-theme-pattern", key);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${key}-chat-${size.name}.png` });
      await page.goto("/member/chat?panel=tools&tool=tour");
      await expect(page.getByRole("heading", { name: "Tour guide in China" })).toBeVisible();
      await page.getByRole("button", { name: "Request a tour guide" }).click();
      await noSideScroll(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${key}-tools-tour-${size.name}.png`, fullPage: true });
    });
  }
}

test("theme chooser shows the pattern", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await signedInMember(page);
  await withTheme(page, "ankara");
  await page.goto("/member/chat?conversation=c1");
  await page.getByRole("button", { name: "Open member account menu" }).click();
  await page.getByRole("menuitem", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Browse themes" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a theme" });
  await dialog.getByRole("radio", { name: /Ghana Must Go/ }).click();
  await expect(dialog.getByText("Ghana Must Go pattern")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/chooser-laptop.png` });
});
