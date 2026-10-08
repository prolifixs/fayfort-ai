-- Layer 7 business-scoped connection registry. No provider credentials are stored here.
create table if not exists public.business_connections (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
    display_name text not null check (length(trim(display_name)) between 1 and 120),
    status text not null default 'setup_required'
        check (status in ('setup_required', 'connected', 'paused', 'disconnected', 'error')),
    credential_status text not null default 'not_configured'
        check (credential_status in ('not_configured', 'configured')),
    safe_settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, provider, display_name)
);

create index if not exists idx_business_connections_business_created
    on public.business_connections(business_id, created_at desc);

create or replace function public.set_business_connections_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists business_connections_updated_at on public.business_connections;
create trigger business_connections_updated_at
before update on public.business_connections
for each row execute function public.set_business_connections_updated_at();

alter table public.business_connections enable row level security;
revoke all on table public.business_connections from anon, authenticated;
grant select, insert, update, delete on table public.business_connections to service_role;
comment on table public.business_connections is
    'Business-scoped provider connection metadata and non-secret settings; credentials are managed in a separate secret store.';
