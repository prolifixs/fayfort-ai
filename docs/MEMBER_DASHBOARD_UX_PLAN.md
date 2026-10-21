# Member dashboard: archive, tour, Orders & requests, product chat, plans (plan for review)

Status: built 2026-10-18, waiting for push. The owner took every recommendation (section 7). Section 8 lists what was built.

## 1. Retained chats: clear them from the list, keep the record

**How it works today**
- When a chat creates or is linked to a sourcing request, it is marked *retained* (`retention_hold`, reason
  `member_purchase_request_submitted`). From then on:
  - the chat is read-only: no composer and no chat tools;
  - it can't be deleted, by the member or by the 30-day clean-up;
  - it stays in the sidebar forever as "Request linked · retained", even after the goods are delivered.
- Staff see the same chat in Operations, and it is the record for disputes and refunds. That record must stay.

**Plan: an Archive**
- **Archive, not delete.** Retained chats get an Archive action in the place of Delete. Archived chats leave the sidebar,
  but nothing is removed from the database. Staff still see everything.
- **Automatic archive.** When the linked request is Delivered or Cancelled, its chat archives itself after 3 days. The
  member also gets a notice: "Your chat for <request> moved to Archive."
- **Where the archive lives**:
  - a quiet "Archive (n)" link at the bottom of the chat list;
  - "View chat" on each request in Orders & requests.
- **Archived chats** open read-only, with "Delivered 12 Oct · archived 15 Oct" at the top, and can be moved back to the
  list. Normal chats (no request) keep today's Delete.
- **Search** in the archive by title or request name.
- **Technical**:
  - `member_conversations.archived_at`;
  - the archive runs from the request status change (database function plus a daily job for the 3-day delay);
  - `GET /members/conversations?archived=1`, and archive / unarchive endpoints;
  - nothing ever deletes a retained chat.

## 2. Tour: explain the chat tools (the red-circled icons)

The four icons under the message box are the most important actions, and the tour skips them:

| Icon | What it does today |
| --- | --- |
| Clipboard with link | **Paste a link**: pastes a TikTok, Instagram or shop link from the clipboard and finds that product |
| Picture | **Ask a person to review a photo**: send a product photo and a FayFort person says what it is and if we can source it |
| Bag with + | **Create a sourcing request**: the form that starts a request (what, how many, budget) |
| Chain link | **Link an existing request**: attach this chat to a request you already made (only shown once you have requests) |

**Plan**
- The tour gets a "Chat tools" part with one step per icon. Each step highlights that icon and gives one sentence on
  what it does and when to use it. The link step still shows when the member has no requests, with "appears once you
  have a request".
- The icons themselves:
  - On desktop, a label appears on hover.
  - On phones, a long press shows the label.
  - For a member's first 3 visits, a small text row under the icons reads "Link · Photo · Request · Attach".
- The tour also covers the new pieces below: Archive (section 1) and "Ask about this product" (section 4).
- The tour can be replayed from the account menu ("Show me around").

## 3. Orders & requests: one clear place, nothing missed

**Today** one long page shows, in order:
1. invoices to pay;
2. shop orders;
3. every sourcing request, each with its full eight-step tracker, description, history and "Cancel request";
4. recurring schedules with "Schedule updates".

Everything is open at once, so the item that needs the member gets lost.

**Plan**
1. **"Needs you" at the top**: only items waiting for the member, each with one button.
   - Pay invoice · Choose an option (quote ready) · Add a delivery address · Reply to the team.
   - When nothing is waiting: "Nothing needs you right now."
2. **Three tabs**:
   - **In progress**: open requests and orders, with the newest change first.
   - **Completed**: delivered, cancelled and paid.
   - **Recurring**: schedules.
   - Each tab shows a count, and there is one search box by name.
3. **Compact cards**: a status pill and a short progress bar (8 dots) per card.
   - Each card shows the title and one line, "What happens next", in plain words. Example: "We're comparing suppliers.
     You'll get options by 14 Oct."
   - There is one main button.
   - Tapping the card opens the detail, where the full tracker, the history, the description, "View chat" and "Cancel
     request" now live.
4. **Plain wording**, used everywhere, including emails:

   | Stage | Status on the card |
   | --- | --- |
   | Request received | "We have your request" |
   | Under review | "Checking the details" |
   | Sourcing | "Finding suppliers" |
   | At FayFort warehouse | "At our warehouse, being checked" |
   | Shipped / In transit / Out for delivery | "On its way" (with the step) |
   | Delivered | "Delivered" |

   The notes for staff (for example "[SYNTHETIC ACCEPTANCE TEST]") never show to members.
5. **Shop orders and invoices** go into the same cards with a small "Shop order" or "Sourcing" label, so there is one
   list, not three.

## 4. Ask about a product from the product page

**Today** a product opens on the left and the chat stays on the right, but the chat doesn't know which product the
member is looking at.

**Plan**
- **Product reference.** On a product page the chat shows a small card above the message box: "Asking about: FayFort
  test item · $1.00 ×".
  - Messages sent with it carry the product. The AI gets that product's details (name, price, stock, description,
    options), so "is this available in black?" just works.
  - The message shows the product as a small card, and tapping the card opens the product again.
- **Choosing the chat.**
  - **Phone (Pinterest style).** The product page has a round **Ask** button. It opens a bottom sheet like Pinterest's
    "Save to board":
    - "New chat" first, then the 5 most recent chats, each with its title and last message;
    - tapping one opens it with the product attached;
    - retained or archived chats aren't offered, because they're read-only.
  - **Desktop.** The chat is already open beside the product, so the product card above the message box has a small
    "Send to: This chat ▾" menu. The menu offers New chat and the recent chats, and shows the current chat by default.
    There is also an "Ask in chat" button next to Add to cart, which focuses the message box with the product
    attached.
- **The first time a member opens a product**, a one-step tip points to Ask (phone) or the product card (desktop). The
  main tour gets the same step.
- **Technical**:
  - `member_messages.product_ref`;
  - the send endpoint accepts `product_id`, and the AI prompt adds a "Product the member is asking about" block from
    the catalog;
  - the history returns the product card.

## 5. Member tier pop-up: no plans in it; plans live in Settings

- **The tier pop-up** keeps only rank, sub-rank, points, progress to the next rank and what's unlocked. The plan
  comparison table (deposit, consultation, supplier contacts) is removed from it.
- **Settings → Account** gets a full **Plan** section:
  - the current plan;
  - the comparison table (Free / Standard / Pro);
  - the change-plan button, once billing is switched on;
  - a "Plan" link in the account menu leads to it.
- **"See plans" links** (the "Go ad-free with Standard" ad, the tier pop-up, `/member/membership`) all open Settings →
  Plan.

## 6. Suggested batches

1. **Tier and plans move**, and **tour chat-tools steps** (small, no database change).
2. **Orders & requests restructure**, with the plain wording and the "Needs you" box.
3. **Archive** (database change and daily job).
4. **Product reference in chat** (database and AI change, mobile sheet, desktop menu, tour steps).

Each batch gets tests and screenshots at phone, iPad, laptop and desktop.

## 7. Decisions (owner, 2026-10-17: "proceed with all your recommendations")

1. **Auto-archive**: 3 days after Delivered or Cancelled, and members can also archive by hand.
2. **Orders tabs**: by stage: In progress / Completed / Recurring.
3. **Product chat on phones**: Pinterest-style bottom sheet.
4. **Chat icons**: text labels under them for a member's first 3 visits, plus the tour steps.

## 8. What was built (2026-10-18)

- **Plans → Settings**:
  - The tier pop-up shows rank, points, progress and perks, then "Your plan: X · Plans and perks in Settings".
  - Settings now opens with a **Plan** section: the comparison, upgrade or billing, and the consultation and
    supplier-contact perks.
  - The "Go ad-free" ad, the return from checkout and every "See plans" link open Settings at Plan.
- **Tour and chat tools**:
  - `member/chatTools.tsx` shares the four icons between the toolbar and the tour.
  - The tour adds "Your chat tools" and one step per tool, each with the tool's own icon. It also adds an Archive
    step and an "Ask about a product" step, and its chats step explains auto-archive.
  - The tools show their names on hover (desktop) and on a long press (phone); a long press doesn't also open the tool.
  - Names show under the icons for the first 3 visits.
  - The account menu has "Show me around" to replay the tour.
- **Orders & requests**:
  - "New request" opens the form only when asked.
  - **Needs you** collects invoices to pay, a missing address, questions from the team and options to choose. Each
    item has one button, and "Answer" or "Choose an option" opens that request.
  - The tabs are In progress, Completed and Recurring, each with a count and a name search. Shipped or cancelled shop
    orders go to Completed.
  - Compact cards show a "Sourcing request" or "Shop order" label, the title, a plain status pill, one line on what
    happens next, 8 progress dots and the arrival estimate. Details opens the full tracker, the answer form, the
    options, the history, "View chat" and Cancel.
  - Plain wording comes from `memberStageText` in `requests/requestShared.tsx`. Test tags like "[SYNTHETIC
    ACCEPTANCE]" are hidden from members.
  - Links ending in `#request-<id>` open that request.
  - The older /member/products page keeps the full layout.
- **Archive**:
  - Migration `20261018100000_member_chat_archive.sql` adds:
    - `archived_at`, `archived_by` and `unarchived_at` on `member_conversations`;
    - `archive_finished_member_chats()`, which archives chats 3 days after delivered or cancelled, skips chats the
      member moved back, and never deletes;
    - the hourly pg_cron job `member-chat-archive`.
  - API: `GET /members/conversations` leaves archived chats out and returns `archived_count`;
    `?archived=true` lists them. `POST …/archive` and `…/unarchive` work only for chats kept with a request.
    `/members/requests` returns each request's `conversation_id`.
  - Chat list:
    - chats kept with a request offer "Archive chat" in place of Delete;
    - "Archive (n)" opens the archived list, and "← Chats" goes back;
    - "N finished chats moved to Archive." shows until the Archive is opened;
    - an archived chat shows "Archived … · kept as your record" with "Move back to chats";
    - "View chat" on a request opens its chat, even from the Archive.
- **Ask about a product**:
  - Migration `20261018110000_member_chat_product_ref.sql` adds `member_messages.product_ref`.
  - The send endpoint takes `product_id`. Only an active catalog product is used. The AI prompt gets "The member is
    looking at this product", with its name, price, stock and details, and the answer check uses those facts too. The
    history returns the product card.
  - **Desktop**:
    - opening a product attaches it above the message box ("Asking about …", with price and ×);
    - "Send to: <chat> ▾" offers + New chat and the 5 most recent open chats;
    - "Ask in chat" sits next to Add to cart.
  - **Phone**: a round Ask button opens a Pinterest-style sheet, with New chat first and then the recent open chats.
    Chats kept with a request or archived are never offered.
  - A member's message shows "Asked about" with the product card, which reopens the product.
  - The first product a member opens shows a one-time tip.
- **Tests**:
  - API: 606 pass, including the archive endpoints and product reference.
  - Dashboard: 150 pass, including Orders hub, Archive, product chat on desktop and phone, the plan move and the tour.
  - Layout: 7 new checks at phone, laptop and desktop (`tests/e2e/member-features.spec.ts`), and all member and staff
    layout checks pass.
  - Both migrations were applied twice on PostgreSQL 16. The archive rules were checked there: delivered more than 3
    days ago is archived; recent, in progress, moved back and ordinary chats are not.

## Name card, empty chats, theme tries (owner rules, 2026-10-19)

- **Name, surname and username are required.** A member without all three sees "Tell us who you are" over the app until they save them; it can't be closed (only "Not you? Sign out"). First name and surname come prefilled from Google when available; the username is checked as they type (3 to 20 characters: lowercase letters, numbers, dots, underscores; unique; FayFort-like names reserved). Saving also sets the display name staff see ("First Surname"). They can change them later in Settings → Your name. The welcome tour waits until the card is done. API: `GET/PUT /members/me/identity`, `GET /members/me/username?u=` (`app/accounts/member_identity.py`); columns `member_profiles.first_name/last_name/username` (migration `20261019160000_member_identity.sql`).
- **Empty chats are removed.** A chat nobody has written in isn't listed, and it's deleted when the member moves to another chat. The server also clears any left behind when the chat list loads (never the chat open on screen, one made in the last two minutes, or one kept with a request).
- **Theme tries:** each try-on lasts 15 seconds and every member gets 3 an hour. The server counts them (`member_theme_tries`, migration `20261019170000_theme_tries.sql`) and only gives the full-app design while a try is running, so reloading or another browser can't reset it. The chooser shows "2 of 3 tries left this hour" and, when they're used, the time of the next try.

## Theme patterns: Ankara and Ghana Must Go (owner request, 2026-10-20)

Themes can carry a pattern (`member_theme_revisions.pattern`, `pattern_strength`, migration 20261021090000), set in Theme Studio (Pattern, Pattern strength). The tiles are original vector drawings in `dashboard/src/app/themePatterns.ts` (Kente-style Ankara: stepped triangles, striped and dotted strips; Ghana Must Go: woven white with checkered black bands and red lines).
Placement is fixed so screens stay readable: a band under the top bar, the sidebar header behind the logo (the logo sits on a solid chip), a ribbon above the chat welcome heading and the left edge of plan and tool cards. Never behind chat messages, product grids or forms. "Bold" makes the band and ribbon larger.
Two published Standard/Pro themes (migration 20261021091000): **Ankara** (cream, orange accent, Montserrat) and **Ghana Must Go** (white, red accent, DM Sans), both with a bold pattern and AA contrast.
