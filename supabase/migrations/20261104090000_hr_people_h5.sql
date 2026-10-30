-- HR H5: people records, documents and policies (docs/HR_AND_HIRING_PLAN.md sections 3.4 and 3.7).
-- * The employment record (started by Hire in H4, or opened by HR for people already on the team) gains personal
--   details and an emergency contact. No pay and no ID documents (owner decisions 30 Oct 2026).
-- * Documents per person live in the private hr-documents bucket; links are short-lived and every opening is audited.
-- * Policies are handbook pages with versions; publishing a new version asks everyone to read and accept it again.
-- Safe to run again.

-- 1. Personal details on the employment record.
alter table public.hr_employment
    add column if not exists legal_name text check (legal_name is null or length(legal_name) <= 120),
    add column if not exists preferred_name text check (preferred_name is null or length(preferred_name) <= 80),
    add column if not exists phone text check (phone is null or length(phone) <= 40),
    add column if not exists country text check (country is null or length(country) <= 80),
    add column if not exists city text check (city is null or length(city) <= 80),
    add column if not exists date_of_birth date,
    add column if not exists emergency_name text check (emergency_name is null or length(emergency_name) <= 120),
    add column if not exists emergency_relationship text check (emergency_relationship is null or length(emergency_relationship) <= 60),
    add column if not exists emergency_phone text check (emergency_phone is null or length(emergency_phone) <= 40),
    add column if not exists probation_passed_at timestamptz;

-- 2. What happened in someone's time at FayFort.
create table if not exists public.hr_employment_events (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    kind text not null check (kind in ('record_opened', 'hired', 'started', 'job_changed', 'details_changed',
                                       'probation_passed', 'probation_extended', 'document_added', 'document_removed',
                                       'policy_accepted', 'finished')),
    detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
    actor_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);
create index if not exists idx_hr_employment_events_worker on public.hr_employment_events(worker_id, created_at desc);

-- 3. Documents.
create table if not exists public.hr_documents (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    kind text not null check (kind in ('offer', 'contract', 'certificate', 'other')),
    title text not null check (length(btrim(title)) between 1 and 120),
    file_path text check (file_path is null or file_path like 'people/%'),
    file_name text check (file_name is null or length(file_name) <= 160),
    file_type text check (file_type is null or length(file_type) <= 120),
    file_size integer check (file_size is null or file_size between 1 and 10485760),
    offer_id uuid references public.hr_offers(id) on delete set null,
    visible_to_worker boolean not null default true,
    uploaded_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (file_path is not null or offer_id is not null)
);
create index if not exists idx_hr_documents_worker on public.hr_documents(worker_id, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('hr-documents', 'hr-documents', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 4. Policies and who has accepted which version.
create table if not exists public.hr_policies (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text not null check (length(btrim(title)) between 2 and 120),
    summary text not null default '' check (length(summary) <= 300),
    body text not null default '' check (length(body) <= 30000),
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    version integer not null default 0 check (version >= 0),
    published_body text check (published_body is null or length(published_body) <= 30000),
    published_at timestamptz,
    published_by uuid references auth.users(id) on delete set null,
    position integer not null default 0,
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.hr_policy_acknowledgements (
    id uuid primary key default gen_random_uuid(),
    policy_id uuid not null references public.hr_policies(id) on delete cascade,
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    version integer not null check (version >= 1),
    acknowledged_at timestamptz not null default now(),
    unique (policy_id, worker_id, version)
);
create index if not exists idx_hr_policy_acks_worker on public.hr_policy_acknowledgements(worker_id);

-- Starter drafts. Nothing is shown to staff until HR checks and publishes them.
insert into public.hr_policies(slug, title, summary, body, position) values
('code-of-conduct', 'Code of conduct', 'How we treat members, suppliers and each other.',
'Be honest with members. Never promise a price, date or quality you have not checked.
Be respectful in every chat, call and message, with members, suppliers and colleagues.
Keep members'' trust: tell them early when something changes or goes wrong.
Do not accept gifts or money from suppliers. Tell HR if a supplier offers one.
Ask for help when you are unsure. A question asked early saves a member a problem later.', 1),
('customer-data', 'Customer data handling', 'Keeping members'' details private and safe.',
'Use member details only to do your FayFort work.
Never copy member details into personal phones, chats or files.
Do not share screenshots that show member names, addresses, phone numbers or payments outside FayFort.
Lock your screen when you step away. Never share your password or sign-in codes.
Tell your manager straight away if you think member details were seen by someone who should not see them.', 2),
('working-hours', 'Working hours and shifts', 'Clocking in, breaks and being reachable.',
'Clock in when you start and clock out when you finish, in the Operations Center.
Take your breaks with the break button so your hours are right.
If you will be late or can''t work, tell your manager before your shift starts.
Ask for time off in My HR so your bookings and desk cover can be planned.', 3)
on conflict (slug) do nothing;

-- 5. Only the API reads and writes these.
alter table public.hr_employment_events enable row level security;
alter table public.hr_documents enable row level security;
alter table public.hr_policies enable row level security;
alter table public.hr_policy_acknowledgements enable row level security;
revoke all on table public.hr_employment_events, public.hr_documents, public.hr_policies, public.hr_policy_acknowledgements
    from anon, authenticated;
grant select, insert, update, delete on table public.hr_employment_events, public.hr_documents, public.hr_policies,
    public.hr_policy_acknowledgements to service_role;
