-- HR and hiring H1: jobs, candidates, applications and the private CV bucket (docs/HR_AND_HIRING_PLAN.md).
-- * HR staff (the HR flag on a worker), the CEO and platform admins run hiring through the API.
-- * Candidates never sign in: they reach their application through a private link whose token is stored as a hash.
-- * Everything is read and written by the API with the service role; no browser reads these tables directly.
-- Safe to run again.

-- 1. The HR flag on a worker (set by the owner in Control Center -> People).
alter table public.fayfort_workers
    add column if not exists hr_access boolean not null default false;
comment on column public.fayfort_workers.hr_access is
    'HR staff: can run jobs, candidates, interviews, offers and hiring in Control Center -> People.';

-- 2. Jobs.
create table if not exists public.hr_jobs (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80),
    title text not null check (length(btrim(title)) between 2 and 80),
    department text not null check (department in ('conversation_intake', 'sourcing', 'fulfillment', 'disputes',
                                                   'member_support', 'store_team', 'leadership')),
    job_type text not null default 'full_time' check (job_type in ('full_time', 'part_time', 'contract', 'internship')),
    location text not null default 'guangzhou' check (location in ('guangzhou', 'remote', 'both')),
    pay_range text check (pay_range is null or length(pay_range) <= 80),
    show_pay boolean not null default false,
    summary text not null default '' check (length(summary) <= 1200),
    duties text[] not null default '{}' check (cardinality(duties) <= 12),
    requirements text[] not null default '{}' check (cardinality(requirements) <= 12),
    questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 5),
    trial_task boolean not null default false,
    trial_paid boolean not null default false,
    status text not null default 'draft' check (status in ('draft', 'open', 'paused', 'closed')),
    opened_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_hr_jobs_status on public.hr_jobs(status, opened_at desc);

-- 3. Candidates: one per email address.
create table if not exists public.hr_candidates (
    id uuid primary key default gen_random_uuid(),
    email text unique check (email is null or (email = lower(email) and length(email) <= 320)),
    full_name text check (full_name is null or length(full_name) <= 120),
    phone text check (phone is null or length(phone) <= 40),
    location text check (location is null or length(location) <= 120),
    languages text check (languages is null or length(languages) <= 200),
    keep_details boolean not null default false,
    retain_until date not null,
    anonymised_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_hr_candidates_retain on public.hr_candidates(retain_until) where anonymised_at is null;

-- 4. Applications: one per candidate and job.
create table if not exists public.hr_applications (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references public.hr_jobs(id) on delete restrict,
    candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
    stage text not null default 'applied' check (stage in ('applied', 'screening', 'interview', 'trial_task', 'offer',
                                                          'hired', 'not_moving_forward', 'withdrew')),
    close_reason text check (close_reason is null or length(close_reason) <= 300),
    answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
    cv_path text check (cv_path is null or cv_path like 'cvs/%'),
    cv_name text check (cv_name is null or length(cv_name) <= 160),
    cv_type text check (cv_type is null or cv_type in ('application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword')),
    portfolio_url text check (portfolio_url is null or length(portfolio_url) <= 300),
    heard_from text check (heard_from is null or length(heard_from) <= 80),
    token_hash text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
    stage_changed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (job_id, candidate_id)
);
create index if not exists idx_hr_applications_job_stage on public.hr_applications(job_id, stage, created_at desc);
create index if not exists idx_hr_applications_candidate on public.hr_applications(candidate_id);

-- 5. What happened to an application, newest last.
create table if not exists public.hr_application_events (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.hr_applications(id) on delete cascade,
    kind text not null check (kind in ('applied', 'stage_changed', 'note', 'email_sent', 'withdrawn', 'cv_viewed')),
    actor_id uuid references auth.users(id) on delete set null,
    detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
    created_at timestamptz not null default now()
);
create index if not exists idx_hr_application_events_app on public.hr_application_events(application_id, created_at);

-- 6. Only the API (service role) reads and writes hiring data.
alter table public.hr_jobs enable row level security;
alter table public.hr_candidates enable row level security;
alter table public.hr_applications enable row level security;
alter table public.hr_application_events enable row level security;
revoke all on table public.hr_jobs, public.hr_candidates, public.hr_applications, public.hr_application_events
    from anon, authenticated;
grant select, insert, update, delete on table public.hr_jobs, public.hr_candidates, public.hr_applications,
    public.hr_application_events to service_role;

-- 7. Private CV bucket: PDF or Word, up to 5 MB. Read through short signed links the API makes for HR staff.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('hr-cvs', 'hr-cvs', false, 5242880,
    array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'])
on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.hr_applications is
    'A candidate''s application to one job. token_hash is the SHA-256 of the private status link token.';
