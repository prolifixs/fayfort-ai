# FayFort platform consolidation — Cloudflare integration and single-project merge

Created 2026-10-13. Status: **0 / 100 accepted**. Decisions are recorded. The local build work for Gates 2–5 is done and tested; live acceptance waits on the owner action queue below. The owner asked for the work to run autonomously and approved the major decisions on 2026-10-13. Owner approval is required before each live DNS, hosting, credential or data change. As in the other plans, points are earned only when a gate's acceptance evidence is recorded; writing code or applying a migration earns none by itself.

## Goal

FayFort AI becomes the one FAYFORT platform: one repository, one deployment pipeline, and one domain served through Cloudflare.

- **Domain:** `fayfort.com` is served through Cloudflare with permanent hostnames. Temporary quick tunnels and hand-edited webhook URLs go away.
- **Public site:** the public pages of the old website (`prolifixs/Fayfort-International`) move into this repository. The old repository, Vercel project and Supabase project are retired.
- **Managed from FayFort AI:** platform admins can see and manage Cloudflare (tunnel health, public hostnames, webhook endpoints) from the FayFort AI dashboard, not from a command line.

### Target layout

| Hostname | Serves | Source in this repo | Hosting |
| --- | --- | --- | --- |
| `fayfort.com`, `www.fayfort.com` | Public site: home, Services, About, Terms, Ebook terms, LANDED | `web/` (Next.js, moved from the old repo) | Vercel during the merge; optionally Cloudflare later (decision D6) |
| `app.fayfort.com` | Member app, worker/staff Operations Center, Control Center | `dashboard/` (Vite) | Cloudflare Pages |
| `api.fayfort.com` | FastAPI: member/staff APIs and Instagram/Messenger webhooks | `app/` | Always-on host, reached only through a named Cloudflare Tunnel (no open ports) |
| `api-dev.fayfort.com` | The same API running on the development PC | `app/` | Named Cloudflare Tunnel from the PC; replaces the trycloudflare quick tunnels |

DNS records move to Cloudflare. **The domain stays registered at Hostinger**; only its nameservers change.

## What exists today (audited 2026-10-13)

**Old website — `prolifixs/Fayfort-International` (Next.js 16 on Vercel)**
- The public surface is six routes, all enforced by `src/proxy.ts`: `/`, `/services`, `/about-us`, `/terms`, `/terms-ebooks` and `/ebook/landed`.
- LANDED is sold through a Shopify Buy Button (`8kjjz9-ei.myshopify.com/products/landed`, $99).
- About 1.2 MB of images live in `public/images` (brand, fay, landed).
- The site depends on WhatsApp/Instagram/email contact constants, security headers/CSP, and its sitemap and robots files.
- `https://www.fayfort.com/terms` is the URL entered in the Meta app for both Terms and Privacy. It must keep working through every phase.
- **The enterprise app is closed in production** (`ENABLE_ENTERPRISE` unset):
  - It covers login/registration, catalog, requests, invoices, Stripe payments, notifications, admin and 40+ API routes.
  - It uses a **separate Supabase project** (`uxbakpeeqydatgvvdyaa`), not FayFort AI's (`lirauxdhnknfiqjnulxb`).
  - It is closed because of the open access-control issues in its `docs/SECURITY-REVIEW.md`.
  - FayFort AI already covers the same jobs (member accounts, catalog, sourcing requests, timeline, Operations).
- FaySource (`/products/fay`) is closed; it redirects home unless `FAYSOURCE_ZONE_URL` is set.

**FayFort AI (this repository)**
- FastAPI is configured from `.env` (`API_HOST`/`API_PORT`, single source of truth since 2026-10-13). The dashboard is Vite/React.
- Development runs on the owner's PC. Meta reaches it through a temporary trycloudflare quick tunnel whose URL changes on every restart.
- CORS allows only `127.0.0.1:5173` and `localhost:5173`. Supabase Auth redirects and `WORKER_INVITE_REDIRECT_URL` point at `127.0.0.1:5173`.
- Instagram is live-accepted end to end (L7-004/005). Messenger (L7-024) is open, and the owner's Meta setup is Instagram-based.

**DNS and email:** `fayfort.com` DNS is hosted at Hostinger. A public lookup on 2026-10-13 shows the domain's mail is handled by **Google** (`MX 1 smtp.google.com`, TTL 14400), so `support@fayfort.com` depends on the Google MX record and any Google SPF/DKIM/DMARC TXT records. The Hostinger zone export in Gate 0 is the authoritative list.

## Owner decisions — recorded 2026-10-13

| # | Decision | Outcome |
| --- | --- | --- |
| D1 | Move `fayfort.com` nameservers from Hostinger to Cloudflare (Free plan) | **Approved.** The registrar stays Hostinger; every existing record (website, Google email) is copied first. |
| D2 | Subdomains `app.` / `api.` / `api-dev.` as in the target table | **Approved.** |
| D3 | Production API host | **Approved: Hostinger VPS** (small Linux VM), running the API and cloudflared as services |
| D4 | Old Supabase project `uxbakpeeqydatgvvdyaa` | **No customers on the old site (owner, 2026-10-13); FayFort AI is the system of record.** No data migration. Export a backup, then pause the project in Gate 7. |
| D5 | Old enterprise app code (Stripe, invoices, PDF, email queue) | **Approved: not ported.** It stays archived with the old repository. |
| D6 | Public-site hosting after the merge | **Approved:** stays on Vercel (root `web/`) through cutover; Cloudflare hosting revisited afterwards |
| D7 | Messenger (L7-024) | **Approved: deferred.** Moved to P2 in `LAYER7_COMPLETION_TRACKER.md` until FAYFORT has a Facebook Page; Instagram is the live channel. |
| D8 | Visual identity | **Approved:** the public site keeps its FAYFORT look; shared logo, colour and type tokens with the app |
| D9 | LANDED | **Owner requirement:** LANDED has real Shopify buyers and is the one old-site feature that must be handled with care. See "LANDED protection" below; it overrides any other step in this plan. |

## LANDED protection (non-negotiable)

LANDED (`/ebook/landed`) is a live product: the $99 LANDED directory sold through Shopify to real buyers. Nothing in this plan may interrupt it, change its checkout, or break links buyers or Shopify depend on.

**What it depends on (audited from the old repository):**
- **Shopify Buy Button.**
  - Component: `src/app/components/ShopifyBuyButton.tsx`.
  - It loads `https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js` and builds a client for shop `8kjjz9-ei.myshopify.com` with the public storefront token.
  - Product ID `11224254382422`, `buttonDestination: checkout`, custom pink button styles.
  - It shows a fallback link to `CHECKOUT_URL` until Shopify's iframe appears.
- **Configuration.** `src/app/ebook/landed/config.ts`: `PRICE_USD = 99`, `PRICE_WAS_USD = 150`, `CHECKOUT_URL = https://8kjjz9-ei.myshopify.com/products/landed`.
- **Content Security Policy entries** (in `next.config.js`) that allow Shopify:
  - `script-src https://sdks.shopifycdn.com`
  - `connect-src https://8kjjz9-ei.myshopify.com https://monorail-edge.shopifysvc.com`
  - `frame-src https://8kjjz9-ei.myshopify.com`
  - `img-src https://cdn.shopify.com`
  - `form-action https://8kjjz9-ei.myshopify.com`
  - Removing any of these breaks the buy button silently and leaves only the fallback link.
- **Page, layout and SEO.**
  - `src/app/ebook/landed/page.tsx` and `layout.tsx`, including the Book and Product JSON-LD structured data with the offer price and checkout URL.
  - `DirectoryCarousel.tsx`.
  - Images in `public/images/landed/` (`landed-front.jpg`, `landed-back.jpg`, `fayfay.jpg`).
- **Linked legal pages** buyers rely on: `/terms-ebooks` (including the `#refunds` anchor) and `/terms`.
- **Analytics.** Vercel Analytics in the root layout.
- **Access gate.** The old site's `proxy.ts` allow-list (`/ebook/landed` and `/ebook/landed/*`).

**Rules for every gate:**
1. **No URL changes.** `https://www.fayfort.com/ebook/landed`, `/terms-ebooks` (with `#refunds`) and `/terms` keep working at every step, including during the DNS move and the hosting switch.
2. **No checkout changes.** The shop domain, storefront token, product ID, button destination and checkout URL are copied byte-for-byte. Price changes happen only on the owner's instruction, in Shopify and in `config.ts` together.
3. **No change to the Shopify side.** This plan never edits the Shopify store, product, Buy Button channel or storefront token.
4. **CSP parity.** Every Shopify CSP entry above is carried into `web/` and checked by an automated test.
5. **Switch gates.** Before any production switch (DNS in Gate 1, hosting in Gate 5, cutover in Gate 7), on the new deployment:
   - the page renders;
   - the Shopify iframe button replaces the fallback link;
   - clicking it opens the Shopify checkout for LANDED at the current price;
   - `/terms-ebooks#refunds` resolves.
   - If the owner chooses, a real or 100%-discount test order confirms the download email. The owner places it; the plan never does.
6. **Rollback first.** If any check fails after a switch, roll back immediately (nameservers in Gate 1; Vercel production deployment in Gate 5) before investigating.

## Progress — 2026-10-13

| Gate | Built locally (no live change) | Live acceptance still needed |
| --- | --- | --- |
| 0 | Decisions D1–D9 recorded. Public DNS lookup: mail is Google (`MX 1 smtp.google.com`). LANDED dependency audit is in the "LANDED protection" section. | Hostinger zone export; Vercel/Meta/Supabase/Google configuration record; LANDED baseline screenshots of production |
| 1 | — | Cloudflare account and zone, record reconciliation, nameserver switch (owner actions A2–A4) |
| 2 | `PUBLIC_API_URL` in `.env`. The preflight defaults to it. `start-local-api.ps1` reports the cloudflared Windows service. `start-tunnel.ps1` stays as a fallback. | Named tunnel `fayfort-api-dev` and the `api-dev` hostname (created from the Infrastructure page once Cloudflare is connected); connector service on the PC; Meta callback set once |
| 3 | **Built.** Migrations `20261013100000_platform_infrastructure_cloudflare` (vault-backed platform integration, webhook endpoint registry, append-only audit) and `20261013110000_platform_infrastructure_health_alerts` (health ledger; one admin inbox alert per state change), both verified on PostgreSQL 16 with Supabase-equivalent roles. Admin-only `/platform/infrastructure` API: Cloudflare verify, tunnels, guarded `api*` hostname routing that never overwrites unmanaged DNS, audited connector install command, webhook save and server-side preflight. Infrastructure page in the Control Center. Health monitor (`INFRASTRUCTURE_MONITOR_ENABLED`). 17 backend tests and 2 UI tests. | Apply both migrations; connect Cloudflare; live tunnel status; preflight; stop/recover the tunnel to see the alert |
| 4 | `APP_PUBLIC_URL` and `ALLOWED_ORIGINS` settings. CORS and the worker invitation redirect are derived from them. The dashboard API address is derived from `.env`. | Cloudflare Pages project; Supabase Auth and Google redirect URLs; signed-in checks at `app.fayfort.com` |
| 5 | **Built.** `web/` holds the six public routes and LANDED. Compared with the old production build: same status codes, identical security headers, identical text, links, images, meta tags and structured data, and pixel-identical screenshots (12/12). LANDED protection tests are in place, and they were checked by deliberately breaking the CSP. Retired-URL redirects switch on with `FAYFORT_APP_URL`. | Point the Vercel project at this repository (root `web/`); preview check; production switch |
| 6–7 | — | Hostinger VPS; production tunnel; cutover and decommission |

## Owner action queue

These steps need the owner's accounts. Everything else continues without waiting.

1. **A1 — Commit and push.** Commit the working-tree changes in `fayfort-ai` and push them to GitHub. Vercel (Gate 5) and Cloudflare Pages (Gate 4) build from GitHub. In the same commit, stop tracking `dashboard/node_modules`:
   ```
   git rm -r --cached dashboard/node_modules dashboard/tsconfig.tsbuildinfo dashboard/test-results
   ```
2. **A2 — Hostinger DNS export (Gate 0).** In Hostinger, open Domains → fayfort.com → DNS / Nameservers and export or screenshot every record.
3. **A3 — Cloudflare account (Gate 1).**
   - Create a free Cloudflare account and add `fayfort.com`.
   - Create an API token with Account › Cloudflare Tunnel › Edit and Zone › DNS › Edit (fayfort.com only).
   - Note the account ID.
   - Enter the token, account ID and domain on **Control Center → Platform → Infrastructure** (never in chat). The page then shows the two Cloudflare nameservers.
4. **A4 — Nameserver switch (Gate 1).**
   - After the records are reconciled against A2 and the LANDED switch-gate checks are ready, replace Hostinger's nameservers with the two from A3 (Hostinger → Domains → fayfort.com → Nameservers).
   - Rollback: put Hostinger's nameservers back.
5. **A5 — Apply the two new migrations** to Supabase project `lirauxdhnknfiqjnulxb`, from the repository root:
   ```
   supabase db push
   ```
   Alternatively, paste the two files into the Supabase SQL editor. Then run the usual read-only checks and record both ledger rows.
6. **A6 — Connector on the PC (Gate 2).**
   - On the Infrastructure page: create tunnel `fayfort-api-dev`, route `api-dev`, then open **Install command (Windows)**.
   - Run that command once in an Administrator PowerShell.
   - Set `PUBLIC_API_URL=https://api-dev.fayfort.com` in `.env`, then set the Meta callback **once** to `https://api-dev.fayfort.com/webhooks/instagram`.
7. **A7 — Vercel (Gate 5).** In the existing fayfort.com Vercel project, connect the `fayfort-ai` repository with Root Directory `web/`. Check the preview deployment before promoting it.
8. **A8 — Hostinger VPS (Gate 6).** Order a small Linux VPS and share SSH access the way you prefer when Gate 6 starts.

## Phases and weighted acceptance gates

| Gate | Weight | Accepted | Summary |
| --- | ---: | ---: | --- |
| 0. Inventory, backups and decisions | 5 | 0 | Everything needed to change DNS/hosting safely, plus decisions D1–D9 |
| 1. Cloudflare zone onboarding | 10 | 0 | `fayfort.com` served by Cloudflare DNS with no website or email interruption |
| 2. Permanent API tunnel (development) | 10 | 0 | `api-dev.fayfort.com` → PC API as a Windows service; Meta webhook URL permanent |
| 3. Cloudflare inside FayFort AI | 20 | 0 | Platform admin Infrastructure view: Cloudflare connection, tunnel health, hostnames, webhook endpoints, preflight |
| 4. App hosting at `app.fayfort.com` | 10 | 0 | Dashboard on Cloudflare Pages against the public API; auth/CORS/redirects updated |
| 5. Public site moved into the monorepo | 20 | 0 | `web/` serves the same public pages from this repo; enterprise code left behind |
| 6. Production API host | 15 | 0 | `api.fayfort.com` served from an always-on host; PC stays on `api-dev` |
| 7. Cutover and decommission | 10 | 0 | Old repo/Vercel/Supabase retired, redirects in place, docs and trackers closed |
| **Total** | **100** | **0** | |

### Gate 0 — Inventory, backups and decisions (5)

- **DNS export.** Export the full `fayfort.com` zone from Hostinger (every A/AAAA/CNAME/MX/TXT/SRV/CAA record) and store it outside the repo. Note which records serve Vercel and which serve email (MX, SPF, DKIM, DMARC; Resend, if used).
- **Configuration record.** Write down, without secrets:
  - the Vercel project's domains and environment variable names;
  - the Meta app's domains, callback URL and Terms/Privacy URLs;
  - the Supabase Auth site URL and redirect list for both projects;
  - the Google OAuth origins and redirects;
  - the Shopify Buy Button settings.
- **Old database.** D4 is settled by the owner: no customers, no migration. Take a backup export of the old Supabase project before Gate 7 pauses it.
- **LANDED baseline.** Record the live LANDED baseline for the switch-gate comparisons:
  - full-page screenshots (desktop and mobile);
  - confirmation that the Shopify button loads and opens checkout;
  - page title and OpenGraph tags;
  - the response headers, including the CSP.
- **Decisions.** Record D1–D9. **Done 2026-10-13.**
- **Acceptance:** the export is stored, the configuration record is written, the LANDED baseline is recorded, and the decisions are recorded.

### Gate 1 — Cloudflare zone onboarding (10)

1. Add `fayfort.com` to a Cloudflare account (Free plan). Let Cloudflare scan the zone, then reconcile it line by line against the Gate 0 export and add anything missing (especially the email TXT/MX records).
2. Set the records for Vercel (`@`/`www`) to **DNS only** (grey cloud), as Vercel recommends for domains it serves. Email records are never proxied.
3. Lower the TTLs at Hostinger first if possible, then switch the nameservers at Hostinger to the two Cloudflare nameservers.
4. Verify:
   - `www.fayfort.com` and `/terms` load over HTTPS;
   - the LANDED switch-gate checks pass;
   - the Vercel domain still shows as valid;
   - an email to and from `support@fayfort.com` works;
   - SPF/DKIM/DMARC checks pass.
- **Rollback:** restore the Hostinger nameservers. The Hostinger zone is left intact until Gate 7.
- **Acceptance:** Cloudflare shows the zone **Active**, and every check above passes and is recorded.

### Gate 2 — Permanent API tunnel for development (10)

1. In Cloudflare Zero Trust, create a remotely managed named tunnel, `fayfort-api-dev`, with public hostname `api-dev.fayfort.com` pointing to `http://127.0.0.1:<API_PORT>`.
2. Install cloudflared on the PC as a Windows service using the tunnel token, so it starts with Windows and survives restarts.
3. Repository changes:
   - `start-local-api.ps1` reports the tunnel service state;
   - `start-tunnel.ps1` becomes a fallback only;
   - add `PUBLIC_API_URL=https://api-dev.fayfort.com` to `.env` as the single source for the public address;
   - preflight defaults to it.
4. Set the Meta Instagram webhook callback **once** to `https://api-dev.fayfort.com/webhooks/instagram`.
5. Cloudflare protection: rate-limit `/webhooks/*`; leave bot-fight/challenge rules off webhook paths so Meta is never challenged.
- **Acceptance:**
  - the preflight passes against `api-dev.fayfort.com`;
  - a real Instagram DM is processed through it;
  - after a PC restart, the tunnel comes back without manual steps and a second DM is processed;
  - a Meta duplicate callback still returns `processed: 0`.

### Gate 3 — Cloudflare inside FayFort AI (20)

Platform-admin only. No member or business user sees any of this.

- **Connection.** A platform-level "Cloudflare" connection.
  - The API token is stored in the existing credential vault, never returned by the API, never logged.
  - It is a scoped token: Account › Cloudflare Tunnel: Edit; Zone › DNS: Edit for `fayfort.com` only. Account ID and zone ID are saved as safe settings.
  - Verify-token flow (like Instagram's verify step).
- **Infrastructure view** in the Control Center:
  - tunnels with their status, active connectors and last seen;
  - public hostnames with their ingress targets;
  - DNS records for the managed hostnames;
  - all of it read from the Cloudflare API and cached briefly.
- **Webhook endpoint registry.** One row per channel (Instagram; Messenger when D7 allows) showing:
  - the public URL;
  - the last preflight result and time;
  - the last signed event received and time.
  - A **Run preflight** button runs the same checks as the CLI, server-side, against the public hostname.
- **Managed hostnames.**
  - Create or repair the `api*` hostnames and their DNS records from the dashboard. These are guarded actions: confirmation plus an audit event.
  - The system never deletes records it did not create, and never touches the email records or the Vercel `@`/`www` records.
- **Health in Operations.** Tunnel down, webhook failures or a missed expected event raise the existing automation-failure style admin notification.
- **Migration.** Platform infrastructure settings and audit tables with RLS and service-role-only RPCs, following the existing migration and ledger rules.
- **Acceptance:**
  - focused backend and UI tests pass;
  - a signed-in admin sees live tunnel status and runs a passing preflight;
  - a deliberate tunnel stop raises the admin alert and recovery clears it;
  - no secret appears in any response or log.

### Gate 4 — App hosting at `app.fayfort.com` (10)

1. Cloudflare Pages project from the monorepo:
   - root `dashboard/`, build `npm run build`, output `dist`;
   - SPA fallback so `/member/*`, `/operations` and `/worker/*` deep links work;
   - `VITE_FAYFORT_API_URL=https://api-dev.fayfort.com` for now (`api.` after Gate 6).
2. API configuration:
   - add an `ALLOWED_ORIGINS` setting in `.env`, replacing the hard-coded CORS list, and include `https://app.fayfort.com`;
   - set `WORKER_INVITE_REDIRECT_URL` and member callbacks to `app.fayfort.com`.
3. Supabase Auth: site URL and redirect allow-list (`/member/account`, `/worker/accept`, Google callback). Google OAuth: authorised JavaScript origin.
4. Security headers (CSP, HSTS, frame-ancestors) on Pages.
- **Acceptance:**
  - member sign-in (email and Google), chat, a request, and the Operations Center all work at `app.fayfort.com` in signed-in sessions;
  - a worker invitation link lands on `app.fayfort.com/worker/accept`;
  - local development still works unchanged.

### Gate 5 — Public site moved into the monorepo (20)

1. Copy the public part of the old repository into `web/`. Done 2026-10-13 without importing the git history; the old repository keeps the full history and is archived in Gate 7.
2. Then remove what isn't needed, all of which stays archived in the old repository:
   - the closed enterprise app: login/register, dashboard, admin, catalog, request, invoices;
   - all `src/app/api/*` routes, Stripe/Resend/pdfkit code;
   - the old Supabase client, `proxy.ts` enterprise branches, dead code listed in the old `PROGRESS.md`, and unused dependencies.
3. Keep and verify:
   - `/`, `/services`, `/about-us`, `/terms`, `/terms-ebooks`, `/ebook/landed` and its Shopify Buy Button;
   - images, contact config, metadata/OpenGraph, sitemap, robots and security headers (update the CSP for the new origins).
4. Connect the public site to the platform:
   - add "Member sign in" / "Request sourcing" entry points linking to `app.fayfort.com/member/...`;
   - the contact options stay as they are.
5. Shared brand tokens (logo, colours, type) in one place, used by `web/` and `dashboard/` (D8).
6. Point the existing Vercel project at this repository with root directory `web/`, keeping the same domains. Previews deploy on pull requests.
- **Acceptance:**
  - a preview deploy matches production for all six routes (side-by-side screenshots, plus every sitemap URL returning 200 with the same titles/OG tags);
  - `/terms` is unchanged;
  - the LANDED protection checks pass on the preview, and the CSP parity test passes;
  - no enterprise route or `/api/*` route exists in `web/`;
  - the production switch happens only after owner sign-off.

### Gate 6 — Production API host (15)

1. Provision the D3 host:
   - Python environment and the API as a system service, using `python -m app` with production `.env` settings;
   - schedulers enabled deliberately;
   - log rotation; automatic security updates; no inbound ports open (the tunnel only).
2. Create the named tunnel `fayfort-api` → `api.fayfort.com` on that host. Move the Meta webhook to `https://api.fayfort.com/webhooks/instagram`. The PC keeps `api-dev`.
3. Point the Pages production build at `https://api.fayfort.com`; preview builds keep `api-dev`.
4. Secrets live in host environment files only. Rotate any credential that has been on the PC or in screenshots. Turn on Cloudflare health notifications.
- **Acceptance:**
  - an Instagram DM is processed with the PC switched off;
  - the Infrastructure view shows both tunnels;
  - restarting the host restores service unattended;
  - a staff reply is delivered;
  - the runbook for restart, deploy and rollback is written.

### Gate 7 — Cutover and decommission (10)

1. **Redirects** for retired old-site URLs:
   - `/login` and `/register` → `app.fayfort.com/member/account`;
   - `/dashboard*` → `app.fayfort.com/member/chat`;
   - `/catalog*` → `app.fayfort.com/member/products`;
   - `/request` → the member request form;
   - `/products/fay*` → `/`.
2. After a two-week watch with no errors:
   - archive the old GitHub repository (read-only);
   - remove the old Vercel project;
   - per D4, export then pause the old Supabase project;
   - revoke the old app's Stripe/Resend/Supabase keys;
   - remove the leftover Hostinger DNS zone copy.
3. Update the README, `PROJECT_STATUS.md` and trackers. Retire `start-tunnel.ps1` quick-tunnel instructions.
- **Acceptance:** each item checked off with evidence. The only FAYFORT project left running is this repository.

## Order of work and dependencies

Gate 0 → Gate 1 → Gate 2, and the dependencies after that:
- Gate 3 starts on top of Gate 2.
- Gate 4 can run in parallel with Gate 3 once Gate 1 is done.
- Gate 5 can start (local work only) at any time; its production switch needs Gate 1.
- Gate 6 needs Gates 2 and 4.
- Gate 7 comes last.

The live-acceptance runbook items that are still open (Operations Gate 2 via Instagram, and the D7 decision on Messenger) can close in parallel with Gates 0–2.

## Scope guard

New requests during this plan are classified like the Departmental Flow State plan's scope rule:
- a blocker of the active gate is added to that gate;
- anything else goes to the backlog with owner and date.

No live DNS, hosting, credential, Meta or data change happens without explicit owner approval for that step.
