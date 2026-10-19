import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** Member themes on real member screens (light and dark), and the theme chooser. Screenshots in test-results/themes/. */
const OUT = "test-results/themes";
const THEMES = {
  "girl-boss": { name: "Girl Boss", font_family: "poppins", colors: { page_background: "#FFF4F8", surface: "#FFFFFF", text: "#3D0C25", muted_text: "#8A3A62", accent: "#D6247A", accent_foreground: "#FFFFFF", border: "#E9A3C4", focus: "#B0185F" } },
  "koko-water": { name: "Importer, Exporter, Koko Water", font_family: "montserrat", colors: { page_background: "#0B1A33", surface: "#12264A", text: "#EAF1FB", muted_text: "#A9BCD8", accent: "#4FA3FF", accent_foreground: "#06122A", border: "#3A5A8C", focus: "#7CC0FF" } },
  "plus-234-hustler": { name: "+234 Hustler", font_family: "dm-sans", colors: { page_background: "#161718", surface: "#222426", text: "#F2F2F2", muted_text: "#B3B6BA", accent: "#2FBF71", accent_foreground: "#0B1A10", border: "#4A4E53", focus: "#5FD99A" } },
} as const;
type ThemeKey = keyof typeof THEMES;
const design = (key: ThemeKey) => ({ palette_preset: key, wrapper_style: "soft", colors: THEMES[key].colors, font_family: THEMES[key].font_family });

async function withTheme(page: Page, key: ThemeKey | "base") {
  await page.route(/\/members\/(me\/theme|themes)$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/members/themes"))
      return route.fulfill({ json: { member_tier: "standard", selected_theme: key, themes: [
        { theme_id: "base", display_name: "FayFort base", description: "FayFort’s standard member theme.", requires_paid: false, can_apply: true, is_current: key === "base",
          design: { palette_preset: "ocean-blue", wrapper_style: "soft", font_family: "system", colors: { page_background: "#FFFFFF", surface: "#F7F9FA", text: "#17212B", muted_text: "#526170", accent: "#005A9C", accent_foreground: "#FFFFFF", border: "#637180", focus: "#005A9C" } } },
        ...(Object.keys(THEMES) as ThemeKey[]).map((id) => ({ theme_id: id, display_name: THEMES[id].name, description: id === "girl-boss" ? "For the highly motivated women empowerment" : id === "koko-water" ? "Deep navy for people moving goods across borders." : "Charcoal and Naija green for people building it themselves.",
          requires_paid: true, can_apply: true, is_current: key === id, design: design(id) })),
      ] } });
    return route.fulfill({ json: key === "base" ? { selected_theme: "base", active_theme: null, fallback_reason: null }
      : { selected_theme: key, active_theme: { theme_id: key, display_name: THEMES[key].name, revision: 1, design: design(key) }, fallback_reason: null } });
  });
}

for (const key of Object.keys(THEMES) as ThemeKey[]) {
  for (const size of [{ name: "laptop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 844 }]) {
    test(`${key} on member screens, ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await signedInMember(page);
      await withTheme(page, key);
      for (const screen of [{ name: "chat", path: "/member/chat?conversation=c1" }, { name: "browse", path: "/member/chat?panel=catalog" }, { name: "product", path: "/member/chat?panel=product&product=p1" }]) {
        await page.goto(screen.path);
        await expect(page.locator(".member-theme-runtime")).toHaveAttribute("data-theme-id", key);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${key}-${screen.name}-${size.name}.png` });
      }
    });
  }
}

test("dark themes switch status colours and native controls", async ({ page }) => {
  await signedInMember(page);
  await withTheme(page, "koko-water");
  await page.goto("/member/chat?conversation=c1");
  const runtime = page.locator(".member-theme-runtime");
  await expect(runtime).toHaveAttribute("data-theme-tone", "dark");
  const values = await runtime.evaluate((el) => {
    const style = getComputedStyle(el);
    return { danger: style.getPropertyValue("--color-danger").trim(), scheme: style.colorScheme };
  });
  expect(values).toEqual({ danger: "#ff8a80", scheme: "dark" });
});

for (const size of [{ name: "laptop", width: 1280, height: 860 }, { name: "phone", width: 390, height: 844 }]) {
  test(`theme chooser, ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await withTheme(page, "girl-boss");
    await page.goto("/member/chat?conversation=c1");
    if (size.width < 1024) await page.getByRole("button", { name: /open menu/i }).click();
    await page.getByRole("button", { name: /open member account menu/i }).click();
    await page.getByRole("menuitem", { name: /settings/i }).click();
    await page.getByRole("button", { name: "Browse themes" }).click();
    const chooser = page.getByRole("dialog", { name: "Choose a theme" });
    await expect(chooser.getByRole("radio", { name: /Girl Boss/ })).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/chooser-girl-boss-${size.name}.png` });
    await chooser.getByRole("radio", { name: /Koko Water/ }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/chooser-koko-${size.name}.png` });
    await chooser.getByRole("radio", { name: /Hustler/ }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/chooser-hustler-${size.name}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
