-- Short-lived worker heartbeat for actual online presence in Operations Center.
-- Shift availability remains distinct from online/offline presence.
create table if not exists public.operations_worker_presence (
    worker_id uuid primary key references public.fayfort_workers(user_id) on delete cascade,
    last_seen_at timestamptz not null default now()
);

alter table public.operations_worker_presence enable row level security;
revoke all on table public.operations_worker_presence from anon, authenticated;
grant select, insert, update, delete on table public.operations_worker_presence to service_role;

comment on table public.operations_worker_presence is
    'Operations Center worker heartbeats. Online means a heartbeat within the last 90 seconds; separate from handoff shift availability.';
