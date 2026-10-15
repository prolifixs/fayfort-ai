# FayFort products and commerce — findings and proposed plan

**Status: built 2026-10-14 (82/100). Everything that doesn't need the owner is built, tested and the database migration is applied to production. Remaining: Shopify app and tokens (owner), git push and API redeploy, live acceptance and connecting TikTok/Instagram (section 10).**

## Owner decisions (2026-10-14)

1. **Headless Shopify is agreed:** Shopify is the engine and FayFort is the experience.
2. **Basic plan for now,** with an upgrade later. Discounts stay within Shopify's standard types until then.
3. **One store** holds LANDED and all products.
4. **Sourcing quotes are paid by Shopify draft-order invoice.** Draft orders are available on Basic.
5. **TikTok Shop and Instagram:** each phase is built so the channels can plug in, and they are **connected at the end** (P8).
6. **New requirement:** browsing and sourcing should be fun and habit-forming without tiring people out (swipe, endless scroll and similar), driven by a ranking algorithm that is FayFort's own. The options are in section 7.

## 1. What exists today (audited on production, 2026-10-14)

| Piece | State |
| --- | --- |
| Categories (`directory_categories`) | **968 categories** in 4 groups: Beauty, Fabrics, Garment components, Hair. 177 are marked P1. Imported from the sourcing workbook. |
| Products (`directory_products`) | **0 products.** The table has name, category, description, an availability status (`available`/`sourcing`/`unavailable`), active, and **one** media item (image or video by upload, URL or Instagram). There is **no price, discount, variant, stock or SKU**. |
| Member product page (`/member/products`) | Search, category filter, save/unsave, and "request this". It works but is empty. |
| Sourcing requests | 14 requests. Members can ask from a catalog item, a saved item, a **link** (`source_type = url`), an image or a description. Staff send priced options, then the request runs through stages up to delivery, with emails at each stage. |
| Payments | **None in the platform.** "Purchase confirmed · paid" is a stage a worker sets by hand. Shopify is used only for the LANDED ebook checkout on fayfort.com. |
| AI chat | Already matches members' questions to `directory_products`. |
| Giveaways | A placeholder page in the Control Center. |
| Members | 3. |

**What this means:** the sourcing and service side is real and working. Selling is entirely missing: there is no price, cart, checkout, order, discount or stock anywhere.

## 2. What the owner wants

1. Proper listings: media gallery, price, discount, a catalog that grows over time, and the existing categories.
2. Flexible categories (the 968-category taxonomy, not just a few collections).
3. **Fast sales** (time-boxed flash sales).
4. **Social trends as the main selling point:** people copy TikTok or Instagram links. FayFort should catch the copied link in the product and chat panels and show it as a card, even when the item isn't in the store.
5. Discounts.
6. A giveaway system.
7. Traffic comes mostly from Instagram and TikTok.

## 3. Findings: Shopify versus in-house

| Need | Shopify alone | In-house alone | Shopify behind FayFort ("headless") |
| --- | --- | --- | --- |
| Checkout, payments, tax, fraud, refunds, PCI | ✅ Done | ❌ Months of work and ongoing risk | ✅ Shopify checkout |
| Product media, variants, price, compare-at price, stock | ✅ | Build it all | ✅ Edited in Shopify, shown by FayFort |
| TikTok Shop and Instagram/Facebook shop sync | ✅ The official free channel apps sync the catalog and enable product tagging ([LaunchTip](https://www.launchtip.com/blog/4-best-shopify-social-commerce-apps-for-tiktok-and-instagram-sales)) | ❌ Separate integrations with each platform | ✅ Same Shopify catalog |
| The 968 categories | ⚠️ Only collections and tags natively; metafields and metaobjects can carry FayFort's category | ✅ | ✅ The FayFort category is stored on each Shopify product (metafield); FayFort does the browsing |
| Flash sales | ⚠️ Scheduled automatic discounts work; no countdown or "drop" experience | Build it | ✅ FayFort schedules the sale through the Admin API and shows the countdown; Shopify applies the price |
| Custom discount logic (Shopify Functions) | ⚠️ Custom apps using Functions **require Shopify Plus**; public App Store apps work on every plan ([Ringly](https://www.ringly.io/blog/shopify-functions)) | Build it | Standard discounts (percentage, fixed, buy X get Y, codes, automatic, scheduled) cover the plan; Plus only if truly custom logic is needed later |
| Giveaways | ❌ Not built in (apps exist) | Build it | ✅ FayFort runs entries and the draw; Shopify delivers the prize (100% discount code or a $0 draft order) |
| Catch copied links | ❌ Not possible in a theme | ✅ | ✅ This lives in FayFort either way |
| Sourcing (custom items not in stock) | ❌ | ✅ Exists | ✅ Stays in FayFort; a quote can be paid through a Shopify **draft-order invoice**, which finally adds payments to sourcing |
| Headless access | Needs at least the **Basic** plan for the Headless channel (owner should confirm the current plan) ([Shopify Community](https://community.shopify.com/t/make-the-headless-app-available-on-the-starter-plan-5-is-it-possible/630935)) | — | — |

### The copied-link idea: what browsers allow

- **No browser lets a website read the clipboard silently.** Safari rejects any programmatic clipboard read that isn't part of a user gesture. On iOS it shows a one-tap "Paste" bubble instead ([WebKit](https://webkit.org/?p=10855)). Chrome asks once for clipboard permission.
- What works well, combined:
  1. **Paste anywhere.** The product and chat panels listen for a paste (Ctrl/Cmd+V or long-press → Paste). No permission is needed, and the link becomes a card instantly.
  2. **A "Paste link" button** that reads the clipboard on tap. Chrome needs a one-time allow; on iOS it's one extra tap on the Paste bubble.
  3. **Share to FayFort.** If the member installs FayFort as an app on Android, FayFort appears in TikTok's and Instagram's Share menu (Web Share Target), so no copying is needed. iOS doesn't support this for web apps ([WebKit bug 194593](https://bugs.webkit.org/show_bug.cgi?id=194593)), so iOS uses 1 and 2.
- **Showing the card.**
  - TikTok and Instagram offer official embed and oEmbed data. Instagram's needs the Meta app FayFort already has.
  - Other stores are read from their page's preview (Open Graph) tags on the server.
  - Some big marketplaces block automated reads, so the card falls back to the link plus whatever the member typed. It never gets stuck.

## 4. Recommendation

**Use Shopify as the commerce engine and FayFort as the experience ("headless Shopify").** Don't build commerce in-house, and don't try to bend a Shopify theme into FayFort.

- **Shopify** holds everything that has to be correct and compliant: products, variants, prices, discounts, stock, checkout, orders, refunds and tax. It also syncs the same catalog to **TikTok Shop and Instagram** through the official free channels, which matters most given where FayFort's traffic comes from.
- **FayFort** owns everything that makes it different:
  - the 968-category browsing;
  - trend links and the trend board;
  - flash-sale drops with countdowns;
  - giveaways;
  - the AI chat and sourcing for items that aren't in the store;
  - member accounts, emails and staff operations.
- **Products are copied into FayFort's database whenever they change in Shopify** (webhooks, plus a nightly check). Search, the AI chat, saved items and category filters stay fast and keep working as they do today.
- **One Shopify store for everything.** LANDED is simply one product in it, and its existing checkout links are untouched.

What this avoids: building payments, tax and fraud handling; a separate TikTok Shop integration; and a second product admin. What it costs: Shopify's plan fee and transaction fees, and keeping the copied catalog in sync, which the plan includes.

## 5. First draft of the plan (replaced by section 9)

| Gate | Weight | Summary |
| --- | ---: | --- |
| P0. Decisions and Shopify setup | 5 | Confirm the plan (Basic or higher); install the Headless channel; create the Admin API app with the minimum permissions; create a FayFort category metafield definition; register webhooks; connect the TikTok and Facebook & Instagram channels (owner) |
| P1. Catalog sync | 15 | Shopify → `directory_products` copy: Shopify ids, handle, variants, price, compare-at price, currency, stock state, full media gallery (images and video), status. Webhooks for create, update and delete, a nightly reconcile, and an admin "Sync now" |
| P2. Member storefront | 20 | Product grid with sale badges; filters across the 968 categories (group → category → type); product page with gallery and video, variants and price; save; cart through the Storefront API; **Shopify checkout**; mobile-first for TikTok and Instagram visitors |
| P3. Staff product tools | 10 | Control Center → Products: sync health, category mapping for products missing one, "Open in Shopify" edit links, and "Publish sourced item" (turn a sourcing option into a Shopify draft product) |
| P4. Social trend links | 20 | Paste capture in the product and chat panels; "Paste link" button; Android share target; server-side link preview (TikTok/Instagram oEmbed, Open Graph, safe fallback); trend board and member "Trends I've shared"; match a link to a catalog item or start a sourcing request in one tap; staff trend queue with counts ("12 people shared this") |
| P5. Flash sales and discounts | 10 | Sale scheduler in the Control Center → Shopify automatic discount with start and end; countdown and "Sale" collection in FayFort; optional newsletter or email announcement; codes for influencers |
| P6. Giveaways | 10 | Campaigns (dates, prize, rules); member entry (one per member, optional honour-based social tasks); random draw with an audited seed; winner notified by email; prize delivered by Shopify 100% discount code or $0 draft order |
| P7. Orders bridge | 5 | Shopify order webhooks → the member's order list and timeline, plus emails through the existing email system; sourcing quotes paid by Shopify draft-order invoice |
| P8. Live acceptance | 5 | End to end on production: browse, buy, flash sale, trend link to sourcing, giveaway draw |
| **Total** | **100** | |

**Order of work:** P0 → P1 → P2 (the first sale is possible here) → P4 (the selling point) → P5 → P6 → P3/P7 alongside → P8.

## 6. Questions for the owner

1. Do you agree with **Shopify as engine, FayFort as experience** (section 4)?
2. Which Shopify plan is the store on (Starter, Basic, Grow/Shopify, Advanced or Plus)?
3. One store for LANDED and all products (recommended), or a separate store?
4. Should sourcing quotes be paid through Shopify invoices (recommended), or stay manual for now?
5. Is the TikTok Shop / Instagram shop channel something you want connected in P0, or later?

## 7. Discovery and ranking: built around intent and impulse (revised 2026-10-14)

**The owner's direction:** no Tinder-style swiping. Swiping works on social media because the viewer doesn't know what comes next. Shoppers mostly arrive with a goal, and the rest buy on impulse. Effortless swiping without a goal produces weak signals and tires people out. The design therefore serves **intent first** and places **impulse** at the moments when intent is highest.

### Options

| Option | Core loop | Best for |
| --- | --- | --- |
| 1. Find It | Every way in is a request: pasted link, photo, words, category or AI chat. FayFort answers with **Exact match**, then **Closest alternatives** (cheaper, faster, in stock), then **Source it**. | Trend-link shoppers coming from TikTok and Instagram |
| 2. Missions | A member states a goal ("wig install kit", "aso-ebi fabric for 12", "restock my salon"). FayFort builds the basket, remembers it and prompts reorders. | Repeat and business buyers (hair, fabrics, garment components) |
| 3. Hot rails | A short, time-limited storefront: Trending on TikTok this week, Ending soon, Under a set price, Back in stock, Almost sourced. | Impulse buyers and people arriving from a post |

### The ranking (the FayFort intent score)

- **Intent:** each session carries an intent. It is built from the strongest recent signals:
  - pasted link and photo carry the most weight;
  - then add to cart and repeat visits to the same item;
  - then search;
  - then a category tap.
  
  It fades within the session as the member's attention moves on.
- **Score:** relevance to the intent × available now or speed to the member × price fit (their usual price band) × social proof (Heat: unique sharers and buyers, recency) × urgency (sale end, low stock, pool close to full).
- **The impulse layer.** It only appears at high-intent moments, and each slot holds at most 1 to 3 items:
  - after a link is resolved: "Get one today" (an in-stock alternative) while the sourced item takes weeks;
  - after add to cart: items that go with it, and small add-ons to reach a discount threshold;
  - at checkout: one item that is ending soon.
- **No endless random scroll.** Scrolling is endless only inside a context, such as a category, a trend or a mission, so it never loses its point.
- **Group sourcing stays:** "Source it" on an item others also want joins its pool, and the group price unlocks when the pool fills. It is now an outcome of intent, not a swipe.
- **For workers:** shared links are grouped by item, so staff handle one item once ("37 want this") rather than 37 separate requests.

### Recommendation

**Find It as the core**, **Hot rails** as the front page for impulse traffic, and **Missions** added later for repeat and business buyers. The intent score drives all three.

Confirmed by the owner on 2026-10-14. Missions is deferred to a later phase and is outside the 100 points.

## 8. Design rule: familiar, with a twist (owner rule, 2026-10-14)

The member front page is deliberately modelled on ChatGPT: a chat history sidebar, one large composer, a welcome prompt, and panels that open beside the chat. **Every commerce feature has to live inside that familiar shell.** Shopping adds a twist to the chat; it doesn't sit next to it as a separate site.

| Familiar element | FayFort twist |
| --- | --- |
| Composer ("Describe what you are looking for…") | **Find It.** The composer accepts words, a pasted link or a photo. Replies come back as rich cards in three tiers: Exact match, Closest alternatives, Source it. |
| Welcome screen suggestion chips | **Hot rails.** Trending on TikTok, Ending soon, Back in stock and Almost sourced take the place of the chips. |
| Answers in the conversation | Product cards inside the chat, with price, sale badge, a countdown and Add to cart. |
| Side panel next to the chat (the existing split view) | The product page opens beside the chat, so the member can keep asking about the item (for example, "does it come in 30 inch?"). |
| Sidebar navigation | Browse (rails and the 968 categories), Saved, and **Orders & requests**. The cart is a drawer in the header, not a page. |

**Merged so nothing is duplicated:**

- **The link field in the sourcing-request dialog** is replaced by Find It. The Source it tier fills in the request form for the member.
- **Purchases and sourcing requests** share one timeline, because sourcing is paid by Shopify invoice and so becomes an order.
- **Hot rails** sit at the top of Browse; there is no separate Trends page.

## 9. Final plan (weighted to 100, confirmed 2026-10-14)

| Gate | Weight | Summary |
| --- | ---: | --- |
| P0. Shopify setup | 5 | Basic plan; Headless channel; Admin API app with the minimum permissions; FayFort category metafield; webhooks. The owner enters every token. |
| P1. Catalog sync | 10 | Shopify → `directory_products`: ids, variants, price, compare-at price, stock, media gallery and category. Webhooks, a nightly reconcile and a "Sync now" button. |
| P2. Storefront in the chat shell | 15 | Product cards in the chat; product panel beside the chat; Browse with category filters; cart drawer; Shopify checkout. |
| P3. Find It | 15 | The composer resolves links, photos and words into the three tiers; link previews (oEmbed, Open Graph and a fallback); paste capture and a Paste button; Android share target. |
| P4. Intent score, Hot rails and impulse | 15 | Session intent; ranking score; Hot rails on the welcome screen; impulse slots after a link is resolved, after add to cart and at checkout. |
| P5. Sourcing pools and invoices | 10 | Shared links grouped by item; pools with a target and a group price; sourcing quotes sent as Shopify draft-order invoices. |
| P6. Flash sales and discounts | 5 | Scheduler → Shopify automatic discounts with start and end dates; countdowns on cards; influencer codes. |
| P7. Giveaways | 5 | Campaigns, entries, an audited random draw, and prizes delivered as a Shopify code or a $0 order. |
| P8. Orders and staff tools | 10 | One Orders & requests timeline for members; emails through the existing email system. Staff get sync health, the grouped trend queue and "Publish sourced item". |
| P9. Channels and live acceptance | 5 | Connect TikTok Shop and Instagram (owner), then run an end-to-end check on production. |
| P10. Study documentation and structure maps | 5 | A structure map of every pipeline (auth, workforce, email, catalog, Find It, intent, pools, checkout, orders, giveaways and channels) showing its inputs, outputs and links to the others. A dead-weight audit: every feature must feed or use another, and anything that doesn't is removed or merged. A written guide for the owner to study. |
| **Total** | **100** | |

**Order of work:** P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7, with P8 built alongside, then P9 → P10. New issues are logged and dealt with at the end of the phase.

## 10. Build record (2026-10-14)

### What was built

| Gate | Score | Built | Still needed |
| --- | ---: | --- | --- |
| P0 Shopify setup | 2 / 5 | Settings (client-credentials token, webhook secret, Storefront token, API version); "Set up Shopify" button creates the category field and registers 6 webhooks; deploy guide | Owner creates the Dev Dashboard app, the Headless channel token, and fills `api.env` |
| P1 Catalog sync | 12 / 15 | Webhook receiver (signature check, de-duplication, background processing); product/inventory resync; 6-hourly reconcile; Sync now; variants, media gallery, price range, compare-at, stock, restock stamp; category matching with a staff fix that writes back to Shopify | Live run against the real store |
| P2 Storefront in the chat shell | 12 / 15 | Product cards in chat, product panel beside the chat (gallery, video, options, quantity), Browse with group chips, category, sort and "Ships now", cart drawer, Storefront checkout with member attribute and cart-link fallback | Live checkout test |
| P3 Find It | 13 / 15 | Link detection in the composer, Paste link button, Android share target (`/member/share` + web manifest), canonical links, TikTok/Instagram oEmbed and Open Graph previews with SSRF protection, three tiers, Find It saved with the chat message | Live preview check on real TikTok/IG links |
| P4 Intent score and Hot rails | 14 / 15 | Intent events, session intent, Heat, the score, diversity rule, rails (Picked for you, Trending, Ending soon, Back in stock, Almost sourced, Under 25, Popular), impulse slots | Tuning on real traffic |
| P5 Pools and invoices | 8 / 10 | Source it joins a pool and opens one request; staff pools with target and group price; Almost sourced; pool and request invoices as Shopify draft orders; paid invoice moves the request to Purchase confirmed; Found it email | Live invoice payment test |
| P6 Flash sales and codes | 4 / 5 | Automatic sales and influencer codes in Shopify, countdowns and sale prices on cards, cancel | Live discount test |
| P7 Giveaways | 4 / 5 | Campaigns, one entry per member from the front page, recorded-seed draw, 100% prize codes, winner email; the placeholder page is replaced | Live run |
| P8 Orders and staff tools | 8 / 10 | Orders mirrored from webhooks, Orders & requests timeline (Ready to pay, orders with tracking, wanted items, requests), Control Center → Shop (overview, trend queue, invoices, sales, giveaways, category mapping, orders), audit log | Live orders |
| P9 Channels and live acceptance | 0 / 5 | Nothing to build; channels read the Shopify catalog | Owner connects TikTok Shop and Facebook & Instagram channels; end-to-end check |
| P10 Documentation and maps | 5 / 5 | `docs/FAYFORT_SYSTEM_MAP.md` and the published study page with 11 diagrams and the dead-weight audit | — |
| **Total** | **82 / 100** | | |

**Tests:** backend 474 passing (36 new in `tests/test_commerce.py`); dashboard 106 passing (7 new in
`member/Shop.test.tsx`); production build passes. The migration was verified on PostgreSQL 16 locally, then applied to
production (17 tables, RLS on all, migration recorded).

### Issues log (address at the end of the phase)

| ID | Issue | Plan |
| --- | --- | --- |
| C1 | `/member/products` page and its API duplicate Browse in the chat | Redirect the page to `/member/chat?panel=catalog` after the owner confirms |
| C2 | Chat product matching still uses simple word matching | Switch it to the intent score so chat and Browse rank alike |
| C3 | Discount and draft-order GraphQL fields can change between Shopify API versions | Verify in the live acceptance; `SHOPIFY_API_VERSION` is configurable |
| C4 | Photos in Find It go to human review (no image AI yet) | Revisit when an image model is chosen |
| C5 | Orders from TikTok Shop / Instagram aren't tied to a FayFort member | Expected; they show in Shopify and Shop → Orders as "other" |
| C6 | Installing FayFort as an app (needed for the Android share menu) needs the browser's install prompt; no service worker yet | Add a minimal service worker if Chrome requires it for install on members' phones |

## Sources

- [Ringly — Shopify Functions and plans](https://www.ringly.io/blog/shopify-functions)
- [Shopify Community — Headless app and plan requirements](https://community.shopify.com/t/make-the-headless-app-available-on-the-starter-plan-5-is-it-possible/630935)
- [WebKit — Async Clipboard API in Safari](https://webkit.org/?p=10855)
- [WebKit Bugzilla 194593 — Web Share Target](https://bugs.webkit.org/show_bug.cgi?id=194593)
- [LaunchTip — Shopify social commerce apps for TikTok and Instagram](https://www.launchtip.com/blog/4-best-shopify-social-commerce-apps-for-tiktok-and-instagram-sales)
