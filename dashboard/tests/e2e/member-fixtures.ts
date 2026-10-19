import type { Page } from "@playwright/test";

/** A signed-in member with a realistic chat, shop and account, all served from fixtures (no real API). */
export const SUPABASE = "https://test-fayfort.supabase.co";
export const API = "http://127.0.0.1:8001";

const user = {
  id: "member-1", aud: "authenticated", role: "authenticated", email: "member@example.test",
  email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {}, created_at: "2026-09-01T00:00:00Z",
};

const now = Date.now();
const soon = new Date(now + 5 * 3600_000).toISOString();
const wig = (id: string, name: string, price: number, extra: Record<string, unknown> = {}) => ({
  id, name, category_ref: "hair-wigs", group_name: "Hair", source: "shopify", in_stock: true,
  availability_status: "available", media_url: null, media_type: null, price, currency: "USD", buyable: true, heat: 2, ...extra,
});
const products = [
  wig("p1", "Body wave lace front wig 22 inch", 120, { sale: { id: "s1", title: "Weekend drop", ends_at: soon, sale_price: 96 } }),
  wig("p2", "Straight bob wig with bangs", 80),
  wig("p3", "Kinky curly closure wig", 140),
  wig("p4", "Ankara print fabric 6 yards", 18, { group_name: "Fabrics", category_ref: "fabric-ankara" }),
  wig("p5", "Ionic hair dryer", 35, { group_name: "Beauty", category_ref: "hair-tools" }),
];
const trend = {
  id: "t1", url: "https://www.tiktok.com/@hairqueen/video/1", platform: "tiktok", title: "Viral bob wig everyone is asking about",
  image_url: null, author_name: "@hairqueen", status: "pooling", share_count: 9, want_count: 7,
  pool: { target: 10, price: 60, currency: "USD", progress: 0.7 }, member_wants: false, linked_product: null,
};
const chats = [
  { id: "c1", title: "I saw this wig on TikTok", retention_hold: false, support_status: "open", created_at: "2026-10-14T00:00:00Z", last_activity_at: "2026-10-15T00:00:00Z" },
  { id: "c2", title: "Ankara fabric for a wedding party", retention_hold: true, linked_request_id: "r1", created_at: "2026-10-12T00:00:00Z", last_activity_at: "2026-10-13T00:00:00Z" },
  { id: "c3", title: "Hair dryer under fifty dollars", retention_hold: false, created_at: "2026-10-10T00:00:00Z", last_activity_at: "2026-10-10T00:00:00Z" },
];
const messages = [
  { id: "m1", sender_type: "member", content: "I saw this wig on TikTok https://www.tiktok.com/@hairqueen/video/1", related_product_ids: [], created_at: "2026-10-15T00:00:01Z" },
  {
    id: "m2", sender_type: "assistant", related_product_ids: ["p2"], created_at: "2026-10-15T00:00:02Z",
    content: "That looks like a straight bob with bangs. We don't stock that exact one yet, but here are close matches you can get today. Want me to source the exact wig for you?",
    find_it: { kind: "link", query: "bob wig", link: { ...trend, status: "open", pool: null }, exact: null, alternatives: [products[1], products[0]], source_it: { available: true, trend_item_id: "t1", title_hint: "Viral bob wig" } },
  },
  { id: "m3", sender_type: "member", content: "Yes please, I need it before the 30th.", related_product_ids: [], created_at: "2026-10-15T00:00:03Z" },
  { id: "m4", sender_type: "worker", content: "Hi, I'm Ada from FayFort. I'll check with our Guangzhou suppliers and get back to you within a day.", related_product_ids: [], created_at: "2026-10-15T00:00:04Z", staff: { first_name: "Ada", photo_url: null } },
];
const profile = {
  user_id: "member-1", display_name: "Jordan Member", points_balance: 320, rank_level: 2, subrank: 3, member_tier: "free",
  selected_theme: "base", created_at: "2026-09-01T00:00:00Z",
};
const contacts = { tier: "free", credits: 0, pro_allowance_left: 0, pro_allowance: 0, packs: [{ id: "single", credits: 1, price: 15, currency: "USD" }, { id: "pack5", credits: 5, price: 50, currency: "USD" }] };

const fixtures: Record<string, unknown> = {
  "/members/me": {
    profile, onboarding_completed: true,
    completion: { percent: 60, done: 3, total: 5, address_ready: true, items: [
      { key: "email", label: "Verify your email", done: true },
      { key: "name", label: "Add your name", done: true },
      { key: "address", label: "Add a shipping address", done: true, required: true },
      { key: "phone", label: "Add a phone number for delivery", done: false, why: "Couriers may call before they deliver." },
      { key: "photo", label: "Add a profile photo", done: false },
    ] },
  },
  "/members/addresses": { max: 2, addresses: [
    { id: "a1", label: "Home", recipient_name: "Jordan Member", phone: null, line1: "12 Allen Avenue", line2: "Flat 3", city: "Ikeja", region: "Lagos", postal_code: "100271", country: "Nigeria", is_default: true },
  ] },
  "/members/me/theme": { selected_theme: "base", active_theme: null, fallback_reason: null },
  "/members/conversations": { conversations: chats },
  "/members/conversations/c1/messages": { messages },
  "/members/requests": { requests: [] },
  "/members/shop/home": {
    rails: [
      { key: "hot", title: "Hot right now", items: products.slice(0, 4) },
      { key: "trend", title: "Trending links", kind: "trend", items: [trend] },
    ],
    giveaways: [{ id: "g1", title: "Win a lace front wig", description: "", prize_text: "Body wave wig", ends_at: soon, status: "open", entered: false, won: false }],
    intent: { active: true },
    category_bar: [
      { kind: "group", key: "Hair", label: "Hair", count: 3 }, { kind: "group", key: "Fabrics", label: "Fabrics", count: 1 },
      { kind: "group", key: "Beauty", label: "Beauty", count: 1 }, { kind: "category", key: "hair-wigs", label: "Lace front wigs", count: 3 },
      { kind: "category", key: "fabric-ankara", label: "Ankara", count: 1 }, { kind: "category", key: "hair-tools", label: "Hair tools", count: 1 },
    ],
    sections: [
      { id: "s1", title: "Dollar deals", hook: "From $18", style: "deal", accent: "pink", total: 4,
        items: [products[3], products[4], products[1]].map((p) => ({ ...p, badges: [{ key: "discount", label: "-30%" }], compare_at_price: (p.price || 0) * 1.4 })) },
      { id: "s2", title: "Wig week", hook: "Up to 20% off", style: "trend", accent: "navy", total: 3, ends_at: soon, items: products.slice(0, 3) },
    ],
  },
  "/members/shop/sections/s1": { section: { id: "s1", title: "Dollar deals", hook: "From $18", style: "deal", accent: "pink", total: 4, items: products.slice(1, 5) } },
  "/members/shop/products": { products, categories: [], has_more: false },
  "/members/cart": { lines: [{ variant_id: "v1", quantity: 1, unit_price: 96, variant_title: "22 inch", available: true, product: products[0] }], subtotal: 96, currency: "USD", impulse: { pairs_with: [products[4]], ending_soon: [] } },
  "/members/worker-ratings": {
    prompts: [{ id: "wp1", title: "I saw this wig on TikTok", kind: "chat", conversation_id: "c1", request_id: null, worker: { first_name: "Ada", photo_url: null }, rating: null }],
  },
  "/members/reviews": {
    invites: [{ id: "inv1", title: "Body wave wig 22 inch", kind: "request", created_at: "2026-10-16T00:00:00Z" }],
    reviews: [],
    defaults: { display_name: "Jordan M.", country: "Nigeria" },
  },
  "/members/notifications": {
    unread_count: 2,
    notifications: [
      { id: "n1", title: "Your request is being sourced", body: "We found 3 suppliers for your Ankara fabric.", created_at: "2026-10-15T00:00:00Z", read_at: null, href: "/member/chat?panel=requests" },
      { id: "n2", title: "Giveaway closing soon", body: "Enter the lace front wig giveaway before tonight.", created_at: "2026-10-14T00:00:00Z", read_at: null, href: "/member/chat?panel=catalog" },
    ],
  },
  "/members/orders": { orders: [], wanted: [], invoices: [
    { id: "i1", kind: "order", title: "Body wave wig 22 inch", amount: 96, currency: "USD", quantity: 1, invoice_url: "https://shop.example/i/1", status: "sent", sent_at: "2026-10-15T00:00:00Z", paid_at: null },
    { id: "i2", kind: "consultation", title: "FayFort consultation", amount: 100, currency: "USD", quantity: 1, invoice_url: "https://shop.example/i/2", status: "sent", sent_at: "2026-10-15T00:00:00Z", paid_at: null },
  ] },
  "/members/products": { products: [], categories: [] },
  "/members/plan": { tier: "free", deposit: { rate: 0.5, reason: "free_rate" }, consultation: { tier: "free", price: 100, currency: "USD", included: false, included_left: 0, full_price: 100 }, contacts },
  "/members/rank": {
    rank: 2, subrank: 3, name: "Scout", step: 8, score: 495, balance: 320, window_days: 90, current_at: 450,
    next: { rank: 2, subrank: 4, name: "Scout", at: 550 }, grace: { below: false, ends_at: null, days: 30 }, ranks: [],
    earn: [{ kind: "order", label: "Paid order", points: "50 + 1 per $1 (max 250)" }],
    rewards: [{ id: "contact_credit", label: "1 supplier contact credit", cost: 500, credits: 1 }],
    perks: [{ rank: 4, label: "Standard rates on the Free plan", active: false }], recent: [],
  },
  "/members/subscription": { available: true, plan: null, status: "none", paused: false, current_period_end: null, cancel_at_period_end: false, continuous_since: null, months: 0, has_customer: false, prices: { standard: { monthly: 19, currency: "usd" }, pro: { monthly: 49, currency: "usd" } }, max_pause_months: 3 },
  "/members/consultations": { consultations: [], quote: { price: 100 } },
  "/members/ads": {
    show: true,
    max_per_screen: 3,
    google: null,
    placements: [
      { key: "browse_top", shape: "banner", priority: 10, google: null, creatives: [{ id: "a1", advertiser: "FayFort", headline: "Go ad-free with Standard", body: "Lower sourcing deposits, cheaper consultations and no ads. $19 a month, cancel any time.", cta_label: "See plans", target_url: "action:plans", tone: "brand", weight: 1 }] },
      { key: "browse_feed", shape: "feed", priority: 20, google: null, creatives: [{ id: "a3", advertiser: "FayFort", headline: "Find verified suppliers", body: "Markets, factories and service providers in China.", cta_label: "Open the directory", target_url: "/member/chat?panel=directory", tone: "light", weight: 1 }] },
      { key: "directory_feed", shape: "feed", priority: 25, google: null, creatives: [{ id: "a2", advertiser: "FayFort", headline: "Talk to the FayFort team", body: "Book a consultation about sourcing or doing business in China.", cta_label: "Book a consultation", target_url: "action:plans", tone: "accent", weight: 1 }] },
      { key: "chat_welcome", shape: "banner", priority: 30, google: null, creatives: [{ id: "a2", advertiser: "FayFort", headline: "Talk to the FayFort team", body: "Book a consultation about sourcing or doing business in China.", cta_label: "Book a consultation", target_url: "action:plans", tone: "accent", weight: 1 }] },
      { key: "sidebar", shape: "square", priority: 60, google: null, creatives: [{ id: "a3", advertiser: "FayFort", headline: "Find verified suppliers", body: "Markets, factories and service providers in China.", cta_label: "Open the directory", target_url: "/member/chat?panel=directory", tone: "light", weight: 1 }] },
    ],
  },
  "/members/directory": {
    results: [
      { id: "d1", record_type: "market", title: "Guangzhou International Hair Market", verified: true, free: false, unlocked: false, public: { city: "Guangzhou", district: "Liwan", categories: ["Wigs", "Hair extensions"] } },
      { id: "d2", record_type: "market", title: "Xingfa Square", verified: true, free: false, unlocked: true, public: { city: "Guangzhou", district: "Baiyun", categories: ["Wigs"] }, private: { address_en: "88 Jiefang North Rd, Baiyun", contacts: [{ contact_name: "Ms Li", phone_wechat: "wx-li-88" }] } },
    ],
    contacts,
  },
};

/** Twelve products, so the Browse grid has room for an in-feed ad. */
export const manyProducts = Array.from({ length: 12 }, (_, i) => ({ ...products[i % products.length], id: `m${i}` }));

export async function signedInMember(page: Page, options: { newMember?: boolean } = {}) {
  await page.addInitScript(([session]) => {
    window.localStorage.setItem("sb-test-fayfort-auth-token", session);
  }, [JSON.stringify({
    access_token: "member-token", refresh_token: "refresh", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(now / 1000) + 3600, user,
  })]);
  await page.route(`${SUPABASE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/v1/user")) return route.fulfill({ json: user });
    if (path.endsWith("/auth/v1/user/identities")) return route.fulfill({ json: { identities: [{ provider: "email" }] } });
    return route.fulfill({ json: {} });
  });
  await page.route(`${API}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (options.newMember && path === "/members/me") return route.fulfill({ json: { ...(fixtures[path] as object), onboarding_completed: false } });
    const body = fixtures[path] ?? (path.startsWith("/members/shop/products/") ? { product: { ...products[0], description: "Soft 180% density body wave lace front wig, pre-plucked hairline, 22 inch." }, variants: [{ id: "v1", title: "22 inch", price: 96, available: true }, { id: "v2", title: "24 inch", price: 110, available: true }], media: [], pairs_with: [products[4], products[1]] } : {});
    return route.fulfill({ json: body });
  });
}
