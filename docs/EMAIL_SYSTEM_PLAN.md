# FayFort email system plan

Phase opened 2026-10-14. The phase goal comes from the owner:

> apply emailing to notifications, conversations and fulfilments for customers … an email management section in the control center where i can manage the mails sent, toggle off … newsletter i can send to everyone … keep it simple.

Sign-in emails (verification, invitation, password reset, change email, security alerts) stay with Supabase Auth, which sends them through Resend SMTP. That was set up in the auth plan, A0. This phase adds FayFort's own emails, sent through the Resend API.

## What exists

- **In-app alerts.** `member_notifications` already records every customer alert inside database transactions, so it is the single source for email:
  - `worker_reply`: a FayFort person replied in the member chat (**conversations**);
  - `request_milestone`: a request moved stage, from submitted through sourcing and purchase to shipped and delivered (**fulfilment**);
  - `photo_review_status` and `recurring_schedule_update` (**account notifications**).
- **Email sending.** The domain `fayfort.com` was added in Resend on 2026-10-14 and is **Verified**; its DNS records are in Cloudflare.
- **Missing pieces:** FayFort's own email sending, member email preferences, unsubscribe, a log of sent emails, admin controls and a newsletter.

## Decisions

| # | Decision | Taken |
| --- | --- | --- |
| ED1 | Transport | The Resend HTTP API from the VPS API, sending as `FayFort <updates@fayfort.com>` with reply-to `support@fayfort.com`. The owner puts the API key in `/opt/fayfort/api.env` as `RESEND_API_KEY`. Sending stays off until `EMAIL_DELIVERY_ENABLED=true`. |
| ED2 | Source of truth | A database trigger copies each new `member_notifications` row into an `email_outbox` row. A background sender on the VPS delivers it. Nothing is emailed from request paths, so a slow email can never slow a reply or a request update. |
| ED3 | Chat replies | At most one conversation email per member every 15 minutes. Later replies in that window are skipped with the reason "coalesced", because the member is already on their way back to the chat. |
| ED4 | Member control | Each member can turn conversations, fulfilment, account notifications and newsletter emails on or off in Settings. Every email has a one-click unsubscribe link for its category. |
| ED5 | Admin control | Each category can be switched off for everyone in Control Center → Emails. Security emails (staff password resets) cannot be switched off. |
| ED6 | Newsletter (kept simple) | A subject plus a plain-text body (blank lines make paragraphs, links become clickable), a preview, "send a test to me", and "send to all subscribed members". It goes to members with a confirmed email who haven't unsubscribed; staff accounts are excluded. One send per newsletter, recorded with counts. |
| ED7 | Content | Emails show a short excerpt (at most 240 characters) and a button back to the app. Prices, addresses and photos are never included. |
| ED8 | Staff password reset | The admin "Send password reset" action uses Supabase `generate_link` and FayFort's own sender, so it keeps working once Turnstile captcha is enforced on the public reset endpoint. |

## Gates (weighted to 100)

| Gate | Weight | Accepted | Summary |
| --- | ---: | ---: | --- |
| E0. Foundations | 20 | 0 | Outbox, category settings, member preferences, newsletters tables; Resend client; background sender with retry/backoff; branded HTML and plain-text rendering |
| E1. Customer emails | 20 | 0 | Conversation replies (coalesced), fulfilment milestones, account notifications, each with its own wording and a link back to the app |
| E2. Member preferences and unsubscribe | 10 | 0 | Settings toggles, one-click unsubscribe page, `List-Unsubscribe` header |
| E3. Control Center → Emails | 20 | 0 | Category on/off switches, 7-day counts, delivery log with filters, retry of failed emails, configuration status |
| E4. Newsletter | 15 | 0 | Compose, preview, test send, send to subscribers, history with counts |
| E5. Security and hardening | 10 | 0 | Admin-only routes, server-side checks, rate limits, append-only audit of admin email actions, staff reset through the own mailer, Turnstile on sign-in forms |
| E6. Live acceptance | 5 | 0 | Real inbox checks for every category plus a newsletter test, on production |
| **Total** | **100** | **0** | Each gate's points are awarded only with live evidence |

## Build record (2026-10-14)

All of the following is built and tested locally. Migration `20261014200000_email_system` was **applied to production** on 2026-10-14 (5 category rows, trigger present, `anon` and `authenticated` denied) and recorded in `schema_migrations`. The code is waiting for the owner's push.

- **Database.** Migration `20261014200000_email_system`:
  - category switches with five seeded rows;
  - `member_email_preferences` (with unsubscribe tokens), `newsletters` and `email_outbox`;
  - an append-only `email_admin_audit`;
  - the `member_notifications → email_outbox` trigger;
  - `claim_email_outbox` (`skip locked`) and `requeue_stale_email_outbox`;
  - every table is service-role only.

  Checks run on PostgreSQL 16 with all earlier migrations applied:
  - a worker chat reply queues a `conversations` email;
  - claim and requeue work;
  - the audit table rejects updates;
  - `authenticated` and `anon` are denied;
  - re-running the migration is harmless.
- **API, `app/mailer/`:**
  - `resend_client` treats 429 and 5xx as retryable and other errors as permanent, and sends an idempotency key;
  - `render` produces the branded HTML and plain-text versions;
  - `sender` handles switches, preferences, 15-minute coalescing, confirmed-email-only, backoff of 1, 5, 15 and 60 minutes, at most 5 attempts, and the `List-Unsubscribe` headers;
  - `router` serves the overview, switches, log, retry, newsletter CRUD/preview/test/send, member preferences and the token unsubscribe (page and one-click).
  - The workers' "Send password reset" now uses `generate_link` plus the FayFort sender (ED8).
  - Tests: 428 backend tests pass, 18 of them new.
- **Dashboard:**
  - Control Center → **Emails** (platform admin) with three tabs: Email types, Sent emails, Newsletter (with preview, test and confirm-before-send);
  - Member Settings → **Email notifications**;
  - a public `/email/unsubscribe` page;
  - the Turnstile site key, active on `*.fayfort.com` only.
  - Tests: 99 dashboard tests pass, 8 of them new.
  - Screenshots of the three Email tabs and two sample emails were checked.

## Issue log

| # | Found | Issue | Status |
| --- | --- | --- | --- |
| M1 | 2026-10-14 | Resend's free plan allows about 100 emails a day and 3,000 a month; one newsletter to a large list can exceed that | Open, owner decision when the list grows |
| M2 | 2026-10-14 | Members opted in to newsletters by default; every newsletter carries an unsubscribe link | Accepted, revisit if needed |
| M3 | 2026-10-14 | When Supabase captcha is on, local dashboards on 127.0.0.1 can't sign in (Turnstile doesn't support localhost); sign in on app.fayfort.com | Accepted |

## Scope guard

Not in this phase:
- staff email notifications (Operations Center keeps its in-app alerts);
- scheduled or segmented newsletters, HTML editors or images;
- Supabase Auth templates, which are done.

No change to LANDED, Shopify or `docs/email/`.
