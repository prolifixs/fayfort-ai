# Store team department, store sections and the Schedule

Status: built 2026-10-18, waiting for push (section 9). Owner decisions:
1. Workers do catalog work. A worker prepares a product in FayFort, FayFort creates it as a **draft** in Shopify, and an admin publishes it.
2. The Schedule shows shop events **and** team deadlines and recurring orders.
3. Store sections look like AliExpress (themed tiles with a few products and a price hook).

## 1. Where things stand

- **Products are managed in three places, none of them in the Operations Center:**
  - Shopify admin: store products, copied into FayFort automatically.
  - Control Center → Shop (admin only): sync health, trend queue, invoices, flash sales, giveaways, category mapping, orders, plans.
  - Workspace → Directory & Tools → Products: the sourcing listing form, under the AI tool definitions. It has one photo, a required category and a label (Sourcing / Available / Unavailable), with no price guide or minimum order.
- **The Operations Center** has 5 departments (Conversation intake, Sourcing, Fulfillment, Disputes, Member support). Store orders, group buys and giveaway draws are already work items there. Catalog work (listing, refreshing, retiring) has no work item, owner or deadline.
- **Browse** has automatic rails only (Picked for you, Trending, Ending soon, Back in stock, Almost sourced, Under 25, Popular), then search and a grid. No person chooses what is featured. With 1 store product most rails are empty.
- **Giveaways** are created in Control Center → Shop. Members enter between start and end. When a giveaway ends, a "Draw winners" task opens. Winners get a 100% code by email, and "Arrange the prize" opens if a code fails. Nothing happens before the end, the prize isn't held back from stock, and nothing shows the giveaway ahead of time.
- **There is no schedule or calendar anywhere.** Deadlines live on each task, recurring orders on the member's schedule, and sales and giveaways only on the Shop page.
- **Already in place:** FayFort's Shopify app has `write_products`, and `create_draft_product` already creates Shopify drafts (used for "Publish sourced item"). Creating drafts from the new department needs **no new Shopify permission**.

## 2. The new department: Catalog & Merchandising

A sixth department in the Operations Center, staffed by workers. Admins see everything and publish. Each work type has steps, a "Do now" card, a deadline and a guide, like the other departments.

| Work type | Created when | Steps |
| --- | --- | --- |
| **List a store product** | A worker clicks "New store product", or a trend or sourced item is marked "sell it in the store" | 1 Details (title, description, category, options) → 2 Media (gallery, up to 10 images or videos) → 3 Price (price, compare-at, cost) → 4 Send to Shopify as draft → 5 Admin review and publish → 6 Live (closes itself when the synced product shows as active) |
| **List a sourcing item** | "New sourcing item", or a trend shared by 3+ members | 1 Details and category → 2 Media → 3 Price guide (from–to) and minimum order → 4 Admin review → 5 Live |
| **Refresh a store section** | A section's end date is 2 days away, or it has fewer live products than its minimum (an item sold out or was retired) | 1 Check the section → 2 Swap products (suggestions shown) → 3 Set the next dates → 4 Done |
| **Map new products** | A synced Shopify product has no category (already flagged today) | 1 Choose the category → 2 Saved (written back to Shopify) |
| **Retire a listing** | A sourcing item had no views or requests for 60 days, or a store product has been sold out for 30 days | 1 Review → 2 Retire or keep (with a reason) |
| **Prepare a campaign** | A giveaway or flash sale is scheduled (section 5) | 1 Prize or products ready → 2 Section and banner ready → 3 Announcement drafted → 4 Ready (before it starts) |

**Admin review.** Workers can never publish. "Send for review" puts the item in an admin's queue with a side-by-side preview of how the card and product page will look. The admin can **Publish** (store product: sets it Active in Shopify; sourcing item: makes it visible) or **Send back** with a note.

## 3. One Products workspace (replaces the Directory form)

Inside the department, a **Products** tab with three views:
- **Store**: every Shopify product with its state: draft, waiting for review, live, sold out, hidden. Actions: Edit (opens a FayFort edit item; the change goes to Shopify as an update for review), Open in Shopify, Retire.
- **Sourcing listings**: what the Directory form holds today, now with a gallery, price guide, minimum order, lead time and labels that can't look buyable ("Sourced on request", "Quick to source", "Not available now").
- **Store sections**: section 4.

The Directory & Tools page keeps only the AI tool definitions. Its Products form is replaced by a link to the new workspace. Existing sourcing listings move over unchanged.

## 4. Store sections (AliExpress style)

A section is a themed tile on Browse that a worker builds and changes on a schedule.

- **Fields:** title ("Dollar Deals"), hook ("3 from $0.99", "Up to 70% off", "New this week"), style (deal tile, trend tile, category tile), 3 to 12 products, start and end, priority, optional colour accent.
- **On Browse (member):**
  - At the top, a category bar (the 4 groups and top categories).
  - Below it, **section tiles side by side** (two on desktop, one wide per row on phones). Each tile shows its title, its hook as a pill, and 3 products with photo, price, crossed-out price and a "-40%" chip.
  - Tapping a tile opens the full section.
  - Then the automatic rails (unchanged), then an endless **"More to explore"** grid that stays inside the member's intent and categories.
- **Badges** on cards: "-40%", "Ships now", "Sourced on request", "Ending soon", "New". They're worked out from the data, never typed in by hand.
- **Rules:** a section with fewer live products than its minimum hides itself and opens a "Refresh a store section" task. Sold-out store products drop out automatically. Sourcing items can be in sections, with "Sourced on request" in place of a price.
- **Built-in sections** the system keeps filled: "Flash sale" (from the live sale), "Giveaway" (from the live giveaway), "New this week".

## 5. The Schedule

A new **Schedule** tab in the Operations Center, next to Queue, Archive and Guide.

- **Views:** week (default) and month on desktop, an agenda list on phones. "Today" is always one tap away.
- **What it shows**, colour-coded with filters:

| Type | Comes from |
| --- | --- |
| Giveaways: start, end, draw | `commerce_giveaways` |
| Flash sales and codes: start and end | `commerce_flash_sales` |
| Store sections: go live, end, refresh due | new `merch_sections` |
| Product launches: planned go-live date | the "List a store product" work item |
| Team deadlines: every open task's deadline | work items (overdue shown in red) |
| Recurring orders: next run | member recurring schedules |

- **Worker view:** their own deadlines and the events they're assigned to. **Admin view:** everything, with a filter by person and department.
- **Planning from the calendar:** an admin can click a day to schedule a giveaway, flash sale or section. Each one opens a "Prepare a campaign" task with a deadline before the start.
- Every entry opens the related task or setup page. The Schedule is a view, not a second place to edit.

## 6. Giveaways, start to finish

| Stage | When | What happens | Shows on the Schedule |
| --- | --- | --- | --- |
| 1 Plan | Admin creates it (Control Center or the Schedule) | Title, prize (a store product or a written prize), dates, winners, rules | Planned (grey) |
| 2 Prepare | Creation, deadline 1 day before start | **Prepare a campaign** task: hold back prize stock, check the Giveaway section, draft the announcement | Prepare by … |
| 3 Live | Start time | It opens by itself (no manual Open). Entry count updates on the task and the Schedule. The Giveaway section shows on Browse | Live (green) |
| 4 Draw | End time | The existing "Draw winners" task opens | Draw due |
| 5 Deliver | After the draw | Code by email (as today). Otherwise "Arrange the prize". A prize ordered with a code becomes a Fulfillment store order | Delivering |
| 6 Wrap up | All prizes delivered | Results (entries, new members, orders in the window) saved on the giveaway; the section ends | Done |

**Prize stock:** when the prize is a store product, FayFort keeps the number of winners out of what's shown as available until the draw. Shopify stock itself isn't changed.

## 7. Batches

1. **Department and Products workspace:** department, work types, review and publish, sourcing listings moved from Directory with the richer fields. (Database and API change.)
2. **Store sections and the new Browse:** sections, tiles, badges, category bar, "More to explore". (Database, API and member UI.)
3. **Schedule:** calendar views fed from every source above. (API and staff UI.)
4. **Campaigns and giveaways:** prepare tasks, automatic open, prize hold, wrap-up results. (Database, API and both UIs.)

Each batch gets tests and screenshots at phone, iPad, laptop and desktop, and the guides are updated.

## 8. Decisions (owner, 2026-10-18)

1. **Department name:** Store team.
2. **Retire rules:** 60 days with no interest for sourcing items, 30 days sold out for store products.
3. **Trends:** a "List a sourcing item" task opens when 3 or more members share the same trend.
4. **Order of batches:** as in section 7. Also: update the guides and every connected part of the system.

## 9. What was built (2026-10-18)

**Store team and Products**
- `store_team` is a sixth department everywhere: work items, worker access (Team tab), reports, the Guide.
- Products tab (Store team and administrators): Store, Sourcing, In progress and Sections lists, New store product,
  New sourcing item, and Edit on any product.
- Listing editor: details, category search over the 968 categories, one option (Size, Colour) with values, up to
  10 photos or videos (upload, link, reorder, remove), price, crossed-out price and cost with the margin, or for sourcing
  items a price guide, minimum order, lead time and availability; planned launch date; a live member preview.
- Send for review: a store product is created in Shopify as a DRAFT, the work item waits on an administrator, and
  every administrator gets an inbox notice. Publish sets it ACTIVE, tries to put it on every sales channel, refreshes the
  catalog and closes the work; Send back returns it to the worker with the note. A trend listing links to its trend.
- Retire: sourcing items idle 60 days, store products sold out 30 days. Keep needs a reason; retiring a store product
  is confirmed by an administrator and archives it in Shopify.
- Map product: synced Shopify products with no category become a task; mapping it in Control Center closes it too.
- The Directory & Tools product form is replaced by a link to Products.

**Store sections and Browse**
- Sections (3 to 12 live products, title, hook with Suggest, style, colour, priority, minimum, dates). Under the minimum
  it hides itself and opens a refresh task; two days before the end it opens one; saving it finishes the task.
- Browse: category bar, giveaway banner, AliExpress-style section tiles (hook pill, three products with discount
  chips and crossed-out prices), a sheet with the whole section, then the rails, then "More to explore" that keeps
  loading as you scroll. Built-in tiles: Flash sale and New this week.
- Cards carry badges worked out from the data (-40%, Ending soon, New, Giveaway prize). Sourcing items show "From $X"
  and the product page shows the price guide, minimum order and lead time.

**Schedule**
- Week, month and list views (list by default on phones), filters by type, and for administrators by department and
  person. Entries open the work item or page that owns them. Administrators press + on a day to schedule a giveaway or
  a store section, or go to Shop for a flash sale.

**Campaigns and giveaways**
- New giveaways are scheduled by default (they open and close on their dates); "Keep as a draft" is still there.
- Each giveaway and flash sale opens a Prepare a campaign task due a day before it starts: prize or products ready,
  Browse ready, announcement written. Cancelling the campaign closes the task.
- A store-product prize is held back from what members can buy until the giveaway wraps up; a winner can still buy it
  with their code. Wrap-up runs 7 days after the draw once every prize task is closed and saves the results (entries,
  winners, new members and orders during the giveaway).

**Connected parts**
- The AI's product facts include the price guide (as an estimate), minimum order and lead time.
- The background sweep runs the Store team checks every 10 minutes.
- Guides: one per Store team work type, a Tools section (Products workspace, store sections, Schedule) and 15 new
  glossary words. `docs/FAYFORT_SYSTEM_MAP.md` §11b maps the whole flow.

**Shopify note:** publishing to sales channels needs the app's `read_publications` and `write_publications` scopes.
Without them Publish still works and tells the administrator to tick the sales channels in Shopify.

**Tests:** API 633 (27 new), dashboard 159 (6 new), layout 55 including 9 new checks at phone, laptop and desktop
(`tests/e2e/store-team.spec.ts`). The three migrations were applied twice to a full local copy of the schema and
exercised with real rows.

## 10. Sourcing items imported from FayFort's Instagram (2026-10-20)

Owner request: put every product from fayfort_preorder_chinashopping and fayfort_furnitures_china on the site as sourcing items, with a media limit, a category each, "contact team" when there is no price, and posted prices treated as rough estimates.

- `POST /platform/commerce/sourcing/import` (platform admins, one item per call, `app/commerce/sourcing_import.py`). Creates or updates a `directory_products` row (source fayfort, availability sourcing) keyed by `import_ref` = `instagram:<post code>` (migration 20261020120000), so a re-run updates the same item.
- Media is copied into the `product-media` bucket under `imports/<ref>/`, at most 5 pieces per item. Videos keep their cover as the poster. Only https links on Instagram/Facebook CDN hosts are fetched, without redirects, with size caps (15 MB image, 60 MB video). Media already copied is kept on a re-run unless `refresh_media` is set.
- Prices: the USD price in the caption becomes the price guide (card "From $X est.", detail "Rough price … our team confirms your final price"). No price → card and detail say "Contact our team for a price".
- Posts showing designer logos on low-priced bags and sandals were not imported; the owner decides on those.
