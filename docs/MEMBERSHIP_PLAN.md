# FayFort Membership Plan (plans, sourcing deposits, consultations, contacts, member rank)

Status (2026-10-16): plan rules, sourcing deposits, consultations, the Supplier directory with contact unlocks, and
member ranks and points are **built**. Plan billing (Stripe) is **not built yet**; until Stripe is connected a member's plan is
whatever `member_profiles.member_tier` says. All prices live in one file: `app/membership/plans.py`.

## 1. Plans (decided 2026-10-15)

| | Free | Standard | Pro |
|---|---|---|---|
| Sourcing deposit | 50% of the expected product total | 25% (50% off the Free rate) | None while in good standing (else 25%) |
| Consultation | $100 | $50 (50% off) | 1 included per month, then $50 |
| Supplier & service-provider contacts | $15 each, or 5 for $50 | $15 each, or 5 for $50 | 10 included per month, then credits |
| Hotels & restaurants | Free | Free | Free |
| Premium themes | No | Yes | Yes |

- Plan perks apply only while the subscription is active.
- **Subscriptions (Standard/Pro) will be billed through Stripe. This is the last build step.**

## 2. Sourcing deposit

- A **deposit, not a fee**: a percentage of the expected product total. It **counts toward the order**; if the member
  doesn't buy, **FayFort keeps it**.
- Members can enter an **expected budget** when they submit a request (chat dialog and Orders & requests); the form tells
  them their plan's deposit.
- Staff see **Deposits due** in Control Center → Shop → Invoices: open requests without a deposit, the member's plan and
  rate, and the expected total (editable). **Send deposit** emails a Shopify invoice (no shipping).
- When the member picks an option, **Send invoice** takes the paid deposit off the total (a fixed discount
  "Sourcing deposit paid" on the Shopify draft order). A paid deposit does not move the request to "Purchase confirmed";
  only the order invoice does.
- **Pro good standing:** at least one paid order for every three sourcing requests in the last 90 days (fewer than three
  requests is always fine). Below that, Pro pays the Standard rate until they buy again.

## 3. Consultations

- Booked from the **Member tier** pop-up (Your perks → Book a consultation) with a short topic.
- Free/Standard (and Pro after the included one) get a Shopify invoice; one unpaid booking at a time.
- When it's paid (or straight away for Pro's included one) FayFort opens a **consultation chat** with the topic, puts a
  high-priority **consultation** item in Operations (member support) and emails the member. Staff agree a time in that chat.

## 4. Supplier contacts (the directory)

- **Supplier directory** in the member chat menu: Suppliers & markets, Services, Hotels, Restaurants, My contacts.
- Everyone sees the public half (market, city, district, product categories / service, city, ships to).
- **Unlock** shows the private half: address (EN/CN), buyer notes, floor/stall, contact person, phone/WeChat, best time
  (markets); company, contact, phone/WeChat, email/QQ, address, booth, hours (service providers).
- Order of payment: Pro's 10 included unlocks this month → a purchased credit → otherwise "buy a contact".
  Credits: 1 for $15 or 5 for $50, added when the Shopify invoice is paid. Unlocking the same record again is free.
- Hotels and restaurants show their phone and price for free.
- Unlocked records stay in **My contacts** for good, including after a plan ends.
- Unlocks run in one database function (`unlock_member_contact`), serialised per member, so a credit can't be spent twice.

## 5. Members who pay but aren't consistent

- **Pay but rarely use:** don't penalise them. Send a monthly nudge about what's new in their categories, and offer **pause**
  (low fee, keeps history) instead of only cancel. *(Needs Stripe.)*
- **Join only when they need something (subscribe → use → cancel):**
  1. **Perks grow with continuous months subscribed.** In month 1, Pro sourcing still takes a deposit. Cancelling resets
     the count; coming back within a grace period *(tbd, e.g. 14 days)* keeps it. *(Needs Stripe's subscription dates.)*
  2. **Good standing** (built, section 2).
  3. **Sourcing in progress is tied to an active plan.** If a member cancels during a free sourcing job, the deposit
     applies to that job. *(Needs Stripe.)*

## 6. Member ranks and points (built 2026-10-16)

Activity becomes ledger rows (`member_activity_events`). Two numbers come out of it:

- **Status score** = points from the **last 90 days**. It sets the rank and can't be spent.
- **Points balance** = everything earned minus what was spent. Spendable.

| Activity | Points (score and balance) |
| --- | --- |
| Paid order (store checkout or invoice) | 50 + 1 per $1, max 250 per order |
| Sourcing request that ends in a purchase (paid order invoice) | +100 |
| Paid sourcing deposit | +20 |
| Group buy you joined gets paid | +50 |
| A link you shared brings a buyer (another member pays the group buy) | +30 each, max 10 per link |
| Consultation booked | +30 |
| Giveaway entered | +5 |

Chatting, browsing and taps don't count. A refunded or cancelled order drops back to 0.

| Rank | Name | Score to enter | Subranks |
| --- | --- | --- | --- |
| 1 | Browser | 0 | 5 equal steps up to 250 |
| 2 | Scout | 250 | … up to 750 |
| 3 | Hunter | 750 | … up to 1,750 |
| 4 | Insider | 1,750 | … up to 3,500 |
| 5 | Founder's Circle | 3,500 | … up to 6,000 |

- **Up:** immediately, as soon as the score qualifies.
- **Down:** a **30-day grace period** starts when the score falls below the current rank. After it, the member drops
  **one subrank**, and another after each further 30 days while still below. Never straight to the bottom.
- **Rank perk:** **Free members at Insider (rank 4) or higher pay Standard rates** (25% deposit, $50 consultations) while
  the rank holds. Paid members keep Pro's deposit-free sourcing through the good-standing rule (section 2).
- **Spend points:** 500 points = 1 supplier contact credit (Virtual points pop-up).
- Ranks refresh after every paid/refunded order, giveaway entry and consultation, and for all active members every
  6 hours (`MEMBER_RANKS_ENABLED`). Placeholder ranks from before the engine were reset to Browser 1.
- Later (with Stripe): continuous months subscribed can add to the score; referrals once a referral link exists.

## 7. Member account menu (built 2026-10-15)

The account icon (top right of the member chat) opens four pop-ups: **Virtual points** (balance, rewards, how to earn,
recent activity), **Member tier** (rank name, progress to the next subrank, grace warning, rank perks, plan comparison,
Your perks: consultations and contact credits), **Account details** and **Settings**. Each closes with ×,
Close, Escape or a click outside.

## 8. Where things are

| Piece | Location |
| --- | --- |
| Prices and rules | `app/membership/plans.py` |
| Consultations, credit packs, paid-invoice handling | `app/membership/service.py` |
| Directory search and unlocks | `app/membership/directory.py` |
| Ranks, points, rewards, 6-hourly refresh | `app/membership/ranks.py` |
| Member API (`/members/plan`, `/members/rank`, `/members/points/redeem`, `/members/consultations`, `/members/directory…`, `/members/contact-credits`) | `app/membership/router.py` |
| Deposits due / deposit invoice / deposit credit | `app/commerce/admin_router.py` |
| Database | `supabase/migrations/20261016100000_membership_plans.sql`, `20261016200000_member_ranks.sql` |
| Member UI | `dashboard/src/app/member/MemberPerks.tsx`, `MemberAccountDialogs.tsx`, `membershipApi.ts` |
| Staff UI | `dashboard/src/app/staff/CommercePage.tsx` (Invoices tab) |
