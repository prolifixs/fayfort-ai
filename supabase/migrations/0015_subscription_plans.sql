-- FayFort AI
-- Migration 0015: Subscription Plans

create table if not exists public.subscription_plans (
    id uuid primary key default gen_random_uuid(),

    name text not null unique,

    slug text not null unique,

    description text,

    monthly_price numeric(12,2) not null default 0,

    yearly_price numeric(12,2) not null default 0,

    currency text not null default 'USD',

    max_businesses integer,

    max_social_accounts integer,

    max_messages integer,

    max_ai_tokens bigint,

    features jsonb not null default '{}'::jsonb,

    status text not null default 'active',

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists idx_subscription_plans_status
    on public.subscription_plans(status);