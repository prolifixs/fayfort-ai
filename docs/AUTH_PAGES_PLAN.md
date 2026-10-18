# Sign-in pages: one sign-in, and a globe background (plan for review)

Status: live 2026-10-17 (03b5b1e). Reset-link fix and the logo (sections 8–9) built 2026-10-17. Owner decisions: navy look, admins who are also members land in the
Control Center, globe on the two-step verification screen too.

## 1. The two sign-in pages today

| | Old: Control Center sign-in (`app.fayfort.com/`) | Recent: member sign-in (`/member/account`, `/member/signup`) |
| --- | --- | --- |
| Label | "FAYFORT CONTROL CENTER · Sign in" | "FAYFORT MEMBER ACCOUNT · Member sign in / Create your account" |
| Email + password | Yes | Yes |
| Google | No | Yes ("Continue with Google") |
| Create account | Link to `/member/signup` | Built in (switches mode) |
| Resend verification email | No | Yes |
| Captcha (Cloudflare Turnstile) | Yes | Yes |
| Forgot password | `/auth/forgot?audience=staff` (reset link brings staff back to the Control Center) | `/auth/forgot?audience=member` |
| After sign-in | Two-step verification (staff MFA gate), then the Control Center | Member profile check, then `/member/chat` |
| Footer link | "Create a FayFort member account" | "Return to FayFort Control Center" (removed in this batch) |

**What the old page has that must be kept** when it goes:
1. **The staff two-step verification gate** (StaffMfaGate). It runs after sign-in, not on the form, so it stays as it is.
2. **Staff password reset**: the reset email must send staff back to the Control Center, not to the member chat.
3. **Sending staff to the Control Center** after they sign in.

Everything else (email, password, captcha) is already on the member page.

## 2. One sign-in for everyone

- **Keep the recent page** and make it the only sign-in. Its label becomes "FAYFORT ACCOUNT", and its line becomes
  "Welcome back. Sign in to your FayFort account." (it never mentions staff).
- **After sign-in, the account decides where you go:**
  - FayFort staff (platform admin, or an active worker) → two-step verification → Control Center (`/`) or Operations.
  - Members → `/member/chat` (as today).
  - Someone who is both (an admin who is also a member) → Control Center, with a link to their member chat.
- **`app.fayfort.com/` signed out** shows this same sign-in instead of the old card. The old card's code is removed.
- **Forgot password**: one page. The reset link returns the person to wherever their account belongs (staff → Control
  Center, members → chat), worked out from the account, not from a link parameter.
- The member page no longer links to the Control Center, and the Control Center no longer advertises member sign-up.

## 3. How workers get in without a public link

The Control Center is protected by **who you are**, not by a hidden address:

1. **Invitation**: a platform admin invites a worker in Control Center → FayFort Workers. The worker gets an email and
   sets a password at `/worker/accept`.
2. **Sign in**: workers go to `app.fayfort.com` (bookmark it) and use the same sign-in as members. Their account has the
   staff role, so they land in the Control Center or Operations.
3. **Two-step verification**: staff must pass the authenticator code (the existing gate) before anything loads.
4. **The API checks every request**: staff screens only show data when the server confirms the staff role and two-step
   verification. A member who types `app.fayfort.com/operations` sees a "not allowed" message and gets no data.

So no public link to the Control Center is needed, and knowing the address gives nobody access. If you'd still like a
quieter way in, the invitation email can carry a "Sign in to FayFort" button, and Control Center pages can be kept out of
search engines (`noindex`). Both are in the build list.

## 4. The globe background

**Pages:** sign in, create account, forgot password, set a new password, the email-link pages ("Email confirmed",
"This link can't be used"), worker invitation, and the two-step verification screen.

**Layout**
- **Desktop and tablet**: a large globe on the right, bigger than the screen, so its edge runs off the top and right.
  Routes run from Guangzhou (pink pulse) to Lagos, Accra, Nairobi, Harare, Johannesburg, London and New York, with
  parcels moving along them. The card sits on the left, over open space, and is never covered.
- **Phone**: the globe sits behind the top third, and the card below it fills the width (16px margins).
- **Top bar**: the FAYFORT logo on the left and "← fayfort.com" on the right. On staff-only screens (two-step
  verification, worker invitation) the right-hand link is hidden.
- A quiet caption at the bottom right on desktop: "Shipping from Guangzhou to …" (hidden on phones).

**The card stays clean**: plain white, 18px corners and a soft shadow. No transparency or blur, so forms are always
easy to read. The fields, buttons and captcha are unchanged.

**Two looks (pick one)**
- **A. Navy** (recommended): a deep navy background, light-blue dots, white route trails and pink parcels. The white
  card stands out strongly and it feels premium.
- **B. Light**: the site's pale background with navy dots and blue routes. It matches the public home page.

**Behaviour**
- Same globe code as the home page (no map library). It turns slowly and doesn't respond to drag, so it never gets in
  the way of the form.
- Pauses in background tabs. With "reduce motion" it shows a still picture.
- Loads after the card, so sign-in is never slower.
- It doesn't cost anything after the page loads (it uses no data).

## 5. Build list (after your approval)

1. One sign-in page with role-based landing; the old Control Center sign-in removed.
2. Forgot password and reset links that land by account.
3. Globe background on every page in section 4, in the look you choose.
4. Invitation email button "Sign in to FayFort"; `noindex` on the app.
5. Tests: members land in the chat and staff in the Control Center after two-step verification; a member can't open
   staff pages; layout checks at phone, iPad, laptop and desktop; still frame with "reduce motion".

## 6. Decisions (owner, 2026-10-17)

1. **Look: A, navy.**
2. **Admins who are also members land in the Control Center.**
3. **The two-step verification screen gets the globe too.**

## 7. What was built

- `auth/AuthPage.tsx` + `AuthGlobe.tsx` + `auth-shell.css`: the navy frame on sign in, create account, forgot password,
  email-link pages, the two-step verification screen, worker invitation and worker password pages.
- `auth/landing.ts`: platform admins, active workers and business owners → Control Center; other members → member chat.
  Used after email sign-in, Google sign-in, email links and password resets, and when a member opens `app.fayfort.com`.
- The old Control Center sign-in is removed; `app.fayfort.com/` signed out shows the one sign-in.
- `noindex` on the app (meta tag and `X-Robots-Tag` header).
- Not done: the "Sign in to FayFort" button in the invitation email. Those emails are Supabase's templates, managed in
  the Supabase dashboard, and the existing link already leads to setting a password and then the Control Center.
- Tests: landing rule, one sign-in at `/` and `/member/account`, and layout checks at phone and laptop for four screens.

## 8. Password reset links said "expired" (fixed 2026-10-17)

**Cause.** Supabase's auth log for the owner's reset showed the same link opened twice from the owner's network,
12 seconds apart:
- 01:13:46, the first open: it signed in and used up the one-time link;
- 01:13:58, the second open, the click the owner saw: refused as "invalid or has expired".

Something on the device or in the mail app opened the link before the click, and links used to be used up on opening.
A second problem made the page vaguer than it should have been: supabase-js wiped the error from the address before
the page read it, so the page showed a general message.

**Fix**
- Email links now open `/auth/callback?type=…&token_hash=…`. The page shows a **Continue** button ("Continue to reset
  password", "Confirm my email", "Accept invitation"), and only that click uses the code (`verifyOtp`). Opening or
  scanning the link uses nothing, and the link works in any browser or on any device.
- While the Continue step shows, an account already signed in on that browser is ignored. After the click, the code
  is removed from the address.
- The page reads the address before supabase-js clears it, so expired links get the right message.
- Worker password resets sent from the Control Center use the same link (`hashed_token` from `generate_link`).
- **Supabase email templates** (confirm sign-up, invite, magic link, change email, reset password) link to
  `{{ .SiteURL }}/auth/callback?type=<type>&token_hash={{ .TokenHash }}` in place of `{{ .ConfirmationURL }}`.
  The reset password, confirm sign-up and invite templates were switched on 2026-10-17 after this version went live.
  Change email and magic link keep Supabase's default link, because the app doesn't use them.
- **Security check (Turnstile)**: a check that fails is retried twice by itself, and then the page offers "Try again"
  instead of asking for a reload. A page left open a long time gets a fresh check by itself (`refresh-expired: auto`).
- The public sign-in page no longer says that staff use the same sign-in. It now reads "Welcome back. Sign in to your
  FayFort account.", and a test checks that the page doesn't mention staff or the Control Center.

## 9. The logo

- The owner's logo was traced into a vector (`dashboard/src/app/brand/`, `web/src/app/components/brand/`). There are
  four versions: colour, white-and-pink for navy, silver, and one colour.
- The placeholder "F" squares are replaced everywhere:
  - sign-in pages, the member chat and pages, and the Control Center sidebar;
  - the website header and footer;
  - the app icon and tab icon. The tab title is now "FayFort", and the theme colour is navy.
- **Loading animation** (2.2 s loop): the outline draws in, the shell fills, the F slides up, then a silver shine
  sweeps across. With "reduce motion" on, it fades gently instead.
  - It replaces the "Loading…" and "Checking…" lines across the dashboard (42 places).
  - The opening screen ("Opening FayFort…") uses the white version on the navy globe.

## 10. Staff sign-in cancelled at once, and password reset on accounts with an authenticator (fixed 2026-10-18)

**What the owner saw**:
- The admin account (password or Google) seemed to "do nothing".
- A worker's password reset failed with "AAL2 session is required to update email or password when MFA is enabled".

**Causes**:
1. **The 12-hour idle rule ran against an old timestamp.** The staff gate keeps the last activity time in the
   browser. When a staff member signed in again after more than 12 idle hours, the gate found the old time (39 hours
   on the owner's Chrome) and signed the brand-new session out.
   - Supabase showed the sign-in succeeding (last sign-in 00:40 PT) with 0 sessions left afterwards.
   - The worker account was unaffected because its time was recent.
2. **Accounts with an authenticator need the code before a password change.** A reset link signs in at the first
   level (AAL1), and Supabase refuses the change until the 6-digit code is entered (AAL2). The reset page never asked
   for the code.

**Fixes**:
- The idle rule treats a fresh sign-in as activity: it compares the session's sign-in time with the stored time.
  Ending an idle session also clears the stored time.
  - The owner's Chrome was cleared by hand on 2026-10-18, so the admin can sign in before the push.
- The password form (reset link, invitation and settings) checks the account. When it has an authenticator, an
  "Authenticator code" field appears above the new password. The code is verified (`challengeAndVerify`) before the
  password is saved. If Supabase still answers "AAL2 required", the field appears with a clear message.
- Tests: the idle rule (old time ends an idle session and is cleared; a fresh sign-in is never ended), the authenticator
  step on a staff reset link, and the AAL2 message.
