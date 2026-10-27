import type { Page } from "@playwright/test";

/** A signed-in platform admin with a verified second factor, served entirely from fixtures (no real API). */
const SUPABASE = "https://test-fayfort.supabase.co";
const API = "http://127.0.0.1:8001";
const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const user = {
  id: "staff-1", aud: "authenticated", role: "authenticated", email: "ada@fayfort.test",
  app_metadata: { provider: "email", providers: ["email"], platform_admin: true, roles: ["platform_admin"] },
  user_metadata: {}, created_at: "2026-09-01T00:00:00Z", factors: [{ id: "f1", factor_type: "totp", status: "verified" }],
};
const jwt = [b64({ alg: "HS256", typ: "JWT" }), b64({
  sub: user.id, email: user.email, role: "authenticated", aal: "aal2", amr: [{ method: "password", timestamp: 1 }, { method: "totp", timestamp: 2 }],
  exp: Math.floor(now / 1000) + 3600, app_metadata: user.app_metadata,
}), "sig"].join(".");

const businessId = "biz-1";
const conversations = [
  { id: "bc1", handoff_status: "active", customer_name: "Amaka Obi", customer_username: "@amaka.styles", channel: "instagram", status: "open", summary: "Asking for the price of 30 inch bone straight bundles and delivery to Lagos", last_message_at: iso(4), created_at: iso(300) },
  { id: "bc2", handoff_status: "requested", customer_name: "Grace Mensah", channel: "messenger", status: "open", summary: "Wants a refund for a wig that arrived tangled", last_message_at: iso(25), created_at: iso(600) },
  { id: "bc3", customer_external_id: "1784410022", channel: "instagram", status: "closed", summary: null, last_message_at: iso(900), created_at: iso(1400) },
  { id: "bc4", customer_name: "Tolu Adeyemi", channel: "whatsapp", status: "open", summary: "Bulk order of 50 closures for a salon", last_message_at: iso(60), created_at: iso(2000) },
];
const longText = "Hi! I saw your post about the bone straight bundles. Do you have 30 inch in stock? I need 4 bundles and a 5x5 closure, and I want it delivered to Lekki before next Friday because it is for my sister's wedding. Also can I pay half now and half on delivery?";
const messages = [
  { id: "m1", sender_type: "customer", content: longText, created_at: iso(30) },
  { id: "m2", sender_type: "ai", content: "Hi Amaka! Yes, 30 inch bone straight is in stock. 4 bundles plus a 5x5 closure is $412. Delivery to Lekki takes 5 to 7 days.", created_at: iso(29), delivery: { id: "d1", status: "sent", attempt_count: 1 } },
  { id: "m3", sender_type: "customer", content: "Can I pay half now?", created_at: iso(10) },
  { id: "m4", sender_type: "ai", content: "Let me get a team member to confirm split payment for you.", created_at: iso(9), delivery: { id: "d2", status: "rejected", attempt_count: 2, safe_error_code: "provider_rate_limited" } },
  { id: "m5", sender_type: "agent", content: "Hi Amaka, this is Ada. Yes, we can do 50% now and the rest before dispatch.", created_at: iso(4), delivery: { id: "d3", status: "sent", attempt_count: 1 } },
];
const customer = { id: "cu1", channel: "instagram", external_customer_id: "1784410099", profile: { name: "Amaka Obi", username: "amaka.styles", city: "Lagos" }, created_at: iso(5000), updated_at: iso(4) };
const request = { id: "rq1", customer_id: "cu1", conversation_id: "bc1", request_type: "order_inquiry", status: "awaiting_customer", details: { product: "Bone straight 30 inch", quantity: 4, closure: "5x5" }, required_information: ["delivery_address", "payment_plan"], missing_information: ["delivery_address"], created_at: iso(30), updated_at: iso(4) };
const handoffs = [
  { id: "h1", conversation_id: "bc1", requested_by: "assistant", assigned_to: "ada@fayfort.test", status: "active", reason: "Customer asked about split payment", requested_at: iso(9), updated_at: iso(4), queue_position: 1, wait_estimate: { status: "estimated", lower_minutes: 3, upper_minutes: 8, sample_size: 14 } },
  { id: "h2", conversation_id: "bc2", requested_by: "assistant", assigned_to: null, status: "requested", reason: "Refund request needs a person", requested_at: iso(25), updated_at: iso(25), queue_position: 2, wait_estimate: { status: "unavailable", reason: "not_enough_history" } },
];

const workItems = [
  { id: "w1", department: "member_support", work_type: "member_chat_support", status: "claimed", priority: "high", summary: "Member asks staff to confirm a TikTok wig can be sourced before the 30th", next_action: "Reply to the member with sourcing options", waiting_on: null, waiting_reason: null, due_at: iso(-120), assigned_worker_id: "staff-1", assigned_automation_key: null, claimed_until: iso(-30), version: 3, member_request_id: null, member_conversation_id: "mc1", business_id: null, business_conversation_id: null, handoff_id: null, created_at: iso(200) },
  { id: "w2", department: "conversation_intake", work_type: "business_handoff", status: "claimed", priority: "normal", summary: "Instagram customer wants split payment on a $412 order", next_action: "Confirm payment plan", waiting_on: null, waiting_reason: null, due_at: iso(-1431), assigned_worker_id: "staff-1", assigned_automation_key: null, claimed_until: iso(-20), version: 1, member_request_id: null, member_conversation_id: null, business_id: businessId, business_conversation_id: "bc1", handoff_id: "h1", created_at: iso(9) },
  { id: "w4", department: "fulfillment", work_type: "store_order", status: "open", priority: "high", summary: "Pack and ship #1042 · 3 items", next_action: "Pick and pack the items, then mark the order fulfilled in Shopify with the tracking number.", waiting_on: null, waiting_reason: null, due_at: iso(-60), assigned_worker_id: null, assigned_automation_key: null, claimed_until: null, version: 1, member_request_id: null, member_conversation_id: null, business_id: null, business_conversation_id: null, handoff_id: null, created_at: iso(40), metadata: { source_kind: "shopify_order", source_id: "gid://shopify/Order/5001", order_name: "#1042", admin_url: "https://fayfort.myshopify.com/admin/orders/5001" } },
  { id: "w3", department: "sourcing", work_type: "member_request", status: "open", priority: "normal", summary: "Source Ankara fabric, 6 yards, wedding colours", next_action: "Find three suppliers", waiting_on: null, waiting_reason: null, due_at: iso(640), assigned_worker_id: null, assigned_automation_key: null, claimed_until: null, version: 1, member_request_id: "mr1", member_conversation_id: null, business_id: null, business_conversation_id: null, handoff_id: null, created_at: iso(2080) },
];
const archivedItems = [
  { ...workItems[0], id: "a1", status: "completed", summary: "Packed and shipped #1031 · 2 items", work_type: "store_order", department: "fulfillment", completed_at: iso(600), assigned_worker_id: null, claimed_until: null, member_conversation_id: null, metadata: { source_kind: "shopify_order", source_id: "gid://shopify/Order/4990", order_name: "#1031" } },
  { ...workItems[3], id: "a2", status: "cancelled", summary: "Source silk scarf (member cancelled)", completed_at: iso(3000) },
];
const memberConversation = {
  id: "mc1", title: "I saw this wig on TikTok", linked_request_id: null, retention_hold: false,
  messages: [
    { id: "x1", sender_type: "member", content: "I saw this wig on TikTok https://www.tiktok.com/@hairqueen/video/1", related_product_ids: [], created_at: iso(200) },
    { id: "x2", sender_type: "assistant", content: "That looks like a straight bob with bangs. Want me to source the exact wig for you?", related_product_ids: [], created_at: iso(199) },
    { id: "x3", sender_type: "member", content: "Yes please, I need it before the 30th. Can a person confirm?", related_product_ids: [], created_at: iso(190) },
  ],
};
const businessConversation = { id: "bc1", business_id: businessId, channel: "instagram", status: "open", created_at: iso(300), last_message_at: iso(4), summary: conversations[0].summary, messages: messages.map(({ id, sender_type, content, created_at }) => ({ id, sender_type, content, created_at })) };

const lists = {
  connections: [], automations: [], runs: [], conversations: [], customers: [], requests: [], tools: [], results: [], products: [],
  categories: [], entitlements: [], queue: [], decisions: [], reviews: [], faqs: [], events: [], workers: [], work_items: [], notes: [],
  items: [], batches: [], invoices: [], sales: [], trends: [], newsletters: [], notifications: [], themes: [], agents: [], handoffs: [],
  candidates: [], log: [], review_queue: [], can_review: true, categories_list: [], tunnels: [], hostnames: [], deposits_due: [],
};

// Operations desks (R2): counts and pipeline stages for the rail, My work and the desk headers.
const stage = (key: string, label: string, count: number) => ({ key, label, count });
const desks = {
  mine: 3, mine_due_today: 1, mine_overdue: 1,
  desks: [
    { department: "conversation_intake", total: 2, available: 1, mine: 1, waiting: 0, overdue: 0, stages: [stage("member_app", "Member app chats", 1), stage("customer", "Customer chats", 1)] },
    { department: "sourcing", total: 9, available: 4, mine: 1, waiting: 3, overdue: 1, stages: [stage("review", "Review", 2), stage("deposit", "Deposit due", 2), stage("sourcing", "Sourcing", 2), stage("with_member", "Options sent", 1), stage("chosen", "Chosen", 1), stage("invoice", "Invoice sent", 0), stage("paid", "Paid", 0), stage("group_buy", "Group buys", 1)] },
    { department: "fulfillment", total: 5, available: 2, mine: 1, waiting: 1, overdue: 0, stages: [stage("confirmed", "Confirmed", 1), stage("warehouse", "In the warehouse", 1), stage("on_the_way", "On the way", 1), stage("delivered", "Delivered", 0), stage("shop_order", "Shop orders to pack", 2)] },
    { department: "member_support", total: 3, available: 3, mine: 0, waiting: 0, overdue: 0, stages: [stage("money", "Money", 1), stage("bookings", "Bookings", 1), stage("campaigns", "Giveaways", 1), stage("reviews", "Photo reviews", 0), stage("chats", "Chats", 0)] },
    { department: "disputes", total: 1, available: 1, mine: 0, waiting: 0, overdue: 0, stages: [stage("new", "New", 1), stage("working", "Being worked on", 0), stage("waiting", "Waiting", 0), stage("blocked", "Stuck", 0)] },
    { department: "store_team", total: 4, available: 2, mine: 0, waiting: 0, overdue: 0, stages: [stage("listings", "Listings", 2), stage("finds", "Finds", 1), stage("sections", "Sections", 1), stage("campaigns", "Campaigns", 0)] },
  ],
};

// Sourcing and Fulfillment desks (R4).
const sourcingOverview = {
  trends: [
    { id: "t1", title: "Satin hair bonnet with wide band", url: "https://www.tiktok.com/@a/video/1", platform: "tiktok", status: "open", want_count: 37, share_count: 41, pool: null, ready: false, in_store: false },
    { id: "t2", title: "Dual-sided edge brush", url: "https://www.tiktok.com/@b/video/2", platform: "tiktok", status: "pooling", want_count: 18, share_count: 20, pool: { target: 25, price: 4.5, currency: "USD", deadline: null, progress: 0.72 }, ready: false, in_store: false },
    { id: "t3", title: "Ankara headwrap set", url: "https://www.instagram.com/p/3", platform: "instagram", status: "pooling", want_count: 30, share_count: 30, pool: { target: 30, price: 9, currency: "USD", deadline: null, progress: 1 }, ready: true, in_store: false },
  ],
  deposits_due: [
    { request_id: "r1", work_item_id: "w3", title: "Source Ankara fabric, 6 yards, wedding colours", stage: "under_review", tier: "free", rate: 0.5, expected_total: 180, currency: "USD", suggested_deposit: 90, claimed: false },
    { request_id: "r2", work_item_id: "w3", title: "Bone straight bundles, 30 inch", stage: "submitted", tier: "standard", rate: 0.25, expected_total: null, currency: null, suggested_deposit: null, claimed: true },
  ],
};
const fulfillmentOrders = {
  to_pack_count: 2, shipped_this_week: 6,
  to_pack: [
    { id: "o1", order_name: "#1042", total: "184.00", currency: "USD", placed_at: iso(26), units: 3, work_item_id: "w4", claimed: false },
    { id: "o2", order_name: "#1044", total: "36.00", currency: "USD", placed_at: iso(3), units: 1, work_item_id: null, claimed: false },
  ],
};

// Conversations desk (R3): customer cards and Answers.
function customerCard(path: string) {
  if (path.includes("/w1/"))
    return { locked: false, card: { kind: "member", member_id: "m1", name: "Amaka Obi", profile: { member_tier: "pro", rank_level: 3, country: "Nigeria", created_at: "2026-06-02T00:00:00Z" },
      chats: [{ id: "mc1", title: "TikTok wig", current: true }, { id: "mc0", title: "Ankara for a wedding", last_activity_at: iso(24 * 9) }],
      requests: [{ id: "r1", title: "Body wave wig 22 inch", stage: "options_sent", missing: [] }, { id: "r0", title: "Ankara, 6 yards", stage: "delivered", missing: [] }],
      invoices: [{ id: "i1", title: "Deposit for body wave wig", amount: 30, currency: "USD", status: "sent" }] } };
  return { locked: false, card: { kind: "customer", name: "Chioma", profile: { channel: "instagram", username: "chioma.styles", first_seen: iso(24 * 30), summary: "Asked about paying for a $412 order in two parts." },
    chats: [{ id: "bc1", title: "Split payment on a $412 order", current: true }, { id: "bc0", title: "Wig colours", last_activity_at: iso(24 * 12) }],
    requests: [{ id: "cr1", title: "product order", stage: "awaiting_customer", missing: ["delivery_city", "preferred_length"], details: { product: "Bob wig with bangs", quantity: 2 } }],
    invoices: [] } };
}
const answers = [
  { id: "f1", kind: "faq", title: "Can I split my payment?", text: "Yes. Orders over $300 can be paid in two parts…", full: "Yes. Orders over $300 can be paid in two parts: half to start sourcing, half before shipping." },
  { id: "k1", kind: "knowledge", title: "Payments and deposits", text: "Free members pay a 50% deposit, Standard 25%…", full: "Free members pay a 50% deposit, Standard 25%, Pro none in good standing. Split payments are possible on orders over $300." },
];

function fixture(path: string, search: URLSearchParams): unknown {
  const b = `/businesses/${businessId}`;
  if (path === "/dashboard/businesses") return { businesses: [{ business_id: businessId, name: "FayFort Hair Lagos", role: "owner" }, { business_id: "biz-2", name: "FayFort Fabrics", role: "owner" }] };
  if (path === `${b}/conversations`) return { conversations, has_more: true };
  if (path.startsWith(`${b}/conversations/`) && path.endsWith("/messages")) return { messages, customer, requests: [request] };
  if (path === `${b}/customers`) return { customers: [customer, { ...customer, id: "cu2", channel: "messenger", external_customer_id: "55120031", profile: { name: "Grace Mensah" } }] };
  if (path === `${b}/customers/cu1`) return { customer, conversations: [conversations[0]], requests: [request] };
  if (path === `${b}/requests`) return { requests: [request, { ...request, id: "rq2", conversation_id: "bc4", request_type: "bulk_order", status: "active", details: { product: "5x5 closures", quantity: 50 }, missing_information: [] }] };
  if (path === `${b}/handoffs`) return { handoffs, total: 2, has_more: false };
  if (path === `${b}/handoffs/agents`) return { agents: [{ user_id: "staff-1", status: "active", role: "agent", handoff_availability: "available", handoff_max_active: 3 }, { user_id: "staff-2", status: "active", role: "agent", handoff_availability: "away" }] };
  if (path === "/operations/pending-count") return { pending: 14, overdue: 3 };
  if (path.endsWith("/take-over")) return { taken_over: true, idle_minutes: 30 };
  if (path.endsWith("/hand-back")) return { taken_over: false };
  if (path.startsWith("/operations/bookings") || path.startsWith("/operations/availability/") || path === "/platform/staff/candidates") return bookingFixture(path, search);
  if (path.startsWith("/operations/store/") || path === "/operations/schedule") return storeFixture(path, search);
  if (path === "/operations/me/departments") return { user_id: "staff-1", departments: ["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support", "store_team"], can_manage: true };
  if (path === "/operations/desks") return desks;
  if (path === "/operations/sourcing/overview") return sourcingOverview;
  if (path === "/operations/fulfillment/orders") return fulfillmentOrders;
  if (path === "/operations/catalog") return { products: [{ id: "p1", name: "Body wave lace wig 22 inch", where: "Store", price_min: 120, currency: "USD", in_stock: true }, { id: "p2", name: "Lace front glue", where: "Sourcing catalog", price_min: 2.1, price_max: 2.8, currency: "USD", min_order: 50, lead_time_min_days: 7, lead_time_max_days: 12 }] };
  if (path.endsWith("/customer") && path.startsWith("/operations/work-items/")) return customerCard(path);
  if (path === "/operations/answers") return { answers: answers.filter((answer) => (search.get("q") || "").split(/\s+/).some((word) => word.length > 2 && (answer.title + answer.full).toLowerCase().includes(word.toLowerCase()))) };
  if (path === "/operations/work-items" && search.get("view") === "archive") return { work_items: archivedItems, has_more: false };
  if (path === "/operations/work-items") return { work_items: workItems };
  if (path === "/operations/work-items/w4/source-context") return { source_type: "shopify_order", flow: { kind: "shopify_order", metadata: workItems[2].metadata, member_name: "Amaka Obi", order: { order_name: "#1042", total: "184.00", currency: "USD", financial_status: "paid", fulfillment_status: null, line_items: [{ title: "Body wave wig 22 inch", quantity: 1, variant_title: "Natural black" }, { title: "Edge control", quantity: 2 }] } } };
  if (path === "/operations/work-items/w1/source-context") return { source_type: "member_conversation", conversation: memberConversation };
  if (path === "/operations/work-items/w2/source-context") return { source_type: "business_handoff", conversation: businessConversation, handoff: { id: "h1", conversation_id: "bc1", status: "active", reason: "Customer asked about split payment", requested_at: iso(9), updated_at: iso(4), closed_at: null } };
  if (path.endsWith("/notes")) return { notes: [{ id: "n1", author_id: "staff-1", note: "Called the supplier, waiting for photos.", created_at: iso(50) }] };
  if (path.endsWith("/checklist")) return { items: [{ id: "c1", title: "Confirm deadline", position: 1, completed_at: iso(40), created_at: iso(100) }, { id: "c2", title: "Send options", position: 2, completed_at: null, created_at: iso(100) }] };
  if (path.endsWith("/events")) return { events: [{ id: "e1", sequence_no: 1, event_type: "claimed", actor_type: "worker", previous_department: null, created_at: iso(60) }] };
  if (path === "/operations/workforce") return {
    workers: [
      { user_id: "staff-1", status: "active", handoff_availability: "available", handoff_available_until: null, handoff_max_active: 3, online: true, last_seen_at: iso(1), departments: ["member_support", "conversation_intake"], active_work_count: 2, current_work: workItems.slice(0, 2).map(({ id, summary, department, status, priority }) => ({ id, summary, department, status, priority })) },
      { user_id: "staff-2", status: "active", handoff_availability: "away", handoff_available_until: null, handoff_max_active: 2, online: false, last_seen_at: iso(300), departments: ["sourcing"], active_work_count: 0, current_work: [] },
    ],
    summary: { active_workers: 2, online_workers: 1, active_work_items: 3, automation_owned_work_items: 1, automation_work: [{ id: "w9", summary: "Daily stock sync", department: "fulfillment", status: "open", priority: "low", assigned_automation_key: "stock_sync" }] },
    online_window_seconds: 120,
  };
  if (path === "/operations/automation-health") return { summary: { recent_runs: 42, failed_runs: 2, enabled_schedules: 5, schedule_issues: 1 }, recent_runs: [{ id: "r1", automation_name: "Abandoned cart reminder", business_ref: "biz-1", status: "failed", error_code: "provider_timeout", triggered_by: "schedule", created_at: iso(30), completed_at: iso(29) }], schedule_issues: [{ id: "s1", name: "Weekly report", business_ref: "biz-1", next_run_at: iso(-60), attempts: 3, last_error_code: "missing_template" }] };
  if (path === "/operations/reports") return { generated_at: iso(0), period_days: 30, work: { total: 48, active: 12, due_overdue: 3, by_department: { sourcing: { open: 4, claimed: 2 }, member_support: { claimed: 3 } }, aging: { under_1_day: 6, "1_to_3_days": 4, over_3_days: 2 } }, sourcing: { requests_by_latest_stage: { submitted: 3, sourcing: 4 }, candidates_added: 18, member_options_shared: 9, member_options_selected: 5 }, disputes: { opened_in_period: 2, active: 1, by_status: { investigating: 1 } }, automation: { runs_in_period: 410, failed_in_period: 7, enabled_schedules: 5, schedules_with_issues: 1 }, reconciliation: { actionable_requests_missing_work: 0, terminal_requests_with_active_work: 1, active_disputes_missing_work: 0, expired_claims: 0 }, data_limit_reached: false };
  if (path === "/workers/me/shift") return shiftState;
  if (path === "/platform/revenue") return revenueReport;
  if (path === "/platform/connections") return connections;
  if (path === "/platform/infrastructure") return { cloudflare: { provider: "cloudflare", status: "not_configured", safe_settings: {} }, tunnels: [], cloudflare_error_code: null, webhooks: [], local_api: { base_url: "http://127.0.0.1:8001", public_api_url: null }, recent_events: [] };
  if (path === "/platform/workers") return workerDirectory;
  if (path === "/platform/workers/staff-1") return { worker: { ...workerDirectory.workers[0], departments: ["member_support"], current_work: [], recent_activity: [], audit: [], auth_events: [] } };
  if (path.endsWith("/ratings")) return workerRatings;
  if (path === "/platform/workforce/settings") return { rating_reset_tasks: 20 };
  if (path === "/platform/workforce/timesheets") return timesheet;
  if (path === "/platform/workers/provisioning" || path.startsWith("/platform/workers/invitations")) return { invitations: [] };
  if (path === "/platform/site/reviews") return { reviews: siteReviews, counts: { pending: 2, published: 1, hidden: 0 } };
  if (path === "/platform/site/chat") return { settings: { enabled: true, visitor_daily_limit: 20, network_daily_limit: 60, daily_reply_cap: 400 }, today: { replies: 0, conversations: 0 }, conversations: [] };
  if (path === "/platform/site/instagram") return { posts: [] };
  if (path === "/operations/me/notifications") return { notifications: [{ id: "on1", title: "New handoff", body: "Instagram customer needs a person", created_at: iso(9), read_at: null, href: "/operations" }], unread_count: 1 };
  return lists;
}

export async function signedInStaff(page: Page) {
  const session = { access_token: jwt, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user };
  await page.addInitScript(([value]) => window.localStorage.setItem("sb-test-fayfort-auth-token", value), [JSON.stringify(session)]);
  await page.route(`${SUPABASE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/v1/user")) return route.fulfill({ json: user });
    if (path.endsWith("/factors")) return route.fulfill({ json: { all: user.factors, totp: user.factors } });
    return route.fulfill({ json: {} });
  });
  await page.route(`${API}/**`, (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: fixture(url.pathname, url.searchParams) });
  });
}

// ---- Store team (docs/CATALOG_MERCHANDISING_PLAN.md) ------------------------------------------
const photo = (n: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${n * 47},55%,70%)"/></svg>`)}`;
const storeCategories = [
  { source_ref: "HAIR-WIG", category: "Lace front wigs", group_name: "Hair", product_type: "Wig" },
  { source_ref: "FAB-ANK", category: "Ankara", group_name: "Fabrics", product_type: "Fabric" },
];
const storeProducts = [
  { id: "sp1", name: "Body wave lace front wig 22 inch", source: "shopify", category_ref: "HAIR-WIG", price_min: 120, currency: "USD", in_stock: true, state: "live", media_url: photo(1), media_type: "image", shopify_admin_url: "https://admin.shopify.com/store/x/products/1" },
  { id: "sp2", name: "Kinky curly closure wig", source: "shopify", category_ref: "HAIR-WIG", price_min: 140, currency: "USD", in_stock: false, state: "sold_out", media_url: photo(2), media_type: "image" },
  { id: "sp3", name: "Silk press kit", source: "shopify", category_ref: null, price_min: 35, currency: "USD", in_stock: true, state: "draft", media_url: photo(3), media_type: "image" },
];
const sourcingProducts = [
  { id: "so1", name: "Ankara print fabric, 6 yards", source: "fayfort", category_ref: "FAB-ANK", price_min: 12, price_max: 18, min_order: 50, lead_time_min_days: 10, lead_time_max_days: 20, currency: "USD", state: "live", media_url: photo(4), media_type: "image" },
];
const storeListing = {
  id: "l1", kind: "store_product", action: "create", status: "changes_requested", product_id: null, shopify_product_id: "gid://shopify/Product/9", trend_item_id: null,
  title: "Straight bob wig with bangs", description: "Soft straight bob with full bangs.\n\n180% density, glueless cap.", category_ref: "HAIR-WIG",
  option_name: "Length", option_values: ["10 inch", "12 inch"], price: 80, compare_at_price: 110, cost: 38, currency: "USD", price_guide_min: null, price_guide_max: null,
  min_order: null, lead_time_min_days: null, lead_time_max_days: null, availability_status: "sourcing", media: [1, 2, 3].map((n) => ({ media_type: "image", url: photo(n + 4), source: "upload" })),
  planned_live_at: iso(-60 * 24 * 2), review_note: "Use a brighter first photo, please.", error: null, submitted_at: iso(60), published_at: null, updated_at: iso(30),
  missing: [], steps: { details: true, media: true, price: true },
};
const sections = [
  { id: "sec1", title: "Dollar deals", hook: "From $18", style: "deal", accent: "pink", category_ref: null, starts_at: iso(60 * 24), ends_at: iso(-60 * 30), priority: 10, min_items: 3, status: "published", state: "live", live_count: 3,
    items: [1, 2, 3].map((n) => ({ id: `i${n}`, name: `Item ${n}`, media_url: photo(n), media_type: "image", live: true })) },
  { id: "sec2", title: "Wig week", hook: "Up to 20% off", style: "trend", accent: "navy", category_ref: null, starts_at: iso(60 * 24), ends_at: null, priority: 20, min_items: 3, status: "published", state: "hidden", live_count: 2,
    items: [4, 5, 6].map((n) => ({ id: `i${n}`, name: `Wig ${n}`, media_url: photo(n), media_type: "image", live: n !== 6 })) },
];
function scheduleEntries() {
  const day = (offsetDays: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  return [
    { id: "deadline:w4", type: "deadline", title: "Pack and ship #1042", at: day(0, 15), status: "scheduled", href: "/operations?workItem=w4", detail: "", work_item_id: "w4", department: "fulfillment", worker_id: null },
    { id: "deadline:w9", type: "deadline", title: "List a store product: Straight bob wig", at: day(-1, 11), status: "overdue", href: "/operations?workItem=w9", detail: "", work_item_id: "w9", department: "store_team", worker_id: null },
    { id: "giveaway:g1:start", type: "giveaway", title: "Giveaway starts: Wig week", at: day(1, 10), status: "scheduled", href: "/?page=shop&tab=giveaways", detail: "", work_item_id: null, department: null, worker_id: null },
    { id: "giveaway:g1:draw", type: "giveaway", title: "Draw winners: Wig week", at: day(8, 10), status: "scheduled", href: "/?page=shop&tab=giveaways", detail: "", work_item_id: null, department: null, worker_id: null },
    { id: "sale:s1:start", type: "sale", title: "Flash sale starts: Weekend drop", at: day(2, 9), status: "scheduled", href: "/?page=shop&tab=sales", detail: "", work_item_id: null, department: null, worker_id: null },
    { id: "section:sec1:refresh", type: "section", title: "Refresh due: Dollar deals", at: day(3, 9), status: "scheduled", href: "/operations?view=products&tab=sections&section=sec1", detail: "", work_item_id: null, department: null, worker_id: null },
    { id: "launch:l1", type: "launch", title: "Launch: Straight bob wig", at: day(2, 12), status: "scheduled", href: "/operations?view=products&listing=l1", detail: "", work_item_id: null, department: null, worker_id: null },
    { id: "recurring:r1", type: "recurring", title: "Recurring order comes due", at: day(4, 8), status: "scheduled", href: "/operations?view=queue", detail: "monthly", work_item_id: null, department: "sourcing", worker_id: null },
  ];
}
function storeFixture(path: string, search: URLSearchParams): unknown {
  if (path === "/operations/store/categories") return { categories: storeCategories };
  if (path === "/operations/store/products") {
    const tab = search.get("tab");
    if (tab === "listings") return { listings: [storeListing], can_publish: true };
    return { products: tab === "sourcing" ? sourcingProducts : storeProducts, can_publish: true, shopify_connected: true };
  }
  if (path === "/operations/store/listings/l1") return { listing: storeListing, work_item: null, can_edit: true, can_publish: true };
  if (path === "/operations/store/sections") return { sections };
  if (path === "/operations/store/section-candidates") return { products: [] };
  if (path === "/operations/schedule") return { entries: scheduleEntries(), can_plan: true, workers: [{ user_id: "staff-2", label: "ada@fayfort.com" }] };
  return {};
}

// ---- Customer reviews (Control Center → Website). Layout-test placeholders. ----------------------------------------
const chatShot = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="520"><rect width="390" height="520" fill="#0b0b0f"/><rect x="16" y="60" width="270" height="110" rx="18" fill="#26262c"/><text x="32" y="100" fill="#eee" font-family="sans-serif" font-size="15">Placeholder customer message</text><text x="32" y="124" fill="#eee" font-family="sans-serif" font-size="15">read from a screenshot</text><rect x="150" y="200" width="224" height="60" rx="18" fill="#7a3cf0"/><text x="166" y="236" fill="#fff" font-family="sans-serif" font-size="15">Staff reply</text></svg>`)}`;
const siteReviews = [
  { id: "rv1", source: "instagram", status: "pending", featured: false, rating: null, body: "Placeholder customer message read from a screenshot.",
    display_name: "Test A.", country: "Nigeria", product: null, reviewed_on: "2026-10-12", staff_note: null,
    ocr_text: "23:18\nPlaceholder customer message\nread from a screenshot\nStaff reply", screenshot_url: chatShot, created_at: iso(30) },
  { id: "rv2", source: "member", status: "pending", featured: false, rating: 4, body: "Placeholder member review written in the dashboard.",
    display_name: "Test B.", country: "Ghana", product: "Sample order #1042", reviewed_on: null, staff_note: null, ocr_text: null, screenshot_url: null, created_at: iso(60) },
  { id: "rv3", source: "whatsapp", status: "published", featured: true, rating: null, body: "Placeholder published review.",
    display_name: "Test C", country: "UK", product: null, reviewed_on: null, staff_note: null, ocr_text: null, screenshot_url: null, created_at: iso(900) },
];

// ---- Hours, ratings, revenue and connections (docs/WORKFORCE_AND_REVENUE_PLAN.md). Layout-test placeholders. --------
const shiftState = { shift: { id: "sh1", worker_id: "staff-1", started_at: iso(134), ended_at: null, on_break: false, on_break_since: null, break_seconds: 900, worked_seconds: 7140, ended_by: null, note: null, flag: null }, today_seconds: 7140, week_seconds: 61200, server_time: iso(0) };
const fresh = (current: number, count: number, done: number) => ({ count, average: count >= 5 ? 4.6 : null, average_90_days: count >= 5 ? 4.7 : null, is_new: count < 5, current, current_count: Math.min(count, 4),
  fresh_start: { every: 20, completed_tasks: done, resets: Math.floor(done / 20), last_reset_at: iso(3000), tasks_to_go: 20 - (done % 20) },
  distribution: { "5": 8, "4": 3, "3": 1, "2": 0, "1": 0 }, monthly: [{ month: "2026-07", average: 4.4, count: 3 }, { month: "2026-08", average: 4.6, count: 4 }, { month: "2026-09", average: 4.5, count: 2 }, { month: "2026-10", average: 4.9, count: 3 }] });
const workerDirectory = {
  workers: [
    { user_id: "staff-1", email: "test.a@example.com", display_name: "Test Worker A", status: "active", online: true, last_seen_at: iso(1), last_sign_in_at: iso(200), invited_at: iso(90000), activated_at: iso(80000), deactivated_at: null, handoff_availability: "available", mfa_enrolled: true, email_confirmed: true, open_work_count: 3, invitation: null, photo_url: null, rating: fresh(4.8, 12, 52), on_shift: true, on_break: false },
    { user_id: "staff-2", email: "test.b@example.com", display_name: "Test Worker B", status: "active", online: false, last_seen_at: iso(300), last_sign_in_at: iso(900), invited_at: iso(90000), activated_at: iso(80000), deactivated_at: null, handoff_availability: "away", mfa_enrolled: false, email_confirmed: true, open_work_count: 1, invitation: null, photo_url: null, rating: fresh(5, 2, 7), on_shift: false, on_break: false },
  ],
  summary: { total: 2, active: 2, online: 1, invited: 0, inactive: 0, without_mfa: 1 }, online_window_seconds: 120, generated_at: iso(0),
};
const workerRatings = { summary: fresh(4.8, 12, 52), ratings: [
  { id: "wr1", stars: 5, comment: "Placeholder comment: quick and very helpful.", source: "chat", created_at: iso(600), about: "Sample chat" },
  { id: "wr2", stars: 4, comment: "Placeholder comment: good updates on my order.", source: "request", created_at: iso(3000), about: "Sample order" },
] };
const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset); return d.toISOString().slice(0, 10); };
const timesheet = {
  start: day(0), days: [0, 1, 2, 3, 4, 5, 6].map(day),
  workers: [
    { user_id: "staff-1", name: "Test Worker A", photo_url: null, days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [day(i), [27000, 30600, 25200, 0, 28800, 14400, 0][i]])), total_seconds: 126000, on_shift: true, on_break: false,
      shifts: [{ id: "sx1", worker_id: "staff-1", started_at: iso(2000), ended_at: iso(1500), on_break: false, on_break_since: null, break_seconds: 1800, worked_seconds: 28200, ended_by: "auto", note: null, flag: "auto_ended" }] },
    { user_id: "staff-2", name: "Test Worker B", photo_url: null, days: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [day(i), [0, 18000, 21600, 19800, 0, 0, 0][i]])), total_seconds: 59400, on_shift: false, on_break: false, shifts: [] },
  ],
  on_shift_now: [{ ...shiftState.shift, name: "Test Worker A", photo_url: null }],
  corrections: [{ id: "cr1", shift_id: "sx1", previous_started_at: iso(2000), previous_ended_at: iso(1500), proposed_started_at: iso(2000), proposed_ended_at: iso(1400), reason: "Placeholder reason: forgot to clock out", created_at: iso(30), worker: { name: "Test Worker A", photo_url: null } }],
  coverage: [0, 1, 2, 3, 4, 5].flatMap((weekday) => [9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((hour) => ({ weekday, hour, covered: weekday === 3 ? 0 : hour === 12 ? 0.5 : hour > 16 && weekday > 3 ? 0 : 1 }))),
  support_hours: { days: "Mon-Sat", start: "09:30", end: "18:30", time_zone: "China time" },
};
const revDays = Array.from({ length: 30 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 29 + i); return d.toISOString().slice(0, 10); });
const revenueReport = {
  range: { start: revDays[0], end: revDays[29], bucket: "day", time_zone: "China time" }, currency: "USD",
  tiles: { gross: 18420, refunds: 640, net: 17780, sales: 96, average_sale: 185.21, paying_customers: 61, previous_net: 14210, change: 0.2512, mrr: { amount: 1243, members: { standard: 24, pro: 16 } } },
  streams: [["shop", "Shop"], ["sourcing", "Sourcing orders"], ["deposits", "Deposits"], ["consultations", "Consultations"], ["contact_credits", "Contact credits"], ["memberships", "Memberships"], ["other", "Other"]].map(([key, label]) => ({ key, label })),
  series: revDays.map((bucket, i) => ({ bucket, shop: 120 + (i * 37) % 260, sourcing: i % 3 === 0 ? 900 - (i * 13) % 300 : 0, deposits: i % 4 === 1 ? 300 : 80, consultations: i % 6 === 2 ? 100 : 0, contact_credits: i % 5 === 0 ? 50 : 15, memberships: i % 7 === 3 ? 380 : 20, other: 0 })),
  mix: [["shop", "Shop", 6200, 300, 5900, 41], ["sourcing", "Sourcing orders", 7900, 340, 7560, 10], ["deposits", "Deposits", 2400, 0, 2400, 14], ["consultations", "Consultations", 500, 0, 500, 5], ["contact_credits", "Contact credits", 620, 0, 620, 12], ["memberships", "Memberships", 800, 0, 800, 14], ["other", "Other", 0, 0, 0, 0]]
    .map(([key, label, gross, refunds, net, count]) => ({ key, label, gross, refunds, net, count })),
  sources: { shopify: 16980, stripe: 800 },
  top_products: [{ title: "Sample wig 22 inch", revenue: 1920, quantity: 16 }, { title: "Sample closure", revenue: 1260, quantity: 9 }, { title: "Sample edge control", revenue: 380, quantity: 38 }],
  countries: [{ country: "Nigeria", net: 9200 }, { country: "Ghana", net: 4100 }, { country: "UK", net: 2300 }, { country: "US", net: 1380 }],
  other_currencies: {}, stripe_connected: true, data_since: iso(90000),
};
const connections = {
  shopify: { connected: true, store: "sample.myshopify.com", webhooks: true, manage: "Control Center → Shop → Overview" },
  stripe: { connected: false, ready: false, mode: "not_configured", source: "none", key_hint: null, problem: null, saved_at: null, manage: "Control Center → Shop → Billing" },
  email: { connected: true, sending: true, from: "FayFort <updates@fayfort.com>", manage: "Control Center → Email" },
};

// ---- Bookings and staff roles (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md) ---------------------------
const CEO_ID = "staff-ceo";
const chinaAt = (daysAhead: number, hour: number, minute = 0) => {
  const now = new Date();
  const china = new Date(now.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() + daysAhead, hour - 8, minute)).toISOString();
};
const bookingRow = (id: string, member: string, daysAhead: number, hour: number, extra: Record<string, unknown> = {}) => {
  const starts = chinaAt(daysAhead, hour);
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(starts));
  return {
    id, kind: "consultation", status: "confirmed", starts_at: starts, ends_at: new Date(Date.parse(starts) + 3600_000).toISOString(), hold_expires_at: null,
    topic: "Importing hair from Guangzhou: suppliers, MOQ and shipping to Lagos", brief: null, host_note: null, call_link: null, member_time_zone: "Africa/Lagos",
    reschedule_count: 0, cancel_reason: null, cancelled_by: null, refund: null, work_item_id: "w1", host_id: CEO_ID, member_id: "m1",
    host: { user_id: CEO_ID, name: "Favour Fay", photo_url: null, staff_role: "ceo" }, member_name: member, conversation_id: "mc1",
    payment: { status: "paid", amount: 85, currency: "USD" }, when_china: `${when} China time`, needs: ["call_link", "brief"], ...extra,
  };
};
const bookingRows = () => [
  bookingRow("bk1", "Amaka Obi", 1, 15),
  bookingRow("bk2", "Grace Mensah", 2, 14, { status: "held", hold_expires_at: chinaAt(0, 23), needs: ["hold_expiring"], payment: { status: "sent", amount: 100, currency: "USD" }, topic: "First container from Yiwu" }),
  bookingRow("bk3", "Jordan Mensah", 3, 16, { call_link: "https://meet.google.com/abc-defg-hij", brief: "Second order, wants a Canton Fair plan.", needs: [] }),
];

function bookingFixture(path: string, search: URLSearchParams): unknown {
  if (path === "/operations/bookings/me")
    return {
      user_id: "staff-1", staff_role: "assistant", sees_all: true, admin: false, ceo_id: CEO_ID, settings: {},
      hosts: [
        { user_id: CEO_ID, name: "Favour Fay", photo_url: null, staff_role: "ceo", job_title: "Founder & CEO", is_self: false },
        { user_id: "staff-1", name: "Ada Okafor", photo_url: null, staff_role: "assistant", job_title: "Personal assistant", is_self: true },
      ],
    };
  if (path === "/operations/bookings") return { bookings: search.get("view") === "needs_action" ? bookingRows().slice(0, 2) : bookingRows() };
  if (path.startsWith("/operations/bookings/slots")) return { slots: [14, 15, 16].map((h) => ({ starts_at: chinaAt(1, h), ends_at: chinaAt(1, h + 1) })) };
  if (path.startsWith("/operations/bookings/")) return { booking: bookingRows()[0] };
  if (path.startsWith("/operations/availability/"))
    return {
      host: { user_id: CEO_ID, name: "Favour Fay" }, can_edit: true, time_zone: "Asia/Shanghai",
      weekly: [0, 2, 4].map((weekday) => ({ id: `a${weekday}`, weekday, start_time: "14:00", end_time: "18:00", time_zone: "Asia/Shanghai", kinds: ["consultation"] })),
      time_off: [{ id: "off1", starts_at: chinaAt(9, 0), ends_at: chinaAt(12, 0), reason: "Canton Fair" }],
    };
  if (path === "/platform/staff/candidates")
    return {
      accounts: [
        { user_id: "u-amaka", email: "amaka.obi@example.com", display_name: "Amaka Obi", username: "amaka", created_at: iso(60 * 24 * 30), last_sign_in_at: iso(60), eligible: true, reason: null },
        { user_id: "staff-2", email: "amaka@fayfort.com", display_name: "Amaka (FayFort)", username: null, created_at: iso(60 * 24 * 90), last_sign_in_at: iso(5), eligible: false, reason: "Already on the team" },
      ],
    };
  return lists;
}
