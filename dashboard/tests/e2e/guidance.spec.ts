import { expect, test, type Page } from "@playwright/test";
import { signedInStaff } from "./staff-fixtures";

/** Layout QA for page guides, What next hints, Customers chat threads, Analytics charts and the clock-in gate.
 * Screenshots land in test-results/guidance/. */
const OUT = "test-results/guidance";
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 800 },
];

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

async function extraRoutes(page: Page) {
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10));
  const wave = (i: number, base: number, amp: number) => Math.max(0, Math.round(base + amp * Math.sin(i / 3) + (i % 5)));
  await page.route(/\/(platform|businesses|workers|operations)\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/analytics/charts"))
      return route.fulfill({
        json: {
          days: 30, bucket: "day", start: "", end: "", truncated: false,
          totals: { conversations: { value: 214, change: 0.18 }, handoffs: { value: 23, change: -0.12 }, events: { value: 1830, change: 0.09 },
            messages: { value: 1412 }, ai_calls: { value: 2950, change: 0.21 }, ai_cost_usd: { value: 3.4172 } },
          groups: [{ key: "messages", label: "Messages" }, { key: "handoffs", label: "Handoffs" }, { key: "automations", label: "Automations" },
            { key: "requests", label: "Requests" }, { key: "setup", label: "Setup & directory" }],
          activity: days.map((bucket, i) => ({ bucket, messages: wave(i, 45, 15), handoffs: wave(i, 2, 2), automations: wave(i, 6, 3), requests: wave(i, 4, 2), setup: i % 9 === 0 ? 3 : 0 })),
          channels: ["instagram", "messenger", "website"],
          conversations: days.map((bucket, i) => ({ bucket, instagram: wave(i, 4, 2), messenger: wave(i, 2, 1), website: wave(i, 1, 1) })),
          handoffs: { series: days.map((bucket, i) => ({ bucket, requested: wave(i, 1, 1) })), by_status: { returned: 15, resolved: 4, active: 2, requested: 2 } },
          ai: { series: days.map((bucket, i) => ({ bucket, calls: wave(i, 95, 25), tokens: wave(i, 90000, 20000), cost_usd: 0.11 })),
            by_operation: [{ operation: "response", calls: 1600, tokens: 2_100_000, cost_usd: 2.1 }, { operation: "intent", calls: 1100, tokens: 600_000, cost_usd: 1 },
              { operation: "summary", calls: 250, tokens: 200_000, cost_usd: 0.3 }] },
          top_events: [
            { event_type: "channel.inbound.processed", label: "Messages received", count: 1412 }, { event_type: "automation.execution_recorded", label: "Automation runs", count: 190 },
            { event_type: "request.status_changed", label: "Request status changes", count: 120 }, { event_type: "handoff.requested", label: "Handoffs requested", count: 23 },
            { event_type: "handoff.taken_over", label: "Handoffs taken over", count: 21 }, { event_type: "handoff.returned_to_automation", label: "Returned to the AI", count: 19 }],
        },
      });
    if (path.endsWith("/ai-usage"))
      return route.fulfill({ json: { days: 30, sampled_requests: 2950, summary_truncated: false, reported_usage_requests: 2900, unknown_usage_requests: 50, prompt_tokens: 2_300_000,
        completion_tokens: 600_000, total_tokens: 2_900_000, source_messages: 1400, message_call_distribution: { "1": 300, "2": 1100 }, operations: {}, models: { "openai/gpt-oss-120b": 2950 },
        providers: { deepinfra: 2950 }, budget: { limit_usd: 25, committed_usd: 3.41, pending_usd: 0.02, remaining_usd: 21.57, month_start: "2026-10-01" } } });
    if (path === "/platform/commerce/giveaways")
      return route.fulfill({ json: { giveaways: [
        { id: "g1", title: "Launch test giveaway", prize_text: "FayFort test item", starts_at: hoursAgo(80), ends_at: hoursAgo(70), winner_count: 1, status: "open", entries: 1, draw_seed: null, winners: [] },
        { id: "g2", title: "Wig week", prize_text: "Body wave wig 22 inch", starts_at: hoursAgo(5), ends_at: hoursAgo(-48), winner_count: 2, status: "open", entries: 37, draw_seed: null, winners: [] },
        { id: "g3", title: "September drop", prize_text: "Silk press kit", starts_at: hoursAgo(900), ends_at: hoursAgo(800), winner_count: 1, status: "drawn", entries: 120, draw_seed: "4f2a91",
          winners: [{ member_id: "7c0e3c8e-0000-4000-8000-000000000001", rank: 1, prize_code: null, prize_error: null }] },
      ] } });
    if (path.match(/\/customers\/[^/]+$/))
      return route.fulfill({ json: {
        customer: { id: "cust-1", channel: "instagram", external_customer_id: "ig-2201", profile: { name: "Amaka O." }, updated_at: hoursAgo(1) },
        conversations: [{ id: "conv-1", channel: "instagram", status: "open", summary: "Asked about a 22 inch body wave wig and shipping to Lagos.", created_at: hoursAgo(5), last_message_at: hoursAgo(1) }],
        requests: [],
      } });
    if (path.endsWith("/conversations/conv-1/messages"))
      return route.fulfill({ json: { customer: null, requests: [], messages: [
        { id: "m1", sender_type: "customer", content: "Hi, do you have the 22 inch body wave wig?", created_at: hoursAgo(5) },
        { id: "m2", sender_type: "ai", content: "Yes! It's $120 in the shop. Want me to send the link?", created_at: hoursAgo(4.9) },
        { id: "m3", sender_type: "customer", content: "Yes please, and how long to Lagos?", created_at: hoursAgo(4.8) },
        { id: "m4", sender_type: "ai", content: "Here it is. Shipping to Lagos usually takes 7 to 12 days.", created_at: hoursAgo(4.7) },
      ] } });
    if (path.endsWith("/customers"))
      return route.fulfill({ json: { customers: [{ id: "cust-1", channel: "instagram", external_customer_id: "ig-2201", profile: { name: "Amaka O." }, updated_at: hoursAgo(1) }] } });
    return route.fallback();
  });
}

for (const size of SIZES) {
  test(`giveaways show what next on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await extraRoutes(page);
    await page.goto("/?page=shop&tab=giveaways");
    await expect(page.getByText(/It has ended with 1 entry/)).toBeVisible();
    await expect(page.getByRole("region", { name: "How this page works" })).toContainText("Draw the winners");
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/giveaways-${size.name}.png`, fullPage: true });
  });

  test(`analytics charts fit a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await extraRoutes(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    if (size.width < 1024) await page.getByRole("button", { name: "Open menu" }).click();
    await nav.getByRole("button", { name: /Analytics/ }).click();
    await expect(page.getByRole("figure", { name: "Activity" })).toBeVisible();
    await page.getByRole("button", { name: /How this works/ }).click();
    await page.getByRole("figure", { name: "Activity" }).locator(".viz-col").nth(22).hover();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/analytics-${size.name}.png`, fullPage: true });
  });

  test(`customers read a chat on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    await extraRoutes(page);
    await page.goto("/");
    if (size.width < 1024) await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Customers/ }).click();
    await page.getByRole("button", { name: /Amaka O\./ }).click();
    await page.getByRole("button", { name: "Read chat" }).click();
    await expect(page.getByText("Shipping to Lagos usually takes 7 to 12 days.")).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/customers-chat-${size.name}.png`, fullPage: true });
  });

  test(`workers clock in before the Operations Center on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signedInStaff(page);
    let onShift = false;
    await page.route(/\/(operations\/me\/departments|workers\/me\/shift)/, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/departments")) return route.fulfill({ json: { user_id: "staff-1", departments: ["fulfillment"], can_manage: false } });
      if (path.endsWith("/clock-in")) onShift = true;
      return route.fulfill({ json: { shift: onShift ? { id: "s", started_at: new Date().toISOString(), ended_at: null, on_break: false, worked_seconds: 0, break_seconds: 0 } : null,
        today_seconds: 3 * 3600, week_seconds: 21 * 3600, server_time: new Date().toISOString() } });
    });
    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "Clock in to start" })).toBeVisible();
    await noSideScroll(page);
    await page.screenshot({ path: `${OUT}/gate-${size.name}.png` });
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByRole("heading", { name: "Operations Center" })).toBeVisible();
  });
}
