# FayFort authentication and workforce plan

Phase opened 2026-10-14, after the platform went live (`app.fayfort.com`, `api.fayfort.com`). The email system comes in the next phase. This phase includes only the auth email transport that sign-up, password reset and invitations need in order to work at all.

## Goal

Members, workers and platform admins each get a complete, secure account lifecycle:
- sign up or be invited;
- verify;
- sign in;
- recover a password;
- change a password or email;
- sign out everywhere.

Platform admins get a worker directory showing who is online, with timestamps and a detailed profile per worker. Every sensitive action is audited.

## Audit of what exists today (2026-10-14)

| Area | Exists | Missing |
| --- | --- | --- |
| **Member** (`/member/account`) | Email/password sign-up with a verification link; sign-in; "Continue with Google"; link Google in Settings; sign-out | Forgot password; reset-password page; change password in Settings; change email; resend verification email; clear expired-link states; bot protection on sign-up |
| **Control Center sign-in** (`/`, workers and admins) | Email/password sign-in | Forgot password; change password once signed in; any second factor (MFA) |
| **Worker onboarding** | Admin invites by email (`POST /platform/workers`); `/worker/accept` handles the invite link and lets the worker set a password; `type=recovery` links are understood | List of workers; resend or revoke an invitation; invitation expiry shown; deactivate/reactivate; force a password reset; MFA reset |
| **Worker presence** | `operations_worker_presence` heartbeat (online = seen in the last 90 s), written only while Operations Center is open; handoff shift availability (`available`/`away`/`offline`) on `fayfort_workers` | Presence from the whole Control Center, not just Operations; a last-seen and last-sign-in timestamp anywhere an admin can see it |
| **Control Center → Workers** | "Provision FayFort worker" invite form only | Directory, status, online indicator, timestamps, search, profile page |
| **Auth email delivery** | Supabase built-in mailer | **Custom SMTP is off.** Supabase's built-in mailer only sends to the project's team addresses and allows a few emails per hour, so public members cannot reliably receive verification or reset emails. The Supabase organisation is on the Free plan. |
| **Audit** | `platform_infrastructure` audit, business/handoff events | Auth and workforce audit trail (who invited, deactivated or reset whom, and when) |

## Owner decisions for this phase

Decided 2026-10-14. The owner chose AD1–AD3 in chat. AD4 and AD5 follow the recommendation under the owner's standing delegation.

| # | Decision | Decision taken |
| --- | --- | --- |
| AD1 | Auth email transport | **Decided: Resend.** Resend over SMTP from `auth@fayfort.com`. The `mail` and `send.mail` Resend records are already in Cloudflare DNS. Only the transport and branded Supabase auth templates are in scope here; the email system proper is next phase. **The owner creates the Resend API key and pastes it into Supabase; it is never put in chat.** |
| AD2 | MFA for staff | **Decided: required for staff.** Required (authenticator app, TOTP) for platform admins and workers; optional for members. TOTP is free on the current Supabase plan. |
| AD3 | Bot protection on member sign-up and password reset | **Decided: Turnstile.** Cloudflare Turnstile through Supabase's built-in captcha support. It is free and fits the Cloudflare setup we already have. |
| AD4 | Password policy | At least 10 characters with letters and digits, set in Supabase Auth. Leaked-password checking needs a paid Supabase plan, so it goes to the issue log rather than blocking this phase. |
| AD5 | Staff session lifetime | Staff sessions need re-authentication after 12 hours of inactivity. Deactivating a worker signs them out everywhere immediately. |

## Gates (weighted to 100)

| Gate | Weight | Accepted | Built (2026-10-14) | Summary |
| --- | ---: | ---: | --- | --- |
| A0. Auth email transport and Supabase Auth settings | 10 | 0 | **Configured 2026-10-14**: Resend verified, Turnstile site key in the dashboard; captcha secret goes into Supabase after the next deploy | Custom SMTP (Resend), branded auth templates, redirect URLs, password policy, rate limits, Turnstile keys |
| A1. Shared auth foundation | 10 | 0 | **Built** | One callback route for every auth link type, consistent states for expired or used links, shared password form with policy feedback |
| A2. Member account pipeline | 15 | 0 | **Built** | Sign-up hardening, resend verification, forgot/reset password, change password and email in Settings, sign out everywhere |
| A3. Staff account pipeline (workers and admins) | 20 | 0 | **Built** (API MFA enforcement ships switched off) | Control Center forgot/reset password, change password, invitation expiry/resend/revoke, mandatory MFA enrolment and challenge |
| A4. Worker directory | 15 | 0 | **Built** | All workers with status, online indicator, last seen, last sign-in, invited/activated dates, availability, search and filters, live refresh |
| A5. Worker profile and admin actions | 15 | 0 | **Built** | Detail page per worker with activity and admin actions (deactivate/reactivate, resend invite, force reset, reset MFA), all audited |
| A6. Security hardening and audit trail | 10 | 0 | **Built** | Workforce/auth audit log, server-side enforcement checks, session revocation, rate limits, tests |
| A7. Live acceptance | 5 | 0 | — | End-to-end run on `app.fayfort.com` with real inboxes, combined with the platform's outstanding Gate 4/6 live checks |
| **Total** | **100** | **0** | | Each gate's points are awarded only with live evidence on `app.fayfort.com` |

### A0 record (2026-10-14, 14:50–15:30 PT)

- **Resend.**
  - The domain `fayfort.com` was added in us-east-1. The old `mail.fayfort.com` domain had failed long ago and was left untouched.
  - Three records were added in Cloudflare, all DNS only: TXT `resend._domainkey` (DKIM), CNAME `send` → `send.forge.rmta.net` and CNAME `rsend` → `rsend.forge.rmta.net`.
  - The domain verified later the same afternoon, so Supabase auth emails now go out through Resend.
- **Supabase SMTP.** The owner set it up: `smtp.resend.com:465`, user `resend`, sender `auth@fayfort.com`, name "Fayfort". The owner entered the API key; the key first pasted in chat must be revoked.
- **Supabase Auth settings:**
  - minimum password length 10, letters and digits required;
  - secure password change on (reauthentication code);
  - secure email change on;
  - email OTP/link expiry 86400 s;
  - writing auth audit logs to the database turned on, so worker sign-in history appears;
  - redirect allow-list includes `https://app.fayfort.com/**` and `http://127.0.0.1:5173/**`.
- **Templates.** FayFort-branded templates for confirm sign-up, invite, reset password, change email, reauthentication and magic link.
- **Security notifications.** Turned on, with branded copy, for password changed, email changed, MFA added, MFA removed, sign-in method linked and sign-in method removed.
- **Database.** Migration `20261014100000_workforce_accounts` was applied to production through the SQL editor and recorded in `supabase_migrations.schema_migrations`.
  - The existing worker was backfilled: `invitation_sent_at` and `activated_at` are set.
  - `anon` and `authenticated` have no access to the ledger or the release function.
  - `workforce_auth_events` runs; the hosted database lets it read `auth.audit_log_entries`, which closes I5.

### Build record (2026-10-14)

- **Dashboard:**
  - `src/app/auth/`:
    - `authLinks` (link parsing, password policy, wording that doesn't reveal accounts);
    - `PasswordFields`, `SetPasswordForm` (handles Supabase's reauthentication code);
    - `RequestLinkForm` (reset and resend, 60 s cooldown);
    - `AuthPages` (`/auth/callback`, `/auth/forgot`);
    - `MemberSecuritySection` (change password, change email, sign out everywhere);
    - `StaffMfaGate` (TOTP enrolment and challenge on every staff page, 12-hour idle sign-out);
    - `Turnstile` (switches on once `VITE_TURNSTILE_SITEKEY` is set).
  - `staff/WorkforcePage` (directory and profile).
  - `staff/StaffAccountPage` ("My account").
  - Workers send a presence heartbeat from anywhere in the Control Center.
  - Tests: 91 dashboard tests pass, including 26 new ones.
  - Screenshots of the directory, the profile, the password step and mobile were checked.
- **API:**
  - `app/workforce/`: directory, profile, resend/revoke invitation, deactivate (status, release of work, ban), reactivate, password reset, MFA reset, own profile. Admin actions are limited to 30 a minute and recorded in `workforce_audit`.
  - `STAFF_MFA_REQUIRED` makes every staff check (`trusted_fayfort_staff`, `trusted_platform_admin`, worker tools) require `aal2`.
  - Invitations now point at `/auth/callback?audience=staff&type=invite`.
  - Tests: 410 backend tests pass, including 15 new ones.
- **Database.** Migration `20261014100000_workforce_accounts` was applied, together with all 74 earlier migrations, to a fresh PostgreSQL 16 database with Supabase-equivalent roles. Checks run there:
  - activation sets `activated_at`;
  - a claimed business handoff goes back to `requested` with its work item reopened;
  - an assigned member request is released, and presence is cleared;
  - `workforce_audit` rejects updates, deletes and unknown actions;
  - `anon` and `authenticated` are denied the ledger and both functions, while `service_role` is allowed.

### A0 — Auth email transport and Supabase Auth settings (10)

1. Resend: verify the `fayfort.com` sending domain (DKIM/SPF records added in Cloudflare, DNS only) and create an SMTP key. The owner does the key step.
2. Supabase → Auth → SMTP: enable custom SMTP, sender `FayFort <auth@fayfort.com>`. Raise the email rate limit from the built-in default.
3. Brand the Supabase templates for confirm sign-up, invite, magic link, password recovery, email change and reauthentication. Templates use short, plain FayFort wording, and every link lands on `app.fayfort.com/auth/callback`.
4. Password policy (AD4); captcha (AD3) with the Turnstile site key in the dashboard build and the secret in Supabase only.
5. Keep `docs/email/` Shopify templates untouched; this gate edits Supabase Auth templates only.
- **Acceptance:** a sign-up, a reset and an invite each reach a non-team inbox (Gmail and one other) within a minute; SPF/DKIM pass in the message headers; no secret appears in the repository.

### A1 — Shared auth foundation (10)

1. A single `/auth/callback` page handles `signup`, `invite`, `recovery`, `email_change`, `magiclink` and OAuth returns. It shows the next step and routes members to `/member/...` and staff to the Control Center. The existing `/worker/accept` stays as an alias so links already sent keep working.
2. Clear states for expired, already-used and wrong-browser links, each with a one-click "send me a new link".
3. A shared password form (new + confirm, policy hints, show/hide) is used by every set/reset/change flow.
4. Supabase redirect allow-list updated for `/auth/callback`.
- **Acceptance:** UI tests cover each link type and each failure state; old `/worker/accept` links still complete.

### A2 — Member account pipeline (15)

1. **Sign-up:** Turnstile; "Resend verification email" with a cooldown; a clear message when the email is already registered (without revealing whether an account exists to anyone else).
2. **Forgot password:** a link on member sign-in → email → `/auth/callback` → set a new password → signed in.
3. **Settings → Security:**
   - change password (requires the current password or a fresh reauthentication);
   - change email (confirmation sent to both addresses);
   - see linked sign-in methods;
   - "Sign out of all devices".
4. Google-only members can add a password from Settings.
- **Acceptance:** a full live loop for a new member — sign up, verify, sign in, forget the password, reset, change the password, change the email, sign out everywhere — with an old session rejected afterwards.

### A3 — Staff account pipeline (20)

1. **Control Center sign-in:** "Forgot password" → recovery email → set a new password. The same flow serves workers and admins.
2. **Staff profile menu:** change password (with reauthentication), sign out everywhere.
3. **Invitations:**
   - invitations show their sent time and expiry;
   - an admin can resend or revoke one;
   - revoking deletes the unused auth identity and its worker grant;
   - accepting moves the worker `invited → active` and records `activated_at`.
4. **MFA (AD2):**
   - first sign-in after accepting an invite requires TOTP enrolment;
   - every staff sign-in requires the TOTP challenge;
   - the API rejects staff endpoints for sessions without `aal2`;
   - recovery is through an admin "reset MFA" (A5), never a self-service bypass.
- **Acceptance:**
  - an invited worker accepts, sets a password, enrols MFA and signs in;
  - forgot-password works for a worker and for the admin;
  - a staff API call made with an `aal1` token is refused;
  - a revoked invitation link no longer works.

### A4 — Worker directory (15)

1. `GET /platform/workers` (admin only) returns every worker with:
   - email and display name;
   - status (`invited`/`active`/`inactive`);
   - online (heartbeat within 90 s);
   - `last_seen_at`, `last_sign_in_at`, `invited_at`, `activated_at`;
   - handoff availability;
   - MFA enrolled (yes/no);
   - open handoffs and assigned requests counts.
2. Presence is written by a heartbeat from the whole Control Center while a worker is signed in, not only from Operations Center. The existing table and 90-second rule are reused.
3. **Control Center → Workers page:**
   - the invite form;
   - a table with a green/grey online dot and "last seen 3 min ago" style timestamps (exact time on hover);
   - search, and filters for status and online;
   - live refresh every 30 s.
   - Workers sort online first, then by last seen.
- **Acceptance:** two worker sessions open in two browsers show as online; closing one turns it grey within about 2 minutes, with the right last-seen time; non-admins get 403 from the API and never see the page.

### A5 — Worker profile and admin actions (15)

1. `/staff/workers/:id` page:
   - identity, status and timeline (invited, activated, deactivated);
   - presence and last sign-in;
   - MFA state;
   - current handoffs and requests;
   - recent activity (claims, replies, returns to automation, request updates), taken from existing events;
   - the account's sign-in history from Supabase's auth audit log.
2. Admin actions, each confirmed and audited:
   - deactivate (status `inactive`, all sessions revoked, open handoffs released back to the queue);
   - reactivate;
   - resend invitation;
   - force password reset (sends the recovery email);
   - reset MFA.
3. A worker can see a read-only version of their own profile.
- **Acceptance:**
  - a deactivated worker is signed out within one request and cannot sign back in;
  - their claimed handoffs return to Available;
  - every action appears in the audit trail with the admin, the time and the target.

### A6 — Security hardening and audit trail (10)

1. New `workforce_audit` ledger (append-only, service-role only) covering invite, resend, revoke, activate, deactivate, reactivate, force reset, MFA reset and role changes.
2. Server-side checks on every staff endpoint:
   - an active worker or admin;
   - email confirmed;
   - `aal2`;
   - not deactivated (checked against the database, not only the JWT).
3. Rate limits on the invite and admin-action endpoints. Generic error messages on auth forms, so no account enumeration.
4. Backend and UI tests for every new endpoint and state; migrations verified on PostgreSQL 16 as before.
- **Acceptance:** the full test suites pass; a review checklist (enumeration, session revocation, RLS on new tables, no secrets in the client bundle) is recorded with evidence.

### A7 — Live acceptance (5)

This gate runs together with the platform's outstanding checks:
- Gate 4: Google sign-in and a worker invite on `app.fayfort.com`;
- Gate 6: an Instagram DM handled with the PC off, plus a staff reply.

The test worker:
1. is invited;
2. enrols MFA;
3. appears online in the directory;
4. claims the handoff and replies;
5. is then deactivated, and the handoff returns to the queue.

- **Acceptance:** every step recorded with timestamps in this file.

## Order of work

A0 first: without working auth email, none of the flows can be accepted live. A1 next. Then A2 and A3 in parallel, A4 before A5, A6 alongside each gate, and A7 last.

## Issue log

New or unresolved issues found during the phase are logged here and handled at the end of the phase unless they block a gate.

| # | Found | Issue | Status |
| --- | --- | --- | --- |
| I1 | 2026-10-14 | Prod tunnel still carries an unused `api-dev` ingress rule; the Infrastructure page warns about it | Open |
| I2 | 2026-10-14 | Leaked-password protection needs a paid Supabase plan (AD4) | Open, owner decision |
| I3 | 2026-10-14 | Platform plan Gate 6 items: unattended VPS reboot test, rotation of credentials that were on the PC, Cloudflare tunnel health notifications | Open, tracked in the platform plan |
| I4 | 2026-10-14 | Presence heartbeat existed only in Operations Center | Fixed in A4 build |
| I5 | 2026-10-14 | `workforce_auth_events` reads `auth.audit_log_entries` | Closed: the hosted database allows the read, and database audit logging was turned on |
| I6 | 2026-10-14 | Server-side session inactivity timeouts are a paid Supabase feature; AD5 is enforced in the browser (12 idle hours), and deactivation bans the account | Open, owner decision |
| I8 | 2026-10-14 | A Resend API key was pasted in chat; the owner should revoke it in Resend and keep the replacement out of chat | Open, owner |
| I7 | 2026-10-14 | If the only platform admin loses their authenticator, recovery is in the Supabase dashboard (documented in `deploy/README.md`) | Accepted |

## Scope guard

- Not in this phase:
  - the email system (transactional and notification email, inbox, newsletters);
  - member plan billing;
  - Gate 7 decommissioning.
- No change to LANDED, the Shopify store or `docs/email/`.
- Secrets are entered only by the owner, in Supabase, Resend or the VPS environment files.
