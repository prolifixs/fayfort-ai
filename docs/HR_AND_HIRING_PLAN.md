# HR and hiring: structure and design plan

Status: **proposed 27 Oct 2026, checked against the code and given screen designs 30 Oct 2026, owner decisions taken
30 Oct 2026 (section 9).** Ready to build H1.

Screen designs: the "FayFort HR and hiring screens" canvas (careers page, role page and application, candidate status
link on a phone, Control Center People → Hiring with a candidate open, Operations My HR).

Owner ask: "an HR and hiring system, a simple platform that integrates with the system accordingly."

## 1. Goal

One simple place to find people, hire them and look after them, built on what FayFort already has instead of a
separate HR product. A hire moves from the careers page to the Operations Center without anyone typing their details
twice: **apply → screen → interview → trial task → offer → hire → staff invitation → welcome tour → first week**.

## 2. What already exists and gets reused

| Already built | Used for |
| --- | --- |
| Staff invitations, roles (staff, assistant, CEO), job titles and departments (`fayfort_workers`, `app/workforce/onboarding.py`) | "Hire" sends the existing invitation with the role, desks and job title filled in from the offer |
| Welcome tour and first-week checklist by desk (Operations R7) | The new hire's first days, unchanged |
| Clock in and out, timesheets, corrections, CSV (`worker_shifts`) | Hours and time off |
| Customer ratings, admin reviews, fresh start (`worker_ratings`, `worker_reviews`) | Performance and probation reviews |
| Booking engine, CEO calendar, staff availability, Google Calendar plan | Interview slots and invitations. Interviews become a new booking kind (`interview`) so the existing no-overlap rule stops double booking an interviewer |
| `staff_time_off` (booking engine: blocks a host's bookable slots) | Time off: extended with a leave type, status (requested, approved, declined), half days and the approver, instead of a new table. Only approved rows block slots |
| Email system (Resend, templates, unsubscribe) and notifications | Candidate and staff emails |
| Worker profile photo, presence, audit log (`app/workforce/audit.py`) | People records and an audit trail for every HR action |
| Website (fayfort.com, brand fonts) and the /go pages | The public careers page |

## 3. Structure

### 3.1 Where things live (no separate app)

| Who | Place | What |
| --- | --- | --- |
| Candidates (public) | fayfort.com/careers and /careers/{job} | Open roles, the role page, the application form, a "we got it" page |
| Candidates (after applying) | A private link in their email (/careers/status/{token}) | Their application status, interview time picker, trial task upload, offer to accept |
| Owner, CEO and HR staff | Control Center → **People** (replaces "FayFort Workers") | Hiring, Team (today's Workforce), Time off, Documents, Policies, Settings |
| Interviewers | Operations Center → **My work** | Interviews to run and scorecards to fill in, as work items |
| Every staff member | Operations Center → **My account → My HR** | Own profile, time off, documents to sign, policies |

### 3.2 Control Center → People

Tabs along the top, same layout as today's Workforce:

1. **Hiring:** jobs and the candidate pipeline.
2. **Team:** today's directory, worker profile, timesheets and ratings, plus the new employment record on each profile.
3. **Time off:** requests to approve, a calendar of who's away, balances.
4. **Documents:** contracts and signed policies per person, templates.
5. **Policies:** the staff handbook pages and who has acknowledged each version.
6. **Settings:** leave types and allowances (annual, sick and public holidays, changeable any time), probation length,
   data retention, email wording.

### 3.3 Hiring pipeline

Stages, the same for every job, so every list reads the same way:

**Applied → Screening → Interview → Trial task → Offer → Hired**, with **Not moving forward** and **Withdrew** as
closing states at any point.

- **Jobs:** title, department (one of the six desks or Leadership), job type (full time, part time, contract,
  internship), location (Guangzhou office, remote, or both), pay range (optional, shown only if ticked), description,
  what you'll do, what we're looking for, and 3 to 5 screening questions (short answer, yes or no, or multiple choice).
  Status: draft, open, paused, closed. Open jobs show on the careers page.
- **Application form:** name, email, phone (WhatsApp), country and city, languages (English, Chinese, others), CV
  upload (PDF or Word, 5 MB), optional portfolio or LinkedIn link, the job's questions, how they heard about FayFort,
  and consent to keep their details (section 7). Bot protection with the Turnstile check the app's sign-in already uses (the website's content security policy gets Turnstile's script and frame hosts added).
- **Candidate card:** everything they sent, a CV preview, the stage history, notes, scorecards, emails sent, and a
  duplicate warning when the same email applied before.
- **Board view:** columns per stage with drag and drop on a computer; a list grouped by stage on phones. Filters: job,
  stage, country, language, rating.
- **Screening:** a hiring manager reads the answers and moves the person on or closes the application with a reason
  (the reason is internal only).
- **Interview:** choose interviewers and length; the candidate picks a time from their link, using the booking
  engine's free slots across the interviewers' calendars (China time shown with the candidate's own time). Video by
  the Google Meet link once Google Calendar is connected, otherwise a link the manager pastes. Reminders 24 hours and
  1 hour before.
- **Scorecard:** each interviewer rates 4 to 6 skills the job lists (1 to 4 stars) and gives Yes, Maybe or No with a
  note. The decision is only shown to others after they submit their own, so nobody is swayed.
- **Trial task (optional, set per job):** a short task, marked paid or unpaid on each job, with a brief and a due date; the candidate uploads
  the result from their link.
- **Offer:** job title, desks, role, start date, job type, probation length, and a contract made
  from a template. The candidate accepts from their link (typed name and date as a simple signature, with the time and
  IP stored).
- **Hire:** one button, available once the offer is accepted, that
  1. creates the staff invitation with the role, desks and job title (or links an existing FayFort account by email),
  2. creates the employment record with the start date and probation end,
  3. moves the signed offer and CV into the person's Documents,
  4. sets the first-week checklist to start on the start date.

### 3.4 People records

Each team member's profile (today's Workforce profile) gains an **Employment** section:

- **Job:** title, desks, role, manager, job type, location, start date, probation end, contracted hours a week.
- **Personal:** legal name, preferred name, phone, country, city, date of birth (optional), emergency contact.
- **Status timeline:** applied, hired, started, probation passed, role changes, leave, finished; each change
  dated and audited.

### 3.5 Time off

- Leave types: Annual, Sick, Unpaid, Public holiday (China and the person's country), Other. Each has a yearly
  allowance set in People → Settings, pro-rated from the start date.
- **Staff:** request from My HR (dates, half days, type, note, sick note upload for sick leave over 2 days), see
  balances and past requests.
- **Approvers:** the person's manager, else the CEO, else the owner; one tap approve or decline with a note.
- **Effects:** approved time off blocks that person's bookable slots (consultations and tours), removes them from desk
  assignment suggestions and shows "Away until Mon 3 Nov" on their profile and in Team. The clock-in gate tells them
  they're on leave.
- **Calendar:** a month view of who's away by desk, so coverage gaps are visible.

### 3.6 Pay

Pay stays outside FayFort (owner decision 30 Oct 2026): no pay rates, pay summaries or payroll. Timesheets and their
CSV export stay as they are.

### 3.7 Documents and policies

- **Documents per person:** offer and contract, signed policies, certificates. ID documents are never stored. A private storage bucket, signed links that expire, admin only, every view audited.
- **Templates:** offer letter and contract with fields filled from the offer.
- **Policies:** handbook pages (conduct, customer data, working hours, leave, payments and refunds rules for staff).
  A new version asks everyone to read and acknowledge it in My HR; the People → Policies tab shows who hasn't.

### 3.8 Reviews and probation

- Probation review on the probation end date: a task for the manager with the person's ratings, hours, completed work
  and first-week checklist, and a Pass, Extend or End decision.
- Regular reviews every 3 or 6 months (set in Settings): three scores (speed, care, accuracy) and a note from the
  manager, shown next to the person's customer ratings and hours, plus their own short self-review from My HR. Stored in
  a new `hr_reviews` table (customer ratings stay in `worker_ratings`).

### 3.9 Offboarding

A checklist from the profile's "Finish employment" button: last day, reason (internal), reassign their open work
items and chats, cancel their future bookings, deactivate the account on the last day (the existing deactivate),
return of equipment, exit note. The record stays read-only for the retention period.

## 4. Data (new tables)

| Table | Holds |
| --- | --- |
| `hr_jobs` | Job posts, department, type, location, pay range, questions, status |
| `hr_candidates` | One per person (email unique): name, contact, country, languages, consent, retention date |
| `hr_applications` | Candidate × job: answers, CV path, stage, close reason, source, private link token hash |
| `hr_application_events` | Stage changes, notes, emails sent, who and when |
| `hr_interviews` | Application, interviewers, time, link, status (uses the booking engine's slots) |
| `hr_scorecards` | Interviewer, ratings per skill, decision, note |
| `hr_offers` | Terms, contract document, accepted at, signature name, IP |
| `hr_employment` | One per worker: job, manager, type, dates, hours (no pay) |
| `hr_leave_types` (+ new columns on the existing `staff_time_off`) | Allowances per type; requests and approvals live on `staff_time_off` |
| `hr_reviews` | Probation and regular reviews: scores, notes, self-review, decision (there is no admin review table today) |
| `hr_documents` and `hr_policies`, `hr_policy_acknowledgements` | Files and handbook versions |

Row-level security as elsewhere: staff read only their own employment, time off and documents; candidates are
reached only through their private link (token stored as a hash, like staff invitations). Two private buckets:
`hr-cvs` and `hr-documents`.

## 5. Design

Same design language as the facelift (Fraunces headings, Inter text, FayFort Navy palette).

- **Careers page (website, public):** navy hero ("Build FayFort with us", a line about the Guangzhou team and
  remote roles), then the open roles as cards (title, desk, type, location, "Apply"), a short "How hiring works" strip
  with the stages, and life at FayFort photos when you have them. The role page has the description on the left and a
  sticky Apply card on the right; on phones the Apply button is fixed at the bottom. The form is one column with clear
  labels, a CV drop zone and a progress line ("Your details · Questions · Done").
- **Candidate status link:** a simple card with the stage as a step line, what happens next, and the one action for
  that stage (pick a time, upload the task, accept the offer).
- **People → Hiring (Control Center):** jobs list on the left with counts per stage; the board on the right (columns
  per stage, candidate cards with photo initials, country flag, rating stars and days in stage). The candidate card
  opens as a side panel with tabs: Application, Interviews, Scorecards, Activity.
- **Team profile:** today's worker profile with an Employment card, a Time off card (balance bars) and Documents.
- **My HR (Operations, staff):** three cards: Time off (balance and Request), Documents to sign, Policies to read; badges on My account when something needs them.

Wireframes for these screens can go on the facelift design canvas once the structure is agreed.

## 6. Permissions

| Person | Can |
| --- | --- |
| Owner (platform admin) | Everything |
| CEO | Everything except platform settings |
| HR (new flag on a worker, set by the owner) | All jobs, candidates, interviews, offers and the Hire button; time off approvals and policies |
| Interviewer | The candidates they interview, their own scorecards |
| Manager (on the employment record) | Approve their team's time off, run their probation reviews |
| Every staff member | Their own My HR |

Every view of a CV or document, and every stage change, is written to the workforce audit log.

## 7. Candidate data and privacy

- Applicants agree to FayFort keeping their details for a set time (12 months suggested) to consider them for this
  and future roles. After that the application is anonymised and the CV deleted automatically, unless they're hired.
- A candidate can ask to be removed from their status link; that deletes their data after a confirmation.
- No sensitive data is asked for in the application (no ID, date of birth or photo).

## 8. Phases

| # | Phase | Contents |
| --- | --- | --- |
| H1 | Careers and applications | Jobs, careers page and role pages, application form, CV storage, "we got it" email, private status link |
| H2 | Pipeline | People → Hiring board, candidate card, notes, stage emails, closing reasons, duplicates |
| H3 | Interviews and scorecards | Slots from the booking engine, candidate time picker, reminders, scorecards as work items |
| H4 | Offer and hire | Offer templates, accept by link, the Hire button into invitations and onboarding |
| H5 | People records | Employment section, status timeline, documents, policies and acknowledgements |
| H6 | Time off | Leave types, requests, approvals, calendar, effects on bookings and the clock-in gate |
| H7 | Reviews and offboarding | Probation and regular reviews, finish employment checklist |

Each phase ships with migrations, API, screens, emails, tests and screenshots at phone, iPad and desktop, and updates
to this document and the system map. H1 to H4 give you a working hiring flow; H5 to H7 can follow when needed.

## 9. Owner decisions (30 Oct 2026)

1. **Menu name:** "People" in the Control Center, replacing "FayFort Workers".
2. **Careers address:** fayfort.com/careers.
3. **Who hires:** HR. The owner gives a worker the HR flag; HR staff, with the owner and CEO, run jobs, candidates,
   interviews, offers and the Hire button. No per-job hiring managers.
4. **Pay:** stays out of FayFort entirely. No pay rates, pay summaries or payroll screens.
5. **ID documents:** never stored.
6. **Candidate data:** kept for 12 months, then anonymised and the CV deleted, unless hired.
7. **Trial tasks:** decided per job (paid or unpaid is a setting on the job).
8. **Leave allowances:** set and changed in People → Settings, not fixed in code.
