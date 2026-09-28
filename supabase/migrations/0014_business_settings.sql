-- FayFort AI
-- Migration 0014: Business Settings

create table if not exists public.business_settings (
    id uuid primary key default gen_random_uuid(),

    business_id uuid not null unique
        references public.businesses(id)
        on delete cascade,

    ai_enabled boolean not null default true,

    auto_reply_enabled boolean not null default true,

    human_handoff_enabled boolean not null default true,

    default_language text not null default 'en',

    timezone text not null default 'UTC',

    response_delay_seconds integer not null default 0,

    settings jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists idx_business_settings_business_id
    on public.business_settings(business_id);