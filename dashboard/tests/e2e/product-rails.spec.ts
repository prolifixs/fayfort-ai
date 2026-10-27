import { expect, test, type Page } from "@playwright/test";
import { signedInMember } from "./member-fixtures";

/** Chat welcome picks, Shop by category and the product rails (owner request, 2026-10-20).
 * Screenshots in test-results/product-rails/. */
const OUT = "test-results/product-rails";
const COLORS = ["#c9a27e", "#7e9cc9", "#c97e9c", "#8fc97e", "#c9c27e", "#9c7ec9", "#7ec9c2", "#c97e7e"];
const item = (id: string, name: string, label: string, price: number | null, i: number) => ({
  id, name, category_ref: "x", category_label: label, source: "fayfort", availability_status: "sourcing",
  media_url: `https://img.fayfort.test/${i}.svg`, media_type: "image", price, price_max: price, currency: "USD",
  price_guide: price !== null, buyable: false, heat: 0, badges: [{ key: "sourced", label: "Sourced from China" }],
});
const furniture = [
  item("f1", "Natural marble round dining table with lazy susan, 2 m", "Dining tables", 3690, 0),
  item("f2", "White curved modular sofa", "Sofas", 2850, 1),
  item("f3", "Real leather lounge accent chair", "Sofas", 590, 2),
  item("f4", "Cream boucle curved lounge sofa", "Sofas", null, 3),
  item("f5", "Green natural marble dining table, 3 m", "Dining tables", 3450, 4),
];
const kids = [
  item("k1", "Kids electric ride-on jeep, red", "Toys", 114, 5),
  item("k2", "Kids 2-in-1 electric ride-on motorbike", "Toys", 64, 6),
  item("k3", "Baby rocking horse and walker 2-in-1", "Toys", 28, 7),
];
const kitchen = [
  item("c1", "Three-tier cake and dessert stand", "Plates", 7, 1),
  item("c2", "Glass spice jar set with bamboo lids and tray", "Kitchen organizers", 3.5, 3),
  item("c3", "Die-cast cookware set with frying pan, coral", "Cookware", 64, 5),
];
const home = {
  rails: [
    { key: "new_sourcing", title: "New from FayFort sourcing", items: [furniture[0], kids[0], kitchen[0], furniture[1]] },
    { key: "top:Home, Furniture & Interior", title: "Furniture from China", items: furniture.slice(2) },
    { key: "top:Children & Baby", title: "Kids' ride-ons and toys", items: kids.slice(1).concat([item("k4", "Kids adjustable inline skates, pink", "Outdoor equipment", 24, 2)]) },
    { key: "under_price", title: "Under 25 USD", items: kitchen.slice(1).concat([kids[2]]) },
  ],
  giveaways: [],
  intent: { active: false },
  category_bar: [],
  sections: [],
  category_tiles: [
    { key: "Home, Furniture & Interior", label: "Furniture from China", count: 22, image_url: "https://img.fayfort.test/1.svg" },
    { key: "Children & Baby", label: "Kids' ride-ons and toys", count: 10, image_url: "https://img.fayfort.test/5.svg" },
    { key: "Kitchen & Household", label: "Kitchen and home", count: 8, image_url: "https://img.fayfort.test/3.svg" },
    { key: "Sports & Fitness", label: "Skates and outdoor", count: 7, image_url: "https://img.fayfort.test/2.svg" },
    { key: "Electronics & Technology", label: "Phones and gadgets", count: 3, image_url: "https://img.fayfort.test/6.svg" },
  ],
};

async function shop(page: Page) {
  await signedInMember(page);
  await page.route("https://img.fayfort.test/**", (route) => {
    const n = Number(new URL(route.request().url()).pathname.replace(/\D/g, "")) || 0;
    const color = COLORS[n % COLORS.length];
    return route.fulfill({ contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/><circle cx="300" cy="300" r="160" fill="rgba(255,255,255,.35)"/></svg>` });
  });
  await page.route(/\/members\/conversations(\/c9\/messages)?(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/messages")) return route.fulfill({ json: { messages: [] } });
    if (route.request().method() === "POST")
      return route.fulfill({ json: { conversation: { id: "c9", title: "New chat", retention_hold: false, created_at: new Date().toISOString(), last_activity_at: new Date().toISOString() } } });
    return route.fallback();
  });
  await page.route(/\/members\/shop\/(home|products)(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/home")) return route.fulfill({ json: home });
    const top = url.searchParams.get("top");
    const all = [...furniture, ...kids, ...kitchen];
    const products = top === "Home, Furniture & Interior" ? furniture : all;
    return route.fulfill({ json: { products, total: products.length, has_more: false, groups: [], categories: [], offset: 0 } });
  });
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

for (const size of [{ name: "phone", width: 390, height: 844 }, { name: "laptop", width: 1280, height: 800 }]) {
  test(`chat welcome shows product picks on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await shop(page);
    await page.goto("/member/chat");
    if (size.width < 1024) await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Ask FayFort" }).first().click();
    const picks = page.getByRole("region", { name: "Popular picks" });
    await expect(picks).toBeVisible();
    await expect(picks.getByRole("button", { name: /^Open / })).toHaveCount(8);
    await expect(picks.getByRole("link", { name: "Furniture from China" })).toBeVisible();
    await noSideScroll(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/chat-welcome-${size.name}.png`, fullPage: true });
  });

  test(`browse leads with categories and product rails on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await shop(page);
    await page.goto("/member/chat?panel=catalog");
    const tiles = page.getByRole("region", { name: "Category tiles" });
    await expect(tiles).toBeVisible();
    await expect(page.getByRole("region", { name: "New from FayFort sourcing" })).toBeVisible();
    await expect(page.getByText("Contact our team for a price").first()).toBeVisible();
    await noSideScroll(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/browse-${size.name}.png`, fullPage: true });
    await tiles.getByRole("button", { name: /Furniture from China/ }).click();
    await expect(page.getByText("Showing Furniture from China")).toBeVisible();
    await page.screenshot({ path: `${OUT}/browse-furniture-${size.name}.png` });
  });
}
