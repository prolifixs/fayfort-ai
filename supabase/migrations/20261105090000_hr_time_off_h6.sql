-- HR H6: time off (docs/HR_AND_HIRING_PLAN.md section 3.5).
-- * Leave requests reuse the booking engine's staff_time_off rows, so approved leave blocks that person's bookable
--   time automatically. Rows without a leave type are the "block time" entries made in Bookings, as before.
-- * Leave types and yearly allowances, working days and public holidays are set in People -> Settings (owner decision
--   30 Oct 2026: allowances are adjusted there, not fixed in code).
-- Safe to run again.

-- 1. Leave on the existing time-off rows.
alter table public.staff_time_off
    add column if not exists leave_type text,
    add column if not exists status text not null default 'approved',
    add column if not exists start_date date,
    add column if not exists end_date date,
    add column if not exists half_day text,
    add column if not exists days numeric(5,1),
    add column if not exists note text,
    add column if not exists approver_id uuid references auth.users(id) on delete set null,
    add column if not exists decided_at timestamptz,
    add column if not exists decision_note text,
    add column if not exists updated_at timestamptz not null default now();
alter table public.staff_time_off drop constraint if exists staff_time_off_status_check;
alter table public.staff_time_off add constraint staff_time_off_status_check
    check (status in ('requested', 'approved', 'declined', 'cancelled'));
alter table public.staff_time_off drop constraint if exists staff_time_off_half_day_check;
alter table public.staff_time_off add constraint staff_time_off_half_day_check
    check (half_day is null or half_day in ('morning', 'afternoon'));
alter table public.staff_time_off drop constraint if exists staff_time_off_leave_check;
alter table public.staff_time_off add constraint staff_time_off_leave_check check (
    leave_type is null or (start_date is not null and end_date is not null and end_date >= start_date and days is not null));
alter table public.staff_time_off drop constraint if exists staff_time_off_note_check;
alter table public.staff_time_off add constraint staff_time_off_note_check
    check ((note is null or length(note) <= 500) and (decision_note is null or length(decision_note) <= 500));
create index if not exists idx_staff_time_off_leave on public.staff_time_off(status, start_date) where leave_type is not null;

-- 2. Leave types and allowances (days a year; empty means not counted).
create table if not exists public.hr_leave_types (
    key text primary key check (key ~ '^[a-z_]{2,30}$'),
    name text not null check (length(btrim(name)) between 2 and 60),
    yearly_days numeric(5,1) check (yearly_days is null or yearly_days between 0 and 365),
    needs_approval boolean not null default true,
    active boolean not null default true,
    position integer not null default 0
);
insert into public.hr_leave_types(key, name, yearly_days, needs_approval, position) values
    ('annual', 'Annual leave', null, true, 1),
    ('sick', 'Sick leave', null, true, 2),
    ('unpaid', 'Unpaid leave', null, true, 3),
    ('other', 'Other', null, true, 4)
on conflict (key) do nothing;

alter table public.staff_time_off drop constraint if exists staff_time_off_leave_type_fkey;
alter table public.staff_time_off add constraint staff_time_off_leave_type_fkey
    foreign key (leave_type) references public.hr_leave_types(key) on update cascade on delete restrict;

-- 3. Working days and public holidays (not counted as leave days).
alter table public.hr_settings
    add column if not exists work_days integer[] not null default '{0,1,2,3,4,5}';
alter table public.hr_settings drop constraint if exists hr_settings_work_days_check;
alter table public.hr_settings add constraint hr_settings_work_days_check
    check (work_days <@ array[0,1,2,3,4,5,6] and cardinality(work_days) between 1 and 7);

create table if not exists public.hr_public_holidays (
    day date not null,
    name text not null check (length(btrim(name)) between 2 and 80),
    region text not null default 'china' check (length(region) between 2 and 40),
    primary key (day, region)
);

-- 4. Staff notices about time off.
alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert',
        'review_needed', 'review_done',
        'member_message', 'new_work', 'payment_received', 'booking', 'tour_booking', 'work_done',
        'quote_declined', 'hiring', 'time_off'
    ));

-- 5. Only the API reads and writes these.
alter table public.hr_leave_types enable row level security;
alter table public.hr_public_holidays enable row level security;
revoke all on table public.hr_leave_types, public.hr_public_holidays from anon, authenticated;
grant select, insert, update, delete on table public.hr_leave_types, public.hr_public_holidays to service_role;
