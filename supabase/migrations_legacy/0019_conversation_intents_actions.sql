-- FayFort AI
-- Migration 0019: Conversation intents and proposed actions
-- The live Supabase schema already contains these tables. This migration
-- brings the local migration history into parity and is safe to apply there.

create table if not exists public.conversation_intents (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.conversations(id) on delete cascade,
    intent_key text not null,
    intent_status text not null default 'active',
    goal text,
    entities jsonb not null default '{}'::jsonb,
    required_information jsonb not null default '[]'::jsonb,
    missing_information jsonb not null default '[]'::jsonb,
    confidence numeric,
    customer_confirmed boolean not null default false,
    confirmation_requested boolean not null default false,
    source_message_id uuid
        references public.messages(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.conversation_actions (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null
        references public.conversations(id) on delete cascade,
    intent_id uuid
        references public.conversation_intents(id) on delete set null,
    action_key text not null,
    status text not null default 'pending',
    input jsonb not null default '{}'::jsonb,
    result jsonb not null default '{}'::jsonb,
    error text,
    requires_confirmation boolean not null default false,
    confirmed_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_conversation_intents_conversation_id
    on public.conversation_intents(conversation_id);
create index if not exists idx_conversation_intents_active
    on public.conversation_intents(conversation_id, created_at desc)
    where intent_status = 'active';
create index if not exists idx_conversation_intents_source_message_id
    on public.conversation_intents(source_message_id);
create index if not exists idx_conversation_actions_conversation_id
    on public.conversation_actions(conversation_id);
create index if not exists idx_conversation_actions_intent_id
    on public.conversation_actions(intent_id);
create index if not exists idx_conversation_actions_pending
    on public.conversation_actions(conversation_id, created_at desc)
    where status = 'pending';

alter table public.conversation_intents enable row level security;
alter table public.conversation_actions enable row level security;

drop policy if exists "members_can_manage_conversation_intents"
    on public.conversation_intents;
create policy "members_can_manage_conversation_intents"
on public.conversation_intents
for all
using (
    exists (
        select 1
        from public.conversations c
        where c.id = conversation_intents.conversation_id
          and public.is_business_member(c.business_id)
    )
)
with check (
    exists (
        select 1
        from public.conversations c
        where c.id = conversation_intents.conversation_id
          and public.is_business_member(c.business_id)
    )
);

drop policy if exists "members_can_manage_conversation_actions"
    on public.conversation_actions;
create policy "members_can_manage_conversation_actions"
on public.conversation_actions
for all
using (
    exists (
        select 1
        from public.conversations c
        where c.id = conversation_actions.conversation_id
          and public.is_business_member(c.business_id)
    )
)
with check (
    exists (
        select 1
        from public.conversations c
        where c.id = conversation_actions.conversation_id
          and public.is_business_member(c.business_id)
    )
);
