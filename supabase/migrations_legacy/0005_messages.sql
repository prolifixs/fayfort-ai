-- ============================================================
-- FayFort AI
-- Migration 0005: Messages
-- ============================================================

-- MESSAGES
-- Stores individual messages belonging to a conversation.
-- Messages can come from customers, the AI, or human agents.

create table if not exists public.messages (
    id uuid primary key default gen_random_uuid(),

    conversation_id uuid not null
        references public.conversations(id)
        on delete cascade,

    external_message_id text,

    sender_type text not null
        check (sender_type in ('customer', 'ai', 'agent', 'system')),

    message_type text not null default 'text'
        check (message_type in ('text', 'image', 'video', 'audio', 'file', 'sticker', 'system')),

    content text,

    media_url text,

    reply_to_message_id uuid
        references public.messages(id)
        on delete set null,

    agent_id uuid
        references auth.users(id)
        on delete set null,

    ai_generated boolean not null default false,

    ai_model text,

    ai_confidence numeric(5,4),

    status text not null default 'sent'
        check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),

    metadata jsonb not null default '{}'::jsonb,

    sent_at timestamptz not null default now(),

    created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_messages_conversation_id
    on public.messages(conversation_id);

create index if not exists idx_messages_external_message_id
    on public.messages(external_message_id);

create index if not exists idx_messages_sender_type
    on public.messages(sender_type);

create index if not exists idx_messages_sent_at
    on public.messages(sent_at);

create index if not exists idx_messages_agent_id
    on public.messages(agent_id);

create index if not exists idx_messages_status
    on public.messages(status);