-- Layer 7 interval schedules for safe internal test-run automations.
alter table public.business_automations
    drop constraint if exists business_automations_trigger_type_check;

alter table public.business_automations
    add constraint business_automations_trigger_type_check
    check (trigger_type in ('manual_test', 'conversation_inbound', 'scheduled_interval'));

alter table public.business_automations
    add column if not exists schedule_interval_seconds integer,
    add column if not exists schedule_next_run_at timestamptz,
    add column if not exists schedule_attempts integer not null default 0,
    add column if not exists schedule_last_error_code text;

alter table public.business_automations
    drop constraint if exists business_automations_schedule_interval_check;

alter table public.business_automations
    add constraint business_automations_schedule_interval_check check (
        (trigger_type = 'scheduled_interval'
            and schedule_interval_seconds between 60 and 604800)
        or
        (trigger_type <> 'scheduled_interval'
            and schedule_interval_seconds is null)
    );

create index if not exists idx_business_automations_due_schedules
    on public.business_automations(schedule_next_run_at)
    where trigger_type = 'scheduled_interval' and enabled = true;

comment on column public.business_automations.schedule_interval_seconds is
    'Interval for safe scheduled test-run rules (60 seconds to 7 days).';
comment on column public.business_automations.schedule_next_run_at is
    'Next due time; cleared when a scheduled automation is disabled.';
comment on column public.business_automations.schedule_attempts is
    'Consecutive failures for the current scheduled run, used for exponential backoff.';
comment on column public.business_automations.schedule_last_error_code is
    'Sanitized scheduler failure category; never includes provider content or credentials.';
