# Worker profiles, ratings, working hours and revenue: analysis and plan

Status: **built 2026-10-19** with every recommended decision (D1–D8) approved, plus the rating fresh start (section 3b). Migration `20261019140000_workforce_hours_ratings_revenue.sql`.

---

## 1. What exists today

| Area | Today | Gap |
|---|---|---|
| Worker accounts | Control Center → Workforce: directory, invitations, departments, MFA, deactivate. Operations → Team. Presence heartbeat (`operations_worker_presence`) shows "Online now / last seen". | No photo, no rating, no record of hours. Presence is "the tab is open", not "I'm working". |
| Profile photos | Members can upload one (`member_profiles.member_photo_path`, private bucket `member-profile-photos`). Workers have a `member_profiles` row too (every account does) but no screen to upload. | Workers can't set one; members and colleagues see initials only. |
| Member ↔ worker contact | Workers reply in member chats, handoffs (Instagram/WhatsApp), photo reviews, sourcing requests. Each reply is stored with the worker's id. | Nothing asks the customer how the help was. |
| Shopify income | Every Shopify order arrives by webhook into `commerce_orders` (total, currency, financial status, placed date, line items). Sourcing orders, deposits, consultations and contact credits are Shopify invoices (`commerce_invoices.kind`) that become Shopify orders when paid. | Refunds aren't stored as amounts; no totals, trends or charts. Orders before the webhook went live (about 15 Oct) aren't in the database. |
| Stripe income | **Not connected yet** (checked 2026-10-18: the API server has no `STRIPE_SECRET_KEY`). The code is complete: once the key is set, FayFort creates the Standard and Pro prices, the customer portal and the webhook itself, and membership payments land in `member_subscription_payments` (amount, plan, paid date) from the `invoice.paid` webhook. Control Center → Shop → Billing shows plan counts. | No refunds, no monthly totals, no charts. |
| Charts | None; the dashboard has no chart library. | Need a small chart kit. |

---

## 2. Worker profile photo

- **Where:** the worker's own Account page (StaffAccountPage) gets "Profile photo: Upload / Remove", reusing the member photo upload (same checks: JPEG/PNG/WebP, 5 MB, private bucket, signed links).
- Admins can remove an unsuitable photo from Control Center → Workforce → worker profile (audited).
- **Shown in:** Workforce directory and profile, Operations → Team, the assignee chip on work cards, staff chat threads, and (D7) the member chat bubble when a person from the team replies ("Ada · FayFort team" with her photo).
- No new table: `member_profiles.member_photo_path` already exists for every account.

## 3. Worker ratings

**Where ratings come from (D1):**
- **Customers (recommended):** when a piece of human help finishes, the member gets a one-tap prompt: "How was Ada's help? ★★★★★ + optional comment". Triggers:
  - a member chat where a worker replied goes quiet / the handoff closes,
  - a sourcing request the worker handled reaches delivered (same moment as the review invite; one combined card: "Rate the order" + "Rate Ada's help"),
  - a photo review is completed.
  One prompt per worker per conversation/request, so nobody is asked twice for the same help.
- **Admins (optional):** a private monthly review per worker (1–5 on Speed, Care, Accuracy + note), visible only to admins.

**What's shown:**
- Workforce → worker profile: average rating (last 90 days and all time), number of ratings, a monthly trend line, the comments (newest first), and which piece of work each came from.
- Workforce directory: a stars column, sortable.
- The worker's own Account page (D2): their average, trend and comments, without the member's name.
- Low ratings (1–2 stars) notify admins so they can follow up, and are never hidden from the worker's record.

**Fairness:** averages show only after 5 ratings ("New" before that); a rating is tied to a real conversation or request the worker actually handled; members can change their rating for 7 days.

**Data:** `worker_ratings` (worker, member, source type + id, stars 1–5, comment, created/updated), `worker_rating_prompts` (one per worker per conversation/request, like the review invites), `worker_reviews` for admin reviews. Member notification type `worker_rating`.

## 3b. Rating fresh start (owner request, 2026-10-19)

- A worker's **current rating** counts only the customer ratings since their last fresh start. After every **N completed
  tasks** (Operations work items they complete) it goes back to a perfect **5.0**, to keep workers encouraged.
- **N is set by an admin** in Control Center → Workforce → Workers → "Rating fresh start" (default 20; 0 turns it off).
- **Workers see how it works** on their Account page (and admins on each profile): "Fresh start every 20 completed
  tasks", the explanation, "8 tasks to the next fresh start" with a progress bar, and how many fresh starts so far.
- The all-time and 90-day averages and every comment stay in the history for admins. Nothing is deleted.
- Data: `workforce_settings` (`rating_reset_tasks`); the current score is worked out from completed tasks
  (`operations_work_items.completed_at`) and rating dates, so changing N applies at once.

## 4. Working hours: clock in and out

**For the worker (Operations header, next to Notifications):**
- A **Clock in** button. Once in: a running timer "On shift · 2h 14m", **Break** and **Clock out**.
- Clocking in marks them "On shift" (green ring on their photo) everywhere colleagues and admins see them; "Online" stays the separate tab-is-open signal.
- Optional note on clock-out ("Packed 6 orders, sourcing calls").
- **Forgot to clock out:** if the heartbeat stops for 30 minutes, the shift ends automatically at the last heartbeat and is flagged "Auto-ended" so an admin can check it. Shifts can't run past 16 hours.
- **Claiming work (D3):** recommended: no hard block. Claiming while clocked out shows a nudge "You're not clocked in. Clock in now?" with one tap.

**For admins (Control Center → Workforce):**
- **Timesheets** tab: week view per worker (Mon–Sun, China time), hours per day, total, breaks, auto-ended shifts highlighted.
- **Who's on shift now** card at the top of Workforce.
- **Corrections:** an admin can edit a shift's start/end with a reason; the original stays in the audit log. Workers can request a correction with a note; admins approve.
- **Charts:** hours per worker per week (bars), coverage across the support hours (Mon–Sat 9:30–18:30 China time) as a heatmap showing hours nobody was on shift, and hours vs work completed per worker.
- **Export:** CSV of shifts for any date range (for payroll outside FayFort).
- **Pay (D4):** not calculated in this phase. If wanted later: an hourly rate per worker and a pay column in the export.

**Data:** `worker_shifts` (worker, started_at, ended_at, break_seconds, ended_by: worker | auto | admin, note, flags), `worker_shift_breaks`, `worker_shift_corrections` (requested/approved, before/after, reason, by). Totals are computed from shifts, never stored twice.

**Privacy:** no location, IP or screen tracking: only the times the worker presses the buttons and the existing heartbeat.

## 5. Revenue from Shopify and Stripe

**Sources (all already flowing in, plus small additions):**

| Stream | Source | Added in this build |
|---|---|---|
| Shop orders (in-stock store) | Shopify orders, `source = storefront` | Store refunded amount from the order payload (`current_total_price` / `refunds`) on every order webhook. |
| Sourcing orders | Shopify invoices `kind = order` | Same refund handling. |
| Sourcing deposits | Shopify invoices `kind = deposit` | |
| Consultations | Shopify invoices `kind = consultation` | |
| Supplier contact credits | Shopify invoices `kind = contact_credits` | |
| Memberships (Standard, Pro) | Stripe `member_subscription_payments` | Also record Stripe refunds (`charge.refunded`) and the Stripe fee per payment (D5). |

- Paid Shopify invoices also appear as Shopify orders; the revenue view counts each sale once (by the Shopify order, labelled by the invoice kind).
- **History (backfill):** a one-off import pulls past Shopify orders (the last 60 days without extra permission; all history needs the `read_all_orders` scope, which you'd approve in Shopify) and past Stripe invoices, so the charts don't start on 15 October.
- **Currency (D6):** reported in USD (the store currency). Any other currency is shown separately, not converted.
- **Gross vs net (D5):** phase 1 shows gross sales, refunds and net sales (gross − refunds). Payment fees (Stripe fees; Shopify Payments fees via payouts, needing `read_shopify_payments_payouts`) can follow as phase 2.

**Where:** Control Center → Shop → a new **Revenue** tab (next to Orders and Billing), plus a revenue tile on the Control Center Overview ("This month $X, +12% vs last month"). Admins only; workers never see revenue.

**What it shows:**
- **Headline tiles:** revenue this month, vs last month (%), net after refunds, memberships recurring revenue (MRR), average order value, paying customers, refunds.
- **Revenue over time:** stacked area by stream (Shop, Sourcing orders, Deposits, Consultations, Contact credits, Memberships), daily / weekly / monthly, ranges 7 days, 30 days, 90 days, 12 months and custom. Hover shows each stream's amount.
- **Mix:** bar of revenue by stream for the period, and Shopify vs Stripe.
- **Top products** (shop) and **top categories** (sourcing) by revenue.
- **Membership:** MRR trend, new / cancelled / paused members per month.
- **Countries:** revenue by shipping country (from order addresses).
- **Export:** CSV of the transactions behind any chart.

**Data:** a `revenue_entries` view (or table filled by the webhooks and the backfill) with one row per payment or refund: date, stream, source (shopify | stripe), gross, refund, currency, member, order/invoice/payment id, country. The API aggregates it by day, week or month in the database, so charts load fast.

## 5b. Connecting Stripe

Stripe was built to connect from the API server's settings, not from a screen, which is why there's nothing to click.
Control Center → Shop → Billing says "Stripe isn't connected" until the key is there.

- **Today's way (works now):** in Stripe → Developers → API keys, copy the secret key (test key first: `sk_test_…`).
  On the VPS, add one line `STRIPE_SECRET_KEY=…` to `/opt/fayfort/api.env` yourself and restart the API (I can give
  the exact two commands; I never handle the key). Then Shop → Billing → "Run setup and sync now" creates the plans,
  portal and webhook, and shows Ready.
- **Proposed (D8):** a **Connections** card in Control Center → Infrastructure showing Shopify, Stripe and email
  (Resend) as Connected / Not connected / Problem, with a **Connect Stripe** form where you paste the key. The key is
  stored encrypted in Supabase Vault (never shown again, only "sk_live_…4f2a"), checked against Stripe before saving,
  and replaceable or removable. Test and live keys are labelled so live mode is never switched on by accident.

Until Stripe is connected, the Revenue tab shows memberships as "Not connected" and every Shopify stream still works.

## 6. Charts

A small in-house chart kit in the dashboard (SVG, no new library): area/line, bars, stacked bars, heatmap, sparkline and stat tiles. One colour per stream used consistently on every chart, readable in light and dark mode, with hover tooltips, keyboard focus and a table view for screen readers. Built following the dataviz guidance (form per question, validated palette).

## 7. Where everything lives (no new sections)

| Feature | Place |
|---|---|
| Upload own photo, see own ratings and hours | Worker's Account page |
| Clock in / break / clock out | Operations header |
| On shift now, timesheets, corrections, hours charts, ratings per worker | Control Center → Workforce (directory + worker profile + new Timesheets tab) |
| Rate a worker's help (members) | Chat and Orders & requests (same card style as reviews) |
| Revenue charts and export | Control Center → Shop → Revenue tab; tile on Control Center Overview |

## 8. Build order

1. Worker photo (small; reuses member photo upload).
2. Clock in/out + timesheets + corrections + hours charts (with the chart kit).
3. Revenue: refund capture, Stripe refunds, backfill, Revenue tab, Overview tile.
4. Worker ratings: prompts, member card, profile and directory views, low-rating alerts.

Each step ships on its own (migration, API, dashboard, tests, layout screenshots), in that order or any order you prefer.

**Needed from you:** approve Shopify scopes if you want full history (`read_all_orders`) and payment fees (`read_shopify_payments_payouts`) in the Shopify admin; nothing new is needed in Stripe (the webhook exists; `charge.refunded` is added to it automatically).

## 9. Decisions

- **D1** Who rates workers: customers after help (recommended), admins' private monthly review, or both.
- **D2** Can workers see their own ratings and comments (without the customer's name)? Recommended: yes.
- **D3** Must workers clock in before claiming work? Recommended: no block, a one-tap nudge.
- **D4** Calculate pay from hours (hourly rate per worker)? Recommended: not now; CSV export instead.
- **D5** Revenue: gross and refunds now, payment fees later (recommended), or fees from the start.
- **D6** Reporting currency: USD (recommended).
- **D7** Show the worker's photo and first name to members in chat? Recommended: yes.
- **D8** Connect Stripe from a Control Center "Connections" card (key stored encrypted), or keep it as a server
  setting you add on the VPS. Recommended: the Connections card.


## 10. What was built (2026-10-19)

| Piece | Where |
|---|---|
| Worker photo upload/remove; admin remove | Account page; Workforce profile (`/workers/me/photo`, `/platform/workers/{id}/photo`) |
| Photo + first name on team replies in member chat | `member_messages.actor_user_id` → `staff` on each reply (id never sent) |
| Clock in / break / clock out, auto-end after 30 min quiet, 16 h cap | Operations header (`ShiftControl.tsx`), sweep step `shifts` |
| Claim nudge when clocked out | Operations (never blocks) |
| Timesheets, on shift now, corrections (worker asks, admin approves; admin edits keep the original), CSV, hours bars, support-hours coverage heatmap | Workforce → Timesheets |
| Customer ratings (chat quiet 2 h, delivered request), change within 7 days, low-rating alerts, fresh start | Member chat and Orders & requests; Workforce profile; Account page |
| Revenue: tiles, net by stream over time, mix, top products, countries, memberships, CSV, history import | Shop → Revenue; Overview tile |
| Refunds captured (Shopify refunds, Stripe `charge.refunded`), shipping country | `commerce_orders`, `member_subscription_payments`, view `revenue_entries` |
| Connect Stripe (checked with Stripe, key in Vault, hint only, replace/remove) | Infrastructure → Connections |
| Chart kit (validated palette, legend, hover + keyboard tooltips, table view) | `dashboard/src/app/charts/` |

Tests: `tests/test_workforce_team.py`, `WorkforceRevenue.test.tsx`, e2e `team-revenue.spec.ts`.
