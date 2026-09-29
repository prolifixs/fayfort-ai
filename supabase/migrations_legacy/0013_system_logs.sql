-- FayFort AI
-- Migration 0013: System Logs

create table if not exists public.system_logs (
    id uuid primary key default gen_random_uuid(),

    business_id uuid
        references public.businesses(id)
        on delete set null,

    user_id uuid
        references auth.users(id)
        on delete set null,

    level text not null default 'info',

    category text not null,

    message text not null,

    metadata jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now()
);

create index if not exists idx_system_logs_business_id
    on public.system_logs(business_id);

create index if not exists idx_system_logs_user_id
    on public.system_logs(user_id);

create index if not exists idx_system_logs_level
    on public.system_logs(level);

create index if not exists idx_system_logs_category
    on public.system_logs(category);

create index if not exists idx_system_logs_created_at
    on public.system_logs(created_at);