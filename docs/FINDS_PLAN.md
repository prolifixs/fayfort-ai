# FayFort Finds: trending products and rare finds for paid members

Status: decided and built (phases F1, F2 and the website part of F4), 2026-10-26. Batches (F3), the drop email digest
and learning (F5) are next. Decisions in section 7, what was built in section 9.

## 1. The idea (owner, 2026-10-26)

FayFort's main brand promise becomes **finding products before everyone else**: items that are trending (rising on
TikTok Shop and other platforms) and **rare finds** (niche items few people sell yet), each one **checked as obtainable in
China**, then listed so members can watch them and buy them, alone or in batches. The audience is **resellers and repeat
sellers who buy in quantity**. It is tied to the paid plans. Research uses Kalodata and other trend platforms, then a
check in China (1688, factories, the markets).

## 2. What already exists

| Piece | What it does today | Use for Finds |
| --- | --- | --- |
| Sourcing products (`directory_products`, Store team → New sourcing item) | Product with photos, rough price, minimum order, lead time, availability label, a staff-only supplier link, reviewed before going live. 56 live (53 from this week's Instagram import). | **The base of every find.** A find is a sourcing product plus research. |
| Store team listing flow | Draft → review → publish, "Fill from link", work items and deadlines | The find desk is this flow with extra research steps. |
| Trend links (`commerce_trend_items`) | Links members paste (TikTok, Instagram, web), grouped so "37 want this" is handled once; staff link, pool or dismiss. 1 so far. | Member demand signal, and a source of finds. |
| Group buys (pools on trend links) | Target number of people, group price, deadline; invoices go out when full. 0 so far. | **Batch buying**, but it only works on shared links and per person (1–50), not on a product with quantity price breaks. |
| Sourcing batches (Operations) | One worker handles several requests for the same item together (Phase B). | Batch orders on a find land here automatically. |
| Rails and store sections | "Trending on TikTok & Instagram" (member links only), "New from FayFort sourcing", "New this week", "Popular this week", scheduled section tiles. | A Finds rail and a weekly section. |
| Saved products | Members save items. **No alerts.** | Turns into the **watchlist** (with alerts). |
| Recurring requests | Members set a repeat sourcing request on a schedule. | Reorders for repeat sellers. |
| Newsletter | Promises "new finds from China every week", but each issue is typed by hand. | Built automatically from each week's drop. |
| Plans | Free / Standard $5.99 / Pro $14.99: deposits, consultation price, supplier contacts, no ads, themes. | **No product-discovery perk at all today.** This is the gap. |

What's missing: a find has no **evidence** (why it's trending, how we know it's available in China, what a reseller can
make on it), there's no **weekly drop** to anticipate, nothing in it is **tied to the plans**, there are no **price breaks
by quantity**, and watching sends **no alerts**.

## 3. What a find is

A find = a sourcing product + a research card. Two lanes:

- **Trending**: rising on TikTok Shop or elsewhere, still early enough to resell. Stage shown as *Rising*, *Peaking* or
  *Steady seller*.
- **Rare find**: niche, few sellers, often found in person in the markets (Fayfay's videos are the edge no tool has).
  Shown with a *Low competition* marker.

The research card members see (by plan, section 5):

1. **Why it's a find**: where it's moving (TikTok Shop US, UK, Southeast Asia, Instagram, Amazon), stage, and the date we
   checked, written by the team in its own words.
2. **China check**: *Verified in person*, *Verified with a supplier* or *Available online in China*, plus unit cost range,
   minimum order, lead time, whether a sample is possible, and the date checked. The supplier stays private (contacts are a
   separate paid perk).
3. **Reseller maths**: FayFort price per unit by quantity (for example 1–9, 10–49, 50+), an estimated landed cost per unit
   to the member's country, the typical selling price we saw, and the rough margin.
4. **Buy**: order one (sample), order a batch at the break price, or **join a group batch** that reaches the minimum
   order together.

## 4. How the team builds a weekly drop

1. **Scout** (Store team → Finds desk): a worker adds a candidate with its lane, the platform, what they saw (typed in
   their own words, with the source link kept staff-only) and a photo. Sources: Kalodata, other tools (FastMoss,
   EchoTik, TikTok Creative Center), Amazon movers, Google Trends, member trend links ("37 want this") and the markets.
2. **China check**: the worker finds it on 1688, Alibaba or in a market, records cost, minimum order, lead time and
   photos, and picks the check level. Optional sample. Candidates that fail are kept as "Not obtainable" so nobody checks
   them twice.
3. **Price and review**: an admin sets the price breaks (commission included), the landed estimates and the card copy,
   then approves.
4. **Schedule**: approved finds go into the next **drop** (for example every Monday, 10 finds: 7 trending, 3 rare). Each
   drop shows on the Schedule with a "Prepare this week's drop" task and a deadline.
5. **Release**: early access for Pro first, then Standard, then a teaser for Free and the newsletter. The drop email is
   written from the drop automatically.
6. **Learn**: each find shows views, watches, batch joins and orders, so the team sees which signals actually sell.

## 5. What paid members get (proposal A: inside today's plans)

| | Free | Standard $5.99 | Pro $14.99 |
| --- | --- | --- | --- |
| Weekly drop | 3 finds, a week late, no research card | Every find on release day | Every find **48 hours early** |
| Rare finds | Photo only | Full | Full + first pick |
| Research card (why, China check) | — | Yes | Yes |
| Reseller maths (price breaks, landed estimate, margin) | — | Price breaks | Everything |
| Watchlist with alerts (price, stock, batch filling, reorder) | 5 watches, no alerts | 25 with alerts | Unlimited |
| Group batches | Join | Join | Join + first allocation |
| "Research this niche for me" | — | — | 2 a month |
| Archive of past drops | Last 4 weeks | Full | Full + export (CSV) |

Proposal B: keep Standard and Pro as they are with a lighter Finds taste, and add a **Reseller plan** (for example
$39–$49 a month) for batch buyers: everything in Pro's column plus wholesale price breaks and reorder scheduling. B fits
"resellers who buy in batches" best but adds a fourth plan to explain and to set up in Stripe.

## 6. Kalodata and the China check: what to know

- **Kalodata** is a TikTok Shop analytics web app. I couldn't confirm a public API, so the start is **manual**: workers
  read it and type the signal in the Finds desk. **Check its terms before showing its numbers or screenshots to paying
  members**: tools like this usually license data to the subscriber only. The safe default is our own words ("rising on
  TikTok Shop US this month"), not their figures.
- **EchoTik** advertises a data API, which could automate the scouting list later. Worth a trial once the manual flow
  proves which signals sell.
- **1688 image search** has an official API, but it's only open to large approved ERP providers, so the China check stays
  manual (search 1688 or ask a supplier) for now.
- **Brands**: no logo copies or branded knock-offs as finds (same rule as the Instagram import). Rare finds should be
  unbranded or genuine.

## 7. Decisions (owner, 2026-10-26)

1. **Plans: proposal A**, inside Standard and Pro (section 5). A Pro member's first paid month gets Standard access
   (perks grow with loyalty, as for the other plan perks); Standard gets Standard access from day one.
2. **Drop rhythm: as recommended**, Monday 09:00 China time, about 10 finds (7 trending, 3 rare). Pro from Saturday
   09:00 (48 hours early); the regular catalog for everyone a week after release.
3. **Landed estimates: global.** Every country maps to one of 7 shipping zones; an administrator keeps an air rate per
   kilo (and handling per unit) per zone. A zone without a rate shows no estimate.
4. **Rare finds: every paid member.**
5. **Who: the Store team** (whoever handles products) does the searching, by hand for now. The member pages and
   fayfort.com explain the process so members see the effort behind each find.

## 7b. Questions that were open

1. **Plans**: proposal A (inside Standard and Pro) or B (add a Reseller plan)?
2. **Drop rhythm**: which day, how many finds, and the trending/rare split (default: Monday, 10 finds, 7 + 3).
3. **Landed estimates**: which destination countries to show (default: Nigeria, Ghana, UK, US).
4. **Rare finds exclusivity**: everyone paid, or Pro only (more valuable, fewer people)?
5. **Kalodata seat**: who on the team uses it, and is anyone else (FastMoss, EchoTik) worth a trial?

## 8. Build phases (after the decisions)

| # | Phase | Contents |
| --- | --- | --- |
| F1 | Finds desk | Find records (lane, signal, China check, price breaks, landed estimates), scout → check → review → schedule, drops, Schedule entries and work items |
| F2 | Members | Finds page (This week, Trending, Rare, Archive), find cards and detail with the research card by plan, early access, watchlist with alerts |
| F3 | Batches | Group batches on a find (quantity per member, minimum order, price break unlocks), batch orders into one sourcing batch, reorders for repeat sellers |
| F4 | Drop email and website | Weekly drop email built automatically (plan-aware), a teaser on fayfort.com/go and in the newsletter |
| F5 | Learning | Per-find results, which signals sell, an EchoTik or similar API if the trial is worth it |

Each phase comes with tests, screenshots at phone, iPad and desktop, guide text and an update of this document.

## 9. What was built (2026-10-26)

- **Database** (migration `20261029090000_finds.sql`): `finds` (research, China check, price breaks, weight, status),
  `find_drops` (early, release and catalog times, target, what was announced), `find_shipping_rates` (7 zones, rates
  empty until an administrator fills them), `member_find_watches`. Service role only.
- **Store team, Products → Finds** (`app/finds/`, `dashboard/src/app/operations/FindsDesk.tsx`): Scout a trending find /
  Scout a rare find opens a sourcing listing plus the research record and a `list_find` work item. The editor has
  1. What you saw (lane, stage or competition, platforms, regions, "why it's a find" that members read, scout notes for
  the team only), 2. China check (how, where, cost range, supplier minimum, sample; Mark as checked or Not obtainable),
  3. Price for resellers (up to 6 price breaks, usual selling price, unit weight), 4. Listing and drop. The listing
  can't go to review until the research is complete. Publishing puts the find in the next drop with room and keeps
  its product out of Browse. Upcoming drops show how full they are; administrators can move a find to another drop and
  set the shipping rates. Drops appear on the Schedule; a "Fill the drop" task opens 3 days before a short drop opens.
- **Weekly sweep** (every 5 minutes): keeps the next two drops planned, opens a drop for Pro (email), then on Monday for
  Standard (email), and a week later moves its products into the regular catalog.
- **Members, Finds** in the app menu (`dashboard/src/app/member/FindsPanel.tsx`): the drop, the effort line ("we looked at
  64 products, checked 18 in China, 6 made it"), the member's plan and when the next drop opens for them, All /
  Trending / Rare / Watching, past drops, and "How we find them" in four steps. A find opens with its trail (spotted,
  checked in China, priced, released), why it's a find, the China check, minimum order and lead time, the price per
  unit by quantity, and on Pro the landed cost and margin for the chosen country. Watch (Free 5 without alerts,
  Standard 25, Pro unlimited; alerts on a price drop or when it's quick to source again) and "Order or request a
  batch" (opens the product page). Pro has "Research a niche for me" (2 a month, a Store team task). Free sees each
  drop a week later with three finds featured and the rest locked.
- **Drop bell on Home** (added 30 Oct 2026): the Finds card on Home counts down to the next drop and has a "Notify
  me" bell (`PUT /members/finds/alerts`, stored in `member_profiles.finds_drop_alerts`). Until a member chooses,
  Standard and Pro get the drop email and Free does not; Free members who turn it on get "Now open for you" when the
  drop opens for them a week later, and paid members can turn their drop emails off. Migration
  `20261107090000_finds_drop_alerts.sql`.
- **Plans**: the plan comparison lists Finds, Finds pricing, Watched finds and Niche research.
- **fayfort.com/go/finds** and a FayFort Finds ticket on /go: the last drop's effort, three finds from earlier drops,
  how we find them, what each plan gets (`GET /public/finds/teaser`, times and photos only).
- Tests: `tests/test_finds.py`, `dashboard/tests/e2e/finds.spec.ts` (screenshots in test-results/finds).

**For the AI knowledge base (Control Center → Knowledge), suggested text:**

> FayFort Finds: every Monday FayFort releases a drop of about 10 products: trending items (rising on TikTok Shop,
> Instagram, Amazon) and rare finds (niche items few people sell). The team scouts them, checks each one in China (in
> person, with a supplier or online), and prices it per unit by quantity for resellers. Free members see each drop a
> week later with three featured; Standard sees it on Monday with the research and price breaks; Pro sees it two days
> early, with the landed cost to their country and the margin, and can ask the team to research a niche twice a month.
> Members can watch finds to hear about price drops. Finds are in the app menu under Finds.
