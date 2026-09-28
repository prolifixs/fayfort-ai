-- ============================================================
-- FayFort AI
-- Migration 0006: AI Responses
-- ============================================================

-- AI RESPONSES
-- Stores AI processing information associated with messages.

create table if not exists public.ai_responses (
    id uuid primary key default gen_random_uuid(),

    conversation_id uuid not null
        references public.conversations(id)
        on delete cascade,

    message_id uuid
        references public.messages(id)
        on delete set null,

    model text not null,

    provider text,

    prompt text,

    response_text text,

    system_prompt_version text,

    confidence numeric(5,4),

    latency_ms integer,

    input_tokens integer,
    output_tokens integer,
    total_tokens integer,

    status text not null default 'completed'
        check (status in ('pending', 'completed', 'failed', 'blocked')),

    error_message text,

    metadata jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_ai_responses_conversation_id
    on public.ai_responses(conversation_id);

create index if not exists idx_ai_responses_message_id
    on public.ai_responses(message_id);

create index if not exists idx_ai_responses_model
    on public.ai_responses(model);

create index if not exists idx_ai_responses_status
    on public.ai_responses(status);

create index if not exists idx_ai_responses_created_at
    on public.ai_responses(created_at);