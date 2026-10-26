# Bookings, availability, the CEO and her assistant, and adding staff from existing accounts

Status: batches 1 and 2 built 2026-10-26 (section 11); batches 3 to 6 next. Owner decisions in section 9.

## 1. What exists today

| Piece | State |
| --- | --- |
| Virtual consultation | Member app → Tools → Virtual consultation: the member types a topic. An invoice for $100 / $85 / $50 is sent; once it's paid a chat opens and a `consultation` work item goes to member support. **No date or time is picked.** Staff agree the time in the chat. Operations has no Consultations list; it shows up only as a queue item. 1 booking so far (cancelled). |
| Tour guide | Member app → Tools → Tour guide: city, arrival date, days, people, needs. Operations → Tour bookings: quote → paid → name the guide (free text) → done. The arrival date is a wish, not checked against anyone's calendar. 0 bookings. |
| fayfort.com /go | The "Book a consultation" and "Tour guide" buttons open the member app's Tools page. Signed-out visitors go to sign in, and the deep link may be lost on the way. |
| Staff | 1 active worker (in 5 departments) and 1 platform admin. `fayfort_workers` has no role or title. |
| Inviting staff | Control Center → Workforce → Invite sends a Supabase invitation by email. **An email that already has an account is refused** ("An account with this email already exists"). |
| Calendars | Operations → Schedule shows giveaways, sales, sections, launches and deadlines. Nothing knows when anyone is free. Working hours are fixed in code (Mon–Sat 9:30–18:30 China time). |

## 2. What we're building

1. **One booking engine**: availability, time off, a slot finder, holds and no double-booking. Consultations, staff sessions and tours all use it.
2. **Capture on every front end**: pick a date and time in the member app and from fayfort.com, pay, get a confirmed time with the call link, reminders, and the option to move or cancel.
3. **Operations → Bookings**: one place for every booking (list and calendar), replacing the Tour bookings tab.
4. **Executive office**: the CEO (only one) and her personal assistant. They're one team but see different things.
5. **Staff sessions**: members book a session with a chosen worker, from that worker's availability.
6. **Google Calendar**: the CEO's bookings go into her Google Calendar with an automatic Meet link, and her Google busy times block slots.
7. **Add staff from existing accounts**: search users, pick a role and departments, send the invitation link.

## 3. Roles and what each person sees

New `fayfort_workers.staff_role`: `staff` (default), `assistant` or `ceo`. A database rule allows only one CEO. Roles sit on top of departments; they don't replace them.

| Person | Lands on | Sees | Can do |
| --- | --- | --- | --- |
| **CEO** | **Today**, a clean single page | Her schedule today and this week (time, member, topic, call link, a "Join" button 10 min before); a live pulse refreshed every 30 s: new members, orders and revenue today, sourcing requests, open work by department, people waiting for a human, new bookings; and anything flagged "for the CEO" | Join calls, add a short note after a call, mark it done, flag "needs the assistant". **She doesn't manage her calendar**; the assistant does. |
| **Assistant** | Operations → Bookings | All bookings; the **CEO's calendar**: weekly hours, blocked time and days off; plus their own departments | Set and change the CEO's availability, confirm, move, cancel or refund within the rules, add or override the call link, write the brief the CEO sees before each call |
| **Staff** | Operations queue (as today) | Their own bookings and their own availability (Account → My availability) | Set their weekly hours and time off, run their sessions |
| **Admin** | Control Center | Everything, plus the settings below | Everything. Can step in for the assistant |

Notifications: a new booking on the CEO's calendar goes to the assistant (a work item) and shows up on the CEO's Today page. The CEO isn't emailed about every booking, only a morning summary of the day (optional).

## 4. Booking engine

**Tables**
- `staff_availability`: weekly hours per person (weekday, start, end, time zone, which kinds: consultation, session, tour). The CEO's rows are entered by the assistant.
- `staff_time_off`: blocked periods per person (holiday, travel, "not this Friday").
- `bookings`: one row per booked time. Host, kind (`consultation`, `session`, `tour`), member, start and end, status (`held`, `confirmed`, `completed`, `no_show`, `cancelled`), the link to its source record, invoice, call link, Google event id, reminders sent, and reschedule count. A database exclusion rule makes double-booking a host impossible, even when two people click at the same moment.

`member_consultations` and `member_tour_bookings` stay and point to their booking row, so revenue, chats and invoices keep working.

**Slot finder** (`GET /bookings/slots?kind=&host=&from=&to=`): weekly hours minus time off, existing bookings and Google busy times, then the rules:

| Rule | Default (changeable in Control Center) |
| --- | --- |
| Consultation length | 60 min, plus a 15-min gap after |
| Earliest booking | 24 hours from now |
| Furthest booking | 60 days ahead |
| Hold while unpaid | 24 hours, then the slot is freed and the invoice cancelled |
| Times shown | The member's own time zone, with China time beside it |

**Hold, then pay**: picking a slot holds it and sends the invoice. Payment confirms it (the Shopify webhook, as today). Not paid within 24 hours means the slot is released and the member is told. One unpaid hold per member at a time. This keeps the slot finder from being filled by people who never pay.

## 5. Front ends

**Member app → Tools**
- **Virtual consultation**: topic → choose a day and time (the CEO's free slots) → pay → confirmed, with the time in their zone, the Meet link and an "Add to my calendar" (.ics) link. *Move* or *Cancel* buttons follow the 24-hour rule.
- **Book a staff session** (new): pick a person (photo, name, what they help with, rating once they have 5) → pick a time → pay or free (section 9) → confirmed.
- **Tour guide**: pick arrival date and days on a calendar showing which days a guide is free → request → quote (dates held while the quote is open) → paid → confirmed with the guide's name (picked from staff, no longer free text).
- **Orders & requests** lists upcoming bookings with Join, Move and Cancel.

**fayfort.com /go/consultation and /go/tour-guide**: show the next free times live (times only, no names). "Book this time" carries the chosen slot through sign-up or sign-in, so it isn't lost, and lands the member on the payment step with the slot held. An account is required (free) because the invoice and chat belong to it.

**Emails** (outbox, `commerce_` templates): booked (with time and link), paid and confirmed, reminder 24 h and 1 h before, moved, cancelled or refunded, hold expired, and "how did it go?" afterwards (feeds the existing worker ratings).

## 6. Operations → Bookings (replaces Tour bookings)

- **List**: Today, Upcoming, Needs action (unpaid holds near expiry, tours to quote, missing call links), Past. Filters by host, kind and status.
- **Calendar**: day and week, with a colour per kind and one column per host for the assistant and admins.
- **Booking detail**: member, topic or brief, time in China and in the member's zone, payment, call link, chat, history. Actions: confirm, move (offers free slots), change host, add or replace the link, mark done or no-show, cancel with or without refund (the rule is shown; staff can override with a reason).
- Each booking still gets a work item (member support, or the host's department for sessions), so the queue, deadlines and reports keep working.
- **Schedule** tab: bookings appear as a new type there too.

## 7. Google Calendar (CEO first, any host later)

- **Setup, done once by you**: create a Google Cloud OAuth client (Calendar API on). You paste the client ID and secret in Control Center → Infrastructure → Connections; I'll walk you through it but won't enter secrets.
- **Connecting**: the CEO (or the assistant, signed in as her Google account) clicks "Connect Google Calendar" on the Executive page. FayFort stores the refresh token encrypted, server-side only.
- **What it does**: a confirmed booking creates an event on her calendar with a Google Meet link, which becomes the booking's call link. Moving or cancelling updates or removes the event. Her Google "busy" times are read and blocked in the slot finder, so a dentist appointment in Google can't be booked over. Only free/busy is read, never event details.
- **If Google is down or not connected**: bookings still work. The assistant gets a "Add the call link" task and pastes one by hand.

## 8. Adding staff from existing accounts

Control Center → Workforce → **Add staff** has two tabs:
1. **Existing account**: search by email, name or username (admin only, at least 3 characters, 10 results, people who aren't staff yet). Pick one → choose role (staff, assistant, CEO) and departments → **Send invitation**. They get an email with an "Accept staff invitation" link (expires in 7 days). Opening it while signed in as that account and pressing Accept makes them active. Two-step verification is then required the first time they open the Control Center, as for all staff.
2. **New person by email**: the current invitation, with role and departments added.

- Their member account stays: orders, chats and points are untouched. Staff who are also members get a "My member account" link in the account menu.
- Only one CEO: inviting a second one is refused unless you first move the role. A pending CEO invitation counts too.
- Every step is written to the workforce audit log. Revoke and resend work as today.

## 9. Decisions

Taken 2026-10-25:
1. **Booking a worker** means a session with a chosen staff member, each with their own availability.
2. **Consultations** are with the CEO only; the assistant manages her calendar.
3. **Cancelling or moving** a paid consultation (and session): free up to 24 hours before (full refund); inside 24 hours or a no-show, no refund. Staff can override with a reason.
4. **Call link**: Google Calendar with an automatic Meet link; the assistant pastes a link by hand when Google isn't connected.

Still open (defaults used unless you say otherwise):
5. **Staff session price**: free for members, or a price per worker? Default: $25 for 30 minutes, Pro first-month rules as for consultations.
6. **Who can book sessions**: every member, or Standard and Pro only? Default: every member.
7. **CEO's weekly hours to start with**: default Mon–Fri 14:00–18:00 China time, which the assistant changes.
8. **Morning summary email to the CEO**: default on, at 08:30 China time.

## 10. Batches

| # | Batch | Contents |
| --- | --- | --- |
| 1 | Roles and onboarding | `staff_role`, one-CEO rule, search existing users, invitation and accept flow for existing accounts, role picker, "My member account" link |
| 2 | Booking engine and Operations | Tables, slot finder, holds and expiry, emails, Operations → Bookings (list, calendar, detail), the assistant's CEO calendar, Schedule integration |
| 3 | Member and website capture | Consultation and tour date pickers, Orders & requests, move and cancel, /go live slots with the hold kept through sign-up |
| 4 | CEO Today page | Schedule, live pulse, notes, morning summary |
| 5 | Staff sessions | Worker profiles for booking, own availability, session pricing |
| 6 | Google Calendar | OAuth connection, events with Meet links, free/busy blocking (needs your OAuth client) |

Each batch comes with tests (API, dashboard, website, end-to-end), screenshots at phone, iPad and desktop, guide text, and updates to this document, the system map and the AI knowledge (booking rules).

## 11. What was built

### Batch 1: roles and adding staff (2026-10-26)
- Migration `20261027090000_staff_roles_and_invitations.sql`: `fayfort_workers.staff_role` (staff, assistant, ceo),
  `job_title`, `invite_kind` (new_account, existing_account), `invite_token_hash` (sha256 only), `invite_expires_at`,
  `pending_departments`. Unique index: one CEO counting a pending invitation. Audit actions `role_changed`,
  `invitation_accepted`. `apply_pending_worker_departments`, `accept_staff_invitation`, `search_accounts_for_staff`
  (service role only). The email-confirmation trigger now only activates new-account invitations and applies their
  departments.
- API (`app/workforce/onboarding.py`): `GET /platform/staff/candidates?q=` (3+ characters, 10 results, says who can't be
  invited and why), `POST /platform/staff/invitations` (an email that already has an account is switched to the
  existing-account invitation automatically), `PUT /platform/workers/{id}/role`, `GET /staff/invitations/{token}`
  (masked email, role, expired), `POST /staff/invitations/accept` (signed in as the invited account). Links last 7 days;
  resending makes the old link stop working; revoking an existing-account invitation never deletes the account.
- Control Center → FayFort Workers → **Add staff** (Existing account / New person, role cards, job title, departments);
  role chip in the list; Role and Change role on the profile. `/staff/join` accepts the invitation; signed-out people sign
  in and come back to it (`dashboard/src/lib/returnTo.ts`, FayFort app paths only). "My member account" in the staff menu.

### Batch 2: booking engine and Operations → Bookings (2026-10-26)
- Migration `20261027100000_bookings_engine.sql`: `staff_availability`, `staff_time_off`, `bookings` (exclusion rule
  `bookings_no_double_booking` on host and [start, end + gap)), `booking_settings` (one row, defaults as in section 4,
  plus session price $25 and 2 member moves), `member_consultations.booking_id`. btree_gist in the extensions schema.
- Engine (`app/bookings/engine.py`): slot finder (30-minute steps, notice, horizon, gap, time off, live bookings), hold
  (one per member per kind), confirm, move (member: before the cut-off, at most 2 times; staff: any free time, even
  outside weekly hours), cancel (member before the cut-off gets a refund marked due; staff choose; system releases
  expired holds and deletes the unpaid Shopify draft order), done / no-show, mark refunded, call link / brief / host note,
  paid after the hold ran out (keeps the time if still free, otherwise refund due). Emails `commerce_booking_*`.
  Sweep every 5 minutes: expired holds, reminders 24 h and 1 h before, "how did it go?" after a completed booking.
- Consultations: `POST /members/consultations` accepts `starts_at` and `time_zone`; with a CEO set up the time is held on
  her calendar and confirmed when the invoice is paid; the chat and work item say the time. Without a time (the current
  member screen) it works as before.
- API (`app/bookings/router.py`): Operations bookings (list views, range, detail, move, cancel, finish, refunded,
  details, slots), availability and time off, `/platform/bookings/settings`, member slots / list / move / cancel.
- Operations → **Bookings** replaces Tour bookings: Bookings (Needs action, Today, Upcoming, Past), Calendar (week, China
  time), Hours & time off ("CEO's hours" for the assistant), Tours. Bookings also show on the Schedule.
- Not yet: the member date picker and fayfort.com slots (batch 3), the CEO Today page (4), staff sessions (5), Google
  Calendar (6). Until batch 3, members still book consultations without a time.
