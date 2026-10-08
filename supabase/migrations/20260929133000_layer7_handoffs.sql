-- Layer 7 persisted human takeover and auditable state transitions.
create table if not exists public.conversation_handoffs (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    requested_by uuid not null references auth.users(id),
    assigned_to uuid references auth.users(id),
    status text not null default 'requested'
        check (status in ('requested', 'assigned', 'active', 'returned', 'resolved', 'cancelled')),
    reason text not null default 'customer_requested' check (length(reason) <= 500),
    requested_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    closed_at timestamptz
);
create or replace function public.set_conversation_handoffs_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
drop trigger if exists conversation_handoffs_updated_at on public.conversation_handoffs;
create trigger conversation_handoffs_updated_at
before update on public.conversation_handoffs
for each row execute function public.set_conversation_handoffs_updated_at();
create unique index if not exists idx_one_open_handoff_per_conversation
    on public.conversation_handoffs(conversation_id)
    where status in ('requested', 'assigned', 'active');
create index if not exists idx_handoffs_business_status
    on public.conversation_handoffs(business_id, status, requested_at desc);

create table if not exists public.conversation_handoff_events (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    handoff_id uuid not null references public.conversation_handoffs(id) on delete cascade,
    actor_id uuid not null references auth.users(id),
    event_type text not null check (event_type in ('requested', 'assigned', 'taken_over', 'returned_to_automation')),
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_handoff_events_handoff_time
    on public.conversation_handoff_events(handoff_id, created_at);

alter table public.conversation_handoffs enable row level security;
alter table public.conversation_handoff_events enable row level security;
revoke all on table public.conversation_handoffs, public.conversation_handoff_events from anon, authenticated;
grant select, insert, update, delete on table public.conversation_handoffs to service_role;
grant select, insert on table public.conversation_handoff_events to service_role;
revoke update, delete on table public.conversation_handoff_events from service_role;
comment on table public.conversation_handoffs is 'Business-scoped, persisted human-agent takeovers for conversations.';
comment on table public.conversation_handoff_events is 'Append-only audit history for handoff requests and state transitions.';
