-- Booking engine (docs/BOOKINGS_AND_EXECUTIVE_PLAN.md section 4): weekly availability, time off, bookings that can
-- never double-book a host, and the rules (lengths, notice, how far ahead, payment hold). Consultations (with the CEO)
-- use it first; staff sessions and tours follow. Safe to run again.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- 1. Weekly hours. weekday: 0 = Monday ... 6 = Sunday, in the person's own time zone.
create table if not exists public.staff_availability (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    weekday smallint not null check (weekday between 0 and 6),
    start_time time not null,
    end_time time not null,
    time_zone text not null default 'Asia/Shanghai' check (length(time_zone) between 3 and 60),
    kinds text[] not null default array['consultation', 'session']::text[]
        check (kinds <@ array['consultation', 'session', 'tour']::text[] and cardinality(kinds) > 0),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (end_time > start_time)
);
create index if not exists idx_staff_availability_worker on public.staff_availability(worker_id, weekday);

-- 2. Blocked time (holidays, travel, "not this Friday").
create table if not exists public.staff_time_off (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    reason text check (reason is null or length(reason) <= 200),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index if not exists idx_staff_time_off_worker on public.staff_time_off(worker_id, ends_at);

-- 3. Bookings. blocked_until = ends_at + the gap after; the exclusion rule makes overlapping live bookings for one
--    host impossible, even when two people press Book at the same moment.
create table if not exists public.bookings (
    id uuid primary key default gen_random_uuid(),
    host_id uuid not null references public.fayfort_workers(user_id) on delete restrict,
    kind text not null check (kind in ('consultation', 'session', 'tour')),
    member_id uuid references auth.users(id) on delete set null,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    blocked_until timestamptz not null,
    status text not null default 'held' check (status in ('held', 'confirmed', 'completed', 'no_show', 'cancelled')),
    hold_expires_at timestamptz,
    source_table text check (source_table is null or source_table in ('member_consultations', 'member_tour_bookings', 'member_sessions')),
    source_id uuid,
    invoice_id uuid references public.commerce_invoices(id) on delete set null,
    topic text check (topic is null or length(topic) <= 1000),
    brief text check (brief is null or length(brief) <= 2000),
    host_note text check (host_note is null or length(host_note) <= 2000),
    call_link text check (call_link is null or (call_link ~ '^https://' and length(call_link) <= 500)),
    google_event_id text check (google_event_id is null or length(google_event_id) <= 200),
    member_time_zone text check (member_time_zone is null or length(member_time_zone) <= 60),
    reschedule_count integer not null default 0 check (reschedule_count between 0 and 20),
    cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
    cancelled_by text check (cancelled_by is null or cancelled_by in ('member', 'staff', 'system')),
    refund text check (refund is null or refund in ('due', 'done', 'none')),
    reminders jsonb not null default '{}'::jsonb check (jsonb_typeof(reminders) = 'object'),
    work_item_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (ends_at > starts_at and blocked_until >= ends_at),
    check (status <> 'held' or hold_expires_at is not null)
);
alter table public.bookings drop constraint if exists bookings_no_double_booking;
alter table public.bookings add constraint bookings_no_double_booking
    exclude using gist (host_id with =, tstzrange(starts_at, blocked_until, '[)') with &&)
    where (status in ('held', 'confirmed'));
create index if not exists idx_bookings_host_time on public.bookings(host_id, starts_at);
create index if not exists idx_bookings_member on public.bookings(member_id, starts_at desc);
create index if not exists idx_bookings_status_time on public.bookings(status, starts_at);
create unique index if not exists uq_bookings_invoice on public.bookings(invoice_id) where invoice_id is not null;
create unique index if not exists uq_bookings_live_source on public.bookings(source_table, source_id)
    where source_id is not null and status in ('held', 'confirmed');

-- 4. The rules, one row (Control Center can change them).
create table if not exists public.booking_settings (
    id smallint primary key default 1 check (id = 1),
    consultation_minutes integer not null default 60 check (consultation_minutes between 15 and 240),
    session_minutes integer not null default 30 check (session_minutes between 15 and 240),
    buffer_minutes integer not null default 15 check (buffer_minutes between 0 and 120),
    min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 336),
    horizon_days integer not null default 60 check (horizon_days between 1 and 365),
    hold_hours integer not null default 24 check (hold_hours between 1 and 168),
    cancel_cutoff_hours integer not null default 24 check (cancel_cutoff_hours between 0 and 336),
    max_member_moves integer not null default 2 check (max_member_moves between 0 and 10),
    session_price numeric(10,2) not null default 25 check (session_price >= 0),
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);
insert into public.booking_settings (id) values (1) on conflict (id) do nothing;

-- 5. Consultations point to their booked time.
alter table public.member_consultations add column if not exists booking_id uuid references public.bookings(id) on delete set null;

-- 6. Access: the API (service role) only.
alter table public.staff_availability enable row level security;
alter table public.staff_time_off enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_settings enable row level security;
revoke all on table public.staff_availability, public.staff_time_off, public.bookings, public.booking_settings
    from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_availability, public.staff_time_off, public.bookings,
    public.booking_settings to service_role;

comment on table public.bookings is
    'Booked times with a host (the CEO for consultations, a worker for sessions, a guide for tours). Held while unpaid, then confirmed.';
