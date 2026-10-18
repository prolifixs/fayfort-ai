# Operations Center plan: archive, step-by-step work, how-to guides and Shopify work

Status: approved 2026-10-16 and built. Decisions: archive shows 30 days by default and admins can reopen; staff pack shop orders (Fulfillment work); group buys and giveaways are work items; photo reviews and member requests moved into the Operations Center; guides are in-app; order of work archive, steps and guides, then outside work.

## What was built

- Archive tab: finished work, search, 30 or 90 days or any time, read-only, admin Reopen with a reason.
- Steps bar and a Do now card on every work type, with the how-to behind a button (always open in first-week mode).
- Guide tab: one guide per work type, department summaries and a glossary; a ? button opens the same guide in a side sheet.
- New work items that open and close themselves: store_order (shop orders to pack), group_buy, giveaway_draw, giveaway_prize, photo_review, billing_issue, invoice_failed. A background sweep every 10 minutes runs due recurring orders, ended giveaways and failing subscriptions.
- Member request flow: members answer "your input is needed" from their dashboard; choosing an option brings the work back with "Send the invoice"; deposit and final invoice are sent from the work item; a paid invoice confirms the purchase from any open sourcing stage.
- Worker Member Requests page and /worker/member-reviews now point to the Operations Center. The admin assignment view stays.
- Migration: supabase/migrations/20261017100000_operations_flow.sql.

## Deadlines, delivery estimates and cancelling (added 2026-10-16)

- Every task has a deadline: 24 hours from when it opens unless one is set. Queue cards start green and turn amber then red as the deadline nears; past it they are red with the time overdue ("Overdue 3h 20m"). Each department's list puts the closest deadline first.
- A member request must be reviewed within 24 hours and needs a delivery estimate (ETA) before it can move to Sourcing. The ETA becomes the task deadline and shows on the member's request.
- Changing an ETA or any deadline needs a reason. The member sees the new date and the reason; every change is kept in the task history and the request's ETA history.
- Members can cancel a request until it is paid (submitted, under review, sourcing, needs input, options sent). Unpaid invoices are cancelled and their Shopify draft orders deleted. If Shopify refuses, staff get a "Delete a cancelled invoice" task. If an old link is paid anyway, staff get an urgent "Refund" task.
- Migration: supabase/migrations/20261017110000_deadlines_eta_and_cancel.sql (existing live tasks with no deadline get created time + 24 hours, or the request's ETA).

## Store team, Products, Schedule (added 2026-10-18, docs/CATALOG_MERCHANDISING_PLAN.md)

- A sixth department, **Store team**, for catalog work: listing store products and sourcing items, choosing categories,
  retiring listings, refreshing store sections and preparing giveaways and flash sales.
- New tabs: **Products** (Store team and administrators) and **Schedule** (everyone).
- The Guide has a guide per Store team work type, a Tools section (Products workspace, store sections, Schedule) and
  new glossary words.
- Migrations: `20261019100000_store_team.sql`, `20261019110000_store_sections.sql`, `20261019120000_campaigns.sql`.

## Known gaps (not code)

- A member who already paid a deposit cannot cancel from the dashboard; they are told to message us in chat.
- Directory contacts: none loaded yet.

## 1. What happens today

**Where work comes from.** Work items are created by the system. Each one has a department (Conversation intake, Sourcing, Fulfillment, Disputes, Member support), a work type and a status (open, claimed, waiting, blocked, completed, cancelled).

| Work type | Created when | How it moves |
| --- | --- | --- |
| Member request (sourcing) | A member submits a sourcing request | Request milestones move it. Submitted → under review → sourcing → (needs member input) → options sent → purchase confirmed. Payment of the FayFort invoice moves it to Fulfillment by itself |
| Fulfillment of a request | The request reaches "purchase confirmed" | Item in warehouse → shipped → in transit → out for delivery → delivered |
| Member chat support / consultation | A member asks for a person, or books a consultation | Reply → wait for member → complete |
| Business handoff | The AI hands an Instagram/Messenger customer to a person | Claim → reply → return to automation |
| Dispute case | A worker opens one from a request | Investigating → awaiting member/supplier → resolved → closed |

**What's not working well.**
- **Completed and cancelled items stay in the queue.** The list also stops at 200 items, so finished work slowly pushes live work out.
- **The detail panel is one long column of forms.** Status, next action, transfer, checklist, notes, candidates, fulfillment, dispute and chat are stacked in a fixed order. Nothing says which step the item is on, what to do now, or what "done" means. New workers have to learn it by trial.
- **No explanation anywhere.** Nothing explains what a Checklist, Note, Transfer, Claim or "Waiting on" is for.
- **Some staff work lives outside the Operations Center:**
  - Deposits due and sending invoices sit under Control Center → Shop (admin only).
  - Member photo reviews have their own page.
  - Member Requests is another separate page.
  - Group-buy pools, giveaway draws and paid store orders have no work item at all.

## 2. Does Shopify need operations? Yes, five places

Shopify holds the products, checkout and orders, but several moments need a person and nothing tells anyone today.

| Shopify moment | Today | Proposed |
| --- | --- | --- |
| A member buys an in-stock item in the shop (storefront order paid) | Recorded, but no one is told to pack and ship it | New **Store order** work item in Fulfillment. It closes by itself when Shopify marks the order fulfilled. Link out to the order in Shopify admin for labels |
| Sourcing deposit due (Free 50%, Standard 25%) | A list under Shop → Invoices (admin only) | A **Deposit** step inside the sourcing work item with a "Send deposit invoice" button |
| Final invoice for the chosen option | Sent from Shop → Invoices | An **Invoice** step in the same sourcing item. Payment already moves the item to Fulfillment |
| Group-buy pool reaches its target | Visible only in Shop → Trend queue | New **Group buy** work item in Sourcing: confirm the supplier price → send invoices to everyone who wanted it → track payments → hand to Fulfillment |
| Giveaway ends | An admin has to remember to draw | New **Giveaway draw** item. After the draw, a **Prize shipment** item in Fulfillment |

Smaller ones:
- A Shopify invoice that failed to send becomes an alert item.
- Products synced from Shopify with no category become a low-priority "Map new products" item.
- A dispute that ends in a refund links to the Shopify order's refund page.

**Rule for what goes where:**
- **Operations Center = doing the work.** Anything a person must act on, in order, with a clear finish.
- **Control Center = setting things up.** Shop connection, flash sales, creating giveaways, themes, emails, infrastructure.
- **Links to outside sites** appear only on the step that needs them: Shopify order or refund page, carrier tracking, supplier page, Stripe for a billing dispute.

## 3. Fix plan

### Stage 1: Archive
- New **Archive** tab beside Queue, Team and Reports.
- Holds completed and cancelled items, newest first, with search (title, member, request) and a date range: 30 days by default, 90 days or everything.
- Workers see their own; admins see all.
- Items are read-only with their full history. Admins can **Reopen** (it goes back to the queue with a reason, audited).
- The Queue then shows only open, claimed, waiting and blocked work.
- API: the list endpoint gets an active/archived switch, paging and search (small change, no data moved).

### Stage 2: Step-by-step work items (the playbooks)
Every work type gets a fixed, numbered path shown as a progress bar at the top of the item. The current step is highlighted, and the step is worked out from the real data (request stage, candidates, invoice paid, handoff status). Under it, one **"Do now"** card shows only the current step: what it is, how to do it, the action buttons, and "Done when…". Everything else (chat, request details, checklist, notes, history, transfer) sits below in collapsible sections, in the same order on every item.

| Work type | Steps |
| --- | --- |
| Sourcing request | 1 Review → 2 Ask for missing details (only if needed) → 3 Find options → 4 Share options → 5 Deposit (if their plan needs one) → 6 Invoice → 7 Paid, handed to Fulfillment |
| Fulfillment | 1 Purchase confirmed → 2 In warehouse (photo) → 3 Shipped (carrier and tracking) → 4 In transit → 5 Out for delivery → 6 Delivered |
| Store order (new) | 1 Paid → 2 Pack → 3 Fulfil in Shopify (link) → 4 Delivered (closes by itself) |
| Group buy (new) | 1 Target reached → 2 Confirm supplier price → 3 Send invoices → 4 Payments in → 5 Hand to Fulfillment |
| Member chat / consultation | 1 Read the chat → 2 Reply (agree a time for consultations) → 3 Wait for member → 4 Resolve, or turn into a sourcing request → 5 Complete |
| Customer handoff (business) | 1 Claim → 2 Reply to the customer → 3 Return to automation or close |
| Dispute | 1 Open → 2 Investigate (evidence) → 3 Waiting on member or supplier → 4 Decide (refund, replace or reject, with Shopify refund link) → 5 Close |
| Photo review (moved in) | 1 Look at the photo → 2 Reply with matching products → 3 Done |
| Giveaway draw (new) | 1 Giveaway ended → 2 Draw winners → 3 Notify → 4 Prize shipment created |

The queue list also gets easier to scan:
- Grouped by department, with counts.
- Sorted by "needs you now": your claimed items first, then overdue, then newest.
- Each card shows its step, for example "Step 3 of 7 · Find options".

### Stage 3: How-to guides
- **Guide tab:** one page per department and work type. It covers the purpose, who does it, the steps with screenshots-style examples, "done when", common mistakes, and when to transfer or escalate.
- **Glossary of every element:**
  - Claim and claim lease, priority, due date, "waiting on"
  - Checklist, internal notes and @mentions
  - Transfer, work history, return to automation
  - Statuses
  - Each says why the element exists.
- **Inline help:** a small "?" on each section of a work item opens that section's guide in a side sheet without leaving the item.
- **First-week mode** (optional per worker): the "Do now" card shows the full how-to text until they turn it off.
- Guides ship as content in the app, written by me from how the system actually works, so you can edit the wording later.

### Stage 4: Bring the outside staff work in
- **Photo reviews** become a work type in Member support. The separate page redirects to the Operations Center.
- **Member Requests** (Control Center): the worker view moves into the Operations Center queue. The admin assignment view becomes the Team tab's "assign" action.
- **New work items** for store orders, group-buy pools, giveaway draws, failed invoices and unmapped products. They're created by the API when the event happens (webhook or loop) and close by themselves when the outside event finishes.
- **Deposit and invoice buttons** move from Shop → Invoices into the sourcing steps. Shop keeps a read-only invoice list for admins.

### Stage 5: QA
- Unit tests for the step logic of each work type.
- API tests for archive, paging and the new work items.
- Layout tests for queue, item and guide at phone, iPad and desktop.

## 4. Decisions needed

1. **Archive contents.** Completed and cancelled items, 30 days shown by default with search going back further? Admins can reopen with a reason?
2. **Store orders.** Who packs and ships in-stock shop orders: FayFort staff (then they become Fulfillment work items), or Shopify, a supplier or a 3PL (then just a notice)?
3. **Group buys and giveaways.** Should they become work items as proposed?
4. **Moving pages in.** Fold photo reviews and the Member Requests page into the Operations Center?
5. **Guides.** Written by me as in-app content first, with editing in the app later if you want it?
6. **Order of work.** Archive plus playbooks plus guides first (front-end plus one small API change), then the Shopify and moved-in work items (API plus database)?
