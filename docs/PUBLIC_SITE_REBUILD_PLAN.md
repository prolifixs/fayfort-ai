# Public site rebuild (www.fayfort.com): plan for review

Status: decisions taken 2026-10-16 (section 9); site live. Website chat (section 10) built 2026-10-17. Source: the live site, `web/` (Next.js 16) and the project plans
(PLATFORM_CONSOLIDATION_PLAN, MEMBERSHIP_PLAN, KNOWLEDGE_BASE_DRAFT).

## 1. What's wrong with the current site

The public pages were moved over from the old repository unchanged, so they describe the business as it was before
FayFort AI existed.

| Problem | Where |
| --- | --- |
| **No way into the platform.** No "Join free" or "Sign in", no mention of the member dashboard, sourcing requests, the shop, group buys, the supplier directory, plans or points. | Every page |
| **Starting a job is by email or WhatsApp only.** "Start a job → Email support@fayfort.com" on Services; "Message on WhatsApp" on Home. Today the right start is a sourcing request in the dashboard (free), or the chat. | Home, Services |
| **No pricing model.** Nothing about plans ($0 / $19 / $49), sourcing deposits (50% / 25% / none), consultations ($100 / $50) or that commission is built into the invoice. | Services ("Pricing" says only "itemised quotes") |
| **Retired products still mentioned.** About lists FaySource, which is closed. | About |
| **Broken anchor.** The nav and the Talks card link to `/#contact`, but no section has that id. | Home |
| **Personal portfolio mixed with a trading platform.** The hero is a fashion portrait, and "In front of the camera" shows editorial modelling with no captions. It reads as FayFay's personal site, not a sourcing company customers trust with money. | Home |
| **Two Instagram accounts** (personal and business) side by side, so it isn't clear which one handles enquiries. | Home |
| **No proof of operations.** No routes, countries, process photos, inspection examples or numbers. | Every page |
| **No working hours or reply time.** The chat assistant now says Mon–Sat 9:30–18:30 China time, but the site doesn't. | Contact |

What works and stays: the FAYFORT identity (navy, ink blue and pink, serif headlines, butterfly), the founder story and
timeline, the expo and graduation photos, the six services, LANDED and its checkout, and Terms (`/terms` is the
privacy URL registered with Meta).

## 2. Goals

1. **Turn visitors into members**: "Join free" is the main action on every page and goes to
   `app.fayfort.com/member/signup`. A returning visitor can "Sign in".
2. **Explain the model in one screen**: tell us what you need → we find and quote it → we inspect it → we ship and you
   track every step in your dashboard.
3. **Show the operation**: a globe in the hero with shipping routes from Guangzhou to where customers are.
4. **Sell LANDED** without touching its checkout.
5. **Be honest about money**: plans, deposits, commission and consultations, with the same numbers the platform uses.
6. **Fast and responsive**: phone first, and the globe never slows the first screen.

## 3. Site map

| URL | Page | Change |
| --- | --- | --- |
| `/` | Home | **Rebuilt** (section 4) |
| `/services` | Services | **Rewritten**: the six services, now with "start in your dashboard" and the real pricing model |
| `/pricing` | Plans and fees | **New**: plan comparison, deposits, consultations, supplier contacts, commission, FAQ |
| `/how-it-works` | How it works | **New**: the request journey with screenshots of the dashboard (request, options, warehouse photos, tracking) |
| `/about-us` | About | **Updated**: founder story and timeline kept; FaySource removed; editorial photos moved here (optional) |
| `/ebook/landed` | LANDED | **Not touched** in this rebuild (checkout, price, JSON-LD and images byte-for-byte). Only the shared header and footer would change, and only if you approve (decision 5). |
| `/terms`, `/terms-ebooks` | Terms | Kept; links and anchors unchanged |
| `app.fayfort.com/...` | Member dashboard | Linked from the site: Join free, Sign in, and deep links (Browse, Supplier directory, Orders & requests) |

Redirects: none needed. `/#contact` gets a real target.

## 4. Home page, top to bottom

**Header (sticky).** Logo · How it works · Services · Pricing · LANDED · About · **Sign in** · **Join free** (button).
On phones: logo, Join free and a menu button opening a full-width sheet.

**1. Hero with the globe.**
- Left (top on phones):
  - Eyebrow: "FAYFORT International Trading · Guangzhou".
  - Headline (draft): "From China's factories *to your door.*"
  - Line: "We source, inspect and ship for importers in Africa, the UK and the US, and you follow every step in your
    free FayFort dashboard."
  - Buttons: **Join free** · **Send a sourcing request** (the dashboard's request form, after sign-up) · text link "Get
    LANDED, the directory".
  - Small proof line: "8 years in China · Nigeria, Ghana, Zimbabwe, South Africa, UK, US".
- Right (below on phones): **the globe** (section 5).

**2. Proof strip.** Countries shipped to (flags or names), "Inspected at our Guangzhou warehouse", the Hangzhou Digital
Trade Expo talk, Zhejiang University of Technology. Later: real counters from the API (requests sourced, containers
shipped) once you want them public.

**3. How it works (4 steps).** Tell us what you need (link, photo or description) → We find options and quote them
within 24 hours → We check the goods at our warehouse (photos or video) → We ship and you track it. Each step shows a
small, real dashboard screenshot. "See how it works" goes to `/how-it-works`.

**4. What a free account gives you.** Four cards linking into the dashboard: **Sourcing requests**, **Shop and group
buys** ("Join the pool" for trending items), **Supplier directory** (markets, factories and service providers, unlock
contacts), **Consultations** (talk to the team).

**5. Plans at a glance.** Free / Standard $19 / Pro $49 with the four lines that matter (deposit, consultation,
contacts, ads). "Compare plans" goes to `/pricing`. The numbers come from the API, so they can't drift from the platform.

**6. LANDED.** Book cover, one line, $99, and "Get LANDED" linking to `/ebook/landed`. The checkout stays on that page.

**7. Meet FayFay.** Expo photo, three timeline points (2018 China, 2021 FAYFORT, 2026 LANDED) and "Our story" linking
to About. The blue satin portrait moves here from the hero.

**8. For businesses.** Market days, factory inspection, consolidation and freight, private label: one line each, linking
to `/services`.

**9. Questions (FAQ).** About 8 answers drawn from the knowledge base, so the site and the AI say the same thing: is it
free to start, what is the deposit, how is FayFort paid, how long does it take, what does shipping cost, can I get a
refund, when will a person reply, is this FayFay?

**10. Contact (`#contact`).** "Talk to the team": WhatsApp, email, business Instagram, and hours (Mon–Sat 9:30–18:30
China time). The personal Instagram moves to About.

**Footer.** Logo, short tagline, Explore (How it works, Services, Pricing, LANDED, About), Account (Join free, Sign in),
Contact, Legal (Terms, Ebook & Directory Terms), © FAYFORT International Trading.

## 5. The globe

**What it shows**
- A slowly turning globe made of fine navy dots (land), on the site's light background.
- **Guangzhou** as the origin, with a soft pink pulse.
- **Shipping routes** to Lagos, Accra, Harare, Johannesburg, Nairobi, London and New York, drawn as glowing arcs. Sea
  routes run a little lower and slower than air routes.
- Small **parcels** moving along the arcs. When one lands, the city pulses and a small card fades in for a moment, e.g.
  "Container · Guangzhou → Lagos · in transit", "Inspection passed · 24 photos", "Delivered · London".
- **Interaction**: drag to spin (touch too); hovering a city pauses and shows its card. It eases back to auto-rotate.
- **Content**: illustrative, not live orders. Later it can use real, anonymised counts per country from the API (your
  call).

**How it's built**
- **Canvas 2D with `d3-geo`** (orthographic projection) and a small world map file (Natural Earth 110m TopoJSON,
  self-hosted, about 100 KB). No WebGL and no three.js, so it works on old phones and adds about 40 KB of code.
- **Responsive**: it sizes to its box with sharp edges on retina screens, sits right of the headline on desktop and
  tablet, and below it on phones at about 80% of the screen width. Fewer routes are drawn on small screens.
- **Fast**:
  - The headline renders first (good LCP); the globe loads after the page is interactive.
  - It pauses when off screen or in a background tab, and is capped at 60 fps.
  - Before it loads, a static image of the globe holds the space, so nothing jumps.
- **Accessible**:
  - With "reduce motion" on, it shows one still frame with the routes drawn.
  - It has a text description ("Shipping routes from Guangzhou to Lagos, Accra, …") and needs no focus.
- **CSP**: everything is self-hosted, so no new outside domains.

Alternatives considered: `cobe` (tiny WebGL globe, but no arcs or labels), and three.js/globe.gl (looks rich but about
600 KB and heavy on phones). The canvas approach gives the arcs, parcels and cards we want at a fraction of the weight.

## 6. Design

- **Identity kept (decision D8)**: Ink navy `#02144e`, ink blue `#0540f2`, pink `#f20789` (LANDED accent), paper
  `#f1f1f1`, serif headlines (Iowan / Baskerville), Inter for text, and the butterfly as a small signature.
- **Feel**: calmer and more "logistics company" than "portfolio". Photography of goods, the warehouse and markets
  (needed from you) instead of editorial shots on Home.
- **Shared tokens with the dashboard**, so Join free → sign-up feels like the same product.
- **Breakpoints**: the dashboard's three (phone ≤639px, tablet 640–1023px, desktop ≥1024px). 16px body text minimum, no
  sideways scroll, 44px tap targets.

## 7. Technical

- **Stack**: stays Next.js in `web/`, with pages statically generated, on Vercel (decision D6).
- **New public API (small)**: `GET /public/plans` (prices from `plans.py`) and later `GET /public/stats` (counts for the
  proof strip and the globe), both cached. No member data.
- **SEO**:
  - Titles and descriptions per page, Organization and FAQPage JSON-LD.
  - Sitemap gets `/pricing` and `/how-it-works`.
  - OpenGraph image of the globe hero.
- **Analytics**: Vercel Analytics (already there). Events: Join free, Sign in, Send request, Get LANDED, WhatsApp.
- **Tests**:
  - Playwright at phone, iPad, laptop and desktop: no sideways scroll, hero buttons visible above the fold, the globe
    canvas present, and a reduced-motion still frame.
  - The existing LANDED Buy Button and CSP tests must keep passing unchanged.
  - Links into the dashboard return 200.
- **Performance budget (4G phone)**: LCP under 2.5 s, CLS under 0.05, home page JavaScript under 120 KB gzip
  including the globe.

## 8. Phases

1. **Content and design** (after your review): final copy for Home, Services, Pricing and How it works; a clickable
   Home preview with the real globe to review on your phone and laptop.
2. **Build**: header and footer, Home, the globe, Pricing, How it works, Services rewrite, About update, the public plans
   endpoint, and tests.
3. **Launch**: deploy to a Vercel preview URL for your check, then production. LANDED and Terms are checked before and
   after.
4. **Later (optional)**: live counts on the globe, public "What's moving" preview of trending items, and a WhatsApp click
   tracker.

## 9. Decisions (owner, 2026-10-16)

1. **Hero leads with the platform**: "From China's factories to your door." FayFay appears lower, in Meet FayFay.
2. **Main button: "Join free"** (app.fayfort.com/member/signup). "Sign in" beside it in the header.
3. **Editorial and modelling photos are removed** from the site.
4. **Globe shows sample routes** (illustrative) for now.
5. **LANDED page stays completely as it is**: no header, footer or content change.
6. **No prices on the public site.** There is no /pricing page; plans are described in words ("free to join, paid plans
   lower your deposits and add perks") and prices are shown inside the dashboard. The FAQ explains deposits and
   commission without figures.
7. **Photos and videos come from Instagram.** Staff paste post or reel links in Control Center → Website; the site shows
   them as cards in a "From the market floor" rail, each playing Instagram's own player when scrolled into view.
8. **Contact: the dashboard chat first**, WhatsApp second, then email and Instagram.

Changes to the sections above that follow from these:
- Site map: `/pricing` is dropped. Home section 5 becomes "Free to join, more with a plan" without numbers.
- Home section 2 (proof strip) is followed by the Instagram rail.
- Section 7: no `GET /public/plans`. New: `GET /public/site/instagram` (curated posts), and the Control Center page to
  manage them.

## 10. FayFort AI chat help (owner decisions, 2026-10-17)

**Decisions**
1. **"Talk to a person" (A)**: the website chat never opens a staff handoff. It offers **Join free** (the team replies in
   the member chat) and **WhatsApp**.
2. **Carry-over**: when a visitor joins free or signs in from the chat, the conversation is copied into their member
   chat, titled "From fayfort.com: …".
3. **Welcome bubble**: shown automatically on desktop, about 5 seconds after the page loads, once per visit. Phones show
   only the chat button.

**What was built**
- **Website** (`web/src/app/(site)/chat/`):
  - The chat sits on every page that uses the site layout. LANDED has its own layout and has no chat.
  - The chat button shows the logo on navy. The panel has a header with minimise (–) and close (×); minimised, it
    becomes a small bar showing the last reply, and it stays open or minimised when the visitor moves between pages.
  - Starter questions: How does it work? · Is it free to join? · Do you ship to my country? · Talk to a person.
  - While FayFort AI replies, the animated logo shows with "FayFort AI is typing…".
  - Buttons under replies: Join free / I have an account (both carry a one-time code) and WhatsApp us.
  - On phones the panel is a sheet covering most of the screen.
- **API** (`app/site/chat.py`):
  - Public: `GET /public/site-chat`, `POST /public/site-chat/messages`, `POST /public/site-chat/handoff`.
  - Member: `POST /members/site-chat/claim`.
  - Control Center (platform admin): `GET /platform/site/chat`, `GET /platform/site/chat/{id}`,
    `PUT /platform/site/chat/settings`.
  - Answers come from the same Knowledge and answer checks as the member chat. Website wording: no "dear", and the
    fallback answers point to joining free.
  - The visitor's token travels in a header; only its SHA-256 hash is stored. The CORS allow-list includes
    `https://www.fayfort.com` and `https://fayfort.com`.
- **Limits** (adjustable in Control Center → Website): 20 messages per visitor a day, 60 per network a day and 400 AI
  replies a day for the whole site. When a limit is reached, the reply offers Join free and WhatsApp without calling
  the AI.
- **Database**: migration `20261017150000_site_chat.sql`.
  - Tables: `site_chat_settings`, `site_chat_conversations` and `site_chat_messages`, reachable by the API only.
  - Function: `claim_site_chat`, which runs once per code and refuses codes that have expired or belong to another
    member.
- **Carry-over**:
  - The code from `?site_chat=` is kept in the browser and saved in the new account's sign-up details. So it still
    works when the verification email is opened in another browser.
  - The member chat claims the code on load and opens the copied conversation.
- **Control Center → Website**: a "FayFort AI on the website" section, with the on/off switch, the three limits,
  today's count, and the recent visitor chats (read only) marked "Joined".
- **Tests**:
  - API: 11 tests.
  - Dashboard: the claim and the sign-up code, plus the Website section.
  - Website: the chat is not on LANDED, and the CSP allows the API.
  - A browser check of the flow: the bubble, a starter, the typing state, talking to a person, minimise, moving to
    another page, Join free with the code, the phone sheet and LANDED.

## Customer reviews (2026-10-18)

Reviews on the www.fayfort.com home page ("What customers say", after How it works). Hidden until at least one is
published. Every review comes from a real customer; nothing is public until staff publish it.

**Two ways in**
- **Screenshots** (Control Center → Website → Customer reviews): staff drop in screenshots of reviews customers sent
  (Instagram, WhatsApp, Facebook, TikTok, email, Google). The API server reads the text with Tesseract, the chat model
  sorts it into the customer's words, name, country and product (copying only words that were read; anything that
  doesn't match the screenshot is flagged), and the review waits under "To check". Staff fix misreads and publish.
  The screenshot stays private (bucket `review-screenshots`) as the record of what the customer wrote. Reviews from a
  call or email can be typed in.
- **Members**: when a sourcing request ships (stage shipped, in transit, out for delivery or delivered) or Shopify marks
  a shop order shipped, the member gets a "How was your order?" notification and email, and a "How was it?" card in
  Orders & requests: stars, a few words, name shown (first name and initial) and country. These arrive in Control
  Center as "Verified order" reviews and admins get a notice. Staff can publish, hide or feature a member review but
  can't change its words or stars.

**On the website**: the average of the stars customers gave (screenshot reviews only count when the customer gave
stars), the number of reviews and the countries they came from, then the cards: stars or a quote mark, the words,
name, country, product and month, and "Verified order" or "via Instagram". Featured reviews come first; six show, the
rest behind "Show all". Cached 5 minutes.

**Rules**: publish every genuine review, good or bad; hide only spam, abuse or personal details. No made-up reviews.

**Build**: migration `20261019130000_customer_reviews.sql` (`customer_reviews`, `customer_review_invites`, triggers on
request events and shop orders, notification type `review_invite`); `app/site/reviews.py`, `app/site/review_import.py`;
the API image installs `tesseract-ocr`. Dashboard: `staff/WebsiteReviewsSection.tsx`, `member/ReviewPrompts.tsx`.
Website: `(site)/reviews/`. Tests: `tests/test_customer_reviews.py`, `WebsiteReviewsSection.test.tsx`,
`web/tests/reviews.test.ts`, e2e `reviews.spec.ts`.

## fayfort.com/go: link-in-bio pages (2026-10-20)

For Instagram and TikTok bios. Standalone layout (no site header, footer or chat), mobile first, navy field with faint flight paths, links drawn as route tickets with a perforated stub; pink only for what is live (the giveaway) and the main action.
- `/go` hub: FayFay's photo, "Buy from China without the guesswork.", the CAN → You route strip (the one animation, skipped with reduced motion), then tickets: live giveaway (with countdown, only when one is running), Shop (with 4 product photos), Find me a product (sourcing request), Book a consultation (from price), Tour guide in China (quoted).
- `/go/giveaway`, `/go/shop`, `/go/consultation`, `/go/tour-guide`, `/go/request`: one page each, one main button into the member app (signed-out visitors sign in or join first).
- Data: `GET /public/site/go` (app/site/go.py), read-only, no member data, cached 5 minutes. Product photos come from the public product-media storage, so `img-src` in next.config.js allows `lirauxdhnknfiqjnulxb.supabase.co`.
- The proxy allows exactly these six paths; they are in the sitemap.

## Cookies, visitor newsletter and visitor popups (owner request, 2026-10-25)

**Owner decisions:** Meta Pixel and TikTok Pixel; the banner shown to every visitor with marketing off until they agree;
the newsletter pitched as weekly China finds plus early access to giveaways; popups on fayfort.com and in the app's catalog
for signed-out visitors.

**Cookie consent** (`web/src/consent/`, `dashboard/src/lib/consent.ts`, `dashboard/src/app/consent/`)
- One cookie on `.fayfort.com`, `ff_consent=m1|m0.t<ms>`, shared by fayfort.com and app.fayfort.com; asked again after 6 months.
- Banner: Accept all / Necessary only / Choose (Necessary always on, Marketing switch). "Cookie settings" in every footer
  (site, /go, LANDED) and in the member app's Settings → Privacy reopens it. Policy at fayfort.com/cookies.
- Marketing: Meta Pixel and TikTok Pixel load only after consent, with page views on every route. The owner sets
  `NEXT_PUBLIC_META_PIXEL_ID` and `NEXT_PUBLIC_TIKTOK_PIXEL_ID` in Vercel (web project); without an ID a pixel stays off.
  Switching marketing off deletes `_fbp`, `_fbc`, `_ttp` and reloads the page.
- Google AdSense in the app requests non-personalised ads unless marketing consent is given.
- Vercel Analytics (no cookies) keeps running for everyone.

**Visitor newsletter** (`app/mailer/subscribers.py`, migration `20261025120000_newsletter_subscribers.sql`)
- `POST /public/newsletter/subscribe` (rate limited) sends "Confirm your email"; the link opens fayfort.com/newsletter,
  which confirms by script (so mail-app link scanners can't). Unsubscribe from a newsletter link asks first; the
  List-Unsubscribe header gives mail apps one-click unsubscribe.
- Control Center → Emails → Newsletter sends to members and confirmed visitors together; a visitor who is also a member
  gets the member copy only. It shows visitor counts, and warns above ~100 recipients (Resend free plan).
- Confirmation emails use the newsletter email type: switching Newsletter off in Control Center also pauses them.
- Sign-up forms: site footer, /go, the newsletter popup, fayfort.com/newsletter.

**Visitor popups** (`web/src/consent/VisitorPopups.tsx`, `dashboard/src/app/consent/VisitorPopups.tsx`)
- Never for members (`ff_member=1`, set when anyone signs in on app.fayfort.com), never before the cookie choice, at most one
  per visit, none for 7 days after closing (30 after subscribing).
- First visit: 4 product cards from `/public/site/go` after 25 seconds or half a page (fayfort.com) or after 4 seconds on the
  app's signed-out catalog and products pages; from the second visit, or when leaving the page on a computer: the newsletter.
- Not shown on LANDED, the terms, the cookie policy or the newsletter page; on fayfort.com/go/shop only the newsletter.
