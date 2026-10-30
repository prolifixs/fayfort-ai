-- HR H7: probation and regular reviews, and finishing employment (docs/HR_AND_HIRING_PLAN.md sections 3.8 and 3.9).
-- * Reviews are created a week before they are due: the probation review on the probation end date, and regular
--   reviews every few months (People -> Settings). The person writes a short self-review in My HR; their manager (or
--   HR) scores speed, care and accuracy, writes a note and, for probation, decides pass, extend or end.
-- * Finishing employment is a checklist: last day, reason (internal), releasing their work, their future bookings,
--   equipment returned and an exit note. The account is deactivated at the end of the last day.
-- Safe to run again.

-- 1. How often regular reviews happen (0 means never).
alter table public.hr_settings add column if not exists review_every_months integer not null default 6;
alter table public.hr_settings drop constraint if exists hr_settings_review_every_months_check;
alter table public.hr_settings add constraint hr_settings_review_every_months_check check (review_every_months in (0, 3, 6, 12));

-- 2. Reviews.
create table if not exists public.hr_reviews (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references public.fayfort_workers(user_id) on delete cascade,
    kind text not null check (kind in ('probation', 'regular')),
    due_on date not null,
    status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
    reviewer_id uuid references auth.users(id) on delete set null,
    self_review text check (self_review is null or length(self_review) <= 3000),
    self_submitted_at timestamptz,
    scores jsonb not null default '{}'::jsonb check (jsonb_typeof(scores) = 'object'),
    manager_note text check (manager_note is null or length(manager_note) <= 3000),
    decision text check (decision is null or decision in ('pass', 'extend', 'end')),
    completed_at timestamptz,
    completed_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (worker_id, kind, due_on)
);
create index if not exists idx_hr_reviews_open on public.hr_reviews(status, due_on);
create index if not exists idx_hr_reviews_worker on public.hr_reviews(worker_id, due_on desc);

-- 3. Finishing employment.
create table if not exists public.hr_offboarding (
    worker_id uuid primary key references public.fayfort_workers(user_id) on delete cascade,
    last_day date not null,
    reason_kind text not null check (reason_kind in ('resigned', 'contract_ended', 'probation_ended', 'dismissed', 'other')),
    reason text check (reason is null or length(reason) <= 1000),
    steps jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
    exit_note text check (exit_note is null or length(exit_note) <= 3000),
    started_by uuid references auth.users(id) on delete set null,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    deactivated_at timestamptz,
    cancelled_at timestamptz
);

-- 4. Timeline entries and staff notices.
alter table public.hr_employment_events drop constraint if exists hr_employment_events_kind_check;
alter table public.hr_employment_events add constraint hr_employment_events_kind_check check (kind in (
    'record_opened', 'hired', 'started', 'job_changed', 'details_changed', 'probation_passed', 'probation_extended',
    'document_added', 'document_removed', 'policy_accepted', 'finished',
    'review_completed', 'offboarding_started', 'offboarding_cancelled'));

alter table public.operations_worker_notifications
    drop constraint if exists operations_worker_notifications_notification_type_check;
alter table public.operations_worker_notifications
    add constraint operations_worker_notifications_notification_type_check
    check (notification_type in (
        'assigned', 'reassigned', 'member_replied', 'mentioned',
        'work_due', 'work_overdue', 'automation_failed', 'infrastructure_alert',
        'review_needed', 'review_done',
        'member_message', 'new_work', 'payment_received', 'booking', 'tour_booking', 'work_done',
        'quote_declined', 'hiring', 'time_off', 'hr_review'
    ));

-- 5. Only the API reads and writes these.
alter table public.hr_reviews enable row level security;
alter table public.hr_offboarding enable row level security;
revoke all on table public.hr_reviews, public.hr_offboarding from anon, authenticated;
grant select, insert, update, delete on table public.hr_reviews, public.hr_offboarding to service_role;
