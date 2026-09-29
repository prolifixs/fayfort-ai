-- ============================================================
-- FayFort AI
-- Migration 0002: Business Members
-- ============================================================

-- ------------------------------------------------------------
-- BUSINESS MEMBERS
-- ------------------------------------------------------------
-- Connects Supabase Auth users to businesses.
--
-- One user can belong to multiple businesses.
-- One business can have multiple users.
-- ------------------------------------------------------------

create table if not exists public.business_members (
    id uuid primary key default gen_random_uuid(),

    business_id uuid not null
        references public.businesses(id)
        on delete cascade,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    role text not null default 'member'
        check (role in ('owner', 'admin', 'member')),

    status text not null default 'active'
        check (status in ('active', 'inactive')),

    joined_at timestamptz not null default now(),

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint business_members_business_user_unique
        unique (business_id, user_id)
);


-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists idx_business_members_business_id
    on public.business_members(business_id);

create index if not exists idx_business_members_user_id
    on public.business_members(user_id);

create index if not exists idx_business_members_role
    on public.business_members(role);

create index if not exists idx_business_members_status
    on public.business_members(status);