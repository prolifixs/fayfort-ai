# FayFort Membership Plan (plans, sourcing deposits, consultations, contacts, member rank)

Status (2026-10-16): plan rules, sourcing deposits, consultations, the Supplier directory with contact unlocks, and
member ranks and points, and plan billing through Stripe are **built**. Billing starts as soon as `STRIPE_SECRET_KEY`
is set on the API server (deploy/README.md → Member plan billing). Until then a member's plan is whatever
`member_profiles.member_tier` says. All prices live in one file: `app/membership/plans.py`.

## 1. Plans (decided 2026-10-15)

| | Free | Standard | Pro |
|---|---|---|---|
| Sourcing deposit | 50% of the expected product total | 25% (50% off the Free rate) | None while in good standing (else 25%) |
| Consultation | $100 | $50 (50% off) | 1 included per month, then $50 |
| Supplier & service-provider contacts | $15 each, or 5 for $50 | $15 each, or 5 for $50 | 10 included per month, then credits |
| Hotels & restaurants | Free | Free | Free |
| Premium themes | No | Yes | Yes |

- Plan perks apply only while the subscription is active.
- **Billing:** Standard **$19/month** and Pro **$49/month** (defaults; `MEMBER_STANDARD_MONTHLY_PRICE`,
  `MEMBER_PRO_MONTHLY_PRICE`). Members subscribe through Stripe Checkout and manage (switch plan, card, cancel at period
  end, invoices) in the Stripe customer portal, both from **Member tier** in the chat. The plan follows the
  subscription: active / trialing / past due = the plan; paused, cancelled or unpaid = Free.

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

## 5. Members who pay but aren't consistent (built with Stripe)

- **Pay but rarely use:** not penalised. Members can **pause** (1–3 months, `SUBSCRIPTION_MAX_PAUSE_MONTHS`) instead of
  cancelling: no payments and no plan perks while paused, but their months in a row and history are kept.
- **Join only when they need something (subscribe → use → cancel):**
  1. **Perks grow with continuous months subscribed.** In the first 30 days of a continuous run, Pro pays the Standard
     deposit (25%). Coming back within **14 days** (`SUBSCRIPTION_RETURN_GRACE_DAYS`) keeps the run; later, it restarts.
  2. **Good standing** (section 2).
  3. **Sourcing in progress follows the plan.** Deposits are worked out when staff send them, so a request whose member
     has cancelled Pro shows up in Deposits due at the Free rate.
- Every paid month adds to rank: **+50 Standard, +100 Pro**.

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
- Paid subscription months add to the score (+50 Standard, +100 Pro). Referrals can be added once a referral link exists.

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
| Stripe client, setup, subscriptions, webhook, 30-min reconcile | `app/billing/stripe_api.py`, `service.py`, `router.py` |
| Member API (`/members/plan`, `/members/rank`, `/members/points/redeem`, `/members/consultations`, `/members/directory…`, `/members/contact-credits`) | `app/membership/router.py` |
| Deposits due / deposit invoice / deposit credit | `app/commerce/admin_router.py` |
| Database | `supabase/migrations/20261016100000_membership_plans.sql`, `20261016200000_member_ranks.sql`, `20261016300000_member_billing.sql` |
| Member UI | `dashboard/src/app/member/MemberPerks.tsx`, `MemberAccountDialogs.tsx`, `membershipApi.ts` |
| Member billing UI | `dashboard/src/app/member/PlanBilling.tsx` (Member tier pop-up and /member/membership) |
| Staff UI | `dashboard/src/app/staff/CommercePage.tsx` (Invoices and Member plans tabs) |

## 10. Tour guide booking and Tools (owner request, 2026-10-20)

**Tour guide in China** (physical presence, `app/membership/tours.py`, table `member_tour_bookings`, migration 20261021100000).
- The member sends city (Guangzhou, Yiwu, Shenzhen, Shanghai or another city), arrival date, days, people, what they need (Canton Fair, wholesale markets, factory visits, interpreting, airport pickup), hotel area, WhatsApp and notes. A chat "Tour guide: <city>" opens and member support gets a `tour_booking` work item; admins are notified.
- Every tour is quoted by staff (owner decision: no fixed day rate). Operations → Tour bookings → Send quote sends a Shopify invoice (`commerce_invoices.kind = 'tour'`) and posts the price in the chat. A new quote cancels the old unpaid invoice.
- Paid → confirmed (Shopify order webhook, idempotent). Staff name the guide, then Mark done; Cancel cancels an unpaid invoice and tells the member.
- Statuses: requested, quoted, confirmed, completed, cancelled. Tour revenue shows under "Other" in Revenue until a Tours stream is added.
- **Pending completion** (shared with the virtual consultation): choosing a date from a live calendar and team availability. Both screens say dates are confirmed by the team in the chat.

**Tools** (member app): the left menu's "Supplier directory" became **Tools**, one page with Virtual consultation, Tour guide in China, Supplier directory and Supplier contacts (contact credits). Consultation and contacts moved out of Settings (Settings links to Tools). Deep links: `/member/chat?panel=tools&tool=consultation|tour|directory|contacts`; old `?panel=directory` links open Tools on the directory.

## 11. LANDED buyers move from Baserow to FayFort (owner request, 2026-10-25)

LANDED was sold with password-protected Baserow views as its live directory, sent in the Shopify order email. The Baserow
tables close on **30 November 2026**; the directory lives on FayFort (the Baserow tables already sync into it by webhook).

**Owner decisions (2026-10-25)**
- LANDED owners get the **address** of every market and service provider in the **25 October 2026 snapshot**, free, including
  entries not yet confirmed. Supplier contacts (names, phone/WeChat, stall) and anything added after the snapshot use contact
  credits like for everyone else.
- Every directory record is listed for every member with its verification label (Verified / Not yet confirmed / Sources
  disagree). Before this, services, hotels and restaurants showed only verified records.
- Everyone bought through Shopify; no buyers outside it.

**How it works**
- `public.landed_owners`: one row per Shopify order of the LANDED product (matched by product handle `landed`, or a line item
  title starting "LANDED"). Filled by a one-off "Read buyers from Shopify" and then by the order webhooks. Refunded or voided
  orders lose access.
- `public.landed_snapshot`: the (record type, source_key) pairs in the snapshot, written by the migration. Keyed by source_key
  so the Baserow sync updating a row keeps it in the snapshot.
- Linking: a member whose confirmed email matches a purchase email is linked automatically the first time they open the
  directory. Otherwise they claim with order number and purchase email (Tools, Supplier directory). An order linked to
  another account is refused.
- API (app/membership/landed.py): `GET /members/landed`, `POST /members/landed/claim`; platform admins: `GET /platform/landed`,
  `POST /platform/landed/sync`, `POST /platform/landed/send` (`kind` notice or reminder, `dry_run` true by default).
- Emails: Control Center, Emails, LANDED buyers. The notice ("Your LANDED directory is moving to FayFort") once per buyer;
  the reminder only to buyers who haven't signed up. At most 95 a day (Resend free plan); the rest go the next day.
  Sent through the email outbox as service notices; replies go to support@.
- fayfort.com: notice bar and "Already a reader?" box on the LANDED page, a FAQ entry, Ebook and Directory Terms sections 4
  and 5 rewritten (dated 25 October 2026). Sign-up at `/member/signup?from=landed` explains the free addresses.

**Owner to do**
- Change the Shopify order email for LANDED so new buyers are sent to FayFort sign-up instead of Baserow passwords.
- Put a short note at the top of each shared Baserow view, and switch the views off on 30 November.
