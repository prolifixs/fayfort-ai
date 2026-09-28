-- FayFort AI
-- Migration 0011: Human Handoffs

create table if not exists public.human_handoffs (
    id uuid primary key default gen_random_uuid(),

    conversation_id uuid not null
        references public.conversations(id)
        on delete cascade,

    requested_by uuid
        references auth.users(id)
        on delete set null,

    assigned_to uuid
        references auth.users(id)
        on delete set null,

    reason text,

    status text not null default 'pending',

    priority text not null default 'normal',

    notes text,

    assigned_at timestamptz,

    resolved_at timestamptz,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists idx_human_handoffs_conversation_id
    on public.human_handoffs(conversation_id);

create index if not exists idx_human_handoffs_requested_by
    on public.human_handoffs(requested_by);

create index if not exists idx_human_handoffs_assigned_to
    on public.human_handoffs(assigned_to);

create index if not exists idx_human_handoffs_status
    on public.human_handoffs(status);

create index if not exists idx_human_handoffs_priority
    on public.human_handoffs(priority);

create index if not exists idx_human_handoffs_created_at
    on public.human_handoffs(created_at);