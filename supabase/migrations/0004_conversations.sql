-- ============================================================
-- FayFort AI
-- Migration 0004: Conversations
-- ============================================================

-- CONVERSATIONS
-- Stores customer conversations associated with a business
-- and the social account through which they were received.

create table if not exists public.conversations (
    id uuid primary key default gen_random_uuid(),

    business_id uuid not null
        references public.businesses(id)
        on delete cascade,

    social_account_id uuid
        references public.social_accounts(id)
        on delete set null,

    external_conversation_id text,

    customer_external_id text,
    customer_name text,
    customer_username text,

    platform text
        check (platform in ('instagram', 'facebook', 'tiktok')),

    status text not null default 'open'
        check (status in ('open', 'closed', 'pending', 'archived')),

    assigned_to uuid
        references auth.users(id)
        on delete set null,

    ai_enabled boolean not null default true,

    last_message_at timestamptz,

    metadata jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_conversations_business_id
    on public.conversations(business_id);

create index if not exists idx_conversations_social_account_id
    on public.conversations(social_account_id);

create index if not exists idx_conversations_customer_external_id
    on public.conversations(customer_external_id);

create index if not exists idx_conversations_status
    on public.conversations(status);

create index if not exists idx_conversations_last_message_at
    on public.conversations(last_message_at);