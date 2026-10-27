# Restructuring the Control Center and the Operations Center around departments

Status: analysis and proposal, 2026-10-26, for the owner's review. Nothing changed yet.

Owner brief (2026-10-26): the system works but feels out of place. Hide admin pages from workers (Entitlements,
Automations, Human Agents, Knowledge, Infrastructure). Move Verification into the Website section (it's a tool).
Most important: reorganise the Operations Center by department so each department's work, and what it needs from
other departments, sits in one recognisable frame. Anything a worker needs that lives outside Operations comes in as a
compact card, with a way to open the original page. Keep the task explanations, make onboarding easy.

## 1. What I found

### 1.1 Two apps, mixed audiences

- **Control Center** (app.fayfort.com) is one sidebar for everyone. Workers and the administrator see the same
  Workspace, Operations and Manage groups: Overview, Conversations, Customers, Requests, Directory & Tools, Channels &
  Connections, Automations, Entitlements, Verification, Human Agents, Knowledge, Analytics, Settings. Only the
  "Platform admin" group (FayFort Workers, Shop, Ads, Website, Emails, Theme Studio, Infrastructure) and Member Requests
  are hidden from workers.
- **Operations Center** (/operations) is where staff work happens. Its tabs are Queue, Products (Store team), Bookings,
  Schedule, Archive, Guide, and Team and Reports for the administrator. Workers reach it from a link at the bottom of the
  Control Center sidebar.
- The server mostly allows any FayFort team member on the business pages; only some actions check for an administrator.
  Hiding pages must therefore also be enforced on the server, not only in the menu.

### 1.2 Every Control Center page: who it's for and where it should go

| Page | What it is | Used by | Proposal |
| --- | --- | --- | --- |
| Overview | Counts for the business (open chats, handoffs, requests, failed runs) | Admin | Admin. Workers get "My work" in Operations instead |
| Conversations | Instagram, Messenger and website chats waiting for a person; all chats; member-app chats | Conversation intake, Member support | **Comes into Operations** as the Conversations desk (full page stays for the admin) |
| Customers | Customer profiles with their chats and requests | Conversation intake | **Card** inside a chat (the customer's profile beside the conversation); full page for the admin |
| Requests | Requests the AI pulled out of customer chats (missing info, status) | Conversation intake | **Card** inside a chat; a "Requests" list in the Conversations desk |
| Directory & Tools | AI tool definitions and directory datasets | Admin | Admin |
| Channels & Connections | Connecting Instagram, Messenger, the website chat | Admin | Admin (recommended; see question 2) |
| Automations | Rules, schedules, runs and failures | Admin | **Hidden from workers** (owner) |
| Entitlements | Who can use the directory tools | Admin | **Hidden from workers** (owner) |
| Verification | Reviewing unverified directory fields | Admin | **Moves into Website** as a tool (owner) |
| Human Agents | Handoff availability, assignment, takeover | Admin, but workers set their availability there today | **Hidden from workers** (owner). A worker's own availability moves into Operations (shift bar), so nothing is lost |
| Knowledge | FAQ answers the AI uses | Admin | **Hidden from workers** (owner). Workers get a read-only "Answers" search inside chats, so they reply like the AI |
| Analytics | Business event history | Admin | Admin (recommended) |
| Settings | Business configuration | Admin | Admin (recommended) |
| Member Requests (admin) | Member sourcing requests list | Admin | Duplicates the Sourcing queue; becomes the Sourcing desk's pipeline view |
| Shop (admin) → Trend queue & pools | Shared links grouped by item, group buys | Admin, but it's Sourcing work | **Card** in the Sourcing desk ("Trends and group buys"); full page for the admin |
| Shop → Invoices (Deposits due) | Requests waiting for a deposit, sending deposits | Admin, Sourcing | **Card** in the Sourcing desk; work items already link here and send workers out |
| Shop → Orders | Shopify orders | Admin, Fulfillment | **Card** in the Fulfillment desk |
| Shop → Giveaways, Flash sales | Campaign setup | Admin, Store team | Admin page stays; the Store team desk shows a card of what's running and due |
| Shop → Revenue, Billing, Products | Money and plan setup | Admin | Admin |
| Website, Emails, Ads, Theme Studio, Workers, Infrastructure | Platform setup | Admin | Admin (Infrastructure already hidden) |

### 1.3 The departments, one by one

**Conversation intake** (Instagram, Messenger and website customers who want a person)
- Work: `human_handoff` / `business_handoff` (take over a customer chat), `member_conversation`.
- Pipeline: AI asks for a person → in the queue → a worker takes over → replies (Messenger: within 24 hours) → hands back
  to the AI or turns it into a request.
- Today the work is split three ways: the handoff item in Operations (with a chat panel), the Conversations page in the
  Control Center (the "Open in Conversations" button sends workers out), and Human Agents (availability, assignment).
  The customer's profile and requests are on two more pages. A worker on chats alone has to visit 4 places.
- Crosstalk: a chat becomes a **sourcing request** (Sourcing), a complaint becomes a **dispute** (Disputes), a member
  asks for a **consultation or tour** (Member support).

**Sourcing** (finding what members ask for)
- Work: `sourcing_request` (member request), `group_buy`, recurring orders, sourcing batches.
- Pipeline: submitted → under review → deposit (Free 50%, Standard 25%) → sourcing (delivery estimate) → options shared
  → member chooses → invoice → paid (→ Fulfillment).
- Inside Operations: the request steps, research, share options (now moves the stage by itself), batches, the invoice.
- Outside: Deposits due and the trend queue and pools live in Shop (administrator only), so a sourcing worker can't see
  "37 want this" or start a group buy themselves; Member Requests duplicates the queue for the administrator.
- Crosstalk: from Conversations (new requests), to Fulfillment (paid), to Store team (a trend becomes a listing or a find),
  to Disputes.

**Fulfillment** (getting paid things to the member)
- Work: `fulfillment_request` (purchase confirmed → in the warehouse → shipped → in transit → delivered),
  `store_order` (pack a Shopify order).
- Inside: stages, checklists, tracking. Outside: Shopify admin to mark an order fulfilled, carrier sites. Shop → Orders
  is administrator only.
- Crosstalk: from Sourcing (paid requests) and the shop (orders), to Disputes (damaged, missing), to Member support
  (refunds).

**Member support** (everything about a member's account, money and bookings)
- Work: `member_chat_support`, `billing_issue`, `invoice_failed`, `invoice_void`, `refund_after_cancel`,
  `photo_review`, `giveaway_draw`, `giveaway_prize`, `consultation`, `tour_booking`, bookings.
- Inside: each item has its panel; Bookings and Tours are a top tab of the Operations Center shared with everyone.
- Outside: Shopify admin for refunds and deleting drafts, Shop → Invoices and Giveaways (administrator only).
- It's the widest department: money, campaigns and the calendar. Grouping it into three lanes (Money, Bookings,
  Campaigns) makes it readable.

**Disputes**
- Work: `dispute_case` (member disputes on orders), `membership_dispute` (card disputes on plan payments, urgent, with
  the Stripe link).
- Crosstalk: comes from Fulfillment, Sourcing and Stripe; needs the order, the chat and the payment in one view.

**Store team** (the catalog)
- Work: `list_store_product`, `list_sourcing_item`, `list_find`, `fill_finds_drop`, `research_niche`, `map_product`,
  `retire_listing`, `refresh_section`, `prepare_campaign`.
- Inside: Products tab (Store, Sourcing, In progress, Finds, Sections) and the Schedule. This is already the most
  self-contained department; it mainly needs its own home and the campaign card.

**Shared across departments:** the Schedule (deadlines, drops, campaigns, bookings), the Archive, the Guide,
notifications, the shift clock, and the member chat that most item types carry.

### 1.4 What makes it feel out of place

1. **One undifferentiated queue.** Every department's items sit in one list with a department filter; the tabs across
   the top (Products, Bookings, Schedule) are tools of particular departments shown to everyone.
2. **Department tools live outside.** Conversations, customers, requests, deposits, trends and pools, orders and
   giveaways are in the Control Center or in administrator-only Shop tabs.
3. **Duplicates.** Handoffs appear in Human Agents, Conversations and the queue; member requests in Member Requests and
   the queue.
4. **Workers land in the wrong place.** They open the Control Center (business pages and admin tools) and have to find
   the Operations Center link at the bottom of the menu.
5. **The guides are good but flat.** The task explanations are per work type; nothing explains a department as a
   whole (its pipeline, its tools, who it hands to).

## 2. Proposal

### 2.1 Who sees what

- **Workers land in the Operations Center.** Opening app.fayfort.com as a worker goes straight to /operations. Their
  Control Center keeps only My account and My member account; everything they need is a desk or a card.
- **Administrators** keep the full Control Center plus the Operations Center (all desks, Team, Reports).
- **Hidden from workers, menu and server:** Entitlements, Automations, Human Agents, Knowledge, Infrastructure (owner),
  and as recommended Channels & Connections, Directory & Tools, Analytics, Settings, Overview. The server answers 403 to
  non-administrators on those pages' write endpoints (reads where they expose admin data).
- **Verification moves into Website** (Control Center → Website → Directory verification).

### 2.2 The Operations Center by desk

A left rail (a top menu on phones) with:

1. **My work** (home for everyone): my claimed items across desks, what's due today, my notifications, my shift and my
   **availability for chats** (moved from Human Agents), and the "what to do next" line per item.
2. **One desk per department the worker belongs to** (administrators see all):
   Conversations · Sourcing · Fulfillment · Member support · Disputes · Store team.
3. **Shared:** Schedule, Archive, Guide. Administrators also: Team, Reports.

Every desk has the same shape, so a new worker learns it once:

- **Header:** what the desk does in one line, and a "How this desk works" panel: its pipeline drawn as steps, its tools,
  who it hands work to.
- **Pipeline strip:** the desk's stages with counts (for example Sourcing: Review 4 · Deposit 2 · Sourcing 6 · Options
  sent 3 · Invoice 1). Tapping a stage filters the list.
- **List and detail:** the desk's queue on the left and the item on the right, with the existing step-by-step guide,
  chat and actions (what workers already like stays).
- **Tool cards:** compact versions of anything that lived outside, each with "Open full page ↗" for those allowed.
- **Hand-off buttons:** crosstalk actions in the item itself, so nobody goes looking (section 2.4).

### 2.3 What each desk holds

| Desk | Pipeline strip | List | Tool cards (compact, "Open full page" for admins) |
| --- | --- | --- | --- |
| **Conversations** | Waiting for a person · Mine · Member app · Handed back today | Every chat waiting for a person across Instagram, Messenger, website and the member app, one inbox | **Three panes in one frame**: chats · the conversation (take over, reply, hand back, the 24-hour notice) · the **customer card** (profile, past chats, their requests and orders). **Answers** (read-only knowledge search). **Requests** (AI-found requests with missing info) |
| **Sourcing** | Review · Deposit · Sourcing · Options sent · Chosen · Invoice | Member requests, group buys, recurring orders | **Trends and group buys** ("37 want this", start a pool), **Deposits due** (send a deposit), **Batches**, **Supplier directory** search |
| **Fulfillment** | Confirmed · Warehouse · Shipped · In transit · Delivered · Shop orders to pack | Paid requests and shop orders | **Orders** (Shopify orders and tracking), carrier links |
| **Member support** | Money · Bookings · Campaigns · Chats | Billing, invoices, refunds, photo reviews, giveaways, consultations, tours | **Bookings** (calendar, today's bookings, the CEO's hours, moved here from the top tabs), **Tours**, **Invoices** (failed and unpaid), **Giveaways** (running, to draw) |
| **Disputes** | New · Investigating · Waiting · Resolved | Order disputes and card disputes | **Case file**: the order, the chat, the payment and the Stripe link side by side |
| **Store team** | Listings · Finds · Sections · Campaigns | Store team work items | **Products** (Store, Sourcing, In progress, Finds, Sections, as today), **Campaigns** (giveaways and sales running and due), **Next drop** (how full) |

### 2.4 Crosstalk: where one desk hands to another

| From | To | Trigger | How it shows |
| --- | --- | --- | --- |
| Conversations | Sourcing | "Start a sourcing request" in a chat | The request opens in Sourcing with the chat attached; the chat shows a link to it |
| Conversations | Disputes | "Open a dispute" in a chat | A dispute case with the chat attached |
| Conversations | Member support | Member asks for a consultation, tour or refund | "Book" or "Send to Member support" with a note |
| Sourcing | Fulfillment | The order invoice is paid (automatic today) | The item moves; Fulfillment sees where it came from |
| Sourcing | Store team | A trend or request worth listing | "Suggest as a listing / find" |
| Fulfillment | Disputes / Member support | Damaged, missing, refund | "Open a dispute" / "Ask for a refund" on the item |
| Any desk | Any desk | Work that belongs elsewhere | Transfer (exists today, folded away) becomes a visible "Send to…" with a reason |

Every hand-off keeps the history and shows "Came from Conversations · by Ada · 2 h ago" at the top of the item.

### 2.5 Onboarding

- The Guide tab is grouped by desk: each desk's page shows its pipeline, its work types (the existing explanations),
  its tool cards and its hand-offs.
- A worker's first visit shows a short tour of their own desks only.
- The first-week checklist is filtered to the worker's departments.

## 3. Build phases (after review)

| # | Phase | Contents |
| --- | --- | --- |
| R1 | Access and menu | Hide the pages from workers (menu and server), Verification into Website, workers land in Operations, availability into the shift bar |
| R2 | Desk shell | Left rail, My work, desk header and pipeline strip, desk-filtered lists, the tool-card pattern with "Open full page" |
| R3 | Conversations desk | One inbox across channels and the member app, three panes, customer card, Answers, Requests, hand-offs from a chat |
| R4 | Sourcing and Fulfillment | Trends and group buys, Deposits due, Batches, Directory search; Orders card; pipeline strips |
| R5 | Member support and Disputes | Bookings and Tours moved in, Invoices and Giveaways cards, the dispute case file |
| R6 | Store team | Products, Campaigns and Next drop on its desk |
| R7 | Guide and onboarding | Guide by desk, first-visit tour per desk, checklist by department, screenshots and this document |

Each phase: tests, screenshots at phone, iPad and desktop, guide text, and an update here.

## 4. Owner decisions (2026-10-26)

1. Workers land straight in the Operations Center; their Control Center keeps only My account. **Yes.**
2. Channels & Connections, Directory & Tools, Analytics, Settings and Overview are hidden from workers too. **Yes.**
3. Bookings and Tours go under Member support, and the CEO's assistant sees the Bookings desk. **Yes.**
4. A left rail of desks (a top menu on phones). **Yes.**
5. **One account only.** FayFort is its own client and won't open client accounts. "FayFort International"
   (b16f5070…) is the live account: it holds the knowledge, conversations, automations, the Instagram connection and the
   AI usage, and it was renamed from "FayFort Test Business". The older, empty "FayFort International" (32aff5ae…) was
   renamed "FayFort International (old, unused)" and switched off; the Control Center lists active accounts only. Its
   leftover rows (event tickets, one test-channel chat, one knowledge doc) can be deleted by the owner with the SQL in
   the R1 hand-over.

## 5. R1 build notes (access and menu)

- **Server:** `app/admin_pages.py` is a middleware that answers 403 "Only a FayFort administrator can open this page."
  to anyone signed in who isn't a platform administrator, on every method, for a business's automations, connections,
  entitlements, verification, analytics, ai-usage, settings, channels, channel-deliveries, directory tools and
  products, knowledge, faqs and handoffs/agents. Workers are "admin" business members, so per-endpoint role checks
  didn't keep them out. Requests with no sign-in still reach the endpoint and get its own 401. Worker pages (handoffs,
  handoff availability, conversations, requests, the Operations APIs) are untouched; no Operations screen calls the
  guarded pages.
- **Control Center:** workers see no Workspace, Operations or Manage groups, only the Operations Center link and My
  account; any other page sends them to /operations. `/?page=account` opens My account. The client-account picker is
  hidden when there is one account.
- **Verification** moved from the Operations group into Website (below Website chat), for administrators.
- **Operations header (workers):** "My account" replaces "← Control Center", and a **chat availability** switch sits
  next to the shift clock: Take chats for 8 hours · Away from chats · Not taking chats (the same setting as Human
  agents → Your availability, which workers no longer open).
- Tests: `tests/test_admin_pages.py`, knowledge tests sign in as a platform admin, App.test worker navigation,
  `ChatAvailability.test.tsx`, e2e `ops-worker-header.spec.ts` (phone and laptop, no sideways scroll).
