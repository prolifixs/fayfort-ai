-- FayFort AI
-- Migration 0016: Business Subscriptions

create table if not exists public.business_subscriptions (
    id uuid primary key default gen_random_uuid(),

    business_id uuid not null
        references public.businesses(id)
        on delete cascade,

    plan_id uuid not null
        references public.subscription_plans(id)
        on delete restrict,

    status text not null default 'active',

    started_at timestamptz not null default now(),

    current_period_start timestamptz,

    current_period_end timestamptz,

    canceled_at timestamptz,

    external_customer_id text,

    external_subscription_id text,

    metadata jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create unique index if not exists idx_business_subscriptions_active
    on public.business_subscriptions(business_id)
    where status = 'active';

create index if not exists idx_business_subscriptions_business_id
    on public.business_subscriptions(business_id);

create index if not exists idx_business_subscriptions_plan_id
    on public.business_subscriptions(plan_id);

create index if not exists idx_business_subscriptions_status
    on public.business_subscriptions(status);