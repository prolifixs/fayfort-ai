-- Agent controlled shift state and bounded concurrency for honest queue estimates.
alter table public.business_members
    add column if not exists handoff_availability text not null default 'offline',
    add column if not exists handoff_available_until timestamptz,
    add column if not exists handoff_max_active integer not null default 3,
    add column if not exists handoff_availability_updated_at timestamptz not null default now();

alter table public.business_members drop constraint if exists business_members_handoff_availability_check;
alter table public.business_members add constraint business_members_handoff_availability_check
    check (handoff_availability in ('available', 'away', 'offline'));
alter table public.business_members drop constraint if exists business_members_handoff_max_active_check;
alter table public.business_members add constraint business_members_handoff_max_active_check
    check (handoff_max_active between 1 and 20);
alter table public.business_members drop constraint if exists business_members_handoff_shift_check;
alter table public.business_members add constraint business_members_handoff_shift_check
    check ((handoff_availability = 'available' and handoff_available_until is not null)
        or (handoff_availability <> 'available' and handoff_available_until is null));

create index if not exists idx_business_members_handoff_availability
    on public.business_members(business_id, handoff_availability, handoff_available_until)
    where status = 'active';

alter table public.business_events drop constraint if exists business_events_event_type_check;
alter table public.business_events add constraint business_events_event_type_check check (event_type in (
    'channel.inbound.processed','channel.delivery_retried','connection.created','connection.status_changed',
    'automation.created','automation.enabled_changed','automation.execution_recorded',
    'handoff.requested','handoff.assigned','handoff.taken_over','handoff.returned_to_automation','handoff.agent_availability_changed',
    'request.status_changed','request.updated','entitlement.granted','entitlement.revoked',
    'directory.verification_reviewed','business.settings_updated','connection.settings_updated'
));

comment on column public.business_members.handoff_available_until is 'Manual on-duty cutoff; availability expires automatically for queue capacity calculations.';
comment on column public.business_members.handoff_max_active is 'Agent-configured maximum concurrent assigned or active handoffs, bounded to 1..20.';
