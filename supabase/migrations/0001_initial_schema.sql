-- ============================================================
-- FayFort AI
-- Migration 0001: Initial Business Schema
-- ============================================================

-- ------------------------------------------------------------
-- BUSINESSES
-- ------------------------------------------------------------
-- One row represents one company/customer using the platform.
-- This is the foundation for multi-tenant architecture.
-- ------------------------------------------------------------

create table if not exists public.businesses (
    id uuid primary key default gen_random_uuid(),

    name text not null,

    slug text not null unique,

    description text,

    status text not null default 'active'
        check (status in ('active', 'inactive', 'suspended')),

    settings jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists idx_businesses_status
    on public.businesses(status);

create index if not exists idx_businesses_created_at
    on public.businesses(created_at);