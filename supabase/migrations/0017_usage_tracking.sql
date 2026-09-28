-- FayFort AI
-- Migration 0017: Usage Tracking

create table if not exists public.business_usage (
    id uuid primary key default gen_random_uuid(),

    business_id uuid not null
        references public.businesses(id)
        on delete cascade,

    period_start date not null,

    period_end date not null,

    messages_received bigint not null default 0,

    messages_sent bigint not null default 0,

    ai_requests bigint not null default 0,

    input_tokens bigint not null default 0,

    output_tokens bigint not null default 0,

    total_tokens bigint not null default 0,

    estimated_ai_cost numeric(14,6) not null default 0,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    unique (business_id, period_start, period_end)
);

create index if not exists idx_business_usage_business_id
    on public.business_usage(business_id);

create index if not exists idx_business_usage_period
    on public.business_usage(period_start, period_end);