-- Operations restructure R7 (docs/OPERATIONS_RESTRUCTURE_PLAN.md): the welcome tour and first-week checklist for new
-- workers, kept on the server so they follow the worker to any device. Also lets a chat's history record that part of
-- it was sent to another desk (R3), which the event list didn't allow yet. Safe to run again.

alter table public.fayfort_workers
    add column if not exists onboarding_completed_at timestamptz,
    add column if not exists onboarding_progress jsonb not null default '{}'::jsonb;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'fayfort_workers_onboarding_progress_object') then
        alter table public.fayfort_workers add constraint fayfort_workers_onboarding_progress_object
            check (jsonb_typeof(onboarding_progress) = 'object');
    end if;
end $$;

comment on column public.fayfort_workers.onboarding_completed_at is
    'When the worker finished or skipped the welcome tour in the Operations Center (null: show it on their next visit).';
comment on column public.fayfort_workers.onboarding_progress is
    'First-week checklist items the worker ticked or that were recorded for them: {"item_key": "timestamp"}.';

alter table public.operations_work_events drop constraint if exists operations_work_events_event_type_check;
alter table public.operations_work_events add constraint operations_work_events_event_type_check check (event_type in (
    'created', 'claimed', 'released', 'assigned', 'transferred', 'status_changed',
    'priority_changed', 'due_date_changed', 'automation_started', 'automation_succeeded',
    'automation_failed', 'reopened', 'completed', 'cancelled', 'handed_off'
));
