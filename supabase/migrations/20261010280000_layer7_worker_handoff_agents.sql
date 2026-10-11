-- FayFort Human Agents are internal workers, not users attached to client accounts.
-- Existing conversation_handoffs.assigned_to values remain intact so this schema
-- change does not discard assignment history or silently requeue live work.
alter table public.fayfort_workers
    add column if not exists handoff_availability text not null default 'offline',
    add column if not exists handoff_available_until timestamptz,
    add column if not exists handoff_max_active integer not null default 3,
    add column if not exists handoff_availability_updated_at timestamptz not null default now();

alter table public.fayfort_workers drop constraint if exists fayfort_workers_handoff_availability_check;
alter table public.fayfort_workers add constraint fayfort_workers_handoff_availability_check
    check (handoff_availability in ('available', 'away', 'offline'));
alter table public.fayfort_workers drop constraint if exists fayfort_workers_handoff_max_active_check;
alter table public.fayfort_workers add constraint fayfort_workers_handoff_max_active_check
    check (handoff_max_active between 1 and 20);
alter table public.fayfort_workers drop constraint if exists fayfort_workers_handoff_shift_check;
alter table public.fayfort_workers add constraint fayfort_workers_handoff_shift_check
    check ((handoff_availability = 'available' and handoff_available_until is not null)
        or (handoff_availability <> 'available' and handoff_available_until is null));

create index if not exists idx_fayfort_workers_handoff_availability
    on public.fayfort_workers(handoff_availability, handoff_available_until)
    where status = 'active';

comment on column public.fayfort_workers.handoff_available_until is
    'FayFort-wide manual Human Agents shift cutoff; availability expires automatically for queue capacity calculations.';
comment on column public.fayfort_workers.handoff_max_active is
    'FayFort worker maximum concurrent assigned or active handoffs across client accounts, bounded to 1..20.';
