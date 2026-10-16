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
  { id: "bc1", customer_name: "Amaka Obi", customer_username: "@amaka.styles", channel: "instagram", status: "open", summary: "Asking for the price of 30 inch bone straight bundles and delivery to Lagos", last_message_at: iso(4), created_at: iso(300) },
  { id: "bc2", customer_name: "Grace Mensah", channel: "messenger", status: "open", summary: "Wants a refund for a wig that arrived tangled", last_message_at: iso(25), created_at: iso(600) },
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
  { id: "w2", department: "conversation_intake", work_type: "business_handoff", status: "claimed", priority: "normal", summary: "Instagram customer wants split payment on a $412 order", next_action: "Confirm payment plan", waiting_on: null, waiting_reason: null, due_at: null, assigned_worker_id: "staff-1", assigned_automation_key: null, claimed_until: iso(-20), version: 1, member_request_id: null, member_conversation_id: null, business_id: businessId, business_conversation_id: "bc1", handoff_id: "h1", created_at: iso(9) },
  { id: "w3", department: "sourcing", work_type: "member_request", status: "open", priority: "normal", summary: "Source Ankara fabric, 6 yards, wedding colours", next_action: "Find three suppliers", waiting_on: null, waiting_reason: null, due_at: iso(-1440), assigned_worker_id: null, assigned_automation_key: null, claimed_until: null, version: 1, member_request_id: "mr1", member_conversation_id: null, business_id: null, business_conversation_id: null, handoff_id: null, created_at: iso(800) },
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
  if (path === "/operations/me/departments") return { user_id: "staff-1", departments: ["conversation_intake", "sourcing", "fulfillment", "disputes", "member_support"], can_manage: true };
  if (path === "/operations/work-items") return { work_items: workItems };
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
