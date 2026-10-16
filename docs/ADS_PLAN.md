# Ads on the member site: plan

Status: built 2026-10-16, waiting for push and the Google AdSense credentials.

## 1. Who sees ads

- **Free members see ads. Standard and Pro members see none.** The API decides from `member_profiles.member_tier`
  (Stripe billing keeps it current, so a paused or cancelled plan falls back to Free and ads come back).
- For paid members the Google script is **never loaded**, so nothing tracks them.
- Free members at rank Insider get Standard prices but still see ads (the rank isn't a paid plan).
- Every ad has a small "Ad" label and a "Remove ads" link that opens the plans pop-up.
- No ads in the Control Center, Operations Center, sign-in pages, emails, or the Shopify store.

## 2. Where ads go (member dashboard, app.fayfort.com/member/...)

| Placement key | Where | Shape | Default |
| --- | --- | --- | --- |
| `browse_top` | Browse, between "What's moving" and the search filters | wide banner | on |
| `browse_feed` | Inside the Browse product grid, after the 8th product and again after the 24th, looks like a product tile | in-feed card | on |
| `product_detail` | Product page, under the description and above "Goes well with" (never beside Add to cart) | wide banner | on |
| `directory_feed` | Supplier directory results, after the 5th result | in-feed card | on |
| `chat_welcome` | New chat welcome screen, below the trending rails (never inside a conversation) | wide banner | on |
| `sidebar` | Bottom of the left menu, desktop only | small square | on |
| `saved_footer` | Under Saved products (only when 4 or more are saved) | wide banner | off |
| `orders_footer` | Very bottom of Orders & requests, away from Pay buttons | wide banner | off |

Never: inside chat messages, in pop-ups or dialogs, near Pay, Add to cart or Unlock buttons, in settings,
notifications or the plans pop-up.

**Smart rules**
- At most **3 ads on one page** (setting). Placements have a priority; when a page has more, the lowest numbers win.
  Example: Browse shows the top banner, one in-feed card and the desktop menu ad; the second in-feed card waits.
- Ads load only when the slot scrolls near view, so they don't slow the page.
- If Google has no ad to show, the slot collapses, or shows a custom ad (placement source "Google, then custom").
- Slots follow the member's theme colours and sizes; feed ads take the same card shape as products.

## 3. Ad sources per placement

- **Google**: AdSense display or in-feed unit (ad unit ID per placement, format auto / fluid in-feed / rectangle /
  horizontal, optional in-feed layout key).
- **Custom**: FayFort's own ads (house ads or sold to partners): headline, text, button label, link, optional image,
  placements, weight, start and end dates, status (draft / active / paused / archived).
- **Google, then custom** (default): Google first, the custom ad if Google isn't set up or has nothing to show.

Placeholder custom ads are seeded so ads show before Google is approved: "Go ad-free with Standard", "Talk to the
FayFort team" (consultations), "Find verified suppliers" (directory), and a draft "Your brand here" partner slot.

## 4. Control Center → Platform admin → Ads

- **Settings**: ads on/off for everyone; Google on/off; AdSense publisher ID (`ca-pub-…`); Google test mode; most ads
  on one page; the ads.txt line and setup steps.
- **Placements**: each placement's on/off, source, Google ad unit ID, format, layout key, with where it appears.
- **Custom ads**: list, add, edit, pause, archive; image upload; live preview of the ad card; per-placement choice.
- **Results (last 30 days)**: views per placement (Google and custom), clicks and click rate for custom ads. Google
  clicks and earnings stay in AdSense (they happen inside Google's frame).

## 5. What you enter (credentials)

1. In AdSense, add the site **fayfort.com** and get your **publisher ID** (`ca-pub-…`).
2. Control Center → Ads → Settings: paste the publisher ID and switch Google on.
3. AdSense → Ads → By ad unit: create **display** units (for banners and the sidebar) and **in-feed** units (for
   `browse_feed` and `directory_feed`); paste each unit ID into its placement.
4. **ads.txt**: app.fayfort.com/ads.txt is served automatically from your publisher ID. Because the root domain is the
   Shopify store, add a Shopify URL redirect `/ads.txt` → `https://app.fayfort.com/ads.txt` (Shopify admin → Navigation
   → URL redirects) so Google finds it at fayfort.com/ads.txt.
5. AdSense → Privacy & messaging: turn on the GDPR consent message (Google's own consent banner, loaded by the same
   script) if you have visitors from Europe or the UK.

Until steps 1–3 are done, the placements show the custom (placeholder) ads.

## 6. Built pieces

- Migration `20261017130000_ads.sql`: `ad_settings`, `ad_placements` (8 seeded), `ad_creatives` (4 placeholders),
  `ad_daily_stats` + `record_ad_events()`; public storage bucket `ad-images`.
- API `app/ads/`: `GET /members/ads`, `POST /members/ads/events`, `GET /ads.txt`, and `/platform/ads/...` admin routes.
- Dashboard: `member/ads.tsx` (provider, slot, Google loader, custom card), slots in Browse, product, directory, chat
  welcome, sidebar, saved and orders; `staff/AdsPage.tsx` in the Control Center.
- Vercel: `/ads.txt` rewrite to the API.
