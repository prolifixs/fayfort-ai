-- ============================================================
-- FayFort AI
-- Migration 0003: Social Accounts
-- ============================================================

-- SOCIAL ACCOUNTS
-- Stores connected Instagram, Facebook and TikTok accounts.
-- A business can have multiple social accounts.

create table if not exists public.social_accounts (
    id uuid primary key default gen_random_uuid(),

    business_id uuid not null
        references public.businesses(id)
        on delete cascade,

    platform text not null
        check (platform in ('instagram', 'facebook', 'tiktok')),

    account_id text not null,
    account_name text,
    username text,

    access_token text,
    refresh_token text,

    token_expires_at timestamptz,

    status text not null default 'active'
        check (status in ('active', 'inactive', 'error', 'disconnected')),

    settings jsonb not null default '{}'::jsonb,

    webhook_id text,
    webhook_status text,

    last_connected_at timestamptz,
    last_synced_at timestamptz,

    connection_error text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_social_accounts_business_id
    on public.social_accounts(business_id);

create index if not exists idx_social_accounts_platform
    on public.social_accounts(platform);

create index if not exists idx_social_accounts_status
    on public.social_accounts(status);

create index if not exists idx_social_accounts_account_id
    on public.social_accounts(account_id);