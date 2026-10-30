-- HR and hiring H3: interviews and scorecards (docs/HR_AND_HIRING_PLAN.md).
-- * An interview has one or more interviewers. When the candidate picks a time, each interviewer gets a booking
--   (kind 'interview') in the booking engine, so the no-double-booking rule protects their calendars.
-- * Scorecards: each interviewer rates the job's skills (1 to 4) and says Yes, Maybe or No.
-- Safe to run again.

-- 1. Skills each job is scored on.
alter table public.hr_jobs add column if not exists skills text[] not null default '{}';
alter table public.hr_jobs drop constraint if exists hr_jobs_skills_check;
alter table public.hr_jobs add constraint hr_jobs_skills_check check (cardinality(skills) <= 6);

-- 2. Interviews.
create table if not exists public.hr_interviews (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.hr_applications(id) on delete cascade,
    status text not null default 'proposed' check (status in ('proposed', 'scheduled', 'completed', 'no_show', 'cancelled')),
    minutes integer not null default 30 check (minutes in (30, 45, 60, 90)),
    window_days integer not null default 14 check (window_days between 3 and 30),
    starts_at timestamptz,
    ends_at timestamptz,
    candidate_time_zone text check (candidate_time_zone is null or length(candidate_time_zone) <= 60),
    call_link text check (call_link is null or (call_link ~ '^https://' and length(call_link) <= 500)),
    message text check (message is null or length(message) <= 1000),
    reschedule_count integer not null default 0 check (reschedule_count between 0 and 10),
    reminders jsonb not null default '{}'::jsonb check (jsonb_typeof(reminders) = 'object'),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (status = 'proposed' or status = 'cancelled' or (starts_at is not null and ends_at > starts_at))
);
create index if not exists idx_hr_interviews_application on public.hr_interviews(application_id, created_at desc);
create index if not exists idx_hr_interviews_status_time on public.hr_interviews(status, starts_at);
create unique index if not exists uq_hr_interviews_open on public.hr_interviews(application_id)
    where status in ('proposed', 'scheduled');

create table if not exists public.hr_interview_interviewers (
    id uuid primary key default gen_random_uuid(),
    interview_id uuid not null references public.hr_interviews(id) on delete cascade,
    worker_id uuid not null references public.fayfort_workers(user_id) on delete restrict,
    booking_id uuid references public.bookings(id) on delete set null,
    unique (interview_id, worker_id)
);
create index if not exists idx_hr_interview_interviewers_worker on public.hr_interview_interviewers(worker_id);

-- 3. Scorecards.
create table if not exists public.hr_scorecards (
    id uuid primary key default gen_random_uuid(),
    interview_id uuid not null references public.hr_interviews(id) on delete cascade,
    application_id uuid not null references public.hr_applications(id) on delete cascade,
    interviewer_id uuid not null references auth.users(id) on delete cascade,
    ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object'),
    decision text not null check (decision in ('yes', 'maybe', 'no')),
    note text check (note is null or length(note) <= 2000),
    submitted_at timestamptz not null default now(),
    unique (interview_id, interviewer_id)
);
create index if not exists idx_hr_scorecards_application on public.hr_scorecards(application_id);

-- 4. Activity on an application.
alter table public.hr_application_events drop constraint if exists hr_application_events_kind_check;
alter table public.hr_application_events add constraint hr_application_events_kind_check check (kind in (
    'applied', 'stage_changed', 'note', 'email_sent', 'withdrawn', 'cv_viewed',
    'interview_proposed', 'interview_scheduled', 'interview_cancelled', 'interview_done', 'scorecard'));

-- 5. The booking engine learns the interview kind.
alter table public.bookings drop constraint if exists bookings_kind_check;
alter table public.bookings add constraint bookings_kind_check
    check (kind in ('consultation', 'session', 'tour', 'interview'));
alter table public.bookings drop constraint if exists bookings_source_table_check;
alter table public.bookings add constraint bookings_source_table_check
    check (source_table is null or source_table in ('member_consultations', 'member_tour_bookings', 'member_sessions',
                                                    'hr_interview_interviewers'));

-- 6. Only the API reads and writes these.
alter table public.hr_interviews enable row level security;
alter table public.hr_interview_interviewers enable row level security;
alter table public.hr_scorecards enable row level security;
revoke all on table public.hr_interviews, public.hr_interview_interviewers, public.hr_scorecards from anon, authenticated;
grant select, insert, update, delete on table public.hr_interviews, public.hr_interview_interviewers, public.hr_scorecards
    to service_role;
