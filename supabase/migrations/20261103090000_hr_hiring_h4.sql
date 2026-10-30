-- HR and hiring H4: offers, accepting by link, and hiring into the team (docs/HR_AND_HIRING_PLAN.md).
-- * Pay is not stored (owner decision 30 Oct 2026); the offer letter says pay is agreed separately.
-- * The candidate accepts by typing their name; the time and address are kept with the offer as the signature.
-- * Hire sends the existing staff invitation and starts the person's employment record.
-- Safe to run again.

-- 1. Settings for HR: the offer letter template and the usual probation.
create table if not exists public.hr_settings (
    id integer primary key default 1 check (id = 1),
    offer_template text not null default '' check (length(offer_template) <= 8000),
    probation_months integer not null default 3 check (probation_months between 0 and 12),
    offer_days integer not null default 7 check (offer_days between 1 and 30),
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.hr_settings(id) values (1) on conflict (id) do nothing;

-- 2. Offers.
create table if not exists public.hr_offers (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.hr_applications(id) on delete cascade,
    status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'withdrawn', 'expired')),
    job_title text not null check (length(btrim(job_title)) between 2 and 80),
    departments text[] not null default '{}' check (departments <@ array['conversation_intake', 'sourcing', 'fulfillment',
        'disputes', 'member_support', 'store_team']::text[]),
    staff_role text not null default 'staff' check (staff_role in ('staff', 'assistant')),
    job_type text not null check (job_type in ('full_time', 'part_time', 'contract', 'internship')),
    location text not null check (location in ('guangzhou', 'remote', 'both')),
    start_date date not null,
    probation_months integer not null default 3 check (probation_months between 0 and 12),
    hours_per_week integer check (hours_per_week is null or hours_per_week between 1 and 60),
    extra_terms text check (extra_terms is null or length(extra_terms) <= 2000),
    letter text not null check (length(letter) between 1 and 12000),
    expires_on date not null,
    signature_name text check (signature_name is null or length(signature_name) <= 120),
    signature_ip text check (signature_ip is null or length(signature_ip) <= 80),
    responded_at timestamptz,
    decline_reason text check (decline_reason is null or length(decline_reason) <= 500),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_hr_offers_application on public.hr_offers(application_id, created_at desc);
create unique index if not exists uq_hr_offers_open on public.hr_offers(application_id) where status in ('sent', 'accepted');

-- 3. Employment records (people records grow in H5).
create table if not exists public.hr_employment (
    worker_id uuid primary key references public.fayfort_workers(user_id) on delete cascade,
    application_id uuid references public.hr_applications(id) on delete set null,
    offer_id uuid references public.hr_offers(id) on delete set null,
    job_title text check (job_title is null or length(job_title) <= 80),
    job_type text check (job_type is null or job_type in ('full_time', 'part_time', 'contract', 'internship')),
    location text check (location is null or location in ('guangzhou', 'remote', 'both')),
    start_date date,
    probation_end date,
    hours_per_week integer check (hours_per_week is null or hours_per_week between 1 and 60),
    manager_id uuid references auth.users(id) on delete set null,
    status text not null default 'starting' check (status in ('starting', 'active', 'finished')),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 4. The hired person on the application.
alter table public.hr_applications add column if not exists hired_worker_id uuid references auth.users(id) on delete set null;

-- 5. Activity and staff notices.
alter table public.hr_application_events drop constraint if exists hr_application_events_kind_check;
alter table public.hr_application_events add constraint hr_application_events_kind_check check (kind in (
    'applied', 'stage_changed', 'note', 'email_sent', 'withdrawn', 'cv_viewed',
    'interview_proposed', 'interview_scheduled', 'interview_cancelled', 'interview_done', 'scorecard',
    'offer_sent', 'offer_accepted', 'offer_declined', 'offer_withdrawn', 'offer_expired', 'hired'));

alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert',
        'review_needed', 'review_done',
        'member_message', 'new_work', 'payment_received', 'booking', 'tour_booking', 'work_done',
        'quote_declined', 'hiring'
    ));

-- 6. Only the API reads and writes these.
alter table public.hr_settings enable row level security;
alter table public.hr_offers enable row level security;
alter table public.hr_employment enable row level security;
revoke all on table public.hr_settings, public.hr_offers, public.hr_employment from anon, authenticated;
grant select, insert, update, delete on table public.hr_settings, public.hr_offers, public.hr_employment to service_role;
