# FAYFORT public site (`web/`)

This is the public `fayfort.com` site:
- Home
- Services
- About
- Terms
- Ebook & Directory Terms
- **LANDED** (`/ebook/landed`), sold through the Shopify Buy Button

It moved here on 2026-10-13 from `prolifixs/Fayfort-International` as Gate 5 of `docs/PLATFORM_CONSOLIDATION_PLAN.md`. That repository keeps the full earlier history and will be archived at cutover.

Only the working parts came across: the normal public pages, and LANDED with its Shopify checkout (plan decision D11). Several things stayed behind:
- The old enterprise app: login, dashboard, admin, catalog, requests, invoices, Stripe, its Supabase projects and the `/api/*` routes. It was already closed in production. FayFort AI (`app/` + `dashboard/`, served at `app.fayfort.com`) replaces it.
- The `/book` consultation concept from the old `DEV` branch (D10). Consultations will be designed inside FayFort AI.
- FaySource.

```powershell
cd web
npm install
npm run dev     # http://localhost:3000
npm test        # LANDED protection tests
npm run build
```

## LANDED — handle with care

LANDED has real buyers. `tests/landed-protection.test.ts` fails if any of these change:
- the Shopify Buy Button wiring: shop, storefront token, product ID, checkout destination;
- the checkout URL or price;
- the Shopify entries in the Content Security Policy;
- the public routes buyers rely on: `/ebook/landed`, `/terms-ebooks#refunds` and `/terms`.

Change these only on the owner's instruction, and together with the Shopify store. The suite was checked by removing a Shopify CSP entry: the test failed as intended.

Never commit Shopify email templates. They contain live directory passwords, which is why `docs/email/` is ignored.

## Verification at the move (2026-10-13)

`web/` was built side by side with the old repository's production build and compared:
- **Status codes:** every route returns the same status. Public pages return 200; `/login`, `/dashboard` and `/api/*` return 404; `/products/fay` returns 307 to `/`.
- **Headers:** security headers are identical, including the CSP. On the same day, the CSP entries for the retired app (Supabase, Stripe, YouTube, Vimeo) were removed; the Shopify entries are unchanged.
- **Content:** the six pages have identical text, links, images, meta tags and LANDED structured data.
- **Screenshots:** full-page captures at 1440px and 390px are pixel-identical (0 differing pixels on all 12).
- **Stripe:** the new build no longer loads Stripe.js on every page.

## Deploy

1. Previews come from the Vercel project `fayfort-web` (**Root Directory `web/`**, no domains). At the Gate 5 switch, the fayfort.com domains move to it after owner sign-off.
2. Once the app is live, set `FAYFORT_APP_URL=https://app.fayfort.com`. Retired URLs (`/login`, `/register`, `/dashboard`, `/catalog`, `/request`) then redirect to the app.
