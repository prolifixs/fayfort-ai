import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";
import { signedInStaff } from "./staff-fixtures";

/** FayFort Finds (docs/FINDS_PLAN.md): the member page by plan, the find sheet, and the Store team's desk.
 * Screenshots in test-results/finds/. */
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];
const OUT = "test-results/finds";
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}
const photo = (n: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(${n * 53},60%,72%)"/><circle cx="150" cy="150" r="70" fill="hsl(${n * 53 + 40},55%,55%)"/></svg>`)}`;
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const NAMES = ["Heatless curling ribbon", "Satin-lined bonnet", "Mini silk press brush", "Glow edge control 3-pack", "Magnetic lash kit", "Braid cuff set (gold)"];
const process = [
  { title: "We scout every week", body: "TikTok Shop sales data, social feeds, Amazon movers, member requests and the Guangzhou and Yiwu markets." },
  { title: "We check it in China", body: "In person or with a supplier: cost, minimum order and lead time. Most products don't make it." },
  { title: "We price it for resellers", body: "Our price per unit at each quantity and, on Pro, landed cost and margin." },
  { title: "We release it on Monday", body: "A new drop every week; Pro two days early." },
];
const access = (level: "free" | "standard" | "pro") => ({
  level, early: level === "pro", research: level !== "free", breaks: level !== "free", maths: level === "pro",
  watch_limit: level === "free" ? 5 : level === "standard" ? 25 : null, alerts: level !== "free", niche_requests: level === "pro" ? 2 : 0,
});
function cards(level: "free" | "standard" | "pro") {
  return NAMES.map((name, i) => ({
    id: `f${i}`, product_id: `p${i}`, lane: i % 3 === 2 ? "rare" : "trending", name, media_url: photo(i), media_type: "image",
    stage: i % 3 === 2 ? null : i % 2 ? "Peaking" : "Rising", competition: i % 3 === 2 ? "low" : null, watching: i === 1, locked: level === "free" && i >= 3,
    currency: "USD", price_from: 3, check: i % 2 ? "Checked with a supplier" : "Checked in person",
    price_breaks: level === "free" ? undefined : [{ min_qty: 1, price: 4.5 + i }, { min_qty: 10, price: 3.2 + i }, { min_qty: 50, price: 2.4 + i }],
  }));
}
async function mockFinds(page: Page, level: "free" | "standard" | "pro") {
  await page.route("**/members/finds**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/members/finds")) {
      return route.fulfill({ json: {
        access: access(level), process, drop: { id: "d1", title: "Finds of 2 Nov 2026", release_at: iso(-2) },
        stats: { scouted: 64, checked: 18, made_it: 6 }, finds: cards(level),
        drops: [{ id: "d1", title: "Finds of 2 Nov 2026", release_at: iso(-2) }, { id: "d0", title: "Finds of 26 Oct 2026", release_at: iso(-9) }],
        next_drop: { title: "Finds of 9 Nov 2026", release_at: iso(5), early_at: iso(3), opens_for_you: level === "pro" ? iso(3) : iso(5) },
        watching_count: 1, countries: ["NG", "GH", "GB", "US", "KE", "ZA", "CA"],
      } });
    }
    return route.fulfill({ json: { access: access(level), find: {
      ...cards(level)[0], description: "Soft satin ribbon that curls hair overnight without heat. Comes in a zip pouch.",
      media: [{ media_type: "image", url: photo(0) }],
      trail: { scouted_at: iso(-12), checked_at: iso(-10), approved_at: iso(-6), released_at: iso(-4) },
      research: { why: "Sales on TikTok Shop US doubled this month and UK creators started posting it. Few sellers ship it to West Africa yet.",
        platforms: ["TikTok Shop", "Instagram"], regions: ["US", "UK"], china_check: "Checked in person", china_place: "Baiyun market, Guangzhou", sample_available: true },
      min_order: 10, lead_time: [7, 12], typical_price: [14, 20], zone: "West Africa", country: "NG",
      landed: level === "pro" ? [
        { min_qty: 1, unit_price: 4.5, freight_per_unit: 2.5, landed_per_unit: 7, margin_per_unit: 10 },
        { min_qty: 10, unit_price: 3.2, freight_per_unit: 2.5, landed_per_unit: 5.7, margin_per_unit: 11.3 },
        { min_qty: 50, unit_price: 2.4, freight_per_unit: 2.5, landed_per_unit: 4.9, margin_per_unit: 12.1 },
      ] : undefined,
    } } });
  });
}

for (const size of SIZES) {
  test(`member Finds for Pro, with the find sheet, on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await mockFinds(page, "pro");
    await page.goto("/member/chat?panel=finds");
    await expect(page.getByText(/we looked at/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "How we find them" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/member-pro-${size.name}.png` });
    await page.getByRole("button", { name: /Heatless curling ribbon/ }).click();
    const sheet = page.getByRole("dialog", { name: "Heatless curling ribbon" });
    await expect(sheet.getByText("Baiyun market, Guangzhou", { exact: false })).toBeVisible();
    await expect(sheet.getByRole("columnheader", { name: /Landed/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/member-sheet-${size.name}.png` });
  });

  test(`member Finds on Free shows the teaser on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInMember(page);
    await mockFinds(page, "free");
    await page.goto("/member/chat?panel=finds");
    await expect(page.getByText("Unlock with Standard").first()).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/member-free-${size.name}.png` });
  });

  test(`Store team Finds desk on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    const find = {
      id: "f1", lane: "trending", status: "checked", stage: "rising", competition: null, signal_platforms: ["tiktok_shop", "instagram"],
      signal_regions: ["US", "UK"], why: "Sales on TikTok Shop US doubled this month.", scout_note: "", china_check: "in_person",
      china_place: "Baiyun market, Guangzhou", unit_cost_min: 6.5, unit_cost_max: 8, cost_currency: "CNY", supplier_moq: 50,
      sample_available: true, china_note: "", sell_price_min: 14, sell_price_max: 20,
      price_breaks: [{ min_qty: 1, price: 4.5 }, { min_qty: 10, price: 3.2 }, { min_qty: 50, price: 2.4 }], unit_weight_kg: 0.2,
      scouted_at: iso(-3), checked_at: iso(-1), missing: [], listing_id: "l9",
      listing: { id: "l9", title: "Heatless curling ribbon", status: "draft", cover: { url: photo(1) } },
    };
    const drops = [
      { id: "d2", title: "Finds of 9 Nov 2026", early_at: iso(3), release_at: iso(5), catalog_at: iso(12), target_count: 10, state: "planned", count: 4 },
      { id: "d3", title: "Finds of 16 Nov 2026", early_at: iso(10), release_at: iso(12), catalog_at: iso(19), target_count: 10, state: "planned", count: 0 },
    ];
    await page.route("**/operations/finds**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/operations/finds")) return route.fulfill({ json: { finds: [find, { ...find, id: "f2", lane: "rare", status: "scouted", missing: ["the China check", "at least one price break"], listing: { ...find.listing, title: "Hand-painted hair claw", cover: { url: photo(4) } } }], drops } });
      return route.fulfill({ json: { find } });
    });
    await page.goto("/operations?view=products&tab=finds");
    await page.getByRole("button", { name: /Heatless curling ribbon/ }).click();
    await expect(page.getByRole("group", { name: "Where it's moving" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/desk-${size.name}.png`, fullPage: size.name === "laptop" });
  });
}
