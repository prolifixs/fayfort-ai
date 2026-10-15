-- Database keep-alive (app/infrastructure/keepalive.py): the API writes here every few hours so the
-- Supabase project is never paused for inactivity, and staff can see when it last ran.
create table if not exists public.platform_heartbeats (
    name text primary key check (length(name) between 1 and 60),
    last_at timestamptz not null default now()
);
alter table public.platform_heartbeats enable row level security;
revoke all on table public.platform_heartbeats from public, anon, authenticated;
grant select, insert, update on table public.platform_heartbeats to service_role;
