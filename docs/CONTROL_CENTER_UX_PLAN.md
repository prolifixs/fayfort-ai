# Control Center UX review and fix plan

Status: approved and built 2026-10-15 (all stages, see section 6). Scope: the staff Control Center (all 21 sidebar pages) and the
Operations Center, checked at phone (390px), iPad (820px), laptop (1280px) and desktop (1536px) with realistic test
data, plus a read of the code behind each page.

## 1. Root causes (they explain most of what looks off)

| # | Problem | Where it shows |
| --- | --- | --- |
| R1 | **No phone layout.** Below 720px the sidebar becomes one row of 21 buttons that never wraps, so the page is about 2,590px wide and the content starts off-screen to the right | Every page on a phone is unusable |
| R2 | **Page-wide `article` rule** (max 1200px, centred, 32px padding) hits every `<article>` inside pages | Message cards, request cards and customer-history cards shrink and sit centred at random widths |
| R3 | **List rows are plain buttons** with the browser's centred text, fixed heights and an 11px title | Conversation and customer lists look like tall grey boxes with centred text |
| R4 | **Unstyled controls.** Refresh, Mark as seen, filter dropdowns, status dropdowns, Settings fields and reply boxes use the browser's default look, so heights and fonts don't match | Most pages |
| R5 | **Text runs together.** Small labels sit side by side with no spacing | "Order_inquiry · Awaiting_customerRequest rq1Missing: delivery_address", "6:06:38 PMDelivery: sent" |
| R6 | **31 broken characters (�)** where "·", "–" and "…" were lost | Conversations, Human Agents, Directory, Verification, Settings, the top bar |
| R7 | **Raw system values on screen**: snake_case statuses, JSON blobs, internal IDs | "awaiting_customer", "human_agent", "not_enough_history", "Member conversation mc1", worker names shown as user IDs |
| R8 | **Internal build wording** shown to staff | "Layer 7 build" badge on every page; "Layer 5", "Layer 6", "Sixth Directory & Tools list" in descriptions |
| R9 | **Nav icons are first letters** (three "C"s, two each of "A", "S", "R", "O") | Sidebar |
| R10 | **Small tap targets**: 14 to 16 controls per page under 32px tall | Request actions, queue buttons, pagination |
| R11 | **One bad API field blanks the whole app** (white screen, no error message) | Seen on Operations reports, Verification, Analytics, Emails and Infrastructure when a field was missing |

## 2. Chats (the main problem area)

There are three separate chat views for staff. Each is built differently, and none behaves like a chat.

### Conversations page (business customer chats)
- Messages aren't laid out as a chat. Short messages shrink to a small centred card, long ones fill the width (R2). Customer and agent messages look the same and sit on no consistent side.
- Sender labels are raw: "Customer", "Agent", "Human_agent". You can't tell AI replies from staff replies.
- The message box has its own 520px scroll inside a page that also scrolls. It opens at the oldest message, so the newest one is hidden.
- Delivery status, time and "Retry rejected delivery" are squeezed onto one line.
- Customer link, related requests and handoff status are stacked above the messages and push the chat down. The handoff line is unformatted and has broken characters.
- The list rows are tall, centred and grey. There's no message preview hierarchy and no unread or handoff marker, and the pager reads "Showing 1�4+".
- On iPad and phone the list and the messages stack. Picking a conversation doesn't take you to its messages; you have to scroll past the whole list.
- There's no reply box. To answer one customer, staff jump between Conversations, Human Agents and the Operations Center.

### Human Agents (handoff queue)
- The status line and reason run together ("active � Customer asked about split payment").
- The reply is a one-line input next to "Send reply". There's no message thread in the card, and "View history" shows handoff events, not messages.
- The availability dropdown is a small default control next to a tall input. The filter labels run into their dropdowns.

### Operations Center (member and business chats)
- **The sides are mixed up.** In business chats only `agent` (staff) messages went on the FayFort side, so AI replies (`ai`) landed on the customer's side. Staff (`worker`) messages in member chats had no styling at all.
- The reply form is crammed onto one row: label, a 200px text box, the button and the help text.
- The conversation is capped at 26rem inside the page scroll. At laptop size the business chat is cut off at the bottom of its card.
- The queue and the chat sit below about 1,400px of Workforce and Reports panels. On a phone the open item is more than 4,000px down the page. The detail panel doesn't stay in view while you scroll the queue.
- On a phone the internal-notes box shrinks to a narrow column, and the checklist shows bullet dots next to its checkboxes.
- Headings show IDs: "Member conversation mc1", "Human handoff h1".

## 3. Other pages

| Page | Issues |
| --- | --- |
| Top bar | "Mark as seen" is a default button. On iPad the handoff alert and breadcrumb wrap onto two lines |
| Overview | No live numbers. It's a grid of module cards that repeats the sidebar, with "Layer" wording |
| Customers | List cards are about 230px tall with centred text (R3). History and request cards are centred (R2) and their text runs together (R5) |
| Requests | Cards are centred at different widths (R2). Details are shown as raw JSON. Status and type are snake_case. Default dropdowns and oversized "Correct request information" toggles |
| Directory & Tools | Default Refresh button; "Sixth Directory & Tools list" and "Layer 6" wording |
| Channels / Connections | Both pages show the same "Channel connections" block. The Channels page then says provider setup "is not available here yet", contradicting the block above it. The provider dropdown is short next to a tall input |
| Automations, Knowledge, Entitlements, Verification | Default Refresh buttons; dropdowns and text boxes of different heights in the create forms; long descriptions in internal wording |
| Settings | Labels sit beside their fields on one line and the description box floats. "Created" and "Updated" are blank when data is missing |
| Shop, Theme Studio, My account | Mostly fine. Theme Studio's catalog column is an empty box when there are no themes. My account mixes heading sizes |
| Analytics, Emails, Infrastructure | These blanked the app when a test-data field was missing (R11). I'll re-check them with real data during the fix |
| Member Requests, FayFort Workers | These didn't load with my test data. I'll check them with real data during the fix |

## 4. Fix plan (staged, front-end only, no API changes)

| Stage | What | Result |
| --- | --- | --- |
| 1. Shell | Same shell as the member app: desktop sidebar with grouped nav and real icons; below 1024px a drawer with a menu button; top bar with page title, client-account switcher, handoff alert and notifications; one page container; drop the "Layer" badge | Works on phone and iPad; no sideways scroll |
| 2. Building blocks | Remove the page-wide `article`/`header` rules and use a page-container class instead. Shared styled buttons, labelled fields (label above), dropdowns, filter toolbar, left-aligned list rows (title, meta, preview, badge), status badges with readable labels, key/value rows, empty states. Fix the 31 broken characters. Hide internal IDs behind a small "Copy ID". 40px tap targets. A per-page error message instead of a white screen | Consistent look; no run-together text; no raw values |
| 3. One staff chat thread | One thread component used by Conversations, Human Agents and the Operations Center. Customer or member on the left; AI assistant and staff on the right with distinct labels ("AI assistant", "Ada · FayFort"); day separators; delivery status and Retry as a small line under the bubble; opens at the newest message; one scroll area that fills the panel; reply box docked at the bottom (grows with text, Enter sends) wherever the staff member may reply | Every staff chat reads the same way, and the same way as the member app |
| 4. Conversations as an inbox | Desktop: list, thread and a collapsible context column (customer, requests, handoff). iPad: list plus thread. Phone: list, then thread with a back button. List rows show name, channel, last message, time and a status or handoff badge. Filters in a compact toolbar | Works like a messaging inbox |
| 5. Human Agents and Operations Center | Queue cards open the full thread with the docked reply box. Operations Center puts the queue first: list and detail side by side, detail stays in view with its own scroll; Workforce and Reports move to tabs (Queue, Team, Reports); reply and notes forms stacked properly | The work is at the top, not 1,400px down |
| 6. Remaining pages | Overview with live numbers from existing endpoints (open conversations, waiting handoffs, requests awaiting the customer, failed automation runs). Requests show details as readable fields, not JSON. Customers list rows. Settings form. Knowledge and Automations forms aligned. Channels and Connections de-duplicated | Every page tidy |
| 7. QA | Staff layout tests at the four sizes, like the member ones (the test data for this review is already written) | Regressions caught |

## 5. Decisions needed

1. **Reply from Conversations.** Show the reply box on the Conversations page when the handoff is active and assigned to you, so staff don't switch pages? (Recommended: yes. The same rules as Human Agents, no new permissions.)
2. **Overview.** Replace the module directory with live numbers? (Recommended: yes.)
3. **Channels vs Connections.** Merge into one Channels page, with connections at the top and inbound health below? (Recommended: yes.)
4. **Operations Center.** Queue first, with Workforce and Reports in tabs? (Recommended: yes.)
5. **Order of work.** Do stages 1 to 3 first, so the shell and chats are fixed in one release, then 4 to 7? (Recommended: yes.)

## 6. What was built (2026-10-15)

All five decisions were approved.

| Stage | Built |
| --- | --- |
| 1. Shell | `DashboardWorkspace` renders `.staff-app`: sticky sidebar with line icons (`staff/StaffChrome.tsx`), grouped nav, client-account picker, events status, My account and Sign out; below 1024px a drawer with a menu button, scrim, Escape and tap-outside to close; sticky top bar with breadcrumb and the handoff alert. "Layer" badge and internal wording removed |
| 2. Building blocks | `staff/staff.css` (loaded last): page container, panels, buttons, labelled fields, filter toolbars, left-aligned list rows, status pills, `ShortId` chips. The page-wide `article`/`header` rules are gone from `app.css`. 31 broken characters fixed. `PageErrorBoundary` shows a message instead of a white screen |
| 3. One chat thread | `staff/StaffChatThread.tsx` used by Conversations, Human Agents and both Operations Center chats: customer/member left, AI (green tint) and staff (solid green) right, day separators, delivery status and Retry under the bubble, opens at the newest message, docked reply box (grows, Enter sends) |
| 4. Conversations inbox | List, thread and a context column at 1280px+; list and thread from 1024px; list then thread with "← All conversations" below 1024px. Rows show name, time, channel, status and a two-line preview. Reply box appears when the handoff is active (posts to the handoff messages route) |
| 5. Human Agents and Operations Center | Queue cards open the full chat with the reply box. Operations Center has Queue, Team and Reports tabs (queue first); the detail stays in view; "← Back to the queue" and auto-scroll on smaller screens; notes and checklist forms stacked |
| 6. Remaining pages | Overview shows live numbers (open conversations, handoffs waiting, requests awaiting the customer, active requests, recent failed automation runs) plus recent activity and shortcuts. Requests show details as fields instead of JSON. Customers list and history tidied. Settings form stacked. Channels and Connections merged into "Channels & Connections" (old names still open it) |
| 7. QA | `tests/e2e/staff-layout.spec.ts` with `staff-fixtures.ts`: key pages at four sizes with a no-sideways-scroll check, chat sides, phone drawer, Operations Center tabs and chats |


## 7. Guidance, chats under Customers, Analytics charts (2026-10-19)

- **How this works:** every Control Center page and every Shop tab has a collapsible guide under its title (what the page is for, the usual steps in order, confusing words). It opens the first time someone visits the page, then stays closed until opened. Operations Center → Products and Schedule show their guides the same way. Text lives in `dashboard/src/app/staff/PageHelp.tsx` (`PAGE_GUIDES`).
- **What next:** records say what happens next and whose move it is (Next / Waiting / Fix / Done): giveaways (draft, scheduled, live, ended, drawn with prizes to arrange), flash sales, trend items and pools, invoices to send and failed ones, orders to pack, member plans without Stripe, requests, handoffs and reviews to check. Shop → Overview starts with "What needs you", linking to the right tab. The Operations queue says which work to pick first.
- **Product picker:** flash sales and giveaway prizes pick shop products by name instead of pasting ids.
- **Draw winners** only appears once a giveaway has ended.
- **Customers shows every chat:** Read chat opens the full thread on the customer's page (including chats the AI handled alone); Open in Conversations opens it there to request a takeover and reply, even when it isn't in the "needs a person" list.
- **Analytics:** headline tiles with change against the previous window, the AI budget meter, and charts (activity by group, new conversations by channel, handoffs, AI calls, AI calls by job, handoff outcomes, most common events), each with a table view. Data from `GET /businesses/{id}/analytics/charts` (`app/dashboard/analytics_charts.py`): daily for 7 and 30 days, weekly for 90, at most 10,000 rows per source. The event log and AI details stay underneath, folded.

## 8. Member theme fonts (2026-10-19)

Themes change the member dashboard only. Theme Studio has a Text font (FayFort standard, Poppins, Quicksand, Nunito, Montserrat, DM Sans, Playfair Display, Lora), loaded from Google Fonts when used, and three pink palettes (girl boss pink, blush rose, berry bold) that pass the contrast rules. Stored as `member_theme_revisions.font_family` (migration `20261019150000_theme_fonts.sql`); older revisions use the standard font.
