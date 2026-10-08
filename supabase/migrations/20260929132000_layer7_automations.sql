-- Layer 7 safe automation definitions and idempotent execution records.
create table if not exists public.business_automations (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    name text not null check (length(trim(name)) between 1 and 120),
    trigger_type text not null check (trigger_type in ('manual_test', 'conversation_inbound')),
    action_type text not null check (action_type in ('record_test_run')),
    conditions jsonb not null default '{}'::jsonb,
    enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create or replace function public.set_business_automations_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
drop trigger if exists business_automations_updated_at on public.business_automations;
create trigger business_automations_updated_at
before update on public.business_automations
for each row execute function public.set_business_automations_updated_at();

create index if not exists idx_business_automations_business_created
    on public.business_automations(business_id, created_at desc);

create table if not exists public.automation_executions (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    automation_id uuid not null references public.business_automations(id) on delete cascade,
    status text not null check (status in ('dry_run', 'succeeded', 'failed', 'skipped')),
    idempotency_key text not null,
    result jsonb not null default '{}'::jsonb,
    error_code text,
    triggered_by text not null default 'dashboard_or_cli',
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (automation_id, idempotency_key)
);
create index if not exists idx_automation_executions_business_created
    on public.automation_executions(business_id, created_at desc);

alter table public.business_automations enable row level security;
alter table public.automation_executions enable row level security;
revoke all on table public.business_automations, public.automation_executions from anon, authenticated;
grant select, insert, update, delete on table public.business_automations, public.automation_executions to service_role;
comment on table public.business_automations is 'Business-scoped automation definitions. Currently limited to safe internal test action types.';
comment on table public.automation_executions is 'Durable idempotent automation run history; message bodies and credentials are not stored here.';
