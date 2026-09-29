-- FayFort AI
-- Migration 0009: AI Usage / Analytics

-- ============================================
-- AI USAGE
-- ============================================

create table if not exists public.ai_usage (
    id uuid primary key default gen_random_uuid(),

    conversation_id uuid
        references public.conversations(id)
        on delete set null,

    ai_response_id uuid
        references public.ai_responses(id)
        on delete set null,

    model text not null,
    provider text not null default 'openai',

    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    total_tokens integer not null default 0,

    latency_ms integer,

    estimated_cost numeric(12,6),

    status text not null default 'completed',

    source text,

    created_at timestamptz not null default now()
);

-- ============================================
-- INDEXES
-- ============================================

create index if not exists idx_ai_usage_conversation_id
    on public.ai_usage(conversation_id);

create index if not exists idx_ai_usage_ai_response_id
    on public.ai_usage(ai_response_id);

create index if not exists idx_ai_usage_model
    on public.ai_usage(model);

create index if not exists idx_ai_usage_provider
    on public.ai_usage(provider);

create index if not exists idx_ai_usage_status
    on public.ai_usage(status);

create index if not exists idx_ai_usage_created_at
    on public.ai_usage(created_at);

create index if not exists idx_ai_usage_source
    on public.ai_usage(source);